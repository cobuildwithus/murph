import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionRedactedLogEntry,
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
  sanitizeHostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
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

const DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE =
  "Hosted conversation wakes must be imported through mailbox AssistantInputEvent staging.";
const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  "murph.assistant-provider-plan-diagnostics.v1";
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = "assistant.provider.plan";
const HOSTED_ASSISTANT_PROVIDER_CONTINUATION_VALUES = new Set([
  "explicit-structured-history",
  "provider-state-optimization",
  "thread-start",
]);
const HOSTED_ASSISTANT_PROVIDER_WORKING_DIRECTORY_KIND_VALUES = new Set([
  "hosted-stable-proc-cwd",
  "raw",
]);

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
}): Promise<HostedMailboxExecutionMetrics> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }

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
  });

  return {
    bootstrapResult,
    conversationMetrics: mailboxEffect.conversationMetrics,
    mailboxLane: mailboxEffect.mailboxLane,
    redactedLogEntries: mailboxEffect.redactedLogEntries ?? [],
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
}): Promise<HostedMailboxOutcome> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }

  return executeHostedSystemWake({
    wake: input.wake,
    executionContext: input.executionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
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
        runtimeLogPlatform: input.runtime.platform,
        resolvedConfig: input.runtime.resolvedConfig,
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "device-sync",
      });
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
      threadId: route.threadId,
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

export function emitHostedAssistantProviderTraceLog(input: {
  details?: HostedExecutionStructuredLogDetails | null;
  event: unknown;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry | null {
  const diagnostic = readHostedAssistantProviderPlanDiagnosticTrace(input.event);
  if (!diagnostic) {
    return null;
  }

  const redactedDetails = sanitizeHostedExecutionStructuredLogDetails({
    ...(input.details ?? {}),
    ...diagnostic,
  });

  emitHostedExecutionStructuredLog({
    component: "runtime.provider",
    details: redactedDetails,
    message: "Hosted assistant provider plan captured.",
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime.provider",
    eventId: input.wake.eventId,
    level: "info",
    message: "Hosted assistant provider plan captured.",
    phase: "wake.running",
    redacted: redactedDetails,
  };
}

function readHostedAssistantProviderPlanDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const record = rawEvent as Record<string, unknown>;
  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA
    || type !== ASSISTANT_PROVIDER_PLAN_TRACE_TYPE
  ) {
    return null;
  }

  const providerContinuation = readHostedAssistantProviderPlanAllowedString(
    record,
    "providerContinuation",
    HOSTED_ASSISTANT_PROVIDER_CONTINUATION_VALUES,
  );
  const workingDirectoryKind = readHostedAssistantProviderPlanAllowedString(
    record,
    "workingDirectoryKind",
    HOSTED_ASSISTANT_PROVIDER_WORKING_DIRECTORY_KIND_VALUES,
  );
  if (!providerContinuation || !workingDirectoryKind) {
    return null;
  }

  return {
    activeTurnHistoryCount:
      readHostedAssistantProviderPlanNullableNumber(record, "activeTurnHistoryCount"),
    activeTurnHistoryPresent:
      readHostedAssistantProviderPlanBoolean(record, "activeTurnHistoryPresent"),
    providerContinuation,
    providerPlanKind: "provider.plan",
    providerRequestOrdinal:
      readHostedAssistantProviderPlanNullableNumber(record, "providerRequestOrdinal"),
    refreshThreadInstructions:
      readHostedAssistantProviderPlanBoolean(record, "refreshThreadInstructions"),
    resumeProviderSessionIdPresent:
      readHostedAssistantProviderPlanBoolean(record, "resumeProviderSessionIdPresent"),
    storedThreadInstructionsFingerprintPresent:
      readHostedAssistantProviderPlanBoolean(
        record,
        "storedThreadInstructionsFingerprintPresent",
      ),
    threadInstructionsFingerprintPresent:
      readHostedAssistantProviderPlanBoolean(
        record,
        "threadInstructionsFingerprintPresent",
      ),
    workingDirectoryKind,
  };
}

function readHostedAssistantProviderPlanBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readHostedAssistantProviderPlanNullableNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedAssistantProviderPlanAllowedString(
  record: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | null {
  const value = readHostedAssistantProviderPlanString(record, key);
  return value && allowedValues.has(value) ? value : null;
}

function readHostedAssistantProviderPlanString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
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
    bindingDeliveryTarget:
      delivery.kind === "explicit" ? null : delivery.target,
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
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnTrigger: "automation-cron",
    vault,
  };
}
