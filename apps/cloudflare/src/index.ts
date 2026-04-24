import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import {
  type HostedRunDrainResult,
  type HostedRunNudgeResult,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  isLocalLoopbackProxyProtocol,
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
export { RunnerContainer } from "./runner-container.ts";
import type { HostedExecutionContainerNamespaceLike } from "./runner-container.ts";
import type { HostedEmailWorkerRequest } from "./hosted-email.ts";
import { handleHostedEmailIngress } from "./hosted-email/worker-ingress.ts";
import {
  createBrowserVaultReplicaAadFields,
  createHostedBrowserVaultReplicaStore,
} from "./browser-vault-store.ts";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.ts";
import { handleRunnerOutboundRequest } from "./runner-outbound.ts";
import {
  asWorkerStringEnvironment,
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
      return requireBoundInternalRouteUser(context, params, "user-run");
    },
    async handle(context, params) {
      return handleRunRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("run", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.run.method],
    name: "user-run",
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
    ctx?: ExecutionContext,
  ): Promise<Response> {
    try {
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
          waitUntil: ctx?.waitUntil.bind(ctx),
        })
      ) ?? notFound();
    } catch (error) {
      return mapWorkerRouteError(request, error);
    }
  },
  async email(
    message: HostedEmailWorkerRequest,
    env: WorkerEnvironmentSource,
    ctx?: ExecutionContext,
  ): Promise<void> {
    await handleHostedEmailIngress(message, env, {
      waitUntil: ctx?.waitUntil.bind(ctx),
    });
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

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async nudgeHostedRun(): Promise<HostedRunNudgeResult> {
    return this.runner.nudgeHostedRun();
  }

  async drainHostedRuns(input?: {
    targetCommittedSeqHint?: string | null;
  }): Promise<HostedRunDrainResult> {
    return this.runner.drainHostedRuns(input);
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
  return json(await stub.status());
}

async function handleDeployContainerSmokeRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  const result = await context.env.RUNNER_CONTAINER
    .getByName("__deploy-smoke")
    .smokeHealth();

  return json({
    ok: result.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}

async function handleRunRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  try {
    await readOptionalJsonObject(context.request);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "run-request-body-invalid",
        routeName: "user-run",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker run route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }
  const stub = await resolveUserRunnerStub(context.env, userId);
  const acceptedResponse = await stub.nudgeHostedRun();
  if (acceptedResponse.alreadyRunning) {
    return json(acceptedResponse, 202);
  }

  const drainPromise = stub.drainHostedRuns().then(() => acceptedResponse).catch(async (error) => {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: buildWorkerRouteLogDetails({
        reason: "run-background-drain-failed",
        routeName: "user-run",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted run background drain failed after the run request was accepted.",
      phase: "wake.running",
      userId,
    });

    try {
      return await stub.nudgeHostedRun();
    } catch (fallbackError) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildWorkerRouteLogDetails({
          reason: "run-retry-arm-fallback-failed",
          routeName: "user-run",
        }, context.request, userId),
        error: fallbackError,
        level: "error",
        message: "Hosted run retry-arm fallback failed after the direct drain call failed.",
        phase: "wake.running",
        userId,
      });
      throw fallbackError;
    }
  });

  if (context.waitUntil) {
    context.waitUntil(drainPromise);
    return json(acceptedResponse, 202);
  }

  return json(await drainPromise, 202);
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
    environment: context.environment,
    userId,
  });
  const replicaStore = createHostedBrowserVaultReplicaStore({
    bucket: context.env.BUNDLES,
    rootKey: crypto.rootKey,
  });
  const replicaEnvelope = await replicaStore.readBrowserVaultReplicaEnvelope(body.replicaRef);

  if (!replicaEnvelope) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }

  const replicaKey = await replicaStore.deriveBrowserVaultReplicaKey(body.replicaRef);
  const replicaKeyEnvelope = await wrapHostedBrowserSessionKey({
    keyBytes: replicaKey,
    keyId: body.replicaRef.keyId,
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
  return await handleRunnerOutboundRequest(
    createLocalInternalProxyRequest(request, internalUrl),
    env,
    boundUserId,
    runnerProxyToken,
  );
}

async function ownsLocalInternalProxyTokenForUser(input: {
  env: WorkerEnvironmentSource;
  token: string;
  userId: string;
}): Promise<boolean> {
  const stub = input.env.RUNNER_CONTAINER.getByName(input.userId);
  return typeof stub.ownsInternalWorkerProxyToken === "function"
    ? await stub.ownsInternalWorkerProxyToken({ token: input.token, userId: input.userId })
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

  try {
    const url = new URL(value);
    return normalizeLocalHostedProxyHostname(url.hostname);
  } catch {
    return null;
  }
}

function normalizeLocalHostedProxyHostname(value: string): string {
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
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
