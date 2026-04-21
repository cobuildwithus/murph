import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionConversationMessageWake,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerVaultSyncImport,
  HostedIngressSystemEnvelope,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import { sendAssistantNotification } from "@murphai/assistant-engine";
import {
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
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
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
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
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
    "platform"
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
      await sendAssistantNotification(
        buildAssistantNotificationInput(input.wake, input.executionContext, input.vaultRoot),
      );
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "assistant-notification",
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
        ingressLane: "vault-sync-import",
      };
  }

  const exhaustiveWake: never = input.wake;
  void exhaustiveWake;
  throw new TypeError('Unsupported hosted system wake kind.');
}

function createNoopIngressEffect(input: {
  conversationMetrics: HostedConversationWakeMetrics | null;
  ingressLane: HostedIngressLane;
}): HostedIngressOutcome {
  return {
    conversationMetrics: input.conversationMetrics,
    ingressLane: input.ingressLane,
    shareImportResult: null,
    shareImportTitle: null,
    vaultSyncImportResult: null,
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
