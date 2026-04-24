import {
  createInboxBackedAssistantTurnInputPort,
  type AssistantTurnInputPort,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionConversationMessageWake,
  type HostedRunCleanupTarget,
  type HostedRunEventResult,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import { ingestHostedConversationMessageWake } from "./events/conversation.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

export function createHostedAssistantTurnInputPort(input: {
  inboxServices: Parameters<typeof createInboxBackedAssistantTurnInputPort>[0]["inboxServices"];
  requestId: string;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">;
  onImportedEvent?: (
    result: HostedRunEventResult,
    cleanupTarget: HostedRunCleanupTarget | null,
  ) => void;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): AssistantTurnInputPort | undefined {
  const hostedTurnInputPort = input.runtime.platform.turnInputPort;
  if (!hostedTurnInputPort) {
    return undefined;
  }

  const basePort = createInboxBackedAssistantTurnInputPort({
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    vault: input.vaultRoot,
  });
  const importedIngressEventIds = new Set<string>();
  let lastImportedSeq: string | null = null;

  return {
    async refresh(refreshInput) {
      let imported = false;
      let refresh: Awaited<ReturnType<typeof hostedTurnInputPort.refresh>> | null = null;

      try {
        refresh = await hostedTurnInputPort.refresh({
          ...(lastImportedSeq ? { afterSeq: lastImportedSeq } : {}),
          phase: refreshInput.phase,
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
          message: "Hosted assistant turn-input refresh failed before delivery.",
          phase: "wake.running",
          wake: input.wake,
        });
        throw error;
      }

      for (const event of refresh?.events ?? []) {
        if (lastImportedSeq !== null && BigInt(event.seq) <= BigInt(lastImportedSeq)) {
          continue;
        }

        lastImportedSeq = maxBigIntString(lastImportedSeq, event.seq);

        if (
          importedIngressEventIds.has(event.ingressEventId)
          || event.wake.kind !== "conversation.message"
        ) {
          continue;
        }

        await ingestHostedConversationMessageWake({
          runtime: input.runtime,
          vaultRoot: input.vaultRoot,
          wake: event.wake,
        });
        importedIngressEventIds.add(event.ingressEventId);
        input.onImportedEvent?.(
          {
            ingressEventId: event.ingressEventId,
            state: "completed",
          },
          createHostedTurnInputCleanupTarget(event.wake),
        );
        imported = true;
      }

      const baseResult = await basePort.refresh(refreshInput);
      if (imported && !baseResult.progressed) {
        return {
          progressed: true,
          reason: "ingested_input",
        };
      }

      return baseResult;
    },
    listNewConversationCaptures(query) {
      return basePort.listNewConversationCaptures(query);
    },
  };
}

function maxBigIntString(left: string | null, right: string): string {
  if (left === null || BigInt(right) > BigInt(left)) {
    return right;
  }

  return left;
}

function createHostedTurnInputCleanupTarget(
  wake: HostedExecutionConversationMessageWake,
): HostedRunCleanupTarget | null {
  switch (wake.message.channel) {
    case "email":
      return {
        channel: "email",
        eventId: wake.eventId,
        rawMessageKey: wake.message.rawMessageKey,
        userId: wake.userId,
      };
    case "linq":
      return {
        channel: "linq",
        messageId: wake.message.linqMessage.messageId,
      };
    case "telegram":
      return {
        channel: "telegram",
        messageId: wake.message.telegramMessage.messageId,
        target: wake.message.telegramMessage.threadId,
      };
  }
}
