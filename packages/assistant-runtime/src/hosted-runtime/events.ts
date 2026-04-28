import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionConversationMessageWake,
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunnerVaultSyncImport,
  HostedExecutionLogLevel,
  HostedExecutionSystemWake,
  HostedExecutionWake,
  HostedExecutionLogPhase,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantContextFingerprintDetails,
  sendAssistantNotification,
} from "@murphai/assistant-engine";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  isHostedConversationMessageWake,
  isHostedLinqConversationMessageWake,
  sanitizeHostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { ingestHostedConversationMessageWake } from "./events/conversation.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { handleHostedVaultSyncImportWake } from "./events/vault-sync.ts";
import { runHostedDeviceSyncWakeLane } from "./maintenance.ts";
import type {
  HostedMailboxEffect,
  HostedMailboxLane,
  HostedMailboxExecutionMetrics,
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";

type HostedMailboxOutcome = HostedMailboxEffect & {
  mailboxLane: HostedMailboxLane;
};

const HOSTED_PROVIDER_REQUEST_DEBUG_SCHEMA = "murph.assistant-provider-request-debug.v1";
const HOSTED_PROVIDER_REQUEST_DEBUG_TYPE = "assistant.provider.request.debug";
const HOSTED_RESPONSES_REQUEST_DEBUG_SCHEMA = "murph.assistant-responses-request-debug.v1";
const HOSTED_RESPONSES_REQUEST_DEBUG_TYPE = "assistant.responses.request.debug";

export async function executeHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification?: boolean;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedMailboxExecutionMetrics> {
  const bootstrapResult = await prepareHostedWakeContext(
    input.vaultRoot,
    input.wake,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
  );
  const mailboxEffect = await handleHostedMailboxEvent({
    wake: input.wake,
    executionContext: bootstrappedExecutionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification === true,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
    vaultSyncImport: input.vaultSyncImport ?? null,
  });

  return {
    bootstrapResult,
    conversationMetrics: mailboxEffect.conversationMetrics,
    mailboxLane: mailboxEffect.mailboxLane,
    redactedLogEntries: mailboxEffect.redactedLogEntries ?? [],
    vaultSyncImportResult: mailboxEffect.vaultSyncImportResult,
  };
}

async function handleHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedMailboxOutcome> {
  if (isHostedConversationMessageWake(input.wake)) {
    return executeHostedConversationWake({
      wake: input.wake,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });
  }

  return executeHostedSystemWake({
    wake: input.wake,
    executionContext: input.executionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
    vaultSyncImport: input.vaultSyncImport ?? null,
  });
}

async function executeHostedConversationWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "userEnv"
  >;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const conversationMetrics = await ingestHostedConversationMessageWake(input);
  const redactedLogEntries = isHostedLinqConversationMessageWake(input.wake)
    ? [emitHostedLinqConversationContextLog(input.wake)]
    : [];

  return createNoopMailboxEffect({
    conversationMetrics,
    mailboxLane: "conversation-message",
    redactedLogEntries,
  });
}

async function executeHostedSystemWake(input: {
  wake: HostedExecutionSystemWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig"
  >;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.kind) {
    case "member.activated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-activated",
      });
    case "member.channels.updated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-channels-updated",
      });
    case "assistant.notification.requested":
      return executeHostedAssistantNotificationWake({
        wake: input.wake,
        executionContext: input.executionContext,
        forceQueueOnly: input.forceQueueOnlyAssistantNotification,
        vaultRoot: input.vaultRoot,
      });
    case "device-sync.wake":
      await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        resolvedConfig: input.runtime.resolvedConfig,
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "device-sync",
      });
    case "vault.sync.import":
      if (!input.vaultSyncImport) {
        throw new TypeError("Hosted vault sync import wake requires a hydrated runner vaultSyncImport.");
      }
      return {
        ...(await handleHostedVaultSyncImportWake({
          wake: input.wake,
          vaultRoot: input.vaultRoot,
          vaultSyncImport: input.vaultSyncImport,
        })),
        redactedLogEntries: [],
        mailboxLane: "vault-sync-import",
      };
  }

  const exhaustiveWake: never = input.wake;
  void exhaustiveWake;
  throw new TypeError('Unsupported hosted system wake kind.');
}

