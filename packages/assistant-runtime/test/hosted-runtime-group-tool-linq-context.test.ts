import { describe, expect, it, vi } from "vitest";

import {
  createHostedGroupToolWithLinqThreadContext,
  createHostedNewsletterToolWithEmailSend,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import type {
  HostedRuntimeNewsletterToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import type { HostedAssistantEmailDeliveryContext } from "../src/hosted-runtime/email-delivery-context.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";

const ROUTE_AUTHORITY = {
  accountLookupKey: "hplk_current_line",
  channel: "linq" as const,
  containerMemberId: "member_container",
  threadId: "chat_group_1",
};

function buildCurrentInbound(mailboxItemId: string) {
  return {
    dedupeKey: `dedupe:${mailboxItemId}`,
    eventId: `event:${mailboxItemId}`,
    mailboxItemId,
    occurredAt: "2026-07-10T00:00:00.000Z",
    replyToMessageId: `message:${mailboxItemId}`,
    target: "chat_group_1",
  };
}

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

    await expect(groupTool.request({ action: "create_join_link" })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "authenticated_sender_required",
      },
    });
    expect(request).not.toHaveBeenCalled();

    await expect(groupTool.request({ action: "leave_current" })).resolves.toEqual({
      action: "leave_current",
      result: {
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

  it("injects only current mailbox ids into newsletter opt-out", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_group_1"),
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request(
      { action: "revoke_own_email_share" },
      { currentHostedMailboxItemIds: ["mailbox_group_1"] },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "revoke_own_email_share",
      inboundMailboxItemIds: ["mailbox_group_1"],
    });
  });

  it("forwards older pending and fresh input ids for canonical web verification", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "leave_current",
      result: { status: "left" },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_fresh"),
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request(
      { action: "leave_current" },
      {
        currentHostedMailboxItemIds: ["mailbox_pending", "mailbox_fresh"],
      },
    );

    expect(request).toHaveBeenLastCalledWith({
      action: "leave_current",
      inboundMailboxItemIds: ["mailbox_pending", "mailbox_fresh"],
    });
  });

  it("forwards all current ids so web can fail closed on mixed senders", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_group_1"),
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_group_2"),
          directRecipientPhoneNumber: "+15550000002",
          routeAuthority: ROUTE_AUTHORITY,
        }),
      ],
    });

    await groupTool.request(
      { action: "revoke_own_email_share" },
      {
        currentHostedMailboxItemIds: [
          "mailbox_group_1",
          "mailbox_group_2",
        ],
      },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "revoke_own_email_share",
      inboundMailboxItemIds: ["mailbox_group_1", "mailbox_group_2"],
    });
  });

  it("normalizes current mailbox ids without interpreting their contents", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_group_1"),
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
        }),
        buildLinqDeliveryContext({
          currentInbound: buildCurrentInbound("mailbox_direct"),
          directRecipientPhoneNumber: "+15550000001",
          routeAuthority: ROUTE_AUTHORITY,
          threadIsDirect: true,
        }),
      ],
    });

    for (const currentHostedMailboxItemIds of [[], [""], [" "]]) {
      await groupTool.request(
        { action: "revoke_own_email_share" },
        { currentHostedMailboxItemIds },
      );
      expect(request).toHaveBeenLastCalledWith({
        action: "revoke_own_email_share",
      });
    }
    await groupTool.request(
      { action: "revoke_own_email_share" },
      { currentHostedMailboxItemIds: [" mailbox_unknown ", "mailbox_unknown"] },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "revoke_own_email_share",
      inboundMailboxItemIds: ["mailbox_unknown"],
    });
  });

  it("forwards the selected mailbox id for a late steered input", async () => {
    const request = vi.fn().mockResolvedValue({
      action: "leave_current",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });
    const groupTool = createHostedGroupToolWithLinqThreadContext({
      groupToolPort: { request },
      linqDeliveryContexts: [],
    });

    await groupTool.request(
      { action: "leave_current" },
      { currentHostedMailboxItemIds: ["mailbox_bob"] },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "leave_current",
      inboundMailboxItemIds: ["mailbox_bob"],
    });

    await groupTool.request(
      { action: "leave_current" },
      { currentHostedMailboxItemIds: ["mailbox_alice"] },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "leave_current",
      inboundMailboxItemIds: ["mailbox_alice"],
    });

    await groupTool.request(
      { action: "leave_current" },
      { currentHostedMailboxItemIds: ["mailbox_unknown"] },
    );
    expect(request).toHaveBeenLastCalledWith({
      action: "leave_current",
      inboundMailboxItemIds: ["mailbox_unknown"],
    });
  });
});

