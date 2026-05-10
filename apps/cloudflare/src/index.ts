import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import type {
  HostedRunnerNudgeRequest,
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedRunnerNudgeRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionBundleRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedWorkspaceCheckpointRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  assertHostedLocalInternalProxyEnvironment,
  assertHostedLocalInternalProxyBaseUrl,
  isLocalLoopbackProxyProtocol,
  normalizeLocalInternalProxyHostname,
} from "./local-loopback-proxy.ts";
import {
  verifyHostedExecutionVercelOidcRequest,
} from "./auth-adapter.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import {
  verifyHostedWebCallbackSignatureHeaders,
} from "./web-callback-auth.ts";
import {
  json,
  methodNotAllowed,
  notFound,
  readOptionalJsonObject,
  unauthorized,
} from "./json.ts";
export { DeploySmokeRunnerContainer, RunnerContainer } from "./runner-container.ts";
import {
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.ts";
import { handleHostedEmailIngress } from "./hosted-email/worker-ingress.ts";
import { handleLegacyHostedRunnerWakeQueue } from "./legacy-runner-wake-queue.ts";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
  isMissingHostedBundleError,
} from "./bundle-store.ts";
import {
  createBrowserVaultReplicaAadFields,
  createHostedBrowserVaultReplicaStore,
  HostedBrowserVaultReplicaOwnershipError,
  HostedBrowserVaultReplicaRootKeyUnavailableError,
} from "./browser-vault-store.ts";
import {
  HostedUserRunner,
  type HostedRunnerStuckInvocationTestResult,
  type DurableObjectStateLike,
} from "./user-runner.ts";
import { handleRunnerOutboundRequest } from "./runner-outbound.ts";
import {
  buildRunnerBrowserVaultRefreshAttemptId,
  readRunnerBrowserVaultRefreshSourceStateHash,
  RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
} from "./runner-outbound/browser-vault-refresh-authority.ts";
import {
  asWorkerStringEnvironment,
  type WorkerQueueMessageBatchLike,
} from "./worker-contracts.ts";
import {
  decodeRouteParam,
  readCachedRequestText,
  resolveHostedExecutionUserCryptoContext,
  resolveUserRunnerStub,
  type UserRunnerDurableObjectStubLike,
  type WorkerEnvironmentSource,
  type WorkerRouteContext,
} from "./worker-routes/shared.ts";

type RouteParams = Readonly<Record<string, string>>;
type RouteMatcher = (pathname: string) => RouteParams | null;
type WorkerRouteAuthorization = "vercel-oidc" | "web-callback-signature" | null;
type WrongMethodResponse = "method-not-allowed" | "not-found";

interface DeclarativeRoute<Context> {
  authorizeBeforeMethod?: boolean;
  authorization?: WorkerRouteAuthorization;
  beforeMethod?(context: Context, params: RouteParams): Promise<Response | null> | Response | null;
  handle(context: Context, params: RouteParams): Promise<Response> | Response;
  match: RouteMatcher;
  methods: readonly string[];
  name: string;
  wrongMethodResponse?: WrongMethodResponse;
}

const INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES = 4 * 1024;

const workerPublicRoutes: readonly DeclarativeRoute<{
  env: WorkerEnvironmentSource;
  request: Request;
  url: URL;
}>[] = [
  {
    handle(context) {
      return createServiceBannerResponse(context.env);
    },
    match: matchExactPath("/", "/health"),
    methods: ["GET"],
    name: "service-banner",
  },
];

const workerInternalRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context) {
      return handleTestArtifactRoute(context);
    },
    match: matchExactPath("/__test/artifacts"),
    methods: ["GET", "PUT"],
    name: "test-artifact-seed",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context, params) {
      return handleTestRunUntilIdleRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/run-until-idle"),
    methods: ["POST"],
    name: "test-run-until-idle",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context, params) {
      return handleTestRunAlarmRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/alarm"),
    methods: ["POST"],
    name: "test-run-alarm",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context, params) {
      return handleTestStartStuckInvocationRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/stuck-invocation"),
    methods: ["POST"],
    name: "test-start-stuck-invocation",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "web-callback-signature",
    async handle(context) {
      return handleDeployContainerSmokeRoute(context);
    },
    match: matchExactPath("/internal/deploy/container-smoke"),
    methods: ["POST"],
    name: "deploy-container-smoke",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "runner-nudge");
    },
    async handle(context, params) {
      return handleRunnerNudgeRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("runnerNudge", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.runnerNudge.method],
    name: "runner-nudge",
    wrongMethodResponse: "method-not-allowed",
  },

  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "user-data-delete");
    },
    async handle(context, params) {
      return handleUserDataDeleteRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("userDataDelete", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.userDataDelete.method],
    name: "user-data-delete",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "browser-vault-session");
    },
    async handle(context, params) {
      return handleBrowserVaultSessionRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("browserVaultSession", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.browserVaultSession.method],
    name: "browser-vault-session",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "browser-vault-refresh");
    },
    async handle(context, params) {
      return handleBrowserVaultRefreshRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("browserVaultRefresh", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.browserVaultRefresh.method],
    name: "browser-vault-refresh",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "user-status");
    },
    async handle(context, params) {
      return handleStatusRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("status", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.status.method],
    name: "user-status",
    wrongMethodResponse: "method-not-allowed",
  },
];

export default {
  async fetch(
    request: Request,
    env: WorkerEnvironmentSource,
  ): Promise<Response> {
    try {
      assertHostedLocalInternalProxyEnvironment(asWorkerStringEnvironment(env));

      const url = new URL(request.url);
      const localInternalProxyResponse = await maybeHandleLocalInternalProxyRoute(
        request,
        url,
        env,
      );
      if (localInternalProxyResponse) {
        return localInternalProxyResponse;
      }
      const publicResponse = await handleDeclarativeRoute(workerPublicRoutes, { env, request, url });
      if (publicResponse) {
        return publicResponse;
      }

      const stringEnv = asWorkerStringEnvironment(env);
      const environment = readHostedExecutionEnvironment(stringEnv);
      return (
        await handleDeclarativeRoute(workerInternalRoutes, {
          env,
          environment,
          request,
          url,
        })
      ) ?? notFound();
    } catch (error) {
      return mapWorkerRouteError(request, error);
    }
  },
  async email(
    message: ForwardableEmailMessage,
    env: WorkerEnvironmentSource,
    ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    assertHostedLocalInternalProxyEnvironment(asWorkerStringEnvironment(env));

    await handleHostedEmailIngress(message, env, ctx);
  },
  async queue(
    batch: WorkerQueueMessageBatchLike,
    env: WorkerEnvironmentSource,
  ): Promise<void> {
    assertHostedLocalInternalProxyEnvironment(asWorkerStringEnvironment(env));
    await handleLegacyHostedRunnerWakeQueue(batch, env);
  },
};

