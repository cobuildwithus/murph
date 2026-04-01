import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  emitHostedExecutionStructuredLog,
  parseHostedExecutionDispatchRequest,
  readHostedEmailCapabilities,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import {
  parseRawEmailMessage,
  readRawEmailHeaderValue,
} from "@murphai/inboxd/connectors/email/parsed";

import {
  gatewayFetchAttachmentsInputSchema,
  gatewayChannelSupportsReplyToMessage,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsInputSchema,
  gatewayReadMessagesInputSchema,
  readGatewayConversationSessionToken,
  readGatewayMessageKind,
  readGatewayMessageRouteToken,
  gatewayRespondToPermissionInputSchema,
  gatewaySendMessageResultSchema,
  gatewaySendMessageInputSchema,
  gatewayWaitForEventsInputSchema,
  waitForGatewayEventsByPolling,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListOpenPermissionsInput,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayReadMessagesInput,
  type GatewayRespondToPermissionInput,
  type GatewaySendMessageInput,
  type GatewayWaitForEventsInput,
} from "@murphai/gateway-core";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.ts";
import { createHostedUserEnvStore } from "./bundle-store.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommittedResult,
} from "./execution-journal.ts";
import { json, readJsonObject, readOptionalJsonObject } from "./json.ts";
export { RunnerContainer } from "./runner-container.ts";
import { buildHostedRunnerContainerEnv } from "./runner-env.ts";
import {
  createHostedEmailUserAddress,
  type HostedEmailInboundRoute,
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
  resolveHostedEmailInboundRoute,
  writeHostedEmailRawMessage,
  type HostedEmailWorkerRequest,
} from "./hosted-email.ts";
import {
  isHostedEmailInboundSenderAuthorized,
  readHostedVerifiedEmailFromEnv,
} from "@murphai/runtime-state";
import {
  decodeHostedUserEnvPayload,
  parseHostedUserEnvUpdate,
  type HostedUserEnvUpdate,
} from "./user-env.ts";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerCommitInput,
  WorkerUserRunnerFinalizeInput,
  WorkerUserRunnerStubLike,
} from "./worker-contracts.ts";

interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
  getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
}

