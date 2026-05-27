import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import type {
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  assertHostedRuntimeProcessingTimeoutMs,
  getHostedBrowserVaultReplicaStorageKeyId,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
  type HostedExecutionBundleRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimePrewarmRequest,
  parseHostedWorkspaceCheckpointResponse,
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
} from "./internal-hosts.ts";
import {
  verifyHostedExecutionVercelOidcRequest,
} from "./auth-adapter.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import {
  verifyHostedWebCallbackSignatureHeaders,
} from "./web-callback-auth.ts";
import {
  json,
  jsonError,
  methodNotAllowed,
  notFound,
  requireJsonObject,
  readOptionalJsonObject,
  unauthorized,
} from "./json.ts";
export { DeploySmokeRunnerContainer, RunnerContainer } from "./runner-container.ts";
import {
  type HostedExecutionContainerNamespaceLike,
  resolveHostedExecutionRunnerContainerName,
} from "./runner-container.ts";
import { handleHostedEmailIngress } from "./hosted-email/worker-ingress.ts";
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
import {
  asWorkerStringEnvironment,
} from "./worker-contracts.ts";
import {
  handleRunnerOutboundRequest,
} from "./runner-outbound.ts";
import {
  writeRunnerRuntimeWriteFenceHeaders,
} from "./runner-outbound/write-fence.ts";
import {
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
} from "./r2-presigned-url.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
} from "./workspace-snapshot-store.ts";
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
type WorkerRouteAuthorization =
  | "vercel-oidc"
  | "web-callback-signature"
  | null;
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
const DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES = 16 * 1024;
const DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES = 4 * 1024;
const DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION = "0";
const DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_BYTES = 160 * 1024 * 1024;
const DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_KEY_PREFIX =
  "deploy-smoke/direct-r2-presigned-put";

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
      return handleTestContainerActivityExpiredRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/container-activity-expired"),
    methods: ["POST"],
    name: "test-container-activity-expired",
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
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context, params) {
      return handleTestCheckpointArtifactWriteFenceRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/checkpoint-artifact-write-fence"),
    methods: ["POST"],
    name: "test-checkpoint-artifact-write-fence",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
    },
    async handle(context, params) {
      return handleTestDirectR2PresignedPutRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/direct-r2-presigned-put"),
    methods: ["POST"],
    name: "test-direct-r2-presigned-put",
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
    authorization: "web-callback-signature",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "runtime-ensure-processing");
    },
    async handle(context, params) {
      return handleRuntimeEnsureProcessingRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("runtimeEnsureProcessing", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.runtimeEnsureProcessing.method],
    name: "runtime-ensure-processing",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "web-callback-signature",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "runtime-prewarm");
    },
    async handle(context, params) {
      return handleRuntimePrewarmRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("runtimePrewarm", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.runtimePrewarm.method],
    name: "runtime-prewarm",
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
      const url = new URL(request.url);
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
    await handleHostedEmailIngress(message, env, ctx);
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

  async ensureRuntimeProcessingForUser(
    input: HostedRuntimeEnsureProcessingRequest & {
      commandTimeoutMs?: number;
      userId: string;
    },
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    return this.runner.ensureRuntimeProcessingForUser(input);
  }

  async prewarmRuntimeContainerForUser(
    input: HostedRuntimePrewarmRequest & {
      userId: string;
    },
  ): Promise<HostedRuntimePrewarmResponse> {
    return this.runner.prewarmRuntimeContainerForUser(input);
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean> {
    return this.runner.validateRuntimeWriteFence(input);
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.createHostedWorkspaceSnapshotUploadSession(input);
  }

  async readHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.readHostedWorkspaceSnapshotUploadSession(input);
  }

  async deleteHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.deleteHostedWorkspaceSnapshotUploadSession(input);
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: Parameters<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]> {
    return this.runner.recordHostedWorkspaceSnapshotOrphanCandidate(input);
  }

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): ReturnType<HostedUserRunner["beginRuntimeWriteFenceForSmoke"]> {
    return this.runner.beginRuntimeWriteFenceForSmoke(input);
  }

  async finishRuntimeWriteFenceForSmoke(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): ReturnType<HostedUserRunner["finishRuntimeWriteFenceForSmoke"]> {
    return this.runner.finishRuntimeWriteFenceForSmoke(input);
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    return await this.runner.runUntilIdleForTest(input);
  }

  async runAlarmForTest(input: { userId: string }): Promise<{ ok: true }> {
    await this.runner.bindUser(input.userId);
    await this.runner.alarm();
    return { ok: true };
  }

  async startStuckInvocationForTest(input: {
    reason?: HostedWorkspaceInvocationReason;
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

      let payload: string;
      try {
        payload = await readCachedRequestText(context, {
          limitBytes: DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES,
        });
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return jsonError("Request body too large.", 413);
        }

        throw error;
      }
      const verified = await verifyHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: context.request.method,
        path: url.pathname,
        payload,
        request: context.request,
        search: url.search,
        userId: readOptionalHostedExecutionUserIdHeader(context.request),
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

function readOptionalHostedExecutionUserIdHeader(request: Request): string | null {
  const value = request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRequestBodyTooLargeError(error: unknown): error is RangeError {
  return error instanceof RangeError && error.message.startsWith("Request body exceeded ");
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

function parseTestWorkspaceInvocationReason(
  value: string | null,
): HostedWorkspaceInvocationReason | "invalid" | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  if (HOSTED_WORKSPACE_INVOCATION_REASONS.includes(value as HostedWorkspaceInvocationReason)) {
    return value as HostedWorkspaceInvocationReason;
  }
  return "invalid";
}

async function handleDeployContainerSmokeRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  const openAiIntercept = context.url.searchParams.get("openAiIntercept") === "1";
  const directR2PresignedPut = context.url.searchParams.get("directR2PresignedPut") === "1";
  const container = context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env));
  const directR2Smoke = directR2PresignedPut
    ? await createDeployContainerDirectR2PresignedPutSmoke(context)
    : null;
  let result: Awaited<ReturnType<typeof container.smokeHealth>>;
  let primaryError: unknown = null;

  try {
    result = openAiIntercept
      ? await runDeployContainerOpenAiInterceptSmokeWithFence(
          context,
          container,
          directR2Smoke?.containerInput,
        )
      : await container.smokeHealth({
          ...(directR2Smoke ? { directR2PresignedPut: directR2Smoke.containerInput } : {}),
          openAiIntercept,
        });

    if (directR2Smoke) {
      await assertDeployContainerDirectR2PresignedPutSmokeObject(context, {
        expectedByteLength: directR2Smoke.containerInput.byteLength,
        objectKey: directR2Smoke.objectKey,
        result: result.directR2PresignedPut ?? null,
      });
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (directR2Smoke) {
      await deleteDeployContainerDirectR2PresignedPutSmokeObject(context, directR2Smoke.objectKey)
        .catch((cleanupError: unknown) => {
          if (!primaryError) {
            throw cleanupError;
          }
          emitHostedExecutionStructuredLog({
            component: "cloudflare.worker",
            details: {
              errorCode: deriveHostedExecutionErrorCode(cleanupError),
              errorName: readHostedExecutionSafeErrorName(cleanupError),
            },
            level: "warn",
            message: "Deploy direct R2 presigned PUT smoke cleanup failed.",
            phase: "failed",
          });
        });
    }
  }

  return json({
    ok: result.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}

async function runDeployContainerOpenAiInterceptSmokeWithFence(
  context: WorkerRouteContext,
  container: ReturnType<WorkerEnvironmentSource["RUNNER_CONTAINER_SMOKE"]["getByName"]>,
  directR2PresignedPut?: {
    byteLength: number;
    presignedPutUrl: string;
  },
): Promise<Awaited<ReturnType<typeof container.smokeHealth>>> {
  const userId = await readDeployContainerOpenAiInterceptSmokeUserId(context);
  if (!userId) {
    throw new TypeError("OpenAI intercept deploy smoke requires openAiInterceptUserId.");
  }

  const userRunner = context.env.USER_RUNNER.getByName(userId);
  if (
    typeof userRunner.beginRuntimeWriteFenceForSmoke !== "function"
    || typeof userRunner.finishRuntimeWriteFenceForSmoke !== "function"
  ) {
    throw new TypeError("Hosted user runner does not support deploy-smoke write fences.");
  }

  const lease = await userRunner.beginRuntimeWriteFenceForSmoke({
    userId,
    workspaceVersion: DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION,
  });
  if (!lease) {
    throw new Error("OpenAI intercept deploy smoke could not acquire a hosted runner write fence.");
  }
  try {
    return await container.smokeHealth({
      ...(directR2PresignedPut ? { directR2PresignedPut } : {}),
      openAiIntercept: true,
      openAiInterceptAuthority: {
        attemptId: lease.attemptId,
        leaseGeneration: lease.generation,
        userId,
        workspaceVersion:
          lease.workspaceVersion ?? DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION,
      },
    });
  } finally {
    await userRunner.finishRuntimeWriteFenceForSmoke({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId,
    });
  }
}

async function createDeployContainerDirectR2PresignedPutSmoke(
  context: WorkerRouteContext,
): Promise<{
  containerInput: {
    byteLength: number;
    presignedPutUrl: string;
  };
  objectKey: string;
}> {
  const objectKey = [
    DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_KEY_PREFIX,
    `${crypto.randomUUID()}.bin`,
  ].join("/");
  const { url } = await createHostedR2PresignedPutUrl({
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(context.env)),
    key: objectKey,
  });

  return {
    containerInput: {
      byteLength: DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_BYTES,
      presignedPutUrl: url,
    },
    objectKey,
  };
}

async function assertDeployContainerDirectR2PresignedPutSmokeObject(
  context: WorkerRouteContext,
  input: {
    expectedByteLength: number;
    objectKey: string;
    result: {
      byteLength?: number | null;
      ok?: boolean;
      payloadSha256?: string | null;
      status?: number | null;
    } | null;
  },
): Promise<void> {
  if (input.result?.ok !== true || input.result.status !== 200) {
    throw new Error("Deploy direct R2 presigned PUT smoke did not complete successfully.");
  }
  if (input.result.byteLength !== input.expectedByteLength) {
    throw new Error("Deploy direct R2 presigned PUT smoke reported an unexpected byte count.");
  }
  if (
    typeof input.result.payloadSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(input.result.payloadSha256)
  ) {
    throw new Error("Deploy direct R2 presigned PUT smoke did not report a payload hash.");
  }

  const bucket = context.env.BUNDLES;
  if (typeof bucket.head !== "function") {
    throw new Error("Deploy direct R2 presigned PUT smoke requires R2 HEAD support.");
  }
  const object = await bucket.head(input.objectKey);
  if (!object) {
    throw new Error("Deploy direct R2 presigned PUT smoke object was not found in R2.");
  }
  if (object.size !== input.expectedByteLength) {
    throw new Error("Deploy direct R2 presigned PUT smoke object had an unexpected byte count.");
  }
}

async function deleteDeployContainerDirectR2PresignedPutSmokeObject(
  context: WorkerRouteContext,
  objectKey: string,
): Promise<void> {
  if (typeof context.env.BUNDLES.delete !== "function") {
    throw new Error("Deploy direct R2 presigned PUT smoke requires R2 delete support.");
  }
  await context.env.BUNDLES.delete(objectKey);
}

async function readDeployContainerOpenAiInterceptSmokeUserId(
  context: WorkerRouteContext,
): Promise<string | null> {
  const payloadText = await readCachedRequestText(context);
  if (!payloadText.trim()) {
    return null;
  }
  const payload = requireJsonRecord(
    parseJsonValue(payloadText),
    "Deploy container smoke request",
  );
  return normalizeNonEmptyString(payload.openAiInterceptUserId);
}

function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
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
  const reason = parseTestWorkspaceInvocationReason(context.url.searchParams.get("reason"));
  if (reason === "invalid") {
    return json({ error: "Unsupported test workspace invocation reason." }, 400);
  }
  return json(await stub.runUntilIdleForTest({
    reason: reason ?? "manual",
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

async function handleTestContainerActivityExpiredRoute(
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
    "test-container-activity-expired",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const runnerContainerName = resolveHostedExecutionRunnerContainerName({
    source: context.env,
    userId,
  });
  const stub = context.env.RUNNER_CONTAINER.getByName(runnerContainerName);
  if (typeof stub.expireActivityForTest !== "function") {
    throw new Error("Hosted runner container test activity-expiry RPC is unavailable.");
  }
  return json(await stub.expireActivityForTest({ userId }));
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
      expiresInMs?: number;
      reason?: HostedWorkspaceInvocationReason;
      userId: string;
    }): Promise<HostedRunnerStuckInvocationTestResult>;
  };
  const reason = parseTestWorkspaceInvocationReason(context.url.searchParams.get("reason"));
  if (reason === "invalid") {
    return json({ error: "Unsupported test stuck invocation reason." }, 400);
  }
  const expiresInMs = parseTestPositiveInteger(
    context.url.searchParams.get("expiresInMs"),
  );
  if (expiresInMs === "invalid") {
    return json({ error: "Unsupported test stuck invocation expiry." }, 400);
  }
  return json(await stub.startStuckInvocationForTest({
    ...(expiresInMs === null ? {} : { expiresInMs }),
    ...(reason ? { reason } : {}),
    userId,
  }));
}

async function handleTestCheckpointArtifactWriteFenceRoute(
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
    "test-checkpoint-artifact-write-fence",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  let body: Record<string, unknown>;
  try {
    body = await readOptionalJsonObject(context.request, {
      limitBytes: DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }

  const expectedWorkspaceVersion = normalizeNonEmptyString(body.expectedWorkspaceVersion);
  if (!expectedWorkspaceVersion) {
    return json({ error: "expectedWorkspaceVersion is required." }, 400);
  }

  const artifactText = normalizeNonEmptyString(body.artifactText)
    ?? "hosted checkpoint write-fence artifact";
  const artifactBytes = new TextEncoder().encode(artifactText);
  const artifactSha256 = await sha256Hex(artifactBytes);
  const snapshotRef = Object.hasOwn(body, "snapshotRef") ? body.snapshotRef : null;

  const stub = context.env.USER_RUNNER.getByName(userId);
  if (
    typeof stub.beginRuntimeWriteFenceForSmoke !== "function"
    || typeof stub.finishRuntimeWriteFenceForSmoke !== "function"
  ) {
    throw new TypeError("Hosted user runner does not support checkpoint artifact write-fence tests.");
  }

  const lease = await stub.beginRuntimeWriteFenceForSmoke({
    userId,
    workspaceVersion: expectedWorkspaceVersion,
  });
  if (!lease) {
    return json({ error: "Hosted runner write fence is already active." }, 409);
  }

  try {
    const checkpointHeaders = createTestRuntimeWriteFenceHeaders({
      attemptId: lease.attemptId,
      generation: lease.generation,
      workspaceVersion: lease.workspaceVersion ?? expectedWorkspaceVersion,
    });
    const checkpointResponse = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH}`, {
        body: JSON.stringify({
          attemptId: lease.attemptId,
          expectedWorkspaceVersion,
          leaseGeneration: lease.generation,
          reason: "idle_shutdown",
          snapshotRef,
        }),
        headers: checkpointHeaders,
        method: "POST",
      }),
      context.env,
      userId,
    );
    if (!checkpointResponse.ok) {
      return json({
        checkpointStatus: checkpointResponse.status,
        error: "Hosted checkpoint write-fence test checkpoint failed.",
        ok: false,
        stage: "checkpoint",
      }, 502);
    }

    const checkpoint = parseHostedWorkspaceCheckpointResponse(await checkpointResponse.clone().json());
    if (!checkpoint.checkpointed) {
      return json({
        checkpointStatus: checkpointResponse.status,
        error: "Hosted checkpoint write-fence test did not update the workspace.",
        ok: false,
        stage: "checkpoint",
        workspaceVersion: checkpoint.workspace.version,
      }, 409);
    }

    const artifactHeaders = createTestRuntimeWriteFenceHeaders({
      attemptId: lease.attemptId,
      generation: lease.generation,
      workspaceVersion: checkpoint.workspace.version,
    });
    const artifactResponse = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: artifactHeaders,
        method: "PUT",
      }),
      context.env,
      userId,
    );
    if (!artifactResponse.ok) {
      return json({
        artifactStatus: artifactResponse.status,
        checkpointedWorkspaceVersion: checkpoint.workspace.version,
        error: "Hosted checkpoint write-fence test artifact upload failed.",
        ok: false,
        stage: "artifact",
      }, 502);
    }

    return json({
      artifact: {
        sha256: artifactSha256,
        size: artifactBytes.byteLength,
        status: artifactResponse.status,
      },
      checkpoint: {
        checkpointed: true,
        previousWorkspaceVersion: expectedWorkspaceVersion,
        status: checkpointResponse.status,
        workspaceVersion: checkpoint.workspace.version,
      },
      ok: true,
    });
  } finally {
    await stub.finishRuntimeWriteFenceForSmoke({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId,
    });
  }
}

async function handleTestDirectR2PresignedPutRoute(
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
    "test-direct-r2-presigned-put",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  let body: Record<string, unknown>;
  try {
    body = await readOptionalJsonObject(context.request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }

  const presignedPutUrl = normalizeNonEmptyString(body.presignedPutUrl);
  if (!presignedPutUrl) {
    return json({ error: "presignedPutUrl is required." }, 400);
  }

  const byteLength = parseTestPositiveIntegerValue(body.byteLength);
  if (byteLength === "invalid") {
    return json({ error: "Unsupported test direct R2 byte length." }, 400);
  }
  const tlsCaCertificatePem = normalizeNonEmptyString(body.tlsCaCertificatePem);

  const container = context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env));
  const result = await container.smokeHealth({
    directR2PresignedPut: {
      ...(byteLength === null ? {} : { byteLength }),
      presignedPutUrl,
      ...(tlsCaCertificatePem ? { tlsCaCertificatePem } : {}),
    },
  });

  return json({
    directR2PresignedPut: result.directR2PresignedPut ?? null,
    ok: result.directR2PresignedPut?.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}

function createTestRuntimeWriteFenceHeaders(input: {
  attemptId: string;
  generation: string;
  workspaceVersion: string;
}): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  writeRunnerRuntimeWriteFenceHeaders(headers, input);
  return headers;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseTestPositiveInteger(value: string | null): number | "invalid" | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return "invalid";
  }
  return parsed;
}

function parseTestPositiveIntegerValue(value: unknown): number | "invalid" | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return "invalid";
  }
  return parsed;
}

async function handleRuntimeEnsureProcessingRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let ensureRequest: HostedRuntimeEnsureProcessingRequest;
  let commandTimeoutMs: number | null;
  try {
    const payload = await readCachedRequestText(context, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
    ensureRequest = parseHostedRuntimeEnsureProcessingRequest(
      requireJsonObject(payload.trim() ? JSON.parse(payload) : {}),
    );
    commandTimeoutMs = readRuntimeEnsureProcessingCommandTimeoutMs(context.request.headers);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runtime-ensure-processing-request-invalid",
        routeName: "runtime-ensure-processing",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker runtime ensure-processing route rejected an invalid request.",
      phase: "failed",
      userId,
    });
    const classified = classifyPublicRouteError(error);
    return json({
      code: "invalid_request",
      error: classified.error,
    }, classified.status);
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.ensureRuntimeProcessingForUser({
    ...ensureRequest,
    ...(commandTimeoutMs === null ? {} : { commandTimeoutMs }),
    userId,
  }));
}

async function handleRuntimePrewarmRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let prewarmRequest: HostedRuntimePrewarmRequest;
  try {
    const payload = await readCachedRequestText(context, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
    prewarmRequest = parseHostedRuntimePrewarmRequest(
      requireJsonObject(payload.trim() ? JSON.parse(payload) : {}),
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runtime-prewarm-request-invalid",
        routeName: "runtime-prewarm",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker runtime prewarm route rejected an invalid request.",
      phase: "failed",
      userId,
    });
    const classified = classifyPublicRouteError(error);
    return json({
      code: "invalid_request",
      error: classified.error,
    }, classified.status);
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.prewarmRuntimeContainerForUser({
    ...prewarmRequest,
    userId,
  }));
}

function readRuntimeEnsureProcessingCommandTimeoutMs(headers: Headers): number | null {
  const value = headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER);
  if (value === null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  if (!/^[0-9]+$/u.test(normalized)) {
    throw new TypeError("Hosted runtime ensure-processing command timeout header must be a positive integer.");
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("Hosted runtime ensure-processing command timeout header must be a positive integer.");
  }
  assertHostedRuntimeProcessingTimeoutMs(
    parsed,
    "Hosted runtime ensure-processing command timeout header",
  );

  return parsed;
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

function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
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
    pathname: redactWorkerRoutePathname(url.pathname),
    reason: input.reason,
    ...(input.routeName ? { routeName: input.routeName } : {}),
    ...(input.targetHost ? { targetHost: input.targetHost } : {}),
    ...(input.userId ?? userId ? { userId: input.userId ?? userId ?? "" } : {}),
  };
}

function redactWorkerRoutePathname(pathname: string): string {
  return pathname.replace(
    /^\/internal\/users\/[^/]+(?=\/|$)/u,
    "/internal/users/<REDACTED_USER>",
  );
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