export class UserRunnerDurableObject extends DurableObject implements UserRunnerDurableObjectStubLike {
  private readonly runner: HostedUserRunner;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    super(state as never, env as never);
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bindUser(userId);
  }

  async deleteHostedUserData(userId: string): ReturnType<HostedUserRunner["deleteHostedUserData"]> {
    return this.runner.deleteHostedUserData(userId);
  }

  async runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse> {
    return this.runner.runnerStatus(input);
  }

  async nudgeHostedRunner(input?: HostedRunnerNudgeRequest): Promise<HostedRunnerNudgeResult> {
    return this.runner.nudgeHostedRunner(input);
  }

  async nudgeHostedRunnerForUser(
    userId: string,
    input?: HostedRunnerNudgeRequest,
  ): Promise<HostedRunnerNudgeResult> {
    return this.runner.nudgeHostedRunnerForUser(userId, input);
  }

  async scheduleBrowserVaultRefreshForUser(input: { userId: string }): ReturnType<HostedUserRunner["scheduleBrowserVaultRefreshForUser"]> {
    return this.runner.scheduleBrowserVaultRefreshForUser(input);
  }

  async scheduleDashboardReplicaRefreshForUser(input: { userId: string }): ReturnType<HostedUserRunner["scheduleBrowserVaultRefreshForUser"]> {
    // Legacy Durable Object method for deploy skew. Deletion target:
    // 2026-05-23, after deployed web callers have switched to
    // `scheduleBrowserVaultRefreshForUser`.
    return this.runner.scheduleBrowserVaultRefreshForUser(input);
  }

  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    return this.runner.ownsActiveInvocationLease(input);
  }

  async recordActiveInvocationHeartbeat(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): ReturnType<HostedUserRunner["recordActiveInvocationHeartbeat"]> {
    return this.runner.recordActiveInvocationHeartbeat(input);
  }

  async recordActiveInvocationContainerStopped(input: {
    attemptId: string;
    leaseGeneration: string;
    stoppedAt?: string | null;
    userId: string;
  }): ReturnType<HostedUserRunner["recordActiveInvocationContainerStopped"]> {
    return this.runner.recordActiveInvocationContainerStopped(input);
  }

  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    return this.runner.recordActiveInvocationWorkspaceCheckpoint(input);
  }

  async runUntilIdleOrBudget(input: {
    reason: HostedWorkspaceInvocationReason;
  }): Promise<HostedWorkspaceInvocationResult> {
    return this.runner.runUntilIdleOrBudget(input);
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.runner.bindUser(input.userId);
    return this.runner.runUntilIdleOrBudget({ reason: input.reason });
  }

  async runAlarmForTest(input: { userId: string }): Promise<{ ok: true }> {
    await this.runner.bindUser(input.userId);
    await this.runner.alarm();
    return { ok: true };
  }

  async startStuckInvocationForTest(input: {
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.runner.bindUser(input.userId);
    return this.runner.startStuckInvocationForTest(input);
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function handleDeclarativeRoute<Context>(
  routes: readonly DeclarativeRoute<Context>[],
  context: Context & { request: Request; url: URL },
): Promise<Response | null> {
  for (const route of routes) {
    const params = route.match(context.url.pathname);
    if (!params) {
      continue;
    }

    if (route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, context, route.name);
      if (authorizationError) {
        return authorizationError;
      }
    }

    if (!route.methods.includes(context.request.method)) {
      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          reason: "wrong-method",
          routeName: route.name,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an unsupported method.",
        phase: "failed",
      });
      return respondToWrongMethod(route.wrongMethodResponse ?? "not-found");
    }

    const preMethodResponse = await route.beforeMethod?.(context, params);
    if (preMethodResponse) {
      return preMethodResponse;
    }

    if (!route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, context, route.name);
      if (authorizationError) {
        return authorizationError;
      }
    }

    return route.handle(context, params);
  }

  return null;
}

function createServiceBannerResponse(env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">): Response {
  const workerVersionId = readWorkerVersionId(env);
  return json({
    ok: true,
    service: "cloudflare-hosted-runner",
    ...(workerVersionId ? { workerVersionId } : {}),
  });
}

function readWorkerVersionId(env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">): string | null {
  const versionId = env.CF_VERSION_METADATA?.id;
  return typeof versionId === "string" && versionId.trim().length > 0
    ? versionId.trim()
    : null;
}

async function authorizeRoute(
  authorization: WorkerRouteAuthorization,
  context: { request: Request } & Partial<WorkerRouteContext>,
  routeName: string,
): Promise<Response | null> {
  switch (authorization) {
    case "web-callback-signature": {
      const callbackSigning = context.environment?.webCallbackSigning;
      const url = context.url;
      if (!callbackSigning || !url) {
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: buildWorkerRouteLogDetails({
            authScheme: "web-callback-signature",
            reason: "missing-callback-signing-environment",
            routeName,
          }, context.request),
          level: "warn",
          message: "Hosted worker route rejected an internal request before auth because callback signing is unavailable.",
          phase: "failed",
        });
        return unauthorized();
      }

      const payload = await readCachedRequestText(context);
      const verified = await verifyHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: context.request.method,
        path: url.pathname,
        payload,
        request: context.request,
        search: url.search,
      });

      if (verified) {
        return null;
      }

      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          authScheme: "web-callback-signature",
          reason: "callback-signature-verification-failed",
          routeName,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an internal request after callback signature verification failed.",
        phase: "failed",
      });
      return unauthorized();
    }
    case "vercel-oidc": {
      const validation = context.environment?.vercelOidcValidation;
      if (!validation) {
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: buildWorkerRouteLogDetails({
            authScheme: "vercel-oidc",
            reason: "missing-vercel-oidc-validation",
            routeName,
          }, context.request),
          level: "warn",
          message: "Hosted worker route rejected an internal request before auth because OIDC validation is unavailable.",
          phase: "failed",
        });
        return unauthorized();
      }
      const verified = await verifyHostedExecutionVercelOidcRequest({
        request: context.request,
        validation,
      });

      if (verified) {
        return null;
      }

      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          authScheme: "vercel-oidc",
          reason: "vercel-oidc-verification-failed",
          routeName,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an internal request after OIDC verification failed.",
        phase: "failed",
      });
      return unauthorized();
    }
    default:
      return null;
  }
}

