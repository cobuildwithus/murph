import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionConversationMessageWake,
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerVaultSyncImport,
  HostedExecutionRunLevel,
  HostedIngressSystemEnvelope,
  HostedIngressEnvelope,
  HostedExecutionRunPhase,
  HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import { sendAssistantNotification } from "@murphai/assistant-engine";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  isHostedConversationMessageWake,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { ingestHostedConversationMessageWake } from "./events/conversation.ts";
import { handleHostedShareAcceptedWake } from "./events/share.ts";
import { handleHostedVaultSyncImportWake } from "./events/vault-sync.ts";
import type {
  HostedIngressEffect,
  HostedIngressLane,
  HostedIngressExecutionMetrics,
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";

type HostedIngressOutcome = HostedIngressEffect & {
  ingressLane: HostedIngressLane;
};

const HOSTED_PROVIDER_REQUEST_DEBUG_SCHEMA = "murph.assistant-provider-request-debug.v1";
const HOSTED_PROVIDER_REQUEST_DEBUG_TYPE = "assistant.provider.request.debug";
const HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_SIZE = 300;
const HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT = 32;

export async function executeHostedIngressEvent(input: {
  wake: HostedIngressEnvelope;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedIngressExecutionMetrics> {
  const bootstrapResult = await prepareHostedWakeContext(
    input.vaultRoot,
    input.wake,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
  );
  const ingressEffect = await handleHostedIngressEvent({
    wake: input.wake,
    executionContext: bootstrappedExecutionContext,
    runtime: input.runtime,
    sharePack: input.sharePack ?? null,
    vaultRoot: input.vaultRoot,
    vaultSyncImport: input.vaultSyncImport ?? null,
  });

  return {
    bootstrapResult,
    conversationMetrics: ingressEffect.conversationMetrics,
    ingressLane: ingressEffect.ingressLane,
    redactedLogEntries: ingressEffect.redactedLogEntries ?? [],
    shareImportResult: ingressEffect.shareImportResult,
    shareImportTitle: ingressEffect.shareImportTitle,
    vaultSyncImportResult: ingressEffect.vaultSyncImportResult,
  };
}

async function handleHostedIngressEvent(input: {
  wake: HostedIngressEnvelope;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedIngressOutcome> {
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
    sharePack: input.sharePack ?? null,
    vaultRoot: input.vaultRoot,
    vaultSyncImport: input.vaultSyncImport ?? null,
  });
}

async function executeHostedConversationWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv"
  >;
  vaultRoot: string;
}): Promise<HostedIngressOutcome> {
  const conversationMetrics = await ingestHostedConversationMessageWake(input);

  return createNoopIngressEffect({
    conversationMetrics,
    ingressLane: "conversation-message",
  });
}

async function executeHostedSystemWake(input: {
  wake: HostedIngressSystemEnvelope;
  executionContext: AssistantExecutionContext;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
}): Promise<HostedIngressOutcome> {
  switch (input.wake.kind) {
    case "member.activated":
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "member-activated",
      });
    case "member.channels.updated":
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "member-channels-updated",
      });
    case "assistant.notification.requested":
      return executeHostedAssistantNotificationWake({
        wake: input.wake,
        executionContext: input.executionContext,
        vaultRoot: input.vaultRoot,
      });
    case "device-sync.wake":
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "device-sync",
      });
    case "vault.share.accepted":
      if (!input.sharePack) {
        throw new TypeError("Hosted share accepted wake requires a hydrated runner sharePack.");
      }
      return {
        ...(await handleHostedShareAcceptedWake({
          wake: input.wake,
          sharePack: input.sharePack,
          vaultRoot: input.vaultRoot,
        })),
        conversationMetrics: null,
        redactedLogEntries: [],
        vaultSyncImportResult: null,
        ingressLane: "vault-share-accepted",
      };
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
        ingressLane: "vault-sync-import",
      };
  }

  const exhaustiveWake: never = input.wake;
  void exhaustiveWake;
  throw new TypeError('Unsupported hosted system wake kind.');
}

