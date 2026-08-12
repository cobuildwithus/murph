import { describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedGroupToolWithCurrentTurnContext,
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
const EXACT_GROUP_PARTICIPANT = {
  assistantInputId: `ain_${"4".repeat(32)}`,
  senderHandle: "+15550000002",
  source: "linq" as const,
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

function buildEmailDeliveryContext(
  overrides: Partial<HostedAssistantEmailDeliveryContext>,
): HostedAssistantEmailDeliveryContext {
  return {
    senderHandle: "person@example.test",
    ...overrides,
  };
}

describe("createHostedGroupToolWithCurrentTurnContext", () => {
  it("forwards current-turn cancellation through the neutral current-sender request", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "ask_current_sender",
      result: { status: "accepted" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });
    const signal = new AbortController().signal;
    const currentSenderRequest = {
      action: "ask_current_sender" as const,
      origin: {
        assistantInputId: `ain_${"a".repeat(32)}`,
        kind: "accepted_input" as const,
        sessionId: "session_group",
      },
    };

    await expect(
      groupTool.request(currentSenderRequest, { signal }),
    ).resolves.toEqual({
      action: "ask_current_sender",
      result: { status: "accepted" },
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      currentSenderRequest,
      { signal },
    );
  });

  it("injects the exact current sender into referral actions", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "arm_usage_referral",
      result: { outcome: "armed", referral: null, status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      currentDeliveryRoute: {
        channel: "linq",
        deliveryTarget: "raw-group-thread",
        identityId: `hid_${"1".repeat(32)}`,
        participantId: `hid_${"2".repeat(32)}`,
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: false,
      },
      groupToolPort: { request },
      linqService: "imessage",
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: EXACT_GROUP_PARTICIPANT.senderHandle,
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request({
      action: "arm_usage_referral",
      linqSenderHandles: ["forged"],
      policyCodes: ["active_group_v1"],
      sourceConversation: {
        channel: "telegram",
        threadId: `hid_${"f".repeat(32)}`,
        threadIsDirect: true,
      },
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "arm_usage_referral",
      linqSenderHandles: [
        "+15550000001",
        EXACT_GROUP_PARTICIPANT.senderHandle,
      ],
      policyCodes: ["active_group_v1"],
      sourceConversation: {
        channel: "linq",
        linqService: "imessage",
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: false,
      },
    });

    await groupTool.request({
      action: "read_usage_referral",
      participant: EXACT_GROUP_PARTICIPANT,
      sourceConversation: {
        channel: "telegram",
        threadId: `hid_${"e".repeat(32)}`,
        threadIsDirect: true,
      },
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_usage_referral",
      linqSenderHandles: [EXACT_GROUP_PARTICIPANT.senderHandle],
      sourceConversation: {
        channel: "linq",
        linqService: "imessage",
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: false,
      },
    });

    await groupTool.request({
      action: "cancel_usage_referral",
      linqSenderHandles: ["forged"],
      policyCode: "new_person_activation_v1",
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "cancel_usage_referral",
      linqSenderHandles: [
        "+15550000001",
        EXACT_GROUP_PARTICIPANT.senderHandle,
      ],
      policyCode: "new_person_activation_v1",
    });
  });

  it("injects the observed non-iMessage Linq service for fail-closed policy gating", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_usage_referral",
      result: { outcome: "read", referral: null, status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      currentDeliveryRoute: {
        channel: "linq",
        deliveryTarget: "raw-direct-thread",
        identityId: `hid_${"1".repeat(32)}`,
        participantId: `hid_${"2".repeat(32)}`,
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: true,
      },
      groupToolPort: { request },
      linqDeliveryContexts: [],
      linqService: "sms",
    });

    await groupTool.request({ action: "read_usage_referral" });

    expect(request).toHaveBeenCalledWith({
      action: "read_usage_referral",
      sourceConversation: {
        channel: "linq",
        linqService: "sms",
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: true,
      },
    });
  });

  it("denies referral and signup-link actions on group email without an authoritative sender", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      emailDeliveryContexts: [
        buildEmailDeliveryContext({ senderHandle: "person@example.test" }),
      ],
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await expect(groupTool.request({
      action: "read_usage_referral",
    })).resolves.toEqual({
      action: "read_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    await expect(groupTool.request({
      action: "create_signup_referral_link",
    })).resolves.toEqual({
      action: "create_signup_referral_link",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    await expect(groupTool.request({
      action: "ask_current_sender",
      origin: {
        assistantInputId: `ain_${"a".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toEqual({
      action: "ask_current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("forwards telegram current-turn sender evidence channel-qualified", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_shared",
      result: { status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [],
      telegramSenderHandles: ["1234567890", "1234567890", "9876543210"],
    });

    await groupTool.request({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      telegramSenderHandles: ["1234567890", "9876543210"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("injects the Telegram source conversation into referral reads", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_usage_referral",
      result: { outcome: "read", referral: null, status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      currentDeliveryRoute: {
        channel: "telegram",
        deliveryTarget: "raw-direct-thread",
        identityId: `hid_${"4".repeat(32)}`,
        participantId: `hid_${"5".repeat(32)}`,
        threadId: `hid_${"6".repeat(32)}`,
        threadIsDirect: true,
      },
      groupToolPort: { request },
      linqDeliveryContexts: [],
      telegramSenderHandles: ["1234567890"],
    });

    await groupTool.request({
      action: "read_usage_referral",
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_usage_referral",
      sourceConversation: {
        channel: "telegram",
        threadId: `hid_${"6".repeat(32)}`,
        threadIsDirect: true,
      },
      telegramSenderHandles: ["1234567890"],
    });
  });

  it("overwrites model-supplied telegram sender evidence", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_shared",
      result: { status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [],
      telegramSenderHandles: ["1234567890"],
    });

    await groupTool.request({
      action: "read_shared",
      telegramSenderHandles: ["999999999"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      telegramSenderHandles: ["1234567890"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("fails closed when both linq and telegram sender evidence are present", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_shared",
      result: { status: "ok" },
    });
    // One group runtime is bound to a single provider thread, so evidence from
    // two namespaces is a contradiction Web must never be asked to resolve.
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
      telegramSenderHandles: ["1234567890"],
    });

    await groupTool.request({
      action: "read_shared",
      telegramSenderHandles: ["forged"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("drops overlong telegram sender handles before transport", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_shared",
      result: { status: "ok" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [],
      telegramSenderHandles: ["x".repeat(513)],
    });

    await groupTool.request({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("injects the wake-derived linq thread into chat-scoped actions only", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: { status: "sent" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: null }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
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
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "set_chat_avatar",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
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

    await groupTool.request({
      action: "post_disclosure_request",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      permissionText: "Share my calendar availability only to coordinate group calls.",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_disclosure_request",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      permissionText: "Share my calendar availability only to coordinate group calls.",
      linqThread: {
        authority: ROUTE_AUTHORITY,
        chatId: "chat_group_1",
      },
    });

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });

    await groupTool.request({ action: "read_chat_name" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_name" });

    await groupTool.request({ action: "read_usage" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_usage" });

    await groupTool.request({
      action: "read_shared",
      linqSenderHandles: ["forged@example.test"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      linqSenderHandles: ["+15550000001"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

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
      action: "ask_member",
      grantId: "hdg_calendar",
      origin: {
        assistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "Are you available Tuesday afternoon?",
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "ask_member",
      grantId: "hdg_calendar",
      origin: {
        assistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "Are you available Tuesday afternoon?",
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

  it("binds personalized contact cards to the exact direct iMessage chat", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: { status: "sent" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
        // A direct home conversation carries no thread-route authority.
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: null,
          target: "chat_direct_1",
          threadIsDirect: true,
        }),
      ],
    });

    await groupTool.request({
      action: "share_contact_card",
      contactCardImageUrl,
      contactCardShareKey: "input_direct_1",
    });

    // The chat id, never a fabricated group thread authority.
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "share_contact_card",
      contactCardImageUrl,
      contactCardShareKey: "input_direct_1",
      directLinqChatId: "chat_direct_1",
    });
  });

  it("rejects personalized contact cards on direct SMS before Web delivery", async () => {
    const directAuthority = {
      ...ROUTE_AUTHORITY,
      threadId: "chat_direct_sms",
    };
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: directAuthority,
          service: "sms",
          target: "chat_direct_sms",
          threadIsDirect: true,
        }),
      ],
    });

    await expect(groupTool.request({
      action: "share_contact_card",
      contactCardImageUrl,
      contactCardShareKey: "input_direct_sms",
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "sms_attachments_unsupported",
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not choose between two direct iMessage routes for a personalized card", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            threadId: "chat_direct_1",
          },
          target: "chat_direct_1",
          threadIsDirect: true,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000002",
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            threadId: "chat_direct_2",
          },
          target: "chat_direct_2",
          threadIsDirect: true,
        }),
      ],
    });

    await expect(groupTool.request({
      action: "share_contact_card",
      contactCardImageUrl,
      contactCardShareKey: "input_direct_ambiguous",
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
    });

    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when the turn carries two distinct route-authorized threads", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "member@example.test",
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

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });

    await groupTool.request({
      action: "read_shared",
      linqSenderHandles: ["forged@example.test"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("dedupes repeated route-authorized iMessage contexts", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "share_contact_card",
      result: { status: "sent" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
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
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_direct" },
          threadIsDirect: true,
        }),
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
  });

  it("gives SMS the shared group workflow and reports only real provider gaps", async () => {
    const request = vi.fn(async (
      groupRequest: HostedRuntimeGroupToolRequest,
    ): Promise<HostedRuntimeGroupToolResponse> => {
      if (groupRequest.action === "read_chat_participants") {
        return {
          action: groupRequest.action,
          result: { participants: [], status: "ok" },
        };
      }
      if (groupRequest.action === "read_shared") {
        return {
          action: groupRequest.action,
          result: {
            members: [],
            requestedProjectionScopeKeys: ["steps-days.v0"],
            status: "ok",
          },
        };
      }
      if (groupRequest.action === "create_join_link") {
        return {
          action: groupRequest.action,
          result: {
            group: null,
            status: "unavailable",
            unavailableReason: "synthetic_link_unavailable",
          },
        };
      }
      throw new Error(`Unexpected group action: ${groupRequest.action}`);
    });
    const smsRouteAuthority = {
      ...ROUTE_AUTHORITY,
      threadId: "chat_sms_group",
    };
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000003",
          routeAuthority: smsRouteAuthority,
          service: "SMS",
          target: "chat_sms_group",
        }),
      ],
    });

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_chat_participants",
      linqThread: {
        authority: smsRouteAuthority,
        chatId: "chat_sms_group",
      },
    });

    await groupTool.request({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      linqSenderHandles: ["+15550000003"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: {
        displayName: "Weekly Health Crew",
        messageTemplate:
          "React here to join. This shares {{share_scope}} with the group. Details: {{join_url}}.",
        projectionScopes: [{ projectionKind: "sleep-times.v0" }],
      },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "create_join_link",
      joinLink: {
        displayName: "Weekly Health Crew",
        requestedVaultShareProjectionScopes: [
          { projectionKind: "sleep-times.v0" },
        ],
      },
    });

    await expect(groupTool.request({ action: "share_contact_card" }))
      .resolves.toEqual({
        action: "share_contact_card",
        result: {
          status: "unavailable",
          unavailableReason: "sms_attachments_unsupported",
        },
      });
    await expect(groupTool.request({
      action: "post_disclosure_request",
      originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
      permissionText: "Share calendar availability only.",
    })).resolves.toEqual({
      action: "post_disclosure_request",
      result: {
        status: "unavailable",
        unavailableReason: "sms_reactions_unsupported",
      },
    });
    await expect(groupTool.request({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "sms_chat_customization_unsupported",
      },
    });
    await expect(groupTool.request({ action: "preflight_set_chat_avatar" }))
      .resolves.toMatchObject({
        result: { unavailableReason: "sms_chat_customization_unsupported" },
      });
    await expect(groupTool.request({
      action: "set_chat_avatar",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
    })).resolves.toMatchObject({
      result: { unavailableReason: "sms_chat_customization_unsupported" },
    });

    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "iMessage and SMS",
      second: { service: "sms" },
      service: "imessage",
    },
    {
      label: "iMessage and RCS",
      second: { service: "RCS" },
      service: "imessage",
    },
    {
      label: "SMS and RCS",
      second: { service: "RCS" },
      service: "sms",
    },
    {
      label: "SMS and a missing service",
      second: { service: null },
      service: "sms",
    },
    {
      label: "SMS and unknown thread direction",
      second: { service: "sms", threadIsDirect: null },
      service: "sms",
    },
  ] satisfies readonly {
    label: string;
    second: Partial<HostedAssistantLinqDeliveryContext>;
    service: string;
  }[])("fails closed for authoritative $label contexts", async ({
    second,
    service,
  }) => {
    const request = vi.fn().mockResolvedValue({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
          service,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000002",
          routeAuthority: ROUTE_AUTHORITY,
          ...second,
        }),
      ],
    });

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: { projectionKinds: ["steps-days.v0"] },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "post_join_offer",
      joinOffer: { projectionKinds: ["steps-days.v0"] },
    });

    await groupTool.request({ action: "share_contact_card" });
    expect(request).toHaveBeenLastCalledWith({ action: "share_contact_card" });

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_participants" });

    await groupTool.request({
      action: "read_shared",
      linqSenderHandles: ["forged"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("uses the same first-party access link fallback in Telegram groups", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "synthetic_link_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      currentDeliveryRoute: {
        channel: "telegram",
        deliveryTarget: "raw-group-thread",
        identityId: `hid_${"4".repeat(32)}`,
        participantId: `hid_${"5".repeat(32)}`,
        threadId: `hid_${"6".repeat(32)}`,
        threadIsDirect: false,
      },
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await groupTool.request({
      action: "post_join_offer",
      joinOffer: {
        displayName: "Weekly Health Crew",
        projectionKinds: ["steps-days.v0"],
      },
    });
    expect(request).toHaveBeenCalledWith({
      action: "create_join_link",
      joinLink: {
        displayName: "Weekly Health Crew",
        requestedVaultShareProjectionKinds: ["steps-days.v0"],
      },
    });
  });

  it("fails participant reads closed for ambiguous, direct, or unsupported-service contexts", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
    const ambiguousGroupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({ routeAuthority: ROUTE_AUTHORITY }),
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_sms_group" },
          service: "sms",
          target: "chat_sms_group",
        }),
      ],
    });

    await ambiguousGroupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_participants" });

    const directGroupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_sms_direct" },
          service: "sms",
          target: "chat_sms_direct",
          threadIsDirect: true,
        }),
      ],
    });

    await directGroupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_participants" });

    const unsupportedServiceGroupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          routeAuthority: { ...ROUTE_AUTHORITY, threadId: "chat_rcs_group" },
          service: "RCS",
          target: "chat_rcs_group",
        }),
      ],
    });

    await unsupportedServiceGroupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_chat_participants" });
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
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
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
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "set_chat_avatar",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
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

  it("does not let unauthenticated email ingress carry exact participant effects", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      emailDeliveryContexts: [buildEmailDeliveryContext({})],
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await expect(groupTool.request({
      action: "revoke_own_email_share",
      participant: EXACT_GROUP_PARTICIPANT,
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await groupTool.request({ action: "read_current" });
    expect(request).toHaveBeenLastCalledWith({ action: "read_current" });

    await groupTool.request({
      action: "read_shared",
      linqSenderHandles: ["forged@example.test"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("rejects personal membership reads and durable group mutations whenever email ingress is present", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
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

    for (const actionRequest of [
      {
        action: "ask_current_sender" as const,
        origin: {
          assistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
          kind: "accepted_input" as const,
          sessionId: "session_group",
        },
      },
      {
        action: "ask_member" as const,
        grantId: "hdg_calendar",
        origin: {
          assistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
          kind: "accepted_input" as const,
          sessionId: "session_group",
        },
        question: "Are you available Tuesday afternoon?",
      },
      {
        action: "post_disclosure_request" as const,
        originAssistantInputId: PRIVATE_ASSISTANT_INPUT_ID,
        permissionText: "Share calendar availability only.",
      },
      { action: "revoke_disclosure_grant" as const, grantId: "hdg_calendar" },
    ]) {
      const response = await groupTool.request(actionRequest);
      expect(response.result).toMatchObject({
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      });
    }
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({ action: "read_chat_name" })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: null,
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

    await expect(groupTool.request({
      action: "revoke_own_email_share",
      participant: EXACT_GROUP_PARTICIPANT,
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce({
      action: "read_shared",
      result: {
        members: [],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "none",
      },
    });
    await groupTool.request({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it("retains group-email mutation denial across a no-context continuation", async () => {
    const request = vi.fn();
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
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

  it("passes exact accepted-message participant evidence through without whole-turn inference", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000003",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request({
      action: "revoke_own_email_share",
      participant: EXACT_GROUP_PARTICIPANT,
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "revoke_own_email_share",
      participant: EXACT_GROUP_PARTICIPANT,
    });
  });

  it("injects deduplicated current-turn Linq handles only on lazy shared reads", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "read_shared",
      result: {
        members: [],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "none",
      },
    });
    const groupTool = createHostedGroupToolWithCurrentTurnContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "member@example.test",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "direct@example.test",
          routeAuthority: ROUTE_AUTHORITY,
          threadIsDirect: true,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "unauthorized@example.test",
          routeAuthority: null,
        }),
        buildLinqDeliveryContext({
          directRecipientPhoneNumber: "x".repeat(513),
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    expect(request).not.toHaveBeenCalled();
    await groupTool.request({
      action: "read_shared",
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      linqSenderHandles: ["+15550000001", "member@example.test"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    });
  });

  it.each([
    {
      contexts: [
        buildLinqDeliveryContext({
          routeAuthority: ROUTE_AUTHORITY,
          service: "imessage",
          threadIsDirect: true,
        }),
      ],
      expected: { status: "ok" },
      label: "exactly one direct iMessage route",
    },
    {
      contexts: [
        buildLinqDeliveryContext({
          routeAuthority: ROUTE_AUTHORITY,
          service: "sms",
          threadIsDirect: true,
        }),
      ],
      expected: {
        status: "unavailable",
        unavailableReason: "sms_attachments_unsupported",
      },
      label: "a direct SMS route",
    },
    {
      contexts: [],
      expected: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
      label: "no direct route",
    },
    {
      contexts: [
        buildLinqDeliveryContext({
          routeAuthority: ROUTE_AUTHORITY,
          service: "imessage",
          target: "chat_direct_1",
          threadIsDirect: true,
        }),
        buildLinqDeliveryContext({
          routeAuthority: {
            ...ROUTE_AUTHORITY,
            threadId: "chat_direct_2",
          },
          service: "imessage",
          target: "chat_direct_2",
          threadIsDirect: true,
        }),
      ],
      expected: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
      label: "an ambiguous direct route",
    },
    {
      contexts: [
        buildLinqDeliveryContext({
          routeAuthority: ROUTE_AUTHORITY,
          service: "imessage",
          threadIsDirect: false,
        }),
      ],
      expected: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
      label: "only a group route",
    },
  ])(
    "reports direct-attachment eligibility for $label without a host round trip",
    ({ contexts, expected }) => {
      const request = vi.fn();
      const groupTool = createHostedGroupToolWithCurrentTurnContext({
        groupToolPort: { request },
        linqDeliveryContexts: contexts,
      });

      expect(groupTool.directAttachmentRouteStatus?.()).toEqual(expected);
      expect(request).not.toHaveBeenCalled();
    },
  );
});
