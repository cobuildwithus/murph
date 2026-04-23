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
} from "@murphai/hosted-execution";
import { sendAssistantNotification } from "@murphai/assistant-engine";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  isHostedConversationMessageWake,
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
      buildAssistantNotificationInput(input.wake, input.executionContext, input.vaultRoot),
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
): Record<string, boolean | string | null> {
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

function buildAssistantNotificationInput(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  executionContext: AssistantExecutionContext,
  vault: string,
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
    responsePolicy: wake.notification.responsePolicy ?? null,
    threadId: delivery.kind === "thread" ? delivery.target : route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnTrigger: "automation-cron",
    vault,
  };
}