export async function executeHostedAssistantNotificationWake(input: {
  wake: HostedExecutionAssistantNotificationRequestedWake;
  executionContext: AssistantExecutionContext;
  vaultRoot: string;
}): Promise<HostedIngressOutcome> {
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
    return createNoopIngressEffect({
      conversationMetrics: null,
      ingressLane: "assistant-notification",
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

  return createNoopIngressEffect({
    conversationMetrics: null,
    ingressLane: "assistant-notification",
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
    message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
    phase: "wake.running",
    wake,
  });
}

function buildHostedAssistantNotificationLogDetails(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): HostedExecutionStructuredLogDetails {
  const route = wake.notification.route;

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
  };
}

function createNoopIngressEffect(input: {
  conversationMetrics: HostedConversationWakeMetrics | null;
  ingressLane: HostedIngressLane;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedIngressOutcome {
  return {
    conversationMetrics: input.conversationMetrics,
    ingressLane: input.ingressLane,
    redactedLogEntries: input.redactedLogEntries ?? [],
    shareImportResult: null,
    shareImportTitle: null,
    vaultSyncImportResult: null,
  };
}

function emitHostedAssistantNotificationLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: buildHostedAssistantNotificationLogDetails(input.wake),
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
      ...buildHostedAssistantNotificationLogDetails(input.wake),
      ...(extractHostedAssistantNotificationRedactedDetails(input.error) ?? {}),
      ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    },
  };
}

function emitHostedAssistantNotificationProviderTraceLog(input: {
  event: unknown;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry | null {
  const requestDebug = readHostedProviderRequestDebugTrace(input.event);
  if (!requestDebug) {
    return null;
  }

  const redactedDetails = sanitizeHostedExecutionStructuredLogDetails({
    ...buildHostedAssistantNotificationLogDetails(input.wake),
    assistantProviderDebug: buildHostedProviderRequestDebugDetails(requestDebug),
  });

  emitHostedExecutionStructuredLog({
    component: "runtime.provider",
    details: redactedDetails,
    message: "Hosted assistant provider request debug payload captured.",
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime.provider",
    eventId: input.wake.eventId,
    level: "info",
    message: "Hosted assistant provider request debug payload captured.",
    phase: "wake.running",
    redacted: redactedDetails,
  };
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

function buildHostedProviderRequestDebugDetails(
  debug: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const rawSystemPrompt = readHostedProviderDebugString(debug, "systemPrompt");
  const rawUserPrompt = readHostedProviderDebugString(debug, "userPrompt");
  const systemPrompt = sanitizeHostedProviderDebugPrompt(rawSystemPrompt);
  const userPrompt = sanitizeHostedProviderDebugPrompt(rawUserPrompt);
  const systemPromptChunks = chunkHostedProviderDebugPrompt(systemPrompt);
  const userPromptChunks = chunkHostedProviderDebugPrompt(userPrompt);

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
    systemPromptChunks,
    systemPromptLength:
      readHostedProviderDebugNumber(debug, "systemPromptLength")
      ?? rawSystemPrompt?.length
      ?? 0,
    systemPromptTruncated:
      systemPromptChunks.length >= HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT
      && systemPrompt !== null
      && systemPrompt.length
        > HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_SIZE
          * HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT,
    toolCount: readHostedProviderDebugNumber(debug, "toolCount"),
    toolNames: readHostedProviderDebugStringArray(debug, "toolNames"),
    turnTrigger: readHostedProviderDebugString(debug, "turnTrigger"),
    userPromptChunks,
    userPromptLength:
      readHostedProviderDebugNumber(debug, "userPromptLength")
      ?? rawUserPrompt?.length
      ?? 0,
    userPromptTruncated:
      userPromptChunks.length >= HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT
      && userPrompt !== null
      && userPrompt.length
        > HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_SIZE
          * HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT,
    webSearch: readHostedProviderDebugString(debug, "webSearch"),
    zeroDataRetention: readHostedProviderDebugBoolean(debug, "zeroDataRetention"),
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

function sanitizeHostedProviderDebugPrompt(value: string | null): string | null {
  return value ? sanitizeHostedExecutionStructuredLogText(value) : null;
}

function chunkHostedProviderDebugPrompt(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const chunks: string[] = [];
  for (
    let index = 0;
    index < value.length
    && chunks.length < HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_LIMIT;
    index += HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_SIZE
  ) {
    chunks.push(
      value.slice(index, index + HOSTED_PROVIDER_REQUEST_DEBUG_PROMPT_CHUNK_SIZE),
    );
  }

  return chunks;
}

function buildAssistantNotificationInput(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  executionContext: AssistantExecutionContext,
  vault: string,
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void,
): Parameters<typeof sendAssistantNotification>[0] {
  const route = wake.notification.route;
  const delivery = route.delivery;

  return {
    actorId: route.actorId,
    channel: route.channel,
    deliveryDedupeToken: wake.notification.deliveryDedupeToken ?? null,
    deliveryDispatchMode: wake.notification.deliveryDispatchMode ?? undefined,
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
      const entry = emitHostedAssistantNotificationProviderTraceLog({
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
