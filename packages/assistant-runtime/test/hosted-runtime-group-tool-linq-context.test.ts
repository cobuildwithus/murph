import { describe, expect, it, vi } from "vitest";

import {
  createHostedGroupToolWithLinqThreadContext,
  createHostedNewsletterToolWithEmailSend,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import type {
  HostedRuntimeNewsletterToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";
import type { HostedAssistantEmailDeliveryContext } from "../src/hosted-runtime/email-delivery-context.ts";

const ROUTE_AUTHORITY = {
  accountLookupKey: "hplk_current_line",
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

    await groupTool.request({ action: "read_chat_participants" });
    expect(request).toHaveBeenLastCalledWith({
      action: "read_chat_participants",
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
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "update_display_name",
      updateDisplayName: { displayName: "Weekly Health Crew" },
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

describe("createHostedNewsletterToolWithEmailSend", () => {
  const readStatsResponse = {
    action: "read_stats" as const,
    result: {
      groupId: "group_123",
      missingEmailParticipants: [],
      participants: [
        { displayName: "One", hasEmail: true, memberId: "member_one" },
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
          request.action === "read_stats"
            ? readStatsResponse
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

  it("allows send when the runtime injected scheduled newsletter automation authority", async () => {
    const sendEmail = vi.fn(async () => ({ target: "thread_123" }));
    const request = vi.fn(async (toolRequest) =>
      toolRequest.action === "read_stats"
        ? readStatsResponse
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
          request.action === "read_stats"
            ? readStatsResponse
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
          request.action === "read_stats"
            ? {
                action: "read_stats" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { displayName: "One", hasEmail: true, memberId: "member_one" },
                    { displayName: "Two", hasEmail: true, memberId: "member_two" },
                    { displayName: "Three", hasEmail: true, memberId: "member_three" },
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
          request.action === "read_stats"
            ? {
                action: "read_stats" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { displayName: "One", hasEmail: false, memberId: "member_one" },
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
          request.action === "read_stats"
            ? {
                action: "read_stats" as const,
                result: {
                  groupId: "group_123",
                  missingEmailParticipants: [],
                  participants: [
                    { displayName: "One", hasEmail: true, memberId: "member_one" },
                    { displayName: "Two", hasEmail: true, memberId: "member_two" },
                    { displayName: "Three", hasEmail: true, memberId: "member_three" },
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