async function handleStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.runnerStatus(readHostedStatusRouteOptions(context.url)));
}

function readHostedStatusRouteOptions(url: URL): { logLimit?: number } | undefined {
  const rawLogLimit = url.searchParams.get("logLimit");
  if (!rawLogLimit) {
    return undefined;
  }

  const logLimit = Number.parseInt(rawLogLimit, 10);
  return Number.isSafeInteger(logLimit) && logLimit > 0
    ? { logLimit: Math.min(logLimit, 50) }
    : undefined;
}

async function handleDeployContainerSmokeRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  const result = await context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env))
    .smokeHealth();

  return json({
    ok: result.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}

function resolveDeployContainerSmokeObjectName(
  env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">,
): string {
  const workerVersionId = readWorkerVersionId(env);
  return workerVersionId
    ? `__deploy-smoke-${workerVersionId}`
    : "__deploy-smoke";
}

async function handleTestArtifactRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = context.url.searchParams.get("userId")?.trim() ?? "";
  const sha256 = context.url.searchParams.get("sha256")?.trim() ?? "";
  const bundleKey = context.url.searchParams.get("key")?.trim() ?? "";
  const bundleSize = context.url.searchParams.get("size")?.trim() ?? "";

  if (!userId) {
    return json({ error: "userId is required." }, 400);
  }

  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    return json({ error: "sha256 is required." }, 400);
  }

  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test artifact user.",
    "test-artifact-bound-user-mismatch",
    "test-artifact-seed",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "runtime",
    environment: context.environment,
    userId,
  });
  const artifactStore = createHostedArtifactStore({
    bucket: context.env.BUNDLES,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveKeyById: crypto.resolveKeyById,
    userId,
  });
  if (context.request.method === "GET") {
    if (bundleKey) {
      const parsedBundleSize = Number(bundleSize);
      if (!Number.isSafeInteger(parsedBundleSize) || parsedBundleSize < 0) {
        return json({ error: "size is required." }, 400);
      }

      if (isArtifactBackedHostedWorkspaceBundleKey(bundleKey, sha256)) {
        return await readTestHostedArtifactResponse({
          artifactStore,
          expectedSize: parsedBundleSize,
          sha256,
        });
      }

      const bundleStore = createHostedBundleStore({
        bucket: context.env.BUNDLES,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        resolveKeyById: crypto.resolveKeyById,
        userId,
      });
      const ref: HostedExecutionBundleRef = {
        hash: sha256,
        key: bundleKey,
        size: parsedBundleSize,
        updatedAt: "test-route",
      };

      try {
        const bundle = await bundleStore.readBundle(ref);
        if (!bundle) {
          return json({ error: "Hosted artifact was not found." }, 404);
        }

        return new Response(bundle.slice(), {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      } catch (error) {
        if (isMissingHostedBundleError(error)) {
          return json({ error: "Hosted artifact was not found." }, 404);
        }
        throw error;
      }
    }

    return await readTestHostedArtifactResponse({
      artifactStore,
      sha256,
    });
  }

  const bytes = new Uint8Array(await context.request.arrayBuffer());
  await artifactStore.writeArtifact(sha256, bytes);

  return json({
    ok: true,
    sha256,
    size: bytes.byteLength,
    userId,
  });
}

async function readTestHostedArtifactResponse(input: {
  artifactStore: ReturnType<typeof createHostedArtifactStore>;
  expectedSize?: number;
  sha256: string;
}): Promise<Response> {
  const artifact = await input.artifactStore.readArtifact(input.sha256);
  if (!artifact) {
    return json({ error: "Hosted artifact was not found." }, 404);
  }

  if (input.expectedSize !== undefined && artifact.byteLength !== input.expectedSize) {
    return json({ error: "Hosted artifact size did not match the requested bundle ref." }, 409);
  }

  return new Response(artifact.slice(), {
    headers: {
      "content-type": "application/octet-stream",
    },
  });
}

function isArtifactBackedHostedWorkspaceBundleKey(
  key: string,
  sha256: string,
): boolean {
  return key === `cloudflare-workspace-snapshots/${sha256}.bundle`
    || key === `cloudflare-workspace-deltas/${sha256}.bundle`
    || key === `cloudflare-workspace-hot-state/${sha256}.bundle`;
}

function isHostedWorkerTestEnvironment(env: WorkerEnvironmentSource): boolean {
  const stringEnv = asWorkerStringEnvironment(env);
  return stringEnv.NODE_ENV === "test"
    && stringEnv.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1";
}

async function handleTestRunUntilIdleRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = decodeRouteParam(encodedUserId);
  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test runner user.",
    "test-runner-bound-user-mismatch",
    "test-run-until-idle",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId) as UserRunnerDurableObjectStubLike & {
    runUntilIdleForTest(input: {
      reason: HostedWorkspaceInvocationReason;
      userId: string;
    }): Promise<HostedWorkspaceInvocationResult>;
  };
  return json(await stub.runUntilIdleForTest({
    reason: "manual",
    userId,
  }));
}