describe("createHostedNewsletterToolWithEmailSend", () => {
  const preparationResponse = {
    action: "prepare" as const,
    result: {
      groupId: "group_123",
      missingEmailParticipants: [],
      participants: [
        { hasEmail: true, memberId: "member_one" },
      ],
      status: "ok" as const,
    },
  };

  it("rejects send on normal hosted turns without scheduled automation authority", async () => {
    const sendEmail = vi.fn(async () => ({ target: "thread_123" }));
    const newsletterTool = createHostedNewsletterToolWithEmailSend({
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (request) =>
          request.action === "prepare"
            ? preparationResponse
            : {
                action: "send" as const,
                result: {
                  participantCount: 1,
                  skippedNoEmailMemberIds: [],
                  status: "sent" as const,
                },
              }),
      },
    });

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "scheduled_automation_required",
      },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when newsletter preparation returns a mismatched action", async () => {
    const sendEmail = vi.fn(async () => ({ target: "thread_123" }));
    const newsletterTool = createHostedNewsletterToolWithEmailSend({
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (): Promise<HostedRuntimeNewsletterToolResponse> => ({
          action: "send",
          result: {
            participantCount: 1,
            skippedNoEmailMemberIds: [],
            status: "sent",
          },
        })),
      },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    });

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "newsletter_preparation_unavailable",
      },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows send when the runtime injected scheduled newsletter automation authority", async () => {
    const sendEmail = vi.fn(async () => ({ target: "thread_123" }));
    const request = vi.fn(async (toolRequest) =>
      toolRequest.action === "prepare"
        ? preparationResponse
        : {
            action: "send" as const,
            result: { participantCount: 1, skippedNoEmailMemberIds: [], status: "sent" as const },
          });
    const toolInput = {
      effectsPort: { sendEmail },
      newsletterToolPort: { request },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    };
    const newsletterTool = createHostedNewsletterToolWithEmailSend(toolInput);

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        participantCount: 1,
        skippedNoEmailMemberIds: [],
        status: "sent",
      },
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringContaining("automation_newsletter"),
      target: "group_123",
      targetKind: "group",
    }));
  });

  it("uses the same send identity for same-occurrence retries with different content", async () => {
    const sendEmail = vi.fn(async (_message: {
      idempotencyKey?: string | null;
    }) => ({ target: "thread_123" }));
    const newsletterTool = createHostedNewsletterToolWithEmailSend({
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (request) =>
          request.action === "prepare"
            ? preparationResponse
            : {
                action: "send" as const,
                result: {
                  participantCount: 1,
                  skippedNoEmailMemberIds: [],
                  status: "sent" as const,
                },
              }),
      },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    });

    await newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    });
    await newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly, recomposed</p>",
      subject: "Weekly health note, recomposed",
      text: "Weekly, recomposed",
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const firstKey = sendEmail.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = sendEmail.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBe(
      "group-newsletter:automation_newsletter:2026-07-12T13:00:00.000Z:group_123",
    );
    expect(secondKey).toBe(firstKey);
  });

  it("reports count-only partial delivery status from the hosted email send", async () => {
    const sendEmail = vi.fn(async () => ({
      delivery: {
        failedCount: 1,
        sentCount: 2,
        skippedCount: 0,
        status: "partial_failure" as const,
      },
      target: "thread_123",
    }));
    const toolInput = {
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (request): Promise<HostedRuntimeNewsletterToolResponse> =>
          request.action === "prepare"
            ? {
                action: "prepare" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { hasEmail: true, memberId: "member_one" },
                    { hasEmail: true, memberId: "member_two" },
                    { hasEmail: true, memberId: "member_three" },
                  ],
                  status: "ok" as const,
                },
              }
            : {
                action: "send" as const,
                result: { participantCount: 3, skippedNoEmailMemberIds: [], status: "sent" as const },
              }),
      },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    };
    const newsletterTool = createHostedNewsletterToolWithEmailSend(toolInput);

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        failedRecipientCount: 1,
        participantCount: 3,
        sentRecipientCount: 2,
        skippedNoEmailMemberIds: [],
        status: "partial_failure",
      },
    });
  });

  it("treats zero email participants as no_recipients without calling hosted email", async () => {
    const sendEmail = vi.fn(async () => ({ target: "thread_123" }));
    const newsletterTool = createHostedNewsletterToolWithEmailSend({
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (request): Promise<HostedRuntimeNewsletterToolResponse> =>
          request.action === "prepare"
            ? {
                action: "prepare" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { hasEmail: false, memberId: "member_one" },
                  ],
                  status: "ok" as const,
                },
              }
            : {
                action: "send" as const,
                result: {
                  participantCount: 0,
                  skippedNoEmailMemberIds: ["member_one"],
                  status: "no_recipients" as const,
                },
              }),
      },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    });

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        participantCount: 0,
        skippedNoEmailMemberIds: ["member_one"],
        status: "no_recipients",
      },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports send_failed when every hosted email recipient fails", async () => {
    const sendEmail = vi.fn(async () => ({
      delivery: {
        failedCount: 3,
        sentCount: 0,
        skippedCount: 0,
        status: "failed" as const,
      },
      target: "thread_123",
    }));
    const newsletterTool = createHostedNewsletterToolWithEmailSend({
      effectsPort: { sendEmail },
      newsletterToolPort: {
        request: vi.fn(async (request) =>
          request.action === "prepare"
            ? {
                action: "prepare" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { hasEmail: true, memberId: "member_one" },
                    { hasEmail: true, memberId: "member_two" },
                    { hasEmail: true, memberId: "member_three" },
                  ],
                  status: "ok" as const,
                },
              }
            : {
                action: "send" as const,
                result: { participantCount: 3, skippedNoEmailMemberIds: [], status: "sent" as const },
              }),
      },
      scheduledAutomationAuthority: {
        automationId: "automation_newsletter",
        occurrenceAt: "2026-07-12T13:00:00.000Z",
      },
    });

    await expect(newsletterTool.request({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly</p>",
      subject: "Weekly health note",
      text: "Weekly",
    })).resolves.toEqual({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });
  });
});