export async function executeHostedAssistantNotificationWake(input: {
  wake: HostedExecutionAssistantNotificationRequestedWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnly?: boolean;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification started.",
      phase: "wake.running",
      wake: input.wake,
    }),
  ];

  try {
    await sendAssistantNotification(
      buildAssistantNotificationInput(
        input.wake,
        input.executionContext,
        input.forceQueueOnly === true,
        input.vaultRoot,
        (entry) => {
          redactedLogEntries.push(entry);
        },
      ),
    );
  } catch (error) {
    if (!shouldSkipFailedHostedAssistantNotification(input.wake)) {
      redactedLogEntries.push(
        emitHostedAssistantNotificationLifecycleLog({
          error,
          level: "error",
          message: "Hosted assistant notification failed.",
          phase: "failed",
          wake: input.wake,
        }),
      );
      throw error;
    }

    redactedLogEntries.push(emitHostedAssistantNotificationSkipLog(input.wake, error));
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
      redactedLogEntries,
    });
  }

  redactedLogEntries.push(
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification finished.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    redactedLogEntries,
  });
}

function shouldSkipFailedHostedAssistantNotification(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): boolean {
  return wake.notification.firstContact != null
    || wake.notification.responsePolicy?.kind === "allow_send_or_skip";
}

function emitHostedAssistantNotificationSkipLog(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  error: unknown,
): HostedExecutionRedactedLogEntry {
  return emitHostedAssistantNotificationLifecycleLog({
    error,
    level: "warn",
    message: "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
    phase: "wake.running",
    wake,
  });
}

function buildHostedAssistantNotificationLogDetails(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): HostedExecutionStructuredLogDetails {
  const route = wake.notification.route;
  const delivery = route.delivery;

  return {
    deliveryDedupeTokenPresent: wake.notification.deliveryDedupeToken != null,
    deliveryDispatchMode: wake.notification.deliveryDispatchMode ?? "default",
    firstContact: wake.notification.firstContact != null,
    notificationRouteChannel: route.channel,
    notificationRouteDeliveryKind: route.delivery.kind,
    notificationRouteIdentityPresent: route.identityId != null,
    notificationRouteThreadIdPresent: route.threadId != null,
    notificationRouteThreadIsDirect: route.threadIsDirect,
    responsePolicyKind: wake.notification.responsePolicy?.kind ?? "none",
    ...buildHostedAssistantContextFingerprintDetails({
      actorId: route.actorId,
      channel: route.channel,
      identityId: route.identityId,
      threadId: delivery.kind === "thread" ? delivery.target : route.threadId,
      threadIsDirect: route.threadIsDirect,
    }),
  };
}

function createNoopMailboxEffect(input: {
  conversationMetrics: HostedConversationWakeMetrics | null;
  mailboxLane: HostedMailboxLane;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedMailboxOutcome {
  return {
    conversationMetrics: input.conversationMetrics,
    mailboxLane: input.mailboxLane,
    redactedLogEntries: input.redactedLogEntries ?? [],
    vaultSyncImportResult: null,
  };
}

function emitHostedAssistantNotificationLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry {
  const details = buildHostedAssistantNotificationLogDetails(input.wake);

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.level === undefined ? {} : { level: input.level }),
    message: input.message,
    phase: input.phase,
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: input.level ?? (input.error === undefined ? "info" : "error"),
    message: input.message,
    phase: input.phase,
    redacted: {
      ...details,
      ...(extractHostedAssistantNotificationRedactedDetails(input.error) ?? {}),
      ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    },
  };
}

function emitHostedLinqConversationContextLog(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<
      HostedExecutionConversationMessageWake["message"],
      { channel: "linq" }
    >;
  },
): HostedExecutionRedactedLogEntry {
  const details = sanitizeHostedExecutionStructuredLogDetails({
    contextSource: "linq-conversation-message",
    ...buildHostedAssistantContextFingerprintDetails({
      actorId: wake.message.linqMessage.from,
      channel: "linq",
      identityId: wake.message.phoneLookupKey,
      threadId: wake.message.linqMessage.chatId,
      threadIsDirect: true,
    }),
  });

  emitHostedExecutionStructuredLog({
    component: "runtime.context",
    details,
    message: "Hosted Linq conversation context fingerprints captured.",
    phase: "wake.running",
    wake,
  });

  return {
    component: "runtime.context",
    eventId: wake.eventId,
    level: "info",
    message: "Hosted Linq conversation context fingerprints captured.",
    phase: "wake.running",
    redacted: details,
  };
}

