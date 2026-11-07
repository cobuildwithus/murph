import "server-only";

import {
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  type HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  getHostedLinqChatSummary,
  readHostedLinqExplicitGroupDisplayName,
} from "../hosted-onboarding/linq-client";
import { getHostedTelegramGroupTitle } from "../hosted-onboarding/telegram-client";
import {
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";

export type HostedGroupChatNameResult = Extract<
  HostedRuntimeGroupToolResponse,
  { action: "read_chat_name" }
>["result"];

export function normalizeHostedGroupDisplayName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    !normalized
    || normalized.length > HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH
  ) {
    return null;
  }
  return normalized;
}

// Reads the provider's current chat title (iMessage group name or Telegram
// title) for an active group runtime. Callers own whether the reader may see it.
export async function readHostedGroupChatName(input: {
  memberId: string;
}): Promise<HostedGroupChatNameResult> {
  const unavailable = (unavailableReason: string): HostedGroupChatNameResult => ({
    displayName: null,
    status: "unavailable",
    unavailableReason,
  });

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return unavailable("runtime_inactive");
  }

  let destination: Awaited<
    ReturnType<typeof resolveHostedAssistantNotificationDestination>
  >;
  try {
    destination = await resolveHostedAssistantNotificationDestination({
      memberId: input.memberId,
    });
  } catch {
    return unavailable("route_unavailable");
  }

  const authority = destination?.conversationShape === "thread-container"
    ? destination.externalThreadRouteAuthority
    : null;
  if (!authority) {
    return unavailable("group_chat_unavailable");
  }

  let providerDisplayName: string | null;
  try {
    if (authority.channel === "linq") {
      providerDisplayName = readHostedLinqExplicitGroupDisplayName(
        await getHostedLinqChatSummary({ chatId: authority.threadId }),
      );
    } else if (authority.channel === "telegram") {
      providerDisplayName = await getHostedTelegramGroupTitle({
        threadId: authority.threadId,
      });
    } else {
      return unavailable("group_chat_unavailable");
    }
  } catch {
    return unavailable("provider_unavailable");
  }

  const displayName = providerDisplayName
    ? normalizeHostedGroupDisplayName(providerDisplayName)
    : null;
  return displayName
    ? { displayName, status: "ok" }
    : { displayName: null, status: "none" };
}
