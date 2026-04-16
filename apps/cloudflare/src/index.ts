import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchStatus,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import {
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
  HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER,
} from "./internal-hosts.ts";
import {
  verifyHostedExecutionVercelOidcRequest,
} from "./auth-adapter.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import {
  json,
  methodNotAllowed,
  notFound,
  unauthorized,
} from "./json.ts";
export { RunnerContainer } from "./runner-container.ts";
import type { HostedExecutionContainerNamespaceLike } from "./runner-container.ts";
import type { HostedEmailWorkerRequest } from "./hosted-email.ts";
import { handleHostedEmailIngress } from "./hosted-email/worker-ingress.ts";
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
  readCachedOptionalJsonObject,
  readCachedRequestText,
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
    authorization: "vercel-oidc",
    async handle(context) {
      return handleDispatchRoute(context);
    },
    match: matchExactPath("/internal/dispatch"),
    methods: ["POST"],
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod: requireBoundInternalRouteUser,
    async handle(context, params) {
      return handleEventStatusRoute(context, params.userId, params.eventId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/events\/(?<eventId>[^/]+)\/status$/u),
    methods: ["GET"],
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
      const localLoopbackProxyResponse = await maybeHandleLocalLoopbackProxyRoute(
        request,
        url,
        env,
      );
      if (localLoopbackProxyResponse) {
        return localLoopbackProxyResponse;
      }
      const localRunnerOutboundProxyResponse = await maybeHandleLocalRunnerOutboundProxyRoute(
        request,
        url,
        env,
      );
      if (localRunnerOutboundProxyResponse) {
        return localRunnerOutboundProxyResponse;
      }
      const publicResponse = await dispatchDeclarativeRoute(workerPublicRoutes, { request, url });
      if (publicResponse) {
        return publicResponse;
      }

      const stringEnv = asWorkerStringEnvironment(env);
      const environment = readHostedExecutionEnvironment(stringEnv);
      return (
        await dispatchDeclarativeRoute(workerInternalRoutes, {
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

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult> {
    return this.runner.dispatchWithOutcome(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async getEventStatus(input: {
    eventId: string;
  }): Promise<HostedExecutionDispatchStatus | null> {
    return this.runner.getEventStatus(input);
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function dispatchDeclarativeRoute<Context>(
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

async function handleDispatchRoute(context: WorkerRouteContext): Promise<Response> {
  const payload = await readCachedRequestText(context);
  const dispatch = parseHostedExecutionDispatchRequest(JSON.parse(payload) as unknown);
  const boundUserError = requireHostedExecutionBoundUserResponse(
    context.request,
    dispatch.event.userId,
    "Hosted execution bound user does not match the dispatch user.",
  );

  if (boundUserError) {
    return boundUserError;
  }

  const result = await (await resolveUserRunnerStub(context.env, dispatch.event.userId)).dispatchWithOutcome(dispatch);
  return result.event.state === "backpressured" ? json(result, 429) : json(result);
}

async function handleStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.status());
}

async function handleEventStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  encodedEventId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const eventId = decodeRouteParam(encodedEventId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.getEventStatus({ eventId }));
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

async function maybeHandleLocalRunnerOutboundProxyRoute(
  request: Request,
  url: URL,
  env: WorkerEnvironmentSource,
): Promise<Response | null> {
  if (!readLocalHostedInternalProxyEnabled(env)) {
    return null;
  }

  const internalHost = readLocalHostedInternalProxyHost(request);
  if (!internalHost) {
    return null;
  }

  if (!isTrustedLocalHostedInternalProxyIngress(url, env)) {
    return unauthorized();
  }

  const boundUserId = readHostedExecutionBoundUserId(request);
  if (!boundUserId) {
    return json({
      error: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound control routes.`,
    }, 401);
  }

  emitHostedExecutionStructuredLog({
    component: "worker",
    details: {
      hostSource: internalHost.source,
      internalHost: internalHost.host,
      method: request.method,
      path: url.pathname,
      userId: boundUserId,
    },
    message: "Hosted worker local runner outbound proxy intercepted request.",
    phase: "side-effects.draining",
    userId: boundUserId,
  });

  const proxiedUrl = new URL(`http://${internalHost.host}${url.pathname}`);
  proxiedUrl.search = url.search;
  const internalWorkerProxyToken = readOptionalTrimmedHeader(
    request,
    HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  );

  return handleRunnerOutboundRequest(
    new Request(proxiedUrl, request),
    env,
    boundUserId,
    internalWorkerProxyToken,
  );
}

async function maybeHandleLocalLoopbackProxyRoute(
  request: Request,
  url: URL,
  env: WorkerEnvironmentSource,
): Promise<Response | null> {
  const configuredToken = readLocalLoopbackProxyToken(env);
  if (!configuredToken) {
    return null;
  }

  const match = /^\/__murph\/local-loopback-proxy\/(?<token>[^/]+)\/(?<origin>[^/]+)(?<path>\/.*)?$/u.exec(
    url.pathname,
  );
  if (!match?.groups) {
    return null;
  }

  if (match.groups.token !== configuredToken) {
    return unauthorized();
  }

  const origin = decodeRouteParam(match.groups.origin);
  const upstreamBaseUrl = readLocalLoopbackProxyBaseUrl(origin);
  if (!upstreamBaseUrl) {
    return json({
      error: "Local loopback proxy only supports loopback http(s) targets.",
    }, 400);
  }

  const upstreamUrl = new URL(
    (match.groups.path ?? "/").replace(/^\//u, ""),
    upstreamBaseUrl,
  );
  upstreamUrl.search = url.search;

  emitHostedExecutionStructuredLog({
    component: "worker",
    details: {
      hasBody: request.body ? "true" : "false",
      hasQuery: url.search.length > 0 ? "true" : "false",
      method: request.method,
      upstreamOrigin: upstreamUrl.origin,
      upstreamPathname: upstreamUrl.pathname,
    },
    message: "Hosted worker local loopback proxy request started.",
    phase: "dispatch.running",
  });

  let response: Response;
  try {
    response = await fetch(createLocalLoopbackProxyRequest(upstreamUrl, request));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        hasBody: request.body ? "true" : "false",
        hasQuery: url.search.length > 0 ? "true" : "false",
        method: request.method,
        upstreamOrigin: upstreamUrl.origin,
        upstreamPathname: upstreamUrl.pathname,
      },
      error,
      level: "warn",
      message: "Hosted worker local loopback proxy request failed.",
      phase: "failed",
    });
    throw error;
  }

  emitHostedExecutionStructuredLog({
    component: "worker",
    details: {
      hasBody: request.body ? "true" : "false",
      hasQuery: url.search.length > 0 ? "true" : "false",
      method: request.method,
      status: String(response.status),
      upstreamOrigin: upstreamUrl.origin,
      upstreamPathname: upstreamUrl.pathname,
    },
    message: "Hosted worker local loopback proxy request completed.",
    phase: "dispatch.running",
  });

  return new Response(response.body, {
    headers: buildLocalLoopbackProxyResponseHeaders(response.headers),
    status: response.status,
  });
}

interface LocalLoopbackProxyRequestInit extends RequestInit {
  duplex?: "half";
}

function createLocalLoopbackProxyRequest(upstreamUrl: URL, request: Request): Request {
  const init: LocalLoopbackProxyRequestInit = {
    headers: buildLocalLoopbackProxyRequestHeaders(request.headers),
    method: request.method,
    signal: request.signal,
  };

  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(upstreamUrl, init);
}

function readLocalHostedInternalProxyEnabled(env: WorkerEnvironmentSource): boolean {
  return readLocalHostedInternalProxyUpstreamHost(env) !== null;
}

function readLocalLoopbackProxyToken(env: WorkerEnvironmentSource): string | null {
  const value = env.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readLocalHostedInternalProxyHost(request: Request): {
  host: string;
  source: "header" | "host";
} | null {
  const explicit = readOptionalTrimmedHeader(request, HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER);
  if (explicit && CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(explicit)) {
    return {
      host: explicit,
      source: "header",
    };
  }

  const hostHeader = readOptionalTrimmedHeader(request, "host");
  const normalizedHost = normalizeWorkerHostHeader(hostHeader);
  if (normalizedHost && CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(normalizedHost)) {
    return {
      host: normalizedHost,
      source: "host",
    };
  }

  return null;
}

function readOptionalTrimmedHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWorkerHostHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

function readLocalLoopbackProxyBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!isLocalLoopbackProxyProtocol(url.protocol) || !isLocalLoopbackProxyHostname(url.hostname)) {
      return null;
    }
    return new URL(`${url.origin}${url.pathname.replace(/\/?$/u, "/")}`);
  } catch {
    return null;
  }
}

function isTrustedLocalHostedInternalProxyIngress(
  url: URL,
  env: WorkerEnvironmentSource,
): boolean {
  if (!isLocalLoopbackProxyProtocol(url.protocol)) {
    return false;
  }

  return resolveLocalHostedInternalProxyIngressHosts(env).has(url.hostname);
}

function isLocalLoopbackProxyProtocol(value: string): boolean {
  return value === "http:" || value === "https:";
}

function isLocalLoopbackProxyHostname(value: string): boolean {
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function isAllowedLocalHostedInternalProxyHostname(value: string): boolean {
  return isLocalLoopbackProxyHostname(value) || value === "host.docker.internal";
}

function resolveLocalHostedInternalProxyIngressHosts(
  env: WorkerEnvironmentSource,
): ReadonlySet<string> {
  const hosts = new Set<string>(["127.0.0.1", "localhost", "::1"]);
  const configuredUpstream = readLocalHostedInternalProxyUpstreamHost(env);

  if (configuredUpstream) {
    hosts.add(configuredUpstream);
  }

  return hosts;
}

function readLocalHostedInternalProxyUpstreamHost(
  env: WorkerEnvironmentSource,
): string | null {
  const value = env.HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value);
    return isAllowedLocalHostedInternalProxyHostname(url.hostname)
      ? (url.hostname || null)
      : null;
  } catch {
    return null;
  }
}

function buildLocalLoopbackProxyRequestHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();

  headers.forEach((value, key) => {
    if (shouldStripLocalLoopbackProxyHeader(key)) {
      return;
    }
    nextHeaders.set(key, value);
  });

  return nextHeaders;
}

function buildLocalLoopbackProxyResponseHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();

  headers.forEach((value, key) => {
    if (shouldStripLocalLoopbackProxyHeader(key)) {
      return;
    }
    nextHeaders.set(key, value);
  });

  return nextHeaders;
}

function shouldStripLocalLoopbackProxyHeader(name: string): boolean {
  switch (name.toLowerCase()) {
    case "connection":
    case "content-length":
    case "host":
    case "keep-alive":
    case "proxy-authenticate":
    case "proxy-authorization":
    case "te":
    case "trailer":
    case "transfer-encoding":
    case "upgrade":
      return true;
    default:
      return false;
  }
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

function isBackpressuredStatus(
  status: HostedExecutionUserStatus,
  eventId: string,
): boolean {
  return (status.backpressuredEventIds ?? []).includes(eventId);
}
