import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedUserRootKeyRecipient,
} from "@murphai/runtime-state";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWakeDrainResult,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";

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
  createHostedBrowserVaultSnapshotStore,
  resolveHostedBrowserVaultSnapshotStorageRef,
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
type WorkerRouteAuthorization = "vercel-oidc" | null;
type WrongMethodResponse = "method-not-allowed" | "not-found";

interface DeclarativeRoute<Context> {
  authorizeBeforeMethod?: boolean;
  authorization?: WorkerRouteAuthorization;
  beforeMethod?(context: Context, params: RouteParams): Promise<Response | null> | Response | null;
  handle(context: Context, params: RouteParams): Promise<Response> | Response;
  match: RouteMatcher;
  methods: readonly string[];
  wrongMethodResponse?: WrongMethodResponse;
}

const workerPublicRoutes: readonly DeclarativeRoute<{
  request: Request;
  url: URL;
}>[] = [
  {
    handle() {
      return createServiceBannerResponse();
    },
    match: matchExactPath("/", "/health"),
    methods: ["GET"],
  },
];

const workerInternalRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod: requireBoundInternalRouteUser,
    async handle(context, params) {
      return handleWakeRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/wake$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod: requireBoundInternalRouteUser,
    async handle(context, params) {
      return handleBrowserVaultSessionRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/browser-vault\/session$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod: requireBoundInternalRouteUser,
    async handle(context, params) {
      return handleStatusRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/status$/u),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
];

export default {
  async fetch(request: Request, env: WorkerEnvironmentSource): Promise<Response> {
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
      const publicResponse = await handleDeclarativeRoute(workerPublicRoutes, { request, url });
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
      return mapWorkerRouteError(error);
    }
  },
  async email(message: HostedEmailWorkerRequest, env: WorkerEnvironmentSource): Promise<void> {
    await handleHostedEmailIngress(message, env);
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

  async wakeHostedWakes(input?: {
    targetSeqHint?: string | null;
  }): Promise<HostedExecutionWakeDrainResult> {
    return this.runner.wakeHostedWakes(input);
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
      const authorizationError = await authorizeRoute(route.authorization ?? null, context);
      if (authorizationError) {
        return authorizationError;
      }
    }

    if (!route.methods.includes(context.request.method)) {
      return respondToWrongMethod(route.wrongMethodResponse ?? "not-found");
    }

    const preMethodResponse = await route.beforeMethod?.(context, params);
    if (preMethodResponse) {
      return preMethodResponse;
    }

    if (!route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, context);
      if (authorizationError) {
        return authorizationError;
      }
    }

    return route.handle(context, params);
  }

  return null;
}

function createServiceBannerResponse(): Response {
  return json({ ok: true, service: "cloudflare-hosted-runner" });
}

async function authorizeRoute(
  authorization: WorkerRouteAuthorization,
  context: { request: Request } & Partial<WorkerRouteContext>,
): Promise<Response | null> {
  switch (authorization) {
    case "vercel-oidc": {
      const validation = context.environment?.vercelOidcValidation;
      if (!validation) {
        return unauthorized();
      }
      const verified = await verifyHostedExecutionVercelOidcRequest({
        request: context.request,
        validation,
      });

      return verified ? null : unauthorized();
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

async function handleWakeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const body = await readOptionalJsonObject(context.request);
  const targetSeqHint = parseOptionalWakeTargetSeqHint(body.targetSeqHint);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.wakeHostedWakes({ targetSeqHint }));
}

async function handleBrowserVaultSessionRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const body = parseBrowserVaultSessionRequest(
    JSON.parse(await readCachedRequestText(context)) as unknown,
  );
  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    environment: context.environment,
    userId,
  });
  const snapshotStore = createHostedBrowserVaultSnapshotStore({
    bucket: context.env.BUNDLES,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
  });
  const snapshotEnvelope = await snapshotStore.readBrowserVaultSnapshotEnvelope(userId);

  if (!snapshotEnvelope) {
    return json({
      rootKeyEnvelope: null,
      snapshotAad: null,
      snapshotEnvelope: null,
    });
  }

  const nowIso = new Date().toISOString();
  const snapshotStorageRef = await resolveHostedBrowserVaultSnapshotStorageRef({
    rootKey: crypto.rootKey,
    userId,
  });
  const recipient = await wrapHostedUserRootKeyRecipient({
    recipient: {
      keyId: `browser-session:${globalThis.crypto.randomUUID()}`,
      kind: "user-unlock",
      publicKeyJwk: body.browserPublicKeyJwk,
    },
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    userId,
  });

  return json({
    rootKeyEnvelope: {
      createdAt: nowIso,
      recipients: [recipient],
      rootKeyId: crypto.rootKeyId,
      schema: HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
      updatedAt: nowIso,
      userId,
    },
    snapshotAad: {
      ...snapshotStorageRef.aadFields,
    },
    snapshotEnvelope,
  });
}

function parseBrowserVaultSessionRequest(value: unknown): {
  browserPublicKeyJwk: ReturnType<typeof parseHostedUserRecipientPublicKeyJwk>;
} {
  const record = requireJsonRecord(value, "Browser vault session request");

  return {
    browserPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    ),
  };
}

function parseOptionalWakeTargetSeqHint(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("targetSeqHint must be a base-10 integer string.");
  }

  try {
    BigInt(value);
  } catch {
    throw new TypeError("targetSeqHint must be a base-10 integer string.");
  }

  return value;
}

function requireBoundInternalRouteUser(
  context: Pick<WorkerRouteContext, "request">,
  params: RouteParams,
): Response | null {
  return requireHostedExecutionBoundUserResponse(
    context.request,
    decodeRouteParam(params.userId),
    "Hosted execution bound user does not match the route user.",
  );
}

function requireHostedExecutionBoundUserResponse(
  request: Request,
  expectedUserId: string,
  mismatchMessage: string,
): Response | null {
  const boundUserId = readHostedExecutionBoundUserId(request);

  if (!boundUserId) {
    return json({
      error: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound control routes.`,
    }, 401);
  }

  if (boundUserId !== expectedUserId) {
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
    return unauthorized();
  }

  const runnerProxyToken = readOptionalTrimmedHeader(
    request,
    HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  );
  if (!runnerProxyToken) {
    return json({
      error: `${HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER} header is required for local internal proxy requests.`,
    }, 401);
  }
  const boundUserId = decodeRouteParam(match.groups.userId);
  const validRunnerProxyToken = await ownsLocalInternalProxyTokenForUser({
    env,
    token: runnerProxyToken,
    userId: boundUserId,
  });
  if (!validRunnerProxyToken) {
    return unauthorized();
  }

  const targetHost = decodeRouteParam(match.groups.host);
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(targetHost)) {
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
    ? await stub.ownsInternalWorkerProxyToken({ token: input.token })
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

function matchNamedPath(pattern: RegExp): RouteMatcher {
  return (pathname) => {
    const match = pattern.exec(pathname);
    if (!match?.groups) {
      return null;
    }
    return match.groups;
  };
}

function respondToWrongMethod(response: WrongMethodResponse): Response {
  return response === "method-not-allowed" ? methodNotAllowed() : notFound();
}

function mapWorkerRouteError(error: unknown): Response {
  emitHostedExecutionStructuredLog({
    component: "worker",
    error,
    level: "error",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  const classified = classifyPublicRouteError(error);
  return json({ error: classified.error }, classified.status);
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
