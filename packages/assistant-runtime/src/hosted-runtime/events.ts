import type {
  HostedExecutionFirstContactTarget,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerSharePack,
} from "@murphai/hosted-execution";
import { queueAssistantFirstContactWelcome } from "@murphai/assistant-engine";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedDispatchContext,
} from "./context.ts";
import { ingestHostedEmailMessage } from "./events/email.ts";
import { ingestHostedLinqMessage } from "./events/linq.ts";
import { handleHostedShareAcceptedDispatch } from "./events/share.ts";
import { ingestHostedTelegramMessage } from "./events/telegram.ts";
import type {
  HostedDispatchEffect,
  HostedDispatchExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import { assertNever } from "./utils.ts";

export async function executeHostedDispatchEvent(input: {
  dispatch: HostedExecutionDispatchRequest;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedDispatchExecutionMetrics> {
  const bootstrapResult = await prepareHostedDispatchContext(
    input.vaultRoot,
    input.dispatch,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
  );
  const dispatchEffect = await handleHostedDispatchEvent({
    dispatch: input.dispatch,
    executionContext: bootstrappedExecutionContext,
    runtime: input.runtime,
    sharePack: input.sharePack ?? null,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    shareImportResult: dispatchEffect.shareImportResult,
    shareImportTitle: dispatchEffect.shareImportTitle,
  };
}

async function handleHostedDispatchEvent(input: {
  dispatch: HostedExecutionDispatchRequest;
  executionContext: AssistantExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  const dispatch = input.dispatch;

  switch (dispatch.event.kind) {
    case "member.activated":
      if (dispatch.event.firstContact) {
        await queueAssistantFirstContactWelcome(
          buildAssistantFirstContactWelcomeInput(
            dispatch.event.firstContact,
            input.executionContext,
            input.vaultRoot,
          ),
        );
      }
      return createNoopDispatchEffect();
    case "member.channels.updated":
      return createNoopDispatchEffect();
    case "linq.message.received":
      await ingestHostedLinqMessage(input.vaultRoot, {
        ...dispatch,
        event: dispatch.event,
      });
      return createNoopDispatchEffect();
    case "telegram.message.received":
      await ingestHostedTelegramMessage(input.vaultRoot, {
        ...dispatch,
        event: dispatch.event,
      });
      return createNoopDispatchEffect();
    case "email.message.received":
      await ingestHostedEmailMessage(
        input.vaultRoot,
        {
          ...dispatch,
          event: dispatch.event,
        },
        input.runtime.platform.effectsPort,
        input.runtime.userEnv,
      );
      return createNoopDispatchEffect();
    case "assistant.cron.tick":
    case "device-sync.wake":
      return createNoopDispatchEffect();
    case "vault.share.accepted":
      if (!input.sharePack) {
        throw new TypeError("Hosted share accepted dispatch requires a hydrated runner sharePack.");
      }
      return await handleHostedShareAcceptedDispatch({
        dispatch: {
          ...dispatch,
          event: dispatch.event,
        },
        sharePack: input.sharePack,
        vaultRoot: input.vaultRoot,
      });
    default:
      return assertNever(dispatch.event);
  }
}

function createNoopDispatchEffect(): HostedDispatchEffect {
  return {
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
