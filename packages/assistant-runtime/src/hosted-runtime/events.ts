import type {
  HostedExecutionConversationMessageWake,
  HostedExecutionFirstContactTarget,
  HostedExecutionRunnerSharePack,
  HostedExecutionSystemWake,
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import { queueAssistantFirstContactWelcome } from "@murphai/assistant-engine";
import {
  isHostedConversationMessageWake,
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { buildHostedEmailCapture } from "./events/email.ts";
import { buildHostedLinqCapture } from "./events/linq.ts";
import { handleHostedShareAcceptedWake } from "./events/share.ts";
import { buildHostedTelegramCapture } from "./events/telegram.ts";
import { withHostedInboxPipeline } from "./events/inbox-pipeline.ts";
import type {
  HostedWakeEffect,
  HostedWakeFollowupExecution,
  HostedWakeExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import { assertNever } from "./utils.ts";

type HostedWakeOutcome = HostedWakeEffect & {
  followupExecution: HostedWakeFollowupExecution;
};

export async function executeHostedWakeEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedWakeExecutionMetrics> {
  const bootstrapResult = await prepareHostedWakeContext(
    input.vaultRoot,
    input.wake,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
  );
  const wakeEffect = await handleHostedWakeEvent({
    wake: input.wake,
    executionContext: bootstrappedExecutionContext,
    runtime: input.runtime,
    sharePack: input.sharePack ?? null,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    followupExecution: wakeEffect.followupExecution,
    shareImportResult: wakeEffect.shareImportResult,
    shareImportTitle: wakeEffect.shareImportTitle,
  };
}

async function handleHostedWakeEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedWakeOutcome> {
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
}): Promise<HostedWakeOutcome> {
  const capture = await resolveHostedConversationCapture(input);

  await withHostedInboxPipeline(input.vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });

  return createNoopWakeEffect({
    followupExecution: "conversation-message",
  });
}

async function resolveHostedConversationCapture(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "platform"
  >;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return buildHostedLinqCapture(input.wake);
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return buildHostedTelegramCapture(input.wake);
  }

  if (isHostedEmailConversationMessageWake(input.wake)) {
    return buildHostedEmailCapture(
      input.wake,
      input.runtime.platform.effectsPort,
    );
  }

  throw new TypeError("Unsupported hosted message wake kind.");
}

async function executeHostedSystemWake(input: {
  wake: HostedExecutionSystemWake;
  executionContext: AssistantExecutionContext;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedWakeOutcome> {
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
      return createNoopWakeEffect({
        followupExecution: "system-maintenance",
      });
    case "member.channels.updated":
      return createNoopWakeEffect({
        followupExecution: "system-maintenance",
      });
    case "assistant.cron.tick":
    case "device-sync.wake":
      return createNoopWakeEffect({
        followupExecution: "system-maintenance",
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
        followupExecution: "system-maintenance",
      };
  }

  return assertNever(input.wake);
}

function createNoopWakeEffect(input: {
  followupExecution: HostedWakeFollowupExecution;
}): HostedWakeOutcome {
  return {
    followupExecution: input.followupExecution,
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
