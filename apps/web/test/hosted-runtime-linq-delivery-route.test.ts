import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  recordHostedLinqRuntimeDeliveryOutcomeTx: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  recordHostedLinqRuntimeDeliveryOutcomeTx: mocks.recordHostedLinqRuntimeDeliveryOutcomeTx,
}));

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
      providerMessageId: "linq_message_sent",
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
        messageId: "linq_message_sent",
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
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: false,
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

    expect(mismatch.status).toBe(403);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledTimes(1);

    const targetMismatch = await route.POST(buildDeliveryRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_456",
      providerThreadId: "linq_chat_other",
      routeAuthority,
      target: "linq_chat_123",
      targetKind: "thread",
    }));

    expect(targetMismatch.status).toBe(403);
    expect(mocks.recordHostedLinqRuntimeDeliveryOutcomeTx).toHaveBeenCalledTimes(1);
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
        userId: "member_123",
      }),
    );
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
