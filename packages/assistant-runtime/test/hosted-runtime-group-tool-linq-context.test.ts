import { describe, expect, it, vi } from "vitest";

import {
  createHostedGroupToolWithLinqThreadContext,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";
import type { HostedAssistantEmailDeliveryContext } from "../src/hosted-runtime/email-delivery-context.ts";

const ROUTE_AUTHORITY = {
  accountLookupKey: "hplk_current_line",
  channel: "linq" as const,
  containerMemberId: "member_container",
  threadId: "chat_group_1",
};
const PRIVATE_ASSISTANT_INPUT_ID = `ain_${"3".repeat(32)}`;

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

function buildEmailDeliveryContext(
  overrides: Partial<HostedAssistantEmailDeliveryContext>,
): HostedAssistantEmailDeliveryContext {
  return {
    senderHandle: "person@example.test",
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

    await groupTool.request({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
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

    await groupTool.request({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "preflight_set_chat_avatar" });
    expect(request).toHaveBeenLastCalledWith({
      action: "preflight_set_chat_avatar",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
        projectionKinds: ["sleep-times.v0"],
      },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
        projectionKinds: ["sleep-times.v0"],
      },
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });

    await groupTool.request({
      action: "ask",
      groupLabel: "Morning Movers",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "ask",
      groupLabel: "Morning Movers",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
    });

    await groupTool.request({
      action: "leave_membership",
      membershipId: "hgm_private_member",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "leave_membership",
      membershipId: "hgm_private_member",
    });
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

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
      },
    });
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
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            accountLookupKey: "hplk_legacy_other_line",
          },
        }),
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

    await groupTool.request({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
    });

    await groupTool.request({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    });

    await groupTool.request({ action: "preflight_set_chat_avatar" });
    expect(request).toHaveBeenLastCalledWith({ action: "preflight_set_chat_avatar" });

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
        projectionKinds: ["sleep-times.v0"],
      },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
        projectionKinds: ["sleep-times.v0"],
      },
    });
  });

  it("does not use unauthenticated email From as newsletter opt-out authority", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      emailDeliveryContexts: [buildEmailDeliveryContext({})],
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await groupTool.request({ action: "revoke_own_email_share" });
    expect(request).toHaveBeenLastCalledWith({ action: "revoke_own_email_share" });

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });
  });

  it("rejects personal membership reads and durable group mutations whenever email ingress is present", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      emailDeliveryContexts: [buildEmailDeliveryContext({})],
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
      ],
    });

    await expect(groupTool.request({ action: "list_memberships" })).resolves.toEqual({
      action: "list_memberships",
      result: {
        memberships: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({
      action: "ask",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
    })).resolves.toEqual({
      action: "ask",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({ action: "create_join_link" })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({
      action: "update_display_name",
      updateDisplayName: { displayName: "Spoofed rename" },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({
      action: "leave_membership",
      membershipId: "hgm_private_member",
    })).resolves.toEqual({
      action: "leave_membership",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    await groupTool.request({ action: "revoke_own_email_share" });
    expect(request).toHaveBeenLastCalledWith({ action: "revoke_own_email_share" });
  });

  it("retains group-email mutation denial across a no-context continuation", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      emailDeliveryContexts: [],
      groupEmailIngress: true,
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await expect(groupTool.request({ action: "create_join_link" })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("injects the current group chat sender into newsletter opt-out", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request({ action: "revoke_own_email_share" });
    expect(request).toHaveBeenLastCalledWith({
      action: "revoke_own_email_share",
      selfOptOut: {
        senderHandle: "+15550000001",
        source: "linq",
      },
    });
  });

  it("injects the current group chat sender into personal style reads and writes", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        action: "read_own_assistant_style",
        result: {
          status: "ok",
          style: {
            personality: {
              detail: { source: "default", value: 5 },
              humor: { source: "default", value: 3 },
              push: { source: "default", value: 3 },
            },
            tone: "formal",
            voice: "upbeat",
          },
        },
      })
      .mockResolvedValueOnce({
        action: "update_own_assistant_style",
        result: {
          status: "saved",
          style: {
            personality: {
              detail: { source: "default", value: 5 },
              humor: { source: "custom", value: 10 },
              push: { source: "default", value: 3 },
            },
            tone: "formal",
            voice: "upbeat",
          },
        },
      });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request({ action: "read_own_assistant_style" });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_own_assistant_style",
      currentSender: { senderHandle: "+15550000001", source: "linq" },
    });

    await groupTool.request({
      action: "update_own_assistant_style",
      style: { personality: { humor: 10 } },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "update_own_assistant_style",
      currentSender: { senderHandle: "+15550000001", source: "linq" },
      style: { personality: { humor: 10 } },
    });
  });

  it("rejects personal style reads and writes for group-email ingress", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      emailDeliveryContexts: [buildEmailDeliveryContext({})],
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await expect(groupTool.request({ action: "read_own_assistant_style" })).resolves.toEqual({
      action: "read_own_assistant_style",
      result: {
        status: "unavailable",
        style: null,
        unavailableReason: "authenticated_sender_required",
      },
    });
    await expect(groupTool.request({
      action: "update_own_assistant_style",
      style: { voice: "warm" },
    })).resolves.toEqual({
      action: "update_own_assistant_style",
      result: {
        status: "unavailable",
        style: null,
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails personal style access closed when the current group sender is ambiguous", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_own_assistant_style",
      result: {
        status: "unavailable",
        style: null,
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ directRecipientPhoneNumber: "+15550000001" }),
        buildLinqDeliveryContext({ directRecipientPhoneNumber: "+15550000002" }),
      ],
    });

    await groupTool.request({ action: "read_own_assistant_style" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_own_assistant_style" });
  });

  it("fails personal style access closed when sender contexts are direct or missing", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "update_own_assistant_style",
      result: {
        status: "unavailable",
        style: null,
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          threadIsDirect: true,
        }),
        buildLinqDeliveryContext({ directRecipientPhoneNumber: "   " }),
      ],
    });

    await groupTool.request({
      action: "update_own_assistant_style",
      style: { personality: { detail: 8 } },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "update_own_assistant_style",
      style: { personality: { detail: 8 } },
    });
  });

  it("fails closed when newsletter opt-out has ambiguous current senders", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      emailDeliveryContexts: [
        buildEmailDeliveryContext({ senderHandle: "one@example.test" }),
        buildEmailDeliveryContext({ senderHandle: "two@example.test" }),
      ],
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await groupTool.request({ action: "revoke_own_email_share" });
    expect(request).toHaveBeenLastCalledWith({ action: "revoke_own_email_share" });
  });
});
