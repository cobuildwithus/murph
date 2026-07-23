import {
  isAssistantConversationContextUnavailableError,
  recordAssistantConversationContext,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionPhoneCallResultedWake,
  type HostedExecutionRedactedLogEntry,
} from "@murphai/hosted-execution";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedPhoneCallResultedWake(input: {
  vaultRoot: string;
  wake: HostedExecutionPhoneCallResultedWake;
}): Promise<HostedMailboxOutcome> {
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
  try {
    await recordAssistantConversationContext({
      context: input.wake.phoneCall.context,
      idempotencyKey: input.wake.eventId,
      occurredAt: input.wake.occurredAt,
      sessionId: input.wake.phoneCall.originSessionId,
      vault: input.vaultRoot,
    });
  } catch (error) {
    if (!isAssistantConversationContextUnavailableError(error)) {
      throw error;
    }
    redactedLogEntries.push(emitInvalidPhoneCallOriginLog(input.wake));
  }

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "phone-call-result-context",
    redactedLogEntries,
  });
}

function emitInvalidPhoneCallOriginLog(
  wake: HostedExecutionPhoneCallResultedWake,
): HostedExecutionRedactedLogEntry {
  const message = "Hosted phone-call result origin session is unavailable.";
  const redacted = {
    eventCode: "assistant.phone_call_result_origin_unavailable",
  };
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: redacted,
    level: "warn",
    message,
    phase: "wake.running",
    wake,
  });
  return {
    component: "runtime",
    eventId: wake.eventId,
    level: "warn",
    message,
    phase: "wake.running",
    redacted,
  };
}
