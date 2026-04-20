import type {
  HostedExecutionConversationMessageWake,
  HostedExecutionFirstContactTarget,
  HostedExecutionRunnerSharePack,
  HostedIngressSystemEnvelope,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import { queueAssistantFirstContactWelcome } from "@murphai/assistant-engine";
import {
  isHostedConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { ingestHostedConversationMessageWake } from "./events/conversation.ts";
import { handleHostedShareAcceptedWake } from "./events/share.ts";
import type {
  HostedIngressEffect,
  HostedIngressLane,
  HostedIngressExecutionMetrics,
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import { assertNever } from "./utils.ts";

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
  });

  return {
    bootstrapResult,
    conversationMetrics: ingressEffect.conversationMetrics,
    ingressLane: ingressEffect.ingressLane,
    shareImportResult: ingressEffect.shareImportResult,
    shareImportTitle: ingressEffect.shareImportTitle,
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
}): Promise<HostedIngressOutcome> {
  switch (input.wake.kind) {
    case "member.activated":
      if (input.wake.firstContact) {
        await queueAssistantFirstContactWelcome(
          buildAssistantFirstContactWelcomeInput(
            input.wake.firstContact,
            input.executionContext,
            input.vaultRoot,
          ),
        );
      }
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "member-activated",
      });
    case "member.channels.updated":
      return createNoopIngressEffect({
        conversationMetrics: null,
        ingressLane: "member-channels-updated",
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
        ingressLane: "vault-share-accepted",
      };
  }

  return assertNever(input.wake);
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
  };
}

function buildAssistantFirstContactWelcomeInput(
  firstContact: HostedExecutionFirstContactTarget,
  executionContext: AssistantExecutionContext,
  vault: string,
): Parameters<typeof queueAssistantFirstContactWelcome>[0] {
  if (firstContact.kind === "linq-materialize-home-thread") {
    return {
      channel: "linq",
      executionContext,
      fromPhoneNumber: firstContact.fromPhoneNumber,
      identityId: firstContact.identityId,
      kind: firstContact.kind,
      toPhoneNumber: firstContact.toPhoneNumber,
      vault,
    };
  }

  return {
    actorId: null,
    channel: firstContact.channel,
    executionContext,
    identityId: firstContact.identityId,
    threadId: firstContact.threadId,
    threadIsDirect: firstContact.threadIsDirect,
    vault,
  };
}
