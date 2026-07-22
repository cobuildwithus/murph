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
  const route = input.wake.phoneCall.route;
  const delivery = route.delivery;
  if (route.threadIsDirect !== true || delivery.kind === "explicit") {
    throw new TypeError(
      "Hosted phone-call result context requires a bound direct conversation route.",
    );
  }

  await recordAssistantConversationContext({
    actorId: route.actorId,
    bindingDeliveryTarget: delivery.target,
    channel: route.channel,
    context: input.wake.phoneCall.context,
    deliveryKind: delivery.kind,
    executionContext: input.executionContext,
    idempotencyKey: input.wake.eventId,
    identityId: route.identityId,
    occurredAt: input.wake.occurredAt,
    threadId: route.threadId,
    threadIsDirect: true,
    vault: input.vaultRoot,
  });

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "phone-call-result-context",
  });
}
