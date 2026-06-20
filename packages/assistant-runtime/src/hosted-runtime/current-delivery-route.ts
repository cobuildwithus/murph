import {
  conversationRefFromAssistantInputConversation,
  type AssistantInputConversationRef,
  type AssistantInputReplyTarget,
} from "@murphai/assistant-engine";
import { assistantChannelNameValues } from "@murphai/operator-config/assistant-cli-contracts";
import {
  normalizeAssistantRouteString,
  type AssistantCurrentDeliveryRoute,
} from "@murphai/operator-config/assistant/current-delivery-route";

const deliveryChannels: readonly string[] = assistantChannelNameValues;

// Most channels identify a conversation by channel + delivery target. Hosted
// email reply targets are serialized per-message envelopes, so same-thread
// email messages use the stable conversation thread locator instead.
export function resolveUnambiguousCurrentDeliveryRoute(
  routes: readonly AssistantCurrentDeliveryRoute[],
): AssistantCurrentDeliveryRoute | null {
  const byConversation = new Map<string, AssistantCurrentDeliveryRoute>();
  for (const route of routes) {
    const key = resolveCurrentDeliveryRouteConversationKey(route);
    const existing = byConversation.get(key);
    byConversation.set(key, existing ? mergeAgreedRouteLocators(existing, route) : route);
  }
  if (byConversation.size !== 1) {
    return null;
  }
  return [...byConversation.values()][0] ?? null;
}

function resolveCurrentDeliveryRouteConversationKey(
  route: AssistantCurrentDeliveryRoute,
): string {
  if (route.channel === "email" && route.threadId) {
    return `${route.channel}\0${route.identityId ?? ""}\0thread:${route.threadId}`;
  }
  return `${route.channel}\0${route.deliveryTarget}`;
}

function mergeAgreedRouteLocators(
  a: AssistantCurrentDeliveryRoute,
  b: AssistantCurrentDeliveryRoute,
): AssistantCurrentDeliveryRoute {
  return {
    channel: a.channel,
    deliveryTarget: b.deliveryTarget,
    identityId: a.identityId === b.identityId ? a.identityId : null,
    participantId: a.participantId === b.participantId ? a.participantId : null,
    threadId: a.threadId === b.threadId ? a.threadId : null,
  };
}

export function readHostedAssistantInputCurrentDeliveryRoute(input: {
  conversation: AssistantInputConversationRef | null;
  replyTarget: AssistantInputReplyTarget | null;
}): AssistantCurrentDeliveryRoute | null {
  const channel = normalizeAssistantRouteString(input.replyTarget?.channel);
  // Every delivery channel uses the reply-target thread id as the delivery target.
  if (!channel || !deliveryChannels.includes(channel)) {
    return null;
  }
  const deliveryTarget = normalizeAssistantRouteString(input.replyTarget?.threadId);
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
      ? normalizeAssistantRouteString(conversationRoute.identityId)
      : null,
    participantId: useConversationLocator
      ? normalizeAssistantRouteString(conversationRoute.participantId)
      : null,
    threadId: useConversationLocator
      ? normalizeAssistantRouteString(conversationRoute.threadId)
      : null,
  };
}