interface WorkerEnvironmentSource extends WorkerEnvironmentContract<UserRunnerDurableObjectStubLike> {
  RUNNER_CONTAINER: import("./runner-container.ts").HostedExecutionContainerNamespaceLike;
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
  {
    authorizeBeforeMethod: true,
    authorization: "control",
    async handle(context, params) {
      return handleGatewayRoute(context, params.userId, params.resource);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/gateway\/(?<resource>conversations\/list|conversations\/get|messages\/read|messages\/send|attachments\/fetch|events\/poll|events\/wait|permissions\/list-open|permissions\/respond)$/u),
    methods: ["POST"],
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

  async commit(input: WorkerUserRunnerCommitInput): Promise<HostedExecutionCommittedResult> {
    return this.runner.commit(input);
  }

  async finalizeCommit(input: WorkerUserRunnerFinalizeInput): Promise<HostedExecutionCommittedResult> {
    return this.runner.finalizeCommit(input);
  }

  async gatewayListConversations(input?: GatewayListConversationsInput) {
    return this.runner.gatewayListConversations(input);
  }

  async gatewayGetConversation(input: GatewayGetConversationInput) {
    return this.runner.gatewayGetConversation(input);
  }

  async gatewayReadMessages(input: GatewayReadMessagesInput) {
    return this.runner.gatewayReadMessages(input);
  }

  async gatewayFetchAttachments(input: GatewayFetchAttachmentsInput) {
    return this.runner.gatewayFetchAttachments(input);
  }

  async gatewayPollEvents(input?: GatewayPollEventsInput) {
    return this.runner.gatewayPollEvents(input);
  }

  async gatewayListOpenPermissions(input?: GatewayListOpenPermissionsInput) {
    return this.runner.gatewayListOpenPermissions(input);
  }

  async gatewayRespondToPermission(input: GatewayRespondToPermissionInput) {
    return this.runner.gatewayRespondToPermission(input);
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

async function handleGatewayRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  resource: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  const payload = await readOptionalJsonObject(context.request);

  switch (resource) {
    case "conversations/list":
      return json(
        await requireGatewayStubMethod(stub, "gatewayListConversations")(
          gatewayListConversationsInputSchema.parse(payload),
        ),
      );
    case "conversations/get":
      return json(
        await requireGatewayStubMethod(stub, "gatewayGetConversation")(
          gatewayGetConversationInputSchema.parse(payload),
        ),
      );
    case "messages/read":
      return json(
        await requireGatewayStubMethod(stub, "gatewayReadMessages")(
          gatewayReadMessagesInputSchema.parse(payload),
        ),
      );
    case "attachments/fetch":
      return json(
        await requireGatewayStubMethod(stub, "gatewayFetchAttachments")(
          gatewayFetchAttachmentsInputSchema.parse(payload),
        ),
      );
    case "events/poll":
      return json(
        await requireGatewayStubMethod(stub, "gatewayPollEvents")(
          gatewayPollEventsInputSchema.parse(payload),
        ),
      );
    case "events/wait":
      return json(
        await waitForHostedGatewayEvents(
          requireGatewayStubMethod(stub, "gatewayPollEvents"),
          gatewayWaitForEventsInputSchema.parse(payload),
        ),
      );
    case "messages/send":
      return handleGatewaySendRoute(
        stub,
        userId,
        gatewaySendMessageInputSchema.parse(payload),
      );
    case "permissions/list-open":
      return json(
        await requireGatewayStubMethod(stub, "gatewayListOpenPermissions")(
          gatewayListOpenPermissionsInputSchema.parse(payload),
        ),
      );
    case "permissions/respond":
      return json(
        await requireGatewayStubMethod(stub, "gatewayRespondToPermission")(
          gatewayRespondToPermissionInputSchema.parse(payload),
        ),
      );
    default:
      return notFound();
  }
}

async function handleGatewaySendRoute(
  stub: UserRunnerDurableObjectStubLike,
  userId: string,
  input: GatewaySendMessageInput,
): Promise<Response> {
  const conversation = await requireGatewayStubMethod(stub, "gatewayGetConversation")({
    sessionKey: input.sessionKey,
  });
  if (!conversation) {
    return json({ error: "Gateway session was not found." }, 404);
  }
  if (!conversation.canSend) {
    return json({ error: "Gateway session does not have a routable reply target." }, 409);
  }

  const replyToValidation = validateHostedGatewayReplyTo({
    channel: conversation.route.channel,
    replyToMessageId: input.replyToMessageId ?? null,
    sessionKey: input.sessionKey,
  });
  if (replyToValidation) {
    return replyToValidation;
  }

  const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
    clientRequestId: input.clientRequestId,
    eventId: createGatewayDispatchEventId(),
    occurredAt: new Date().toISOString(),
    replyToMessageId: input.replyToMessageId,
    sessionKey: input.sessionKey,
    text: input.text,
    userId,
  });
  const result = await stub.dispatchWithOutcome(dispatch);

  if (result.event.state === "backpressured") {
    return json({ error: "Hosted runner is backpressured." }, 429);
  }

  if (result.event.state === "poisoned") {
    return json({ error: result.event.lastError ?? "Hosted runner failed." }, 500);
  }

  return json(
    gatewaySendMessageResultSchema.parse({
      delivery: null,
      messageId: null,
      queued: true,
      sessionKey: input.sessionKey,
    }),
  );
}

