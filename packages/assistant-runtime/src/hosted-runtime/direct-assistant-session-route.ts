import {
  listAssistantSessions,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import type {
  AssistantSession,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  normalizeAssistantRouteString,
} from "@murphai/operator-config/assistant/current-delivery-route";

const DELIVERY_CHANNELS: readonly string[] = ["linq", "telegram"];

export async function readCurrentDirectAssistantSessionRoute(
  vaultRoot: string,
): Promise<Pick<AssistantInputEventRecord, "conversation" | "replyTarget"> | null> {
  const sessions = await listAssistantSessions(vaultRoot);
  for (const session of sessions) {
    const route = readDirectAssistantSessionRoute(session);
    if (route) {
      return route;
    }
  }

  return null;
}

function readDirectAssistantSessionRoute(
  session: Pick<AssistantSession, "binding">,
): Pick<AssistantInputEventRecord, "conversation" | "replyTarget"> | null {
  const binding = session.binding;
  if (binding.threadIsDirect !== true) {
    return null;
  }

  const channel = normalizeAssistantRouteString(binding.channel);
  if (!channel || !DELIVERY_CHANNELS.includes(channel)) {
    return null;
  }

  const deliveryTarget = normalizeAssistantRouteString(binding.delivery?.target);
  if (!deliveryTarget) {
    return null;
  }

  return {
    conversation: {
      accountId: normalizeAssistantRouteString(binding.identityId),
      actorId: normalizeAssistantRouteString(binding.actorId),
      actorIsSelf: false,
      source: channel,
      threadId: normalizeAssistantRouteString(binding.threadId),
      threadIsDirect: true,
    },
    replyTarget: {
      channel,
      messageId: null,
      threadId: deliveryTarget,
    },
  };
}
