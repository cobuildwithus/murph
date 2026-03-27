import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.js";
import { readHostedExecutionEnvironment } from "./env.js";
import type {
  HostedExecutionCommittedResult,
  HostedExecutionCommitPayload,
  HostedExecutionFinalizePayload,
} from "./execution-journal.js";
import { json, readJsonObject } from "./json.js";
export { RunnerContainer } from "./runner-container.js";
import { buildHostedRunnerContainerEnv } from "./runner-env.js";
import { parseHostedUserEnvUpdate, type HostedUserEnvUpdate } from "./user-env.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.js";

interface UserRunnerDurableObjectStubLike {
  clearUserEnv(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
    userId: string;
  }): Promise<HostedExecutionCommittedResult>;
  getUserEnvStatus(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(userId: string): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
}

interface DurableObjectNamespaceLike {
  getByName(name: string): UserRunnerDurableObjectStubLike;
}

interface WorkerEnvironmentSource extends Readonly<Record<string, unknown>> {
  BUNDLES: import("./bundle-store.js").R2BucketLike;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS?: string;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID?: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_SIGNING_SECRET?: string;
  HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET?: string;
  RUNNER_CONTAINER: import("./runner-container.js").HostedExecutionContainerNamespaceLike;
  USER_RUNNER: DurableObjectNamespaceLike;
}

type RouteParams = Readonly<Record<string, string>>;
type RouteMatcher = (pathname: string) => RouteParams | null;
type WorkerRouteAuthorization = "control" | "signed-dispatch" | null;
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

interface WorkerRouteContext {
  env: WorkerEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  requestText?: Promise<string>;
  url: URL;
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
    authorization: "signed-dispatch",
    async handle(context) {
      return handleSignedDispatchRoute(context);
    },
    match: matchExactPath("/internal/dispatch", "/internal/events"),
    methods: ["POST"],
  },
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return handleManualRunRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/run$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return handleStatusRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/status$/u),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return handleUserEnvRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/env$/u),
    methods: ["GET", "PUT", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
];

export default {
  async fetch(request: Request, env: WorkerEnvironmentSource): Promise<Response> {
    try {
      const url = new URL(request.url);
      const publicResponse = await dispatchDeclarativeRoute(workerPublicRoutes, {
        request,
        url,
      });
      if (publicResponse) {
        return publicResponse;
      }

      const environment = readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      );
      return (
        await dispatchDeclarativeRoute(workerInternalRoutes, {
          env,
          environment,
          request,
          url,
        })
      ) ?? notFound();
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
};

export class UserRunnerDurableObject implements UserRunnerDurableObjectStubLike {
  private readonly runner: HostedUserRunner;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      ),
      env.BUNDLES,
      buildHostedRunnerContainerEnv(env),
      env.RUNNER_CONTAINER,
    );
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    return this.runner.commit(input);
  }

  async finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    return this.runner.finalizeCommit(input);
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return this.runner.status(userId);
  }

  async getUserEnvStatus(
    userId: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.getUserEnvStatus(userId);
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.updateUserEnv(userId, update);
  }

  async clearUserEnv(
    userId: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.clearUserEnv(userId);
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

    const preMethodResponse = await route.beforeMethod?.(context, params);
    if (preMethodResponse) {
      return preMethodResponse;
    }

    if (!route.methods.includes(context.request.method)) {
      return respondToWrongMethod(route.wrongMethodResponse ?? "not-found");
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
  return json({
    ok: true,
    service: "cloudflare-hosted-runner",
  });
}

async function authorizeRoute(
  authorization: WorkerRouteAuthorization,
  context: { request: Request } & Partial<WorkerRouteContext>,
): Promise<Response | null> {
  switch (authorization) {
    case "control":
      return requireBearerAuthorization(context.request, context.environment?.controlToken);
    case "signed-dispatch": {
      const secret = context.environment?.dispatchSigningSecret;
      if (!secret) {
        return unauthorized();
      }
      const payload = await readCachedRequestText(context);
      const { signature, timestamp } = readHostedExecutionSignatureHeaders(context.request.headers);
      const verified = await verifyHostedExecutionSignature({
        payload,
        secret,
        signature,
        timestamp,
      });

      return verified ? null : unauthorized();
    }
    default:
      return null;
  }
}

async function handleManualRunRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  await readOptionalJsonObject(context.request);
  const userId = decodeRouteParam(encodedUserId);
  const dispatch = createManualRunDispatch(userId);
  const status = await getUserRunnerStub(context.env, userId).dispatch(dispatch);

  return isBackpressuredStatus(status, dispatch.eventId)
    ? json(status, 429)
    : json(status);
}

async function handleStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  return json(await getUserRunnerStub(context.env, userId).status(userId));
}

async function handleUserEnvRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = getUserRunnerStub(context.env, userId);

  if (context.request.method === "GET") {
    return json(await stub.getUserEnvStatus(userId));
  }

  if (context.request.method === "PUT") {
    return json(await stub.updateUserEnv(
      userId,
      parseHostedUserEnvUpdate(await readJsonObject(context.request)),
    ));
  }

  return json(await stub.clearUserEnv(userId));
}


async function handleSignedDispatchRoute(context: WorkerRouteContext): Promise<Response> {
  const payload = await readCachedRequestText(context);
  const dispatch = JSON.parse(payload) as HostedExecutionDispatchRequest;
  const status = await getUserRunnerStub(context.env, dispatch.event.userId).dispatch(dispatch);

  return isBackpressuredStatus(status, dispatch.eventId)
    ? json(status, 429)
    : json(status);
}

function createManualRunDispatch(userId: string): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId,
    },
    eventId: `manual:${Date.now()}`,
    occurredAt: new Date().toISOString(),
  };
}

function getUserRunnerStub(
  env: WorkerEnvironmentSource,
  userId: string,
): UserRunnerDurableObjectStubLike {
  return env.USER_RUNNER.getByName(userId);
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

function methodNotAllowed(): Response {
  return json({ error: "Method not allowed." }, 405);
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

function respondToWrongMethod(response: WrongMethodResponse): Response {
  return response === "method-not-allowed" ? methodNotAllowed() : notFound();
}

function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

async function readCachedRequestText(
  context: Pick<WorkerRouteContext, "request" | "requestText">,
): Promise<string> {
  context.requestText ??= context.request.text();
  return context.requestText;
}

function isBackpressuredStatus(
  status: { backpressuredEventIds?: string[] },
  eventId: string,
): boolean {
  return status.backpressuredEventIds?.includes(eventId) ?? false;
}

function requireBearerAuthorization(
  request: Request,
  token: string | null | undefined,
): Response | null {
  if (!token) {
    return json({ error: "Hosted execution control token is not configured." }, 503);
  }

  return request.headers.get("authorization") === `Bearer ${token}`
    ? null
    : json({ error: "Unauthorized" }, 401);
}

async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.text();

  if (!payload.trim()) {
    return {};
  }

  const parsed = JSON.parse(payload) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}
