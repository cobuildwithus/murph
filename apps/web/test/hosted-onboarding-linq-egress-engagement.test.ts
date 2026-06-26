import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
  decideHostedLinqRecentInbound,
  recordHostedMemberLinqInboundEngagementTx,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";

describe("hosted Linq egress engagement", () => {
  it("requires inbound engagement inside the 28-day window", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");

    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-06-01T12:00:00.000Z"),
      now,
    })).toMatchObject({
      allowed: true,
    });
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-05-01T12:00:00.000Z"),
      now,
    })).toMatchObject({
      allowed: false,
      reason: "missing_recent_inbound",
    });
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: null,
      now,
    })).toMatchObject({
      allowed: false,
      reason: "missing_recent_inbound",
    });
  });

  it("projects real inbound Linq messages onto active and pending member routes", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      chatId: "chat-1",
      memberId: "member-1",
      occurredAt: "2026-06-25T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
        },
        where: expect.objectContaining({
          memberId: "member-1",
        }),
      }),
    );
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          pendingLinqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
        },
        where: expect.objectContaining({
          memberId: "member-1",
        }),
      }),
    );
  });

  it("records skipped runtime sends when no recent inbound exists", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("chat-1");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqConversationState: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      hostedLinqLine: {
        upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.create.phoneNumberLookupKey,
          })),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
          })),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: chatLookupKey,
          linqLastInboundAt: new Date("2026-05-01T12:00:00.000Z"),
          linqRecipientPhoneLookupKey: null,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      fromPhoneNumber: "+15550100001",
      idempotencyKey: "delivery-key-1",
      intentId: "intent-1",
      memberId: "member-1",
      now: new Date("2026-06-25T12:00:00.000Z"),
      prisma: prisma as never,
      target: "chat-1",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqLine.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: "delivery-key-1",
          skippedAt: new Date("2026-06-25T12:00:00.000Z"),
          source: "hosted_runtime_linq_egress_guard",
          status: "skipped",
        }),
      }),
    );
  });

  it("allows pre-chat runtime sends when the sending line has recent inbound engagement", async () => {
    const lineLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!lineLookupKey) {
      throw new Error("Expected test Linq line lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: null,
          linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
          linqRecipientPhoneLookupKey: lineLookupKey,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      directRecipientPhoneNumber: "+15550199999",
      fromPhoneNumber: "+15550100001",
      idempotencyKey: "delivery-key-2",
      intentId: "intent-2",
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      target: "+15550199999",
      targetKind: "participant",
    })).resolves.toBeUndefined();

    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });
});