export function emitHostedAssistantProviderTraceLog(input: {
  details?: HostedExecutionStructuredLogDetails | null;
  event: unknown;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry | null {
  const requestDebug = readHostedProviderRequestDebugTrace(input.event);
  if (requestDebug) {
    const requestSummary = buildHostedProviderRequestSummary(requestDebug);
    const redactedDetails = sanitizeHostedExecutionStructuredLogDetails({
      ...(input.details ?? {}),
      ...prefixHostedProviderTraceDetails(
        requestSummary,
        "assistantProviderRequest",
      ),
    });

    emitHostedExecutionStructuredLog({
      component: "runtime.provider",
      details: redactedDetails,
      message: "Hosted assistant provider request summary captured.",
      phase: "wake.running",
      wake: input.wake,
    });

    return {
      component: "runtime.provider",
      eventId: input.wake.eventId,
      level: "info",
      message: "Hosted assistant provider request summary captured.",
      phase: "wake.running",
      redacted: redactedDetails,
    };
  }

  const responsesDebug = readHostedResponsesRequestDebugTrace(input.event);
  if (!responsesDebug) {
    return null;
  }

  const responsesSummary = buildHostedResponsesRequestSummary(responsesDebug);
  const redactedDetails = sanitizeHostedExecutionStructuredLogDetails({
    ...(input.details ?? {}),
    ...prefixHostedProviderTraceDetails(
      responsesSummary,
      "assistantResponsesRequest",
    ),
  });

  emitHostedExecutionStructuredLog({
    component: "runtime.provider.http",
    details: redactedDetails,
    message: "Hosted assistant final Responses request summary captured.",
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime.provider.http",
    eventId: input.wake.eventId,
    level: "info",
    message: "Hosted assistant final Responses request summary captured.",
    phase: "wake.running",
    redacted: redactedDetails,
  };
}

function prefixHostedProviderTraceDetails(
  details: HostedExecutionStructuredLogDetails,
  prefix: string,
): HostedExecutionStructuredLogDetails {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key, value]) =>
        isHostedProviderTraceDetailKeySafeForRuntimeLog(key)
        && isHostedProviderTraceDetailValueSafeForRuntimeLog(value)
      )
      .map(([key, value]) => [
        `${prefix}${key.slice(0, 1).toUpperCase()}${key.slice(1)}`,
        value,
      ]),
  );
}

function isHostedProviderTraceDetailKeySafeForRuntimeLog(key: string): boolean {
  const normalized = key.toLowerCase();
  return ![
    "address",
    "authorization",
    "body",
    "cookie",
    "email",
    "header",
    "message",
    "path",
    "payload",
    "phone",
    "prompt",
    "raw",
    "secret",
    "text",
    "token",
  ].some((part) => normalized.includes(part));
}

function isHostedProviderTraceDetailValueSafeForRuntimeLog(
  value: unknown,
): value is null | boolean | number | string | Array<null | boolean | number | string> {
  if (Array.isArray(value)) {
    return value.length > 0
      && value.every(isHostedProviderTraceDetailScalarSafeForRuntimeLog);
  }

  return value !== null
    && isHostedProviderTraceDetailScalarSafeForRuntimeLog(value);
}

function isHostedProviderTraceDetailScalarSafeForRuntimeLog(
  value: unknown,
): value is null | boolean | number | string {
  return value === null
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
    || typeof value === "string";
}

function readHostedProviderRequestDebugTrace(
  event: unknown,
): Record<string, unknown> | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const record = rawEvent as Record<string, unknown>;
  const schema = readHostedProviderDebugString(record, "schema");
  const type = readHostedProviderDebugString(record, "type");

  return schema === HOSTED_PROVIDER_REQUEST_DEBUG_SCHEMA
    || type === HOSTED_PROVIDER_REQUEST_DEBUG_TYPE
    ? record
    : null;
}

function readHostedResponsesRequestDebugTrace(
  event: unknown,
): Record<string, unknown> | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const record = rawEvent as Record<string, unknown>;
  const schema = readHostedProviderDebugString(record, "schema");
  const type = readHostedProviderDebugString(record, "type");

  return schema === HOSTED_RESPONSES_REQUEST_DEBUG_SCHEMA
    || type === HOSTED_RESPONSES_REQUEST_DEBUG_TYPE
    ? record
    : null;
}

