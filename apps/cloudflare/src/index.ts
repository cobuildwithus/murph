import { DurableObject } from "cloudflare:workers";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  parseHostedExecutionDispatchRequest,
  readHostedEmailCapabilities,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@murph/hosted-execution";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommittedResult,
  HostedExecutionCommitPayload,
  HostedExecutionFinalizePayload,
} from "./execution-journal.ts";
import { json, readJsonObject } from "./json.ts";
export { RunnerContainer } from "./runner-container.ts";
import { buildHostedRunnerContainerEnv } from "./runner-env.ts";
import {
  createHostedEmailUserAddress,
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
  resolveHostedEmailInboundRoute,
  writeHostedEmailRawMessage,
  type HostedEmailWorkerRequest,
} from "./hosted-email.ts";
import { serializeHostedEmailThreadTarget } from "@murph/runtime-state";
import { parseHostedUserEnvUpdate, type HostedUserEnvUpdate } from "./user-env.ts";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.ts";

interface UserRunnerDurableObjectStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
  }): Promise<HostedExecutionCommittedResult>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
  finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult>;
  getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
}

interface DurableObjectNamespaceLike {
  getByName(name: string): UserRunnerDurableObjectStubLike;
}

interface WorkerEnvironmentSource extends Readonly<Record<string, unknown>> {
  BUNDLES: import("./bundle-store.ts").R2BucketLike;
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
  HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_TOKEN?: string;
  HOSTED_EMAIL_DEFAULT_SUBJECT?: string;
  HOSTED_EMAIL_DOMAIN?: string;
  HOSTED_EMAIL_FROM_ADDRESS?: string;
  HOSTED_EMAIL_LOCAL_PART?: string;
  HOSTED_EMAIL_SIGNING_SECRET?: string;
  RUNNER_CONTAINER: import("./runner-container.ts").HostedExecutionContainerNamespaceLike;
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
    match: matchExactPath("/internal/dispatch"),
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
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return handleUserEmailAddressRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/email-address$/u),
    methods: ["GET"],
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
      readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      ),
      env.BUNDLES,
      buildHostedRunnerContainerEnv(env),
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

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
  }): Promise<HostedExecutionCommittedResult> {
    return this.runner.commit(input);
  }

  async finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult> {
    return this.runner.finalizeCommit(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.getUserEnvStatus();
  }

  async updateUserEnv(update: HostedUserEnvUpdate): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.updateUserEnv(update);
  }

  async clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.clearUserEnv();
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

async function handleUserEnvRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);

  if (context.request.method === "GET") {
    return json(await stub.getUserEnvStatus());
  }

  if (context.request.method === "PUT") {
    return json(
      await stub.updateUserEnv(parseHostedUserEnvUpdate(await readJsonObject(context.request))),
    );
  }

  return json(await stub.clearUserEnv());
}

async function handleUserEmailAddressRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const capabilities = readHostedEmailCapabilities(
    context.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  if (!capabilities.ingressReady || !capabilities.senderIdentity) {
    return json({
      error: "Hosted email ingress is not configured.",
    }, 503);
  }

  const config = readHostedEmailConfig(
    context.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const address = await createHostedEmailUserAddress({
    bucket: context.env.BUNDLES,
    config,
    key: context.environment.bundleEncryptionKey,
    keyId: context.environment.bundleEncryptionKeyId,
    userId,
  });

  return json({
    address,
    identityId: capabilities.senderIdentity,
    userId,
  });
}

async function handleHostedEmailIngress(
  message: HostedEmailWorkerRequest,
  env: WorkerEnvironmentSource,
): Promise<void> {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const capabilities = readHostedEmailCapabilities(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  if (!capabilities.ingressReady) {
    message.setReject?.("Hosted email ingress is not configured.");
    return;
  }

  const config = readHostedEmailConfig(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const route = await resolveHostedEmailInboundRoute({
    bucket: env.BUNDLES,
    config,
    key: environment.bundleEncryptionKey,
    to: message.to,
  });

  if (!route) {
    message.setReject?.("Hosted email address is not recognized.");
    return;
  }

  const rawBytes = await readHostedEmailMessageBytes(message.raw);
  const rawMessageKey = await writeHostedEmailRawMessage({
    bucket: env.BUNDLES,
    key: environment.bundleEncryptionKey,
    keyId: environment.bundleEncryptionKeyId,
    plaintext: rawBytes,
    userId: route.userId,
  });
  const eventId = `email:${rawMessageKey}`;

  const stub = await resolveUserRunnerStub(env, route.userId);
  await stub.dispatch(buildHostedExecutionEmailMessageReceivedDispatch({
    envelopeFrom: normalizeHostedEmailEnvelopeAddress(message.from),
    envelopeTo: normalizeHostedEmailEnvelopeAddress(message.to),
    eventId,
    identityId: route.identityId,
    occurredAt: new Date().toISOString(),
    rawMessageKey,
    threadTarget: route.target ? serializeHostedEmailThreadTarget(route.target) : null,
    userId: route.userId,
  }));
}

function normalizeHostedEmailEnvelopeAddress(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.toLowerCase() : null;
}

async function handleSignedDispatchRoute(context: WorkerRouteContext): Promise<Response> {
  const payload = await readCachedRequestText(context);
  const dispatch = parseHostedExecutionDispatchRequest(JSON.parse(payload) as unknown);
  const result = await (await resolveUserRunnerStub(context.env, dispatch.event.userId))
    .dispatchWithOutcome(dispatch);

  return result.event.state === "backpressured"
    ? json(result, 429)
    : json(result);
}

function createManualRunDispatch(userId: string): HostedExecutionDispatchRequest {
  return buildHostedExecutionAssistantCronTickDispatch({
    eventId: `manual:${Date.now()}`,
    occurredAt: new Date().toISOString(),
    reason: "manual",
    userId,
  });
}

async function resolveUserRunnerStub(
  env: WorkerEnvironmentSource,
  userId: string,
): Promise<UserRunnerDurableObjectStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  await stub.bootstrapUser(userId);
  return stub;
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

function mapWorkerRouteError(error: unknown): Response {
  const status = (
    error instanceof SyntaxError
    || error instanceof TypeError
    || error instanceof URIError
  )
    ? 400
    : 500;

  return json(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    status,
  );
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
