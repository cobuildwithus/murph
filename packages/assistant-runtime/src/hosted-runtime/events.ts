import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";
import { sendGatewayMessageLocal } from "@murph/gateway-core/local";

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
  emailBaseUrl: string;
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
    emailBaseUrl: input.emailBaseUrl,
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
  emailBaseUrl: string;
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
        input.emailBaseUrl,
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
        internalWorkerFetch: input.internalWorkerFetch,
        runtime: input.runtime,
        vaultRoot: input.vaultRoot,
      });
    case "gateway.message.send":
      await sendGatewayMessageLocal({
        clientRequestId: dispatch.event.clientRequestId,
        dispatchMode: "queue-only",
        replyToMessageId: dispatch.event.replyToMessageId,
        sessionKey: dispatch.event.sessionKey,
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
