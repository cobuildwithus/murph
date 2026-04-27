import {
  createInboxBackedAssistantTurnInputPort,
  type AssistantTurnInputRefreshResult,
  type AssistantTurnInputPort,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

export function createHostedAssistantTurnInputPort(input: {
  inboxServices: Parameters<typeof createInboxBackedAssistantTurnInputPort>[0]["inboxServices"];
  requestId: string;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): AssistantTurnInputPort | undefined {
  const refreshMailboxBeforeDelivery =
    input.runtime.platform.refreshMailboxBeforeDelivery ?? null;
  if (!refreshMailboxBeforeDelivery) {
    return undefined;
  }

  const basePort = createInboxBackedAssistantTurnInputPort({
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    vault: input.vaultRoot,
  });

  return {
    async refresh(refreshInput) {
      let mailboxRefresh: AssistantTurnInputRefreshResult | null = null;

      if (refreshInput.phase === "before_delivery") {
        try {
          mailboxRefresh = await refreshMailboxBeforeDelivery({
            requestId: input.requestId,
          });
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "runtime",
            details: {
              requestId: input.requestId,
            },
            error,
            level: "warn",
            message: "Hosted assistant mailbox refresh failed before delivery.",
            phase: "wake.running",
            wake: input.wake,
          });
          throw error;
        }
      }

      const baseResult = await basePort.refresh(refreshInput);
      return mergeHostedTurnInputRefreshResult({
        baseResult,
        mailboxRefresh,
      });
    },
    listNewConversationCaptures(query) {
      return basePort.listNewConversationCaptures(query);
    },
  };
}

function mergeHostedTurnInputRefreshResult(input: {
  baseResult: AssistantTurnInputRefreshResult;
  mailboxRefresh: AssistantTurnInputRefreshResult | null;
}): AssistantTurnInputRefreshResult {
  if (input.baseResult.progressed) {
    return input.baseResult;
  }

  if (input.mailboxRefresh?.progressed) {
    return input.mailboxRefresh;
  }

  if (
    input.mailboxRefresh
    && input.mailboxRefresh.reason !== "no_new_input"
    && input.mailboxRefresh.reason !== "no_port"
  ) {
    return input.mailboxRefresh;
  }

  return input.baseResult;
}