function validateHostedGatewayReplyTo(input: {
  channel: string | null;
  replyToMessageId: string | null;
  sessionKey: string;
}): Response | null {
  if (!input.replyToMessageId) {
    return null;
  }
  if (!gatewayChannelSupportsReplyToMessage(input.channel)) {
    return json({ error: "Gateway reply-to is not supported for this channel." }, 409);
  }
  try {
    const sessionToken = readGatewayConversationSessionToken(input.sessionKey);
    const messageKind = readGatewayMessageKind(input.replyToMessageId);
    const messageRouteToken = readGatewayMessageRouteToken(input.replyToMessageId);
    if (sessionToken !== messageRouteToken) {
      return json({ error: "Gateway reply-to did not belong to the requested session." }, 400);
    }
    if (messageKind !== "capture-message" && messageKind !== "outbox-message") {
      return json({ error: "Gateway reply-to must reference a channel message." }, 400);
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Gateway reply-to is invalid." },
      400,
    );
  }
  return null;
}

async function waitForHostedGatewayEvents(
  poll: (input?: GatewayPollEventsInput) => Promise<GatewayPollEventsResult>,
  input: GatewayWaitForEventsInput,
): Promise<GatewayPollEventsResult> {
  return waitForGatewayEventsByPolling(poll, input);
}

function requireGatewayStubMethod<TKey extends keyof UserRunnerDurableObjectStubLike>(
  stub: UserRunnerDurableObjectStubLike,
  key: TKey,
): Exclude<UserRunnerDurableObjectStubLike[TKey], undefined> {
  const method = stub[key];
  if (typeof method !== "function") {
    throw new TypeError(`User runner stub does not implement ${String(key)}.`);
  }

  return method as Exclude<UserRunnerDurableObjectStubLike[TKey], undefined>;
}

function createGatewayDispatchEventId(): string {
  return `gateway-send:${crypto.randomUUID()}`;
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
    keyId: environment.bundleEncryptionKeyId,
    keysById: environment.bundleEncryptionKeysById,
    to: message.to,
  });

  if (!route) {
    message.setReject?.("Hosted email address is not recognized.");
    return;
  }

  const rawBytes = await readHostedEmailMessageBytes(message.raw);
  const parsedMessage = parseRawEmailMessage(rawBytes);
  const headerFrom = readRawEmailHeaderValue(rawBytes, "from");

  if (!await authorizeHostedEmailIngress({
    env,
    environment,
    envelopeFrom: message.from,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: headerFrom.value ?? parsedMessage.from,
    route,
  })) {
    message.setReject?.("Hosted email sender is not authorized for this route.");
    return;
  }

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
    eventId,
    identityId: route.identityId,
    occurredAt: new Date().toISOString(),
    rawMessageKey,
    userId: route.userId,
  }));
}

async function authorizeHostedEmailIngress(input: {
  env: WorkerEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  envelopeFrom: string | null | undefined;
  hasRepeatedHeaderFrom: boolean;
  headerFrom: string | null | undefined;
  route: HostedEmailInboundRoute;
}): Promise<boolean> {
  const userEnvPayload = await createHostedUserEnvStore({
    bucket: input.env.BUNDLES,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    keysById: input.environment.bundleEncryptionKeysById,
  }).readUserEnv(input.route.userId);
  const userEnv = decodeHostedUserEnvPayload(
    userEnvPayload,
    input.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const verifiedEmailAddress = readHostedVerifiedEmailFromEnv(userEnv)?.address ?? null;

  return isHostedEmailInboundSenderAuthorized({
    envelopeFrom: input.envelopeFrom,
    hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom,
    headerFrom: input.headerFrom,
    threadTarget: input.route.target,
    verifiedEmailAddress,
  });
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
  emitHostedExecutionStructuredLog({
    component: "worker",
    error,
    level: "error",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  const classified = classifyPublicRouteError(error);

  return json(
    { error: classified.error },
    classified.status,
  );
}

function classifyPublicRouteError(error: unknown): {
  error: string;
  status: number;
} {
  if (error instanceof SyntaxError) {
    return {
      error: "Invalid JSON.",
      status: 400,
    };
  }

  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return {
      error: "Invalid request.",
      status: 400,
    };
  }

  return {
    error: "Internal error.",
    status: 500,
  };
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
