import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";
import { assistantChannelDeliverySchema } from "@healthybob/assistant-runtime";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.js";
import { readHostedExecutionEnvironment } from "./env.js";
import { json, readJsonObject } from "./json.js";
import { createHostedAssistantOutboxDeliveryJournalStore } from "./outbox-delivery-journal.js";
import { buildHostedRunnerContainerEnv } from "./runner-env.js";
import { parseHostedUserEnvUpdate } from "./user-env.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.js";

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  getByName(name: string): DurableObjectStubLike;
}

interface WorkerEnvironmentSource extends Readonly<Record<string, unknown>> {
  BUNDLES: import("./bundle-store.js").R2BucketLike;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS?: string;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID?: string;
  HOSTED_EXECUTION_CLOUDFLARE_BASE_URL?: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_SIGNING_SECRET?: string;
  HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET?: string;
  USER_RUNNER: DurableObjectNamespaceLike;
}

type HostedExecutionBundles = HostedExecutionRunnerResult["bundles"];
type RouteParams = Readonly<Record<string, string>>;
type RouteMatcher = (pathname: string) => RouteParams | null;
type WorkerRouteAuthorization = "control" | "runner" | "signed-dispatch" | null;
type DurableObjectControlAction = "env" | "run" | "status";
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

interface DurableObjectRouteContext {
  request: Request;
  runner: HostedUserRunner;
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
    authorizeBeforeMethod: true,
    authorization: "runner",
    async handle(context, params) {
      return handleRunnerOutboxRoute(context, params);
    },
    match: matchNamedPath(/^\/internal\/runner-outbox\/(?<userId>[^/]+)\/(?<intentId>[^/]+)$/u),
    methods: ["GET", "PUT"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorization: "runner",
    async handle(context, params) {
      return forwardRunnerEventCallback(context, params, "commit");
    },
    match: matchNamedPath(
      /^\/internal\/runner-events\/(?<userId>[^/]+)\/(?<eventId>[^/]+)\/commit$/u,
    ),
    methods: ["POST"],
  },
  {
    authorization: "runner",
    async handle(context, params) {
      return forwardRunnerEventCallback(context, params, "finalize");
    },
    match: matchNamedPath(
      /^\/internal\/runner-events\/(?<userId>[^/]+)\/(?<eventId>[^/]+)\/finalize$/u,
    ),
    methods: ["POST"],
  },
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
      return forwardDurableObjectControlRoute(context, params.userId, "run");
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/run$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return forwardDurableObjectControlRoute(context, params.userId, "status");
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/status$/u),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return forwardDurableObjectControlRoute(context, params.userId, "env");
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/env$/u),
    methods: ["GET", "PUT", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
];