async function handleTestRunAlarmRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = decodeRouteParam(encodedUserId);
  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test runner user.",
    "test-runner-bound-user-mismatch",
    "test-run-alarm",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.runAlarmForTest({ userId }));
}

async function handleTestStartStuckInvocationRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = decodeRouteParam(encodedUserId);
  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test runner user.",
    "test-runner-bound-user-mismatch",
    "test-start-stuck-invocation",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId) as UserRunnerDurableObjectStubLike & {
    startStuckInvocationForTest(input: {
      userId: string;
    }): Promise<HostedRunnerStuckInvocationTestResult>;
  };
  return json(await stub.startStuckInvocationForTest({ userId }));
}

async function handleRunnerNudgeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let nudgeRequest: HostedRunnerNudgeRequest = {};
  try {
    nudgeRequest = parseHostedRunnerNudgeRequest(await readOptionalJsonObject(context.request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    }));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runner-nudge-request-body-invalid",
        routeName: "runner-nudge",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker runner nudge route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  const nudge = nudgeRequest.aiUsageAllowDecision
    ? await stub.nudgeHostedRunnerForUser(userId, nudgeRequest)
    : await stub.nudgeHostedRunnerForUser(userId);

  return json(nudge, 202);
}


async function handleUserDataDeleteRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  try {
    await readOptionalJsonObject(context.request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "user-data-delete-request-body-invalid",
        routeName: "user-data-delete",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker user-data deletion route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.deleteHostedUserData(userId));
}

async function handleBrowserVaultSessionRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let body;
  try {
    body = parseBrowserVaultSessionRequest(parseJsonValue(await readCachedRequestText(context)));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "browser-vault-session-request-invalid",
        routeName: "browser-vault-session",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker browser-vault session route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }
  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "runtime",
    environment: context.environment,
    userId,
  });
  const replicaStore = createHostedBrowserVaultReplicaStore({
    bucket: context.env.BUNDLES,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    userId,
  });
  let replicaEnvelope;
  try {
    replicaEnvelope = await replicaStore.readBrowserVaultReplicaEnvelope(body.replicaRef);
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaOwnershipError || error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      replicaEnvelope = null;
    } else {
      throw error;
    }
  }

  if (!replicaEnvelope) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }
  const replicaStorageKeyId = getHostedBrowserVaultReplicaStorageKeyId(body.replicaRef);
  if (replicaEnvelope.keyId !== replicaStorageKeyId) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }

  let replicaKey;
  try {
    replicaKey = await replicaStore.deriveBrowserVaultReplicaKey(body.replicaRef);
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      return json({
        code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
        error: "Browser vault replica was not found.",
      }, 404);
    }

    throw error;
  }
  const replicaKeyEnvelope = await wrapHostedBrowserSessionKey({
    keyBytes: replicaKey,
    keyId: replicaStorageKeyId,
    publicKeyJwk: body.browserPublicKeyJwk,
    purpose: "browser-vault-replica",
    userId,
  });

  return json({
    encryptedReplica: replicaEnvelope,
    replicaAad: createBrowserVaultReplicaAadFields({
      ref: body.replicaRef,
      userId,
    }),
    replicaKeyEnvelope,
    replicaRef: body.replicaRef,
    state: "ready",
  });
}

async function handleBrowserVaultRefreshRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  try {
    parseBrowserVaultRefreshRequest(parseJsonValue(await readCachedRequestText(context)));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "browser-vault-refresh-request-invalid",
        routeName: "browser-vault-refresh",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker browser-vault refresh route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  if (stub.scheduleBrowserVaultRefreshForUser) {
    await stub.scheduleBrowserVaultRefreshForUser({ userId });
    return json({
      accepted: true,
      scheduled: true,
      userId,
    });
  }
  if (stub.scheduleDashboardReplicaRefreshForUser) {
    // Legacy Durable Object fallback for deploy skew. Deletion target:
    // 2026-05-23, after deployed Durable Objects expose
    // `scheduleBrowserVaultRefreshForUser`.
    await stub.scheduleDashboardReplicaRefreshForUser({ userId });
    return json({
      accepted: true,
      scheduled: true,
      userId,
    });
  }
  throw new Error("Hosted user runner does not support browser-vault refresh scheduling.");
}

function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

function parseBrowserVaultRefreshRequest(value: unknown): void {
  requireJsonRecord(value, "Browser vault refresh request");
}

function parseBrowserVaultSessionRequest(value: unknown): {
  browserPublicKeyJwk: ReturnType<typeof parseHostedUserRecipientPublicKeyJwk>;
  replicaRef: HostedBrowserVaultReplicaRef;
} {
  const record = requireJsonRecord(value, "Browser vault session request");

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Browser vault session request replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Browser vault session request replicaRef must not be null.");
  }

  return {
    browserPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    ),
    replicaRef,
  };
}

function requireBoundInternalRouteUser(
  context: Pick<WorkerRouteContext, "request">,
  params: RouteParams,
  routeName: string,
): Response | null {
  return requireHostedExecutionBoundUserResponse(
    context.request,
    decodeRouteParam(params.userId),
    "Hosted execution bound user does not match the route user.",
    "bound-user-mismatch",
    routeName,
  );
}

