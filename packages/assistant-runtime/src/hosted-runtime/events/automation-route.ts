import type {
  AutomationRoute,
} from "@murphai/contracts";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

export function buildHostedAssistantAutomationRoute(
  route: HostedExecutionAssistantNotificationRoute,
): AutomationRoute {
  const delivery = route.delivery;
  if (route.channel === "linq") {
    return {
      channel: route.channel,
      deliverySource: delivery.source ?? null,
      deliveryTarget: delivery.kind === "participant" ? null : delivery.target,
      identityId: route.identityId,
      participantId: delivery.kind === "participant" ? delivery.target : null,
      threadId: null,
    };
  }

  return {
    channel: route.channel,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "explicit" ? delivery.target : null,
    identityId: route.identityId,
    participantId: delivery.kind === "participant" ? delivery.target : null,
    threadId:
      route.threadId ?? (delivery.kind === "thread" ? delivery.target : null),
  };
}