function buildHostedProviderRequestSummary(
  debug: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  return {
    attemptCount: readHostedProviderDebugNumber(debug, "attemptCount"),
    channel: readHostedProviderDebugString(debug, "channel"),
    conversationMessageCount:
      readHostedProviderDebugNumber(debug, "conversationMessageCount"),
    conversationMessageRoles:
      readHostedProviderDebugStringArray(debug, "conversationMessageRoles"),
    deliveryDispatchMode:
      readHostedProviderDebugString(debug, "deliveryDispatchMode"),
    gatewayOnlyProviderCount:
      readHostedProviderDebugNumber(debug, "gatewayOnlyProviderCount"),
    gatewayOnlyProviders:
      readHostedProviderDebugStringArray(debug, "gatewayOnlyProviders"),
    nativeResumePolicy:
      readHostedProviderDebugString(debug, "nativeResumePolicy"),
    previousResponseIdPresent:
      readHostedProviderDebugBoolean(debug, "previousResponseIdPresent"),
    promptCacheDynamicContextStartsAfterStaticCore:
      readHostedProviderDebugNumber(debug, "promptCacheDynamicContextStartsAfterStaticCore"),
    promptCacheStableRouteCapabilityPromptHash:
      readHostedProviderDebugString(debug, "promptCacheStableRouteCapabilityPromptHash"),
    promptCacheStaticPromptHash:
      readHostedProviderDebugString(debug, "promptCacheStaticPromptHash"),
    promptCacheToolSchemaHash:
      readHostedProviderDebugString(debug, "promptCacheToolSchemaHash"),
    promptProfile: readHostedProviderDebugString(debug, "promptProfile"),
    provider: readHostedProviderDebugString(debug, "provider"),
    providerExecutionDriver:
      readHostedProviderDebugString(debug, "providerExecutionDriver"),
    providerModel: readHostedProviderDebugString(debug, "providerModel"),
    providerName: readHostedProviderDebugString(debug, "providerName"),
    routeId: readHostedProviderDebugString(debug, "routeId"),
    schema: HOSTED_PROVIDER_REQUEST_DEBUG_SCHEMA,
    sessionContextPresent:
      readHostedProviderDebugBoolean(debug, "sessionContextPresent"),
    supportsToolRuntime:
      readHostedProviderDebugBoolean(debug, "supportsToolRuntime"),
    systemPromptHash: readHostedProviderDebugString(debug, "systemPromptHash"),
    systemPromptLength:
      readHostedProviderDebugNumber(debug, "systemPromptLength")
      ?? 0,
    toolCount: readHostedProviderDebugNumber(debug, "toolCount"),
    toolNames: readHostedProviderDebugStringArray(debug, "toolNames"),
    turnTrigger: readHostedProviderDebugString(debug, "turnTrigger"),
    userPromptHash: readHostedProviderDebugString(debug, "userPromptHash"),
    userPromptLength:
      readHostedProviderDebugNumber(debug, "userPromptLength")
      ?? 0,
    webSearch: readHostedProviderDebugString(debug, "webSearch"),
    zeroDataRetention: readHostedProviderDebugBoolean(debug, "zeroDataRetention"),
  };
}

