import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";
import { queueAssistantFirstContactWelcome } from "@murphai/assistant-engine";
import {
  assistantGatewayLocalMessageSender,
  assistantGatewayLocalProjectionSourceReader,
} from "@murphai/assistant-engine/gateway-local-adapter";
import { sendGatewayMessageLocal } from "@murphai/gateway-local";

import { prepareHostedDispatchContext } from "./context.ts";
import { ingestHostedEmailMessage } from "./events/email.ts";
import { ingestHostedLinqMessage } from "./events/linq.ts";
import { handleHostedShareAcceptedDispatch } from "./events/share.ts";
import { ingestHostedTelegramMessage } from "./events/telegram.ts";
import type {
  HostedDispatchEffect,
  HostedDispatchExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import { assertNever } from "./utils.ts";

export async function executeHostedDispatchEvent(input: {
  dispatch: HostedExecutionDispatchRequest;
  resultsBaseUrl: string;
  internalWorkerFetch?: typeof fetch;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "userEnv" | "webControlPlane"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedDispatchExecutionMetrics> {
  const bootstrapResult = await prepareHostedDispatchContext(
    input.vaultRoot,
    input.dispatch,
    input.runtimeEnv,
  );
  const dispatchEffect = await handleHostedDispatchEvent({
    dispatch: input.dispatch,
    resultsBaseUrl: input.resultsBaseUrl,
    internalWorkerFetch: input.internalWorkerFetch,
    runtime: input.runtime,
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
  resultsBaseUrl: string;
  internalWorkerFetch?: typeof fetch;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "userEnv" | "webControlPlane"
  >;
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  const dispatch = input.dispatch;

  switch (dispatch.event.kind) {
    case "member.activated":
      if (dispatch.event.firstContact) {
        await queueAssistantFirstContactWelcome({
          channel: dispatch.event.firstContact.channel,
          identityId: dispatch.event.firstContact.identityId,
          threadId: dispatch.event.firstContact.threadId,
          threadIsDirect: dispatch.event.firstContact.threadIsDirect,
          vault: input.vaultRoot,
        });
      }
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
        input.resultsBaseUrl,
        input.internalWorkerFetch,
        input.runtime.commitTimeoutMs,
        input.runtime.userEnv,
      );
      return createNoopDispatchEffect();
    case "assistant.cron.tick":
    case "device-sync.wake":
      return createNoopDispatchEffect();
    case "vault.share.accepted":
      return await handleHostedShareAcceptedDispatch({
        dispatch: {
          ...dispatch,
          event: dispatch.event,
        },
        vaultRoot: input.vaultRoot,
      });
    case "gateway.message.send":
      await sendGatewayMessageLocal({
        clientRequestId: dispatch.event.clientRequestId,
        dispatchMode: "queue-only",
        messageSender: assistantGatewayLocalMessageSender,
        replyToMessageId: dispatch.event.replyToMessageId,
        sessionKey: dispatch.event.sessionKey,
        sourceReader: assistantGatewayLocalProjectionSourceReader,
        text: dispatch.event.text,
        vault: input.vaultRoot,
      });
      return createNoopDispatchEffect();
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
