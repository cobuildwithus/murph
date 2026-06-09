import {
  conversationRefFromAssistantInputConversation,
  type AssistantInputConversationRef,
  type AssistantInputReplyTarget,
} from "@murphai/assistant-engine";

export interface HostedForegroundCurrentDeliveryRoute {
  channel: string;
  deliveryTarget: string;
  identityId: string | null;
  participantId: string | null;
  threadId: string | null;
}

export function readHostedAssistantInputCurrentDeliveryRoute(input: {
  conversation: AssistantInputConversationRef | null;
  replyTarget: AssistantInputReplyTarget | null;
}): HostedForegroundCurrentDeliveryRoute | null {
  const channel = normalizeHostedCurrentDeliveryRouteValue(input.replyTarget?.channel);
  if (!channel || !hostedReplyTargetThreadIsDeliveryTarget(channel)) {
    return null;
  }
  const deliveryTarget = normalizeHostedCurrentDeliveryRouteValue(input.replyTarget?.threadId);
  if (!deliveryTarget) {
    return null;
  }
  const conversationRoute = input.conversation
    ? conversationRefFromAssistantInputConversation(input.conversation)
    : null;
  const useConversationLocator = conversationRoute?.channel === channel;
  return {
    channel,
    deliveryTarget,
    identityId: useConversationLocator
      ? normalizeHostedCurrentDeliveryRouteValue(conversationRoute.identityId)
      : null,
    participantId: useConversationLocator
      ? normalizeHostedCurrentDeliveryRouteValue(conversationRoute.participantId)
      : null,
    threadId: useConversationLocator
      ? normalizeHostedCurrentDeliveryRouteValue(conversationRoute.threadId)
      : null,
  };
}

function hostedReplyTargetThreadIsDeliveryTarget(channel: string): boolean {
  return channel === "linq"
    || channel === "telegram"
    || channel === "email"
    || channel === "whatsapp";
}

function normalizeHostedCurrentDeliveryRouteValue(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}