function buildHostedResponsesRequestSummary(
  debug: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  return {
    contextManagementPresent:
      readHostedProviderDebugBoolean(debug, "contextManagementPresent"),
    functionCallCount:
      readHostedProviderDebugNumber(debug, "functionCallCount"),
    functionCallNames:
      readHostedProviderDebugStringArray(debug, "functionCallNames"),
    functionCallOutputArrayCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputArrayCount"),
    functionCallOutputCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputCount"),
    functionCallOutputHashes:
      readHostedProviderDebugStringArray(debug, "functionCallOutputHashes"),
    functionCallOutputKinds:
      readHostedProviderDebugStringArray(debug, "functionCallOutputKinds"),
    functionCallOutputLongestLength:
      readHostedProviderDebugNumber(debug, "functionCallOutputLongestLength"),
    functionCallOutputMissingCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputMissingCount"),
    functionCallOutputNonStringCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputNonStringCount"),
    functionCallOutputOrphanCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputOrphanCount"),
    functionCallOutputStringJsonArrayCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputStringJsonArrayCount"),
    functionCallOutputStringJsonObjectCount:
      readHostedProviderDebugNumber(debug, "functionCallOutputStringJsonObjectCount"),
    functionCallOutputStringLengths:
      readHostedProviderDebugNumberArray(debug, "functionCallOutputStringLengths"),
    gatewayOnlyProviderCount:
      readHostedProviderDebugNumber(debug, "gatewayOnlyProviderCount"),
    gatewayTagsCount: readHostedProviderDebugNumber(debug, "gatewayTagsCount"),
    gatewayUserPresent: readHostedProviderDebugBoolean(debug, "gatewayUserPresent"),
    gatewayZeroDataRetention:
      readHostedProviderDebugBoolean(debug, "gatewayZeroDataRetention"),
    inputEntryCount: readHostedProviderDebugNumber(debug, "inputEntryCount"),
    inputEntryKinds:
      readHostedProviderDebugStringArray(debug, "inputEntryKinds"),
    inputMessageCount: readHostedProviderDebugNumber(debug, "inputMessageCount"),
    inputRoles: readHostedProviderDebugStringArray(debug, "inputRoles"),
    inputTextFieldCount:
      readHostedProviderDebugNumber(debug, "inputTextFieldCount"),
    inputTextHash: readHostedProviderDebugString(debug, "inputTextHash"),
    inputTextLength: readHostedProviderDebugNumber(debug, "inputTextLength"),
    instructionsHash: readHostedProviderDebugString(debug, "instructionsHash"),
    instructionsLength:
      readHostedProviderDebugNumber(debug, "instructionsLength"),
    method: readHostedProviderDebugString(debug, "method"),
    model: readHostedProviderDebugString(debug, "model"),
    payloadTopLevelKeys:
      readHostedProviderDebugStringArray(debug, "payloadTopLevelKeys"),
    previousResponseIdPresent:
      readHostedProviderDebugBoolean(debug, "previousResponseIdPresent"),
    providerOptionsHash:
      readHostedProviderDebugString(debug, "providerOptionsHash"),
    requestBodyHash: readHostedProviderDebugString(debug, "requestBodyHash"),
    requestBodyLength: readHostedProviderDebugNumber(debug, "requestBodyLength"),
    requestUrlOrigin: readHostedProviderDebugString(debug, "requestUrlOrigin"),
    requestUrlPath: readHostedProviderDebugString(debug, "requestUrlPath"),
    responseFormatHash:
      readHostedProviderDebugString(debug, "responseFormatHash"),
    schema: HOSTED_RESPONSES_REQUEST_DEBUG_SCHEMA,
    textConfigHash: readHostedProviderDebugString(debug, "textConfigHash"),
    toolChoice: readHostedProviderDebugString(debug, "toolChoice"),
    toolCount: readHostedProviderDebugNumber(debug, "toolCount"),
    toolNames: readHostedProviderDebugStringArray(debug, "toolNames"),
    toolsHash: readHostedProviderDebugString(debug, "toolsHash"),
  };
}

function readHostedProviderDebugString(
  debug: Record<string, unknown>,
  key: string,
): string | null {
  const value = debug[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readHostedProviderDebugNumber(
  debug: Record<string, unknown>,
  key: string,
): number | null {
  const value = debug[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedProviderDebugBoolean(
  debug: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = debug[key];
  return typeof value === "boolean" ? value : null;
}

function readHostedProviderDebugStringArray(
  debug: Record<string, unknown>,
  key: string,
): string[] {
  const value = debug[key];
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

function readHostedProviderDebugNumberArray(
  debug: Record<string, unknown>,
  key: string,
): number[] {
  const value = debug[key];
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is number =>
          typeof entry === "number" && Number.isFinite(entry),
      )
    : [];
}

function buildAssistantNotificationInput(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  executionContext: AssistantExecutionContext,
  forceQueueOnly: boolean,
  vault: string,
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void,
): Parameters<typeof sendAssistantNotification>[0] {
  const route = wake.notification.route;
  const delivery = route.delivery;

  return {
    actorId: route.actorId,
    channel: route.channel,
    deliveryDedupeToken: wake.notification.deliveryDedupeToken ?? null,
    deliveryDispatchMode: forceQueueOnly
      ? "queue-only"
      : wake.notification.deliveryDispatchMode ?? undefined,
    deliveryIdempotencyKey: wake.notification.deliveryIdempotencyKey ?? null,
    deliveryKind: delivery.kind === "explicit" ? null : delivery.kind,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "explicit" ? delivery.target : null,
    executionContext,
    firstContactPolicy: wake.notification.firstContact
      ? {
          markSeenOnDeliveryAccepted:
            wake.notification.firstContact.markSeenOnDeliveryAccepted,
        }
      : null,
    identityId: route.identityId,
    instructions: wake.notification.instructions,
    onTraceEvent(event) {
      const contextEntry = emitHostedAssistantContextTraceLog({
        event,
        wake,
      });
      if (contextEntry) {
        recordLogEntry(contextEntry);
      }
      const entry = emitHostedAssistantProviderTraceLog({
        details: buildHostedAssistantNotificationLogDetails(wake),
        event,
        wake,
      });
      if (entry) {
        recordLogEntry(entry);
      }
    },
    responsePolicy: wake.notification.responsePolicy ?? null,
    threadId: delivery.kind === "thread" ? delivery.target : route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnTrigger: "automation-cron",
    vault,
  };
}
