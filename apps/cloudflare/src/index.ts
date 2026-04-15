import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchStatus,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

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
      return handleManualRunRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/run$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
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

  async getDeviceSyncRuntimeSnapshot(input: {
    request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
    return this.runner.getDeviceSyncRuntimeSnapshot(input);
  }

  async applyDeviceSyncRuntimeUpdates(input: {
    request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
    return this.runner.applyDeviceSyncRuntimeUpdates(input);
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

async function handleManualRunRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  await readCachedOptionalJsonObject(context);
  const userId = decodeRouteParam(encodedUserId);
  const dispatch = buildHostedExecutionAssistantCronTickDispatch({
    eventId: `manual:${Date.now()}`,
    occurredAt: new Date().toISOString(),
    reason: "manual",
    userId,
  });
  const status = await (await resolveUserRunnerStub(context.env, userId)).dispatch(dispatch);

  return isBackpressuredStatus(status, dispatch.eventId)
    ? json(status, 429)
    : json(status);
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
