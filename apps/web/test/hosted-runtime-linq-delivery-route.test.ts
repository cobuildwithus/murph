import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  recordHostedLinqRuntimeDeliveryOutcomeTx: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedLinqAnsweredMailboxItemIdsForRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  recordHostedLinqRuntimeDeliveryOutcomeTx: mocks.recordHostedLinqRuntimeDeliveryOutcomeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-egress-engagement", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-egress-engagement")
  >();
  return {
    ...actual,
    resolveHostedLinqAnsweredMailboxItemIdsForRuntime:
      mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime,
  };
});

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority: mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-runtime/linq-egress/delivery/route"
);

let route: RouteModule;
let prisma: {
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
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.recordHostedLinqRuntimeDeliveryOutcomeTx.mockResolvedValue({
      deliveryId: "hld_123",
      recorded: true,
    });
    mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime
      .mockResolvedValue(["mailbox_item_answered_42"]);
  });

  it("records an accepted runtime delivery outcome without raw recipient fallback for participant sends", async () => {
    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_answered_42",
        occurredAt: "2026-04-26T00:00:02.000Z",
        replyToMessageId: "linq_message_inbound",
        target: "linq_chat_123",
      },
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerTarget: "+15550100001",
      providerThreadId: "linq_chat_123",
      target: "+15550100001",
      targetKind: "participant",
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 8 * 1024 },
    );
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: new Date("2026-04-26T00:00:04.000Z"),
        answeredMailboxItemIds: ["mailbox_item_answered_42"],
        attemptedAt: new Date("2026-04-26T00:00:03.000Z"),
        failedAt: null,
        idempotencyKey: "assistant-outbox:intent_123",
        linqChatId: "linq_chat_123",
        messageId: "linq_message_sent",
        phoneNumber: "+15550100099",
        phoneNumberLookupKey: null,
        sourceRef: "intent_123",
        targetKind: "participant",
        userId: "member_123",
      }),
    );
    expect(mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime)
      .toHaveBeenCalledWith({
        currentInbound: {
          dedupeKey: "evt_linq_current",
          eventId: "evt_linq_current",
          mailboxItemId: "mailbox_item_answered_42",
          occurredAt: "2026-04-26T00:00:02.000Z",
          replyToMessageId: "linq_message_inbound",
          target: "linq_chat_123",
        },
        mailboxItemIds: [],
        memberId: "member_123",
        now: new Date("2026-04-26T00:00:04.000Z"),
        prisma,
        routeAuthority: null,
        target: "linq_chat_123",
        targetKind: "participant",
      });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recorded: true,
    });
  });

  it("fails closed when an accepted delivery current inbound proof does not validate", async () => {
    mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime.mockResolvedValueOnce(null);

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_wrong_chat",
        occurredAt: "2026-04-26T00:00:02.000Z",
        replyToMessageId: "linq_message_inbound",
        target: "linq_chat_other",
      },
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(403);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("validates answered current inbound against the original target after recovered delivery changes provider thread", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_123",
      threadId: "linq_chat_old",
    };
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValueOnce({
      accountLookupKey: "hbidx:phone:v1:account",
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_answered_42",
        occurredAt: "2026-04-26T00:00:02.000Z",
        replyToMessageId: "linq_message_inbound",
        target: "linq_chat_old",
      },
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerTarget: "linq_chat_old",
      providerThreadId: "linq_chat_recovered",
      routeAuthority,
      target: "linq_chat_old",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority: routeAuthority,
      prisma,
    });
    expect(mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime)
      .toHaveBeenCalledWith(expect.objectContaining({
        routeAuthority,
        target: "linq_chat_old",
      }));
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        answeredMailboxItemIds: ["mailbox_item_answered_42"],
        linqChatId: "linq_chat_recovered",
        messageId: "linq_message_sent",
        phoneNumberLookupKey: "hbidx:phone:v1:account",
      }));
  });

  it("records every validated mailbox item answered by the accepted delivery", async () => {
    mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime.mockResolvedValueOnce([
      "mailbox_item_answered_42",
      "mailbox_item_answered_43",
    ]);

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredMailboxItemIds: [
        "mailbox_item_answered_42",
        "mailbox_item_answered_43",
      ],
      attemptedAt: "2026-04-26T00:00:03.000Z",
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_answered_42",
        occurredAt: "2026-04-26T00:00:02.000Z",
        replyToMessageId: "linq_message_inbound",
        target: "linq_chat_123",
      },
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime)
      .toHaveBeenCalledWith(expect.objectContaining({
        mailboxItemIds: [
          "mailbox_item_answered_42",
          "mailbox_item_answered_43",
        ],
      }));
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        answeredMailboxItemIds: [
          "mailbox_item_answered_42",
          "mailbox_item_answered_43",
        ],
      }));
  });

  it("derives the active member Linq line from durable home routing for chat sends without route authority", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("linq_chat_123");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime.mockResolvedValueOnce([]);
    prisma.hostedMemberRouting.findUnique.mockResolvedValueOnce({
      linqChatLookupKey: chatLookupKey,
      linqRecipientPhoneLookupKey: "hbidx:phone:v1:home-line",
      pendingLinqChatLookupKey: null,
      pendingLinqRecipientPhoneLookupKey: null,
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      consumeRequired: false,
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
        answeredMailboxItemIds: [],
        linqChatId: "linq_chat_123",
        phoneNumber: null,
        phoneNumberLookupKey: "hbidx:phone:v1:home-line",
      }),
    );
  });

  it("rejects proofless accepted outcomes unless they are explicitly non-consuming", async () => {
    mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime.mockResolvedValueOnce([]);

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

    expect(response.status).toBe(409);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).not.toHaveBeenCalled();
  });

  it("uses route authority for routed sends and rejects authority for a different user", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValueOnce({
      accountLookupKey: "hbidx:phone:v1:account",
    });

    const response = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_answered_42",
        occurredAt: "2026-04-26T00:00:02.000Z",
        replyToMessageId: "linq_message_inbound",
        target: "linq_chat_123",
      },
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority: routeAuthority,
      prisma,
    });
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: null,
        phoneNumberLookupKey: "hbidx:phone:v1:account",
      }),
    );
    expect(mocks.resolveHostedLinqAnsweredMailboxItemIdsForRuntime)
      .toHaveBeenCalledWith(expect.objectContaining({
        routeAuthority,
        target: "linq_chat_123",
        targetKind: "thread",
      }));

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

    expect(mismatch.status).toBe(403);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledTimes(1);

    const targetMismatch = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_456",
      routeAuthority,
      target: "linq_chat_other",
      targetKind: "thread",
    }));

    expect(targetMismatch.status).toBe(403);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledTimes(1);
  });
});

function buildDeliveryRequest(body: unknown): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/linq-egress/delivery",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
