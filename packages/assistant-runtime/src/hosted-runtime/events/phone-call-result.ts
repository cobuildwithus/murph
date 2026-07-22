import {
  recordAssistantConversationContext,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionPhoneCallResultedWake,
} from "@murphai/hosted-execution";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedPhoneCallResultedWake(input: {
  executionContext: AssistantExecutionContext;
  vaultRoot: string;
  wake: HostedExecutionPhoneCallResultedWake;
}): Promise<HostedMailboxOutcome> {
  await recordAssistantConversationContext({
    context: input.wake.phoneCall.context,
    idempotencyKey: input.wake.eventId,
    occurredAt: input.wake.occurredAt,
    sessionId: input.wake.phoneCall.originSessionId,
    vault: input.vaultRoot,
  });

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "phone-call-result-context",
  });
}
