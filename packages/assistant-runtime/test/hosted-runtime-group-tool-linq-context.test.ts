import { describe, expect, it, vi } from "vitest";

import { createHostedGroupToolWithLinqThreadContext } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";

const ROUTE_AUTHORITY = {
  accountLookupKey: "hplk_account",
  channel: "linq" as const,
  containerMemberId: "member_container",
  threadId: "chat_group_1",
};

function buildLinqDeliveryContext(
  overrides: Partial<HostedAssistantLinqDeliveryContext>,
): HostedAssistantLinqDeliveryContext {
  return {
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
    replyToMessageId: null,
    routeAuthority: null,
    service: "imessage",
    target: "chat_group_1",
    threadIsDirect: false,
    ...overrides,
  };
}

describe("createHostedGroupToolWithLinqThreadContext", () => {
  it("injects the wake-derived linq thread into chat-scoped actions only", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: { status: "sent" },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: null }),
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
      ],
    });

    await groupTool.request({ action: "share_contact_card" });
    expect(request).toHaveBeenLastCalledWith({
      action: "share_contact_card",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_chat_participants",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "post_join_offer" });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_join_offer",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });
  });

  it("fails closed when the turn carries two distinct route-authorized threads", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_group_2" },
          target: "chat_group_2",
        }),
      ],
    });

    await groupTool.request({ action: "post_join_offer" });
    expect(request).toHaveBeenLastCalledWith({ action: "post_join_offer" });
  });

  it("dedupes repeated contexts for the same thread and skips non-iMessage or direct contexts", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_chat_participants",
      result: { participants: [], status: "ok" },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_sms_group" },
          service: "sms",
        }),
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_direct" },
          threadIsDirect: true,
        }),
      ],
    });

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_chat_participants",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });
  });

  it("forwards chat-scoped actions without a linq thread when no route-authorized context exists", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [buildLinqDeliveryContext({ routeAuthority: null })],
    });

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_participants" });
  });
});
