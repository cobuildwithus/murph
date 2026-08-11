import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getPrisma: vi.fn(),
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery: vi.fn(),
  materializeHostedSignupWelcomeHomeRouteTx: vi.fn(),
  recordHostedLinqRuntimeDeliveryOutcomeTx: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE:
    "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
  recordHostedLinqRuntimeDeliveryOutcomeTx: mocks.recordHostedLinqRuntimeDeliveryOutcomeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-home-routing", () => ({
  materializeHostedSignupWelcomeHomeRouteTx:
    mocks.materializeHostedSignupWelcomeHomeRouteTx,
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery:
    mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-runtime/linq-egress/delivery/route"
);

let route: RouteModule;
let prisma: {
  $transaction: ReturnType<typeof vi.fn>;
  hostedMemberRouting: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe("hosted runtime Linq delivery route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/linq-egress/delivery/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      $transaction: vi.fn(async (operation) => operation(prisma)),
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery.mockResolvedValue({
      matchedCount: 2,
      recorded: true,
    });
    mocks.recordHostedLinqRuntimeDeliveryOutcomeTx.mockResolvedValue({
      deliveryId: "hld_123",
      recorded: true,
    });
    mocks.materializeHostedSignupWelcomeHomeRouteTx.mockResolvedValue({
      kind: "materialized",
    });
  });

  it("atomically materializes an accepted canonical participant welcome before recording it", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123",
      intentId: "intent_signup_welcome",
      lineLookupKey: "hbidx:phone:v1:untrusted-echo",
      providerMessageId: "linq_message_welcome",
      providerThreadId: "linq_chat_welcome",
      targetKind: "participant",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.materializeHostedSignupWelcomeHomeRouteTx).toHaveBeenCalledWith({
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123",
      linqChatId: "linq_chat_welcome",
      memberId: "member_123",
      prisma,
    });
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: new Date("2026-04-26T00:00:04.000Z"),
        idempotencyKey: "signup-welcome:member_123",
        linqChatId: "linq_chat_welcome",
        messageId: "linq_message_welcome",
        phoneNumber: "+15550100099",
        phoneNumberLookupKey: null,
        prisma,
        targetKind: "participant",
        threadIsDirect: true,
        userId: "member_123",
      }),
    );
    expect(
      mocks.materializeHostedSignupWelcomeHomeRouteTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.recordHostedLinqRuntimeDeliveryOutcomeTx.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["missing original participant", { directRecipientPhoneNumber: null }],
    ["missing provider chat", { providerThreadId: null }],
    ["missing provider message", { providerMessageId: null }],
    ["non-direct provider chat", { threadIsDirect: false }],
  ])("rejects a canonical welcome with %s evidence", async (_label, override) => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123",
      providerMessageId: "linq_message_welcome",
      providerThreadId: "linq_chat_welcome",
      targetKind: "participant",
      threadIsDirect: true,
      ...override,
    }));

    expect(response.status).toBe(403);
    expect(mocks.materializeHostedSignupWelcomeHomeRouteTx).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("records an accepted canonical welcome sent to an existing thread without rematerializing it", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123",
      providerMessageId: "linq_message_welcome",
      providerThreadId: "linq_chat_existing",
      targetKind: "thread",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.materializeHostedSignupWelcomeHomeRouteTx).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: new Date("2026-04-26T00:00:04.000Z"),
        idempotencyKey: "signup-welcome:member_123",
        linqChatId: "linq_chat_existing",
        messageId: "linq_message_welcome",
        prisma,
        targetKind: "thread",
        threadIsDirect: true,
        userId: "member_123",
      }),
    );
  });

  it("rejects a canonical welcome claimed for another authenticated member", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_other",
      providerMessageId: "linq_message_welcome",
      providerThreadId: "linq_chat_welcome",
      targetKind: "participant",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("rejects malformed participant keys inside the signup-welcome namespace", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123:retry",
      providerMessageId: "linq_message_welcome",
      providerThreadId: "linq_chat_welcome",
      targetKind: "participant",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("records an accepted runtime delivery outcome without raw recipient fallback for participant sends", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: [
        "mailbox_item_accepted_1",
        "mailbox_item_accepted_1",
        " mailbox_item_accepted_2 ",
      ],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_link_message",
      providerMessageIds: [
        "linq_text_message",
        "linq_link_message",
      ],
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 8 * 1024 },
    );
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: new Date("2026-04-26T00:00:04.000Z"),
        answeredMailboxItemIds: [
          "mailbox_item_accepted_1",
          "mailbox_item_accepted_2",
        ],
        attemptedAt: new Date("2026-04-26T00:00:03.000Z"),
        failedAt: null,
        idempotencyKey: "assistant-outbox:intent_123",
        linqChatId: "linq_chat_123",
        messageId: "linq_link_message",
        messageIds: ["linq_text_message", "linq_link_message"],
        phoneNumber: "+15550100099",
        phoneNumberLookupKey: null,
        sourceRef: "intent_123",
        targetKind: "participant",
        threadIsDirect: true,
        userId: "member_123",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recorded: true,
    });
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    await runScheduledAfterTask();

    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).toHaveBeenCalledWith({
      answeredMailboxItemIds: [
        "mailbox_item_accepted_1",
        "mailbox_item_accepted_2",
      ],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_123",
      prisma,
      replyRuntimeAttemptId: "runtime_attempt_123",
    });
  });

  it("keeps old-runner delivery callbacks working without latency-link headers", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: ["mailbox_item_accepted_1"],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }, null));

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
  });

  it("does not schedule a delivery link when no accepted delivery was recorded", async () => {
    mocks.recordHostedLinqRuntimeDeliveryOutcomeTx.mockResolvedValueOnce({
      deliveryId: null,
      recorded: false,
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: ["mailbox_item_accepted_1"],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recorded: false,
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
  });

  it("contains best-effort delivery-link failures outside the response path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery.mockRejectedValueOnce(
      new Error("Synthetic link failure."),
    );

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: ["mailbox_item_private_1"],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_private",
      providerMessageId: "linq_message_private",
      providerThreadId: "linq_chat_private",
      target: "linq_chat_private",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
    await runScheduledAfterTask();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("mailbox_item_private_1");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("runtime_attempt_123");

    consoleError.mockRestore();
  });

  it("drops latency linking when post-response scheduling is unavailable", async () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error("Synthetic scheduler failure.");
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: ["mailbox_item_accepted_1"],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.linkHostedIngressLatencyTracesToAcceptedLinqDelivery).not.toHaveBeenCalled();
  });

  it("rejects malformed thread directness flags", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: "false",
    }));

    expect(response.status).toBe(400);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("derives the active member Linq line from durable home routing for chat sends without route authority", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("linq_chat_123");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    prisma.hostedMemberRouting.findUnique.mockResolvedValueOnce({
      linqChatLookupKey: chatLookupKey,
      linqRecipientPhoneLookupKey: "hbidx:phone:v1:home-line",
      pendingLinqChatLookupKey: null,
      pendingLinqRecipientPhoneLookupKey: null,
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "explicit",
    }));

    expect(response.status).toBe(200);
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      select: {
        linqChatLookupKey: true,
        linqRecipientPhoneLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqRecipientPhoneLookupKey: true,
      },
    });
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        linqChatId: "linq_chat_123",
        phoneNumber: null,
        phoneNumberLookupKey: "hbidx:phone:v1:home-line",
      }),
    );
  });

  it("uses the optional post-send line lookup key only for outcome attribution", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_group",
      lineLookupKey: "hbidx:phone:v1:account",
      providerMessageId: "linq_message_group",
      providerThreadId: "linq_chat_group",
      target: "linq_chat_group",
      targetKind: "thread",
      threadIsDirect: false,
    }));

    expect(response.status).toBe(200);
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        linqChatId: "linq_chat_group",
        phoneNumber: null,
        phoneNumberLookupKey: "hbidx:phone:v1:account",
        threadIsDirect: false,
      }),
    );
  });

  it("prefers the canonical sender number over a stale post-send line lookup key", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent_current_line",
      lineLookupKey: "hbidx:phone:v1:stale-line",
      providerMessageId: "linq_message_current_line",
      providerThreadId: "linq_chat_current_line",
      target: "linq_chat_current_line",
      targetKind: "thread",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        linqChatId: "linq_chat_current_line",
        phoneNumber: "+15550100099",
        phoneNumberLookupKey: null,
        threadIsDirect: true,
      }),
    );
  });

  it("records outcomes even when an old runner sends stale route authority", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: false,
    }));

    expect(response.status).toBe(200);
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: null,
        phoneNumberLookupKey: null,
        threadIsDirect: false,
      }),
    );

    const mismatch = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      routeAuthority: {
        ...routeAuthority,
        containerMemberId: "member_other",
      },
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(mismatch.status).toBe(200);

    const targetMismatch = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_456",
      providerThreadId: "linq_chat_other",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(targetMismatch.status).toBe(200);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledTimes(3);
  });

  it("keeps old delivery payloads with route authority compatible", async () => {
    const routeAuthority = {
      channel: "linq",
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalled();
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: null,
        phoneNumberLookupKey: null,
      }),
    );
  });

  it("rejects accepted delivery outcomes with too many answered mailbox item ids", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: Array.from(
        { length: 101 },
        (_, index) => `mailbox_item_${index}`,
      ),
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
    }));

    expect(response.status).toBe(400);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("accepts grouped delivery outcomes with more than forty answered mailbox item ids", async () => {
    const answeredMailboxItemIds = Array.from(
      { length: 45 },
      (_, index) => `mailbox_item_grouped_${index}`,
    );

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds,
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds,
      }),
    );
  });

  it("does not carry answered mailbox item ids for failed delivery outcomes", async () => {
    const response = await route.POST(buildDeliveryRequest({
      answeredMailboxItemIds: ["mailbox_item_should_not_consume"],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      failedAt: "2026-04-26T00:00:05.000Z",
      failureCode: "synthetic_failure",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_text_accepted",
      providerMessageIds: ["linq_text_accepted"],
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: null,
        answeredMailboxItemIds: [],
        failedAt: new Date("2026-04-26T00:00:05.000Z"),
        failureCode: "synthetic_failure",
        messageId: "linq_text_accepted",
        messageIds: ["linq_text_accepted"],
        userId: "member_123",
      }),
    );
  });

  it("does not carry answered mailbox item ids for a recoverable rich-link partial delivery", async () => {
    const answeredMailboxItemIds = ["mailbox_item_primary_answered"];
    const response = await route.POST(buildDeliveryRequest({
      answeredMailboxItemIds,
      attemptedAt: "2026-04-26T00:00:03.000Z",
      failedAt: "2026-04-26T00:00:05.000Z",
      failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      idempotencyKey: "assistant-outbox:intent_partial",
      providerMessageId: "linq_text_accepted",
      providerMessageIds: ["linq_text_accepted"],
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: null,
        answeredMailboxItemIds: [],
        failedAt: new Date("2026-04-26T00:00:05.000Z"),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        messageIds: ["linq_text_accepted"],
        userId: "member_123",
      }),
    );
  });
});

function buildDeliveryRequest(
  body: unknown,
  runtimeAttemptId: string | null = "runtime_attempt_123",
): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/linq-egress/delivery",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(runtimeAttemptId
          ? { "x-hosted-runtime-attempt-id": runtimeAttemptId }
          : {}),
      },
      method: "POST",
    },
  );
}

async function runScheduledAfterTask(index = 0): Promise<void> {
  const task = mocks.after.mock.calls[index]?.[0];
  if (typeof task !== "function") {
    throw new Error("Expected a scheduled after() task.");
  }
  await task();
}
