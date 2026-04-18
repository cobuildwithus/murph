import type {
  HostedExecutionFirstContactTarget,
  HostedExecutionDispatchRequest,
  HostedMessageWakeDispatch,
  HostedExecutionRunnerSharePack,
  HostedSystemWakeDispatch,
} from "@murphai/hosted-execution";
import { queueAssistantFirstContactWelcome } from "@murphai/assistant-engine";
import {
  isHostedEmailMessageWakeDispatch,
  isHostedLinqMessageWakeDispatch,
  isHostedMessageWakeDispatch,
  isHostedSystemWakeDispatch,
  isHostedTelegramMessageWakeDispatch,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedDispatchContext,
} from "./context.ts";
import { buildHostedEmailCapture } from "./events/email.ts";
import { buildHostedLinqCapture } from "./events/linq.ts";
import { handleHostedShareAcceptedDispatch } from "./events/share.ts";
import { buildHostedTelegramCapture } from "./events/telegram.ts";
import { withHostedInboxPipeline } from "./events/inbox-pipeline.ts";
import type {
  HostedDispatchEffect,
  HostedDispatchExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import { assertNever } from "./utils.ts";

type HostedDispatchOutcome = HostedDispatchEffect & {
  maintenanceRequired: boolean;
};

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
    maintenanceRequired: dispatchEffect.maintenanceRequired,
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
}): Promise<HostedDispatchOutcome> {
  const dispatch = input.dispatch;

  if (isHostedMessageWakeDispatch(dispatch)) {
    return executeHostedConversationWake({
      dispatch,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });
  }

  if (isHostedSystemWakeDispatch(dispatch)) {
    return executeHostedSystemWake({
      dispatch,
      executionContext: input.executionContext,
      sharePack: input.sharePack ?? null,
      vaultRoot: input.vaultRoot,
    });
  }

  throw new TypeError("Unsupported hosted dispatch kind.");
}

async function executeHostedConversationWake(input: {
  dispatch: HostedMessageWakeDispatch;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "platform"
  >;
  vaultRoot: string;
}): Promise<HostedDispatchOutcome> {
  const capture = await resolveHostedConversationCapture(input);

  await withHostedInboxPipeline(input.vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });

  return createNoopDispatchEffect({
    maintenanceRequired: false,
  });
}

async function resolveHostedConversationCapture(input: {
  dispatch: HostedMessageWakeDispatch;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "platform"
  >;
}) {
  if (isHostedLinqMessageWakeDispatch(input.dispatch)) {
    return buildHostedLinqCapture(input.dispatch);
  }

  if (isHostedTelegramMessageWakeDispatch(input.dispatch)) {
    return buildHostedTelegramCapture(input.dispatch);
  }

  if (isHostedEmailMessageWakeDispatch(input.dispatch)) {
    return buildHostedEmailCapture(
      input.dispatch,
      input.runtime.platform.effectsPort,
    );
  }

  throw new TypeError("Unsupported hosted message wake kind.");
}

async function executeHostedSystemWake(input: {
  dispatch: HostedSystemWakeDispatch;
  executionContext: AssistantExecutionContext;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultRoot: string;
}): Promise<HostedDispatchOutcome> {
  switch (input.dispatch.event.kind) {
    case "member.activated":
      if (input.dispatch.event.firstContact) {
        await queueAssistantFirstContactWelcome(
          buildAssistantFirstContactWelcomeInput(
            input.dispatch.event.firstContact,
            input.executionContext,
            input.vaultRoot,
          ),
        );
      }
      return createNoopDispatchEffect({
        maintenanceRequired: true,
      });
    case "member.channels.updated":
      return createNoopDispatchEffect({
        maintenanceRequired: true,
      });
    case "assistant.cron.tick":
    case "device-sync.wake":
      return createNoopDispatchEffect({
        maintenanceRequired: true,
      });
    case "vault.share.accepted":
      if (!input.sharePack) {
        throw new TypeError("Hosted share accepted dispatch requires a hydrated runner sharePack.");
      }
      return {
        ...(await handleHostedShareAcceptedDispatch({
          dispatch: {
            ...input.dispatch,
            event: input.dispatch.event,
          },
          sharePack: input.sharePack,
          vaultRoot: input.vaultRoot,
        })),
        maintenanceRequired: true,
      };
  }

  return assertNever(input.dispatch.event);
}

function createNoopDispatchEffect(input: {
  maintenanceRequired: boolean;
}): HostedDispatchOutcome {
  return {
    maintenanceRequired: input.maintenanceRequired,
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