const durableObjectRoutes: readonly DeclarativeRoute<DurableObjectRouteContext>[] = [
  {
    async handle(context) {
      const dispatch = JSON.parse(await context.request.text()) as HostedExecutionDispatchRequest;
      const status = await context.runner.dispatch(dispatch);

      return isBackpressuredStatus(status, dispatch.eventId)
        ? json(status, 429)
        : json(status);
    },
    match: matchExactPath("/dispatch"),
    methods: ["POST"],
  },
  {
    async handle(context) {
      const required = requireSearchParams(context.url, "userId", "eventId");
      if (required instanceof Response) {
        return required;
      }

      return json({
        committed: await context.runner.commit({
          eventId: required.eventId,
          payload: parseHostedExecutionCommitRequest(await readJsonObject(context.request)),
          userId: required.userId,
        }),
        ok: true,
      });
    },
    match: matchExactPath("/commit"),
    methods: ["POST"],
  },
  {
    async handle(context) {
      const required = requireSearchParams(context.url, "userId", "eventId");
      if (required instanceof Response) {
        return required;
      }

      return json({
        finalized: await context.runner.finalizeCommit({
          eventId: required.eventId,
          payload: parseHostedExecutionFinalizeRequest(await readJsonObject(context.request)),
          userId: required.userId,
        }),
        ok: true,
      });
    },
    match: matchExactPath("/finalize"),
    methods: ["POST"],
  },
  {
    async handle(context) {
      const body = await readJsonObject(context.request);
      const userId = typeof body.userId === "string" ? body.userId : null;

      if (!userId) {
        return json({ error: "userId is required." }, 400);
      }

      const dispatch: HostedExecutionDispatchRequest = {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId,
        },
        eventId: `manual:${Date.now()}`,
        occurredAt: new Date().toISOString(),
      };
      const status = await context.runner.run(dispatch);

      return isBackpressuredStatus(status, dispatch.eventId)
        ? json(status, 429)
        : json(status);
    },
    match: matchExactPath("/run"),
    methods: ["POST"],
  },
  {
    async handle(context) {
      const userId = context.url.searchParams.get("userId") ?? "unknown";
      return json(await context.runner.status(userId));
    },
    match: matchExactPath("/status"),
    methods: ["GET"],
  },
  {
    beforeMethod(context) {
      const userId = resolveRequiredUserId(context.url);
      return userId instanceof Response ? userId : null;
    },
    async handle(context) {
      const userId = resolveRequiredUserId(context.url);
      if (userId instanceof Response) {
        return userId;
      }

      if (context.request.method === "GET") {
        return json(await context.runner.getUserEnvStatus(userId));
      }

      if (context.request.method === "PUT") {
        return json(
          await context.runner.updateUserEnv(
            userId,
            parseHostedUserEnvUpdate(await readJsonObject(context.request)),
          ),
        );
      }

      return json(await context.runner.clearUserEnv(userId));
    },
    match: matchExactPath("/env"),
    methods: ["GET", "PUT", "DELETE"],
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

export class UserRunnerDurableObject {
  private readonly runner: HostedUserRunner;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      ),
      env.BUNDLES,
      buildHostedRunnerContainerEnv(env),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return (
      await dispatchDeclarativeRoute(
        durableObjectRoutes,
        {
          request,
          runner: this.runner,
          url,
        },
      )
    ) ?? notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function buildDurableObjectControlRequest(input: {
  action: DurableObjectControlAction;
  request: Request;
  userId: string;
}): Promise<Request> {
  switch (input.action) {
    case "status":
      return new Request(`https://runner.internal/status?userId=${encodeURIComponent(input.userId)}`, {
        method: "GET",
      });
    case "run": {
      const body = {
        ...(await readOptionalJsonObject(input.request)),
        userId: input.userId,
      };

      return new Request("https://runner.internal/run", {
        body: JSON.stringify(body),
        method: "POST",
      });
    }
    case "env": {
      const url = `https://runner.internal/env?userId=${encodeURIComponent(input.userId)}`;

      if (input.request.method === "GET" || input.request.method === "DELETE") {
        return new Request(url, {
          method: input.request.method,
        });
      }

      return new Request(url, {
        body: JSON.stringify(await readOptionalJsonObject(input.request)),
        method: "PUT",
      });
    }
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
    case "runner":
      return requireBearerAuthorization(context.request, context.environment?.runnerControlToken);
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

async function forwardDurableObjectControlRoute(
  context: WorkerRouteContext,
  userId: string,
  action: DurableObjectControlAction,
): Promise<Response> {
  const decodedUserId = decodeRouteParam(userId);

  return context.env.USER_RUNNER.getByName(decodedUserId).fetch(
    await buildDurableObjectControlRequest({
      action,
      request: context.request,
      userId: decodedUserId,
    }),
  );
}

async function forwardRunnerEventCallback(
  context: WorkerRouteContext,
  params: RouteParams,
  action: "commit" | "finalize",
): Promise<Response> {
  const userId = decodeRouteParam(params.userId);
  const eventId = decodeRouteParam(params.eventId);
  const payload = action === "commit"
    ? parseHostedExecutionCommitRequest(await readJsonObject(context.request))
    : parseHostedExecutionFinalizeRequest(await readJsonObject(context.request));

  return context.env.USER_RUNNER.getByName(userId).fetch(
    new Request(
      `https://runner.internal/${action}?eventId=${encodeURIComponent(eventId)}&userId=${encodeURIComponent(userId)}`,
      {
        body: JSON.stringify(payload),
        method: "POST",
      },
    ),
  );
}

async function handleRunnerOutboxRoute(
  context: WorkerRouteContext,
  params: RouteParams,
): Promise<Response> {
  const userId = decodeRouteParam(params.userId);
  const intentId = decodeRouteParam(params.intentId);
  const journalStore = createHostedAssistantOutboxDeliveryJournalStore({
    bucket: context.env.BUNDLES,
    key: context.environment.bundleEncryptionKey,
    keyId: context.environment.bundleEncryptionKeyId,
  });

  if (context.request.method === "GET") {
    const dedupeKey = context.url.searchParams.get("dedupeKey") ?? "";
    const record = await journalStore.read({
      dedupeKey,
      intentId,
      userId,
    });

    return json({
      delivery: record?.delivery ?? null,
      intentId: record?.intentId ?? intentId,
    });
  }

  const payload = await readJsonObject(context.request);
  const dedupeKey = requireString(payload.dedupeKey, "dedupeKey");
  const delivery = assistantChannelDeliverySchema.parse(payload.delivery);
  const record = await journalStore.write({
    dedupeKey,
    delivery,
    intentId,
    userId,
  });

  return json({
    delivery: record.delivery,
    intentId: record.intentId,
  });
}

async function handleSignedDispatchRoute(context: WorkerRouteContext): Promise<Response> {
  const payload = await readCachedRequestText(context);
  const dispatch = JSON.parse(payload) as HostedExecutionDispatchRequest;

  return context.env.USER_RUNNER
    .getByName(dispatch.event.userId)
    .fetch(new Request("https://runner.internal/dispatch", {
      body: payload,
      method: "POST",
    }));
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

function resolveRequiredUserId(url: URL): string | Response {
  const userId = url.searchParams.get("userId");
  return userId ? userId : json({ error: "userId is required." }, 400);
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

function requireSearchParams(
  url: URL,
  ...keys: readonly string[]
): Record<string, string> | Response {
  const params: Record<string, string> = {};

  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (!value) {
      return json({ error: `${keys.join(" and ")} are required.` }, 400);
    }
    params[key] = value;
  }

  return params;
}

function parseHostedExecutionCommitRequest(payload: Record<string, unknown>): HostedExecutionRunnerResult & {
  currentBundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
} {
  const bundles = requireRecord(payload.bundles, "bundles");
  const result = requireRecord(payload.result, "result");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
    currentBundleRefs: readCommittedBundleRefs(payload.currentBundleRefs),
    result: {
      eventsHandled: requireNumber(result.eventsHandled, "result.eventsHandled"),
      nextWakeAt: readOptionalString(result.nextWakeAt, "result.nextWakeAt"),
      summary: requireString(result.summary, "result.summary"),
    },
  };
}

function parseHostedExecutionFinalizeRequest(
  payload: Record<string, unknown>,
): { bundles: HostedExecutionBundles } {
  const bundles = requireRecord(payload.bundles, "bundles");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
  };
}

function isBackpressuredStatus(
  status: { backpressuredEventIds?: string[] },
  eventId: string,
): boolean {
  return status.backpressuredEventIds?.includes(eventId) ?? false;
}

function readCommittedBundleRefs(value: unknown): {
  agentState: HostedExecutionBundleRef | null;
  vault: HostedExecutionBundleRef | null;
} {
  const record = requireRecord(value, "currentBundleRefs");

  return {
    agentState: readHostedBundleRef(record.agentState),
    vault: readHostedBundleRef(record.vault),
  };
}

function readHostedBundleRef(value: unknown): HostedExecutionBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError("Commit bundle refs must be objects or null.");
  }

  if (
    typeof value.hash !== "string"
    || typeof value.key !== "string"
    || typeof value.size !== "number"
    || typeof value.updatedAt !== "string"
  ) {
    throw new TypeError("Commit bundle refs must include hash, key, size, and updatedAt.");
  }

  return {
    hash: value.hash,
    key: value.key,
    size: value.size,
    updatedAt: value.updatedAt,
  };
}

function readHostedBundleBase64Value(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base64 string or null.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function readOptionalString(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string, null, or undefined.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function requireBearerAuthorization(
  request: Request,
  token: string | null | undefined,
): Response | null {
  if (!token) {
    return null;
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