function requireHostedExecutionBoundUserResponse(
  request: Request,
  expectedUserId: string,
  mismatchMessage: string,
  reason: string,
  routeName: string,
): Response | null {
  const boundUserId = readHostedExecutionBoundUserId(request);

  if (!boundUserId) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        boundUserId: null,
        reason: "missing-bound-user-header",
        routeName,
        userId: expectedUserId,
      }, request, expectedUserId),
      level: "warn",
      message: "Hosted worker route rejected a request without the bound-user header.",
      phase: "failed",
      userId: expectedUserId,
    });
    return json({
      error: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound control routes.`,
    }, 401);
  }

  if (boundUserId !== expectedUserId) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        boundUserId,
        reason,
        routeName,
        userId: expectedUserId,
      }, request, expectedUserId),
      level: "warn",
      message: "Hosted worker route rejected a request because the bound user did not match the route user.",
      phase: "failed",
      userId: expectedUserId,
    });
    return json({
      error: mismatchMessage,
    }, 401);
  }

  return null;
}

function readHostedExecutionBoundUserId(request: Request): string | null {
  const value = request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER);

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

interface InternalProxyRequestInit extends RequestInit {
  duplex?: "half";
}

async function maybeHandleLocalInternalProxyRoute(
  request: Request,
  url: URL,
  env: WorkerEnvironmentSource,
): Promise<Response | null> {
  if (!readLocalHostedInternalProxyIngressHost(env)) {
    return null;
  }

  const match =
    /^\/__murph\/local-internal-proxy\/users\/(?<userId>[^/]+)\/(?<host>[^/]+)(?<path>\/.*)?$/u.exec(
      url.pathname,
    );
  if (!match?.groups) {
    return null;
  }

  if (!isTrustedLocalHostedInternalProxyIngress(url, env)) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "untrusted-local-internal-proxy-ingress",
        routeName: "local-internal-proxy",
      }, request),
      level: "warn",
      message: "Hosted worker rejected an untrusted local internal proxy ingress request.",
      phase: "failed",
    });
    return unauthorized();
  }

  const boundUserId = decodeRouteParam(match.groups.userId);
  const runnerProxyToken = readOptionalTrimmedHeader(
    request,
    HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  );
  if (!runnerProxyToken) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "missing-runner-proxy-token",
        routeName: "local-internal-proxy",
      }, request, boundUserId),
      level: "warn",
      message: "Hosted worker rejected a local internal proxy request without the runner proxy token.",
      phase: "failed",
      userId: boundUserId,
    });
    return json({
      error: `${HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER} header is required for local internal proxy requests.`,
    }, 401);
  }
  const validRunnerProxyToken = await ownsLocalInternalProxyTokenForUser({
    env,
    token: runnerProxyToken,
    userId: boundUserId,
  });
  if (!validRunnerProxyToken) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runner-proxy-token-verification-failed",
        routeName: "local-internal-proxy",
      }, request, boundUserId),
      level: "warn",
      message: "Hosted worker rejected a local internal proxy request after proxy-token verification failed.",
      phase: "failed",
      userId: boundUserId,
    });
    return unauthorized();
  }

  const targetHost = decodeRouteParam(match.groups.host);
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(targetHost)) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "local-internal-proxy-target-host-not-found",
        routeName: "local-internal-proxy",
        targetHost,
      }, request, boundUserId),
      level: "warn",
      message: "Hosted worker rejected a local internal proxy request for an unknown internal host.",
      phase: "failed",
      userId: boundUserId,
    });
    return notFound();
  }

  const internalUrl = new URL(`http://${targetHost}${match.groups.path ?? "/"}`);
  internalUrl.search = url.search;
  if (
    targetHost === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane
    && internalUrl.pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
  ) {
    const checkpointRequest = parseHostedWorkspaceCheckpointRequest(
      await readOptionalJsonObject(request.clone() as Request),
    );
    const validCheckpointLease = await ownsLocalInternalProxyTokenForUser({
      attemptId: checkpointRequest.attemptId,
      env,
      leaseGeneration: checkpointRequest.leaseGeneration,
      token: runnerProxyToken,
      userId: boundUserId,
    });
    if (!validCheckpointLease) {
      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          reason: "runner-proxy-token-lease-verification-failed",
          routeName: "local-internal-proxy",
        }, request, boundUserId),
        level: "warn",
        message: "Hosted worker rejected a local workspace checkpoint after lease-token verification failed.",
        phase: "failed",
        userId: boundUserId,
      });
      return unauthorized();
    }
  }
  const refreshSourceStateHash =
    targetHost === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore
      && internalUrl.pathname === "/replicas"
      && request.method === "POST"
      ? readRunnerBrowserVaultRefreshSourceStateHash(request)
      : null;
  const tokenOwnsRefreshLease = refreshSourceStateHash
    ? false
    : await ownsLocalInternalProxyTokenForUser({
        env,
        leaseGeneration: RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
        token: runnerProxyToken,
        userId: boundUserId,
      });
  const refreshProxyContext = refreshSourceStateHash
    ? {
        proxyAttemptId: buildRunnerBrowserVaultRefreshAttemptId(refreshSourceStateHash),
        proxyLeaseGeneration: RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
      }
    : tokenOwnsRefreshLease
      ? {
          proxyLeaseGeneration: RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION,
        }
    : null;
  if (refreshSourceStateHash && refreshProxyContext) {
    const validRefreshLease = await ownsLocalInternalProxyTokenForUser({
      attemptId: refreshProxyContext.proxyAttemptId,
      env,
      leaseGeneration: refreshProxyContext.proxyLeaseGeneration,
      token: runnerProxyToken,
      userId: boundUserId,
    });
    if (!validRefreshLease) {
      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          reason: "runner-proxy-token-refresh-verification-failed",
          routeName: "local-internal-proxy",
        }, request, boundUserId),
        level: "warn",
        message: "Hosted worker rejected a local browser-vault refresh after proxy-token verification failed.",
        phase: "failed",
        userId: boundUserId,
      });
      return unauthorized();
    }
  }
  return await handleRunnerOutboundRequest(
    createLocalInternalProxyRequest(request, internalUrl),
    env,
    boundUserId,
    runnerProxyToken,
    refreshProxyContext ?? undefined,
  );
}

