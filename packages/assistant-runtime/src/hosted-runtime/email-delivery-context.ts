import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
} from "@murphai/hosted-execution";

export interface HostedAssistantEmailDeliveryContext {
  senderHandle: string | null;
}

export function buildHostedAssistantEmailDeliveryContextFromWake(
  wake: HostedExecutionConversationMessageWake,
): HostedAssistantEmailDeliveryContext | null {
  if (!isHostedEmailConversationMessageWake(wake)) {
    return null;
  }

  return {
    senderHandle: normalizeHostedEmailDeliveryContextText(wake.message.from),
  };
}

function normalizeHostedEmailDeliveryContextText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