async function ownsLocalInternalProxyTokenForUser(input: {
  attemptId?: string;
  env: WorkerEnvironmentSource;
  leaseGeneration?: string;
  token: string;
  userId: string;
}): Promise<boolean> {
  const stub = input.env.RUNNER_CONTAINER.getByName(
    resolveHostedExecutionRunnerContainerName({
      source: input.env,
      userId: input.userId,
    }),
  );
  return typeof stub.ownsInternalWorkerProxyToken === "function"
    ? await stub.ownsInternalWorkerProxyToken({
        ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
        ...(input.leaseGeneration === undefined
          ? {}
          : { leaseGeneration: input.leaseGeneration }),
        token: input.token,
        userId: input.userId,
      })
    : false;
}

function isTrustedLocalHostedInternalProxyIngress(
  url: URL,
  env: WorkerEnvironmentSource,
): boolean {
  if (!isLocalLoopbackProxyProtocol(url.protocol)) {
    return false;
  }

  return resolveLocalHostedInternalProxyIngressHosts(env).has(
    normalizeLocalHostedProxyHostname(url.hostname),
  );
}

function resolveLocalHostedInternalProxyIngressHosts(
  env: WorkerEnvironmentSource,
): ReadonlySet<string> {
  const hosts = new Set<string>(["127.0.0.1", "localhost", "::1"]);
  const configuredHost = readLocalHostedInternalProxyIngressHost(env);

  if (configuredHost) {
    hosts.add(configuredHost);
  }

  return hosts;
}

function readLocalHostedInternalProxyIngressHost(
  env: WorkerEnvironmentSource,
): string | null {
  const value = env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const url = assertHostedLocalInternalProxyBaseUrl(value);
  return normalizeLocalInternalProxyHostname(url.hostname);
}

function normalizeLocalHostedProxyHostname(value: string): string {
  return normalizeLocalInternalProxyHostname(value);
}

function createLocalInternalProxyRequest(
  request: Request,
  internalUrl: URL,
): Request {
  const init: InternalProxyRequestInit = {
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  };

  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(internalUrl, init);
}

function readOptionalTrimmedHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function matchExactPath(...paths: readonly string[]): RouteMatcher {
  const allowedPaths = new Set(paths);
  return (pathname) => (allowedPaths.has(pathname) ? {} : null);
}

function matchTestUserRoute(prefix: string, suffix: string): RouteMatcher {
  return (pathname) => {
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
      return null;
    }

    const userId = pathname.slice(prefix.length, pathname.length - suffix.length);
    return userId.length > 0 ? { userId } : null;
  };
}

function respondToWrongMethod(response: WrongMethodResponse): Response {
  return response === "method-not-allowed" ? methodNotAllowed() : notFound();
}

function mapWorkerRouteError(request: Request, error: unknown): Response {
  emitHostedExecutionStructuredLog({
    component: "worker",
    details: buildWorkerRouteLogDetails({
      reason: "route-handler-threw",
    }, request),
    error,
    level: "error",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  const classified = classifyPublicRouteError(error);
  return json({ error: classified.error }, classified.status);
}

function buildWorkerRouteLogDetails(
  input: {
    authScheme?: string | null;
    boundUserId?: string | null;
    reason: string;
    routeName?: string | null;
    targetHost?: string | null;
    userId?: string | null;
  },
  request: Request,
  userId?: string | null,
): Record<string, string> {
  const url = new URL(request.url);
  const boundUserId = input.boundUserId ?? readHostedExecutionBoundUserId(request);
  return {
    ...(input.authScheme ? { authScheme: input.authScheme } : {}),
    ...(boundUserId ? { boundUserId } : {}),
    host: url.host,
    method: request.method,
    pathname: url.pathname,
    reason: input.reason,
    ...(input.routeName ? { routeName: input.routeName } : {}),
    ...(input.targetHost ? { targetHost: input.targetHost } : {}),
    ...(input.userId ?? userId ? { userId: input.userId ?? userId ?? "" } : {}),
  };
}

function classifyPublicRouteError(error: unknown): { error: string; status: number } {
  if (error instanceof SyntaxError) {
    return { error: "Invalid JSON.", status: 400 };
  }
  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return { error: "Invalid request.", status: 400 };
  }
  return { error: "Internal error.", status: 500 };
}
