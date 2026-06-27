import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
  decideHostedLinqRecentInbound,
  recordHostedMemberLinqInboundEngagementTx,
  recordHostedThreadRouteLinqInboundEngagementTx,
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
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-07-25T12:00:00.000Z"),
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

  it("caps future-dated inbound member engagement at server receipt time", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      chatId: "chat-1",
      memberId: "member-1",
      now: new Date("2026-06-25T12:00:00.000Z"),
      occurredAt: "2026-08-25T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
        },
      }),
    );
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          pendingLinqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
        },
      }),
    );
  });

  it("caps future-dated inbound thread-route engagement at server receipt time", async () => {
    const prisma = {
      hostedThreadRoute: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedThreadRouteLinqInboundEngagementTx({
      chatId: "chat-1",
      linePhoneNumberLookupKey: null,
      memberId: "member-1",
      now: new Date("2026-06-25T12:00:00.000Z"),
      occurredAt: "2026-08-25T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
        },
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
          idempotencyKey: expect.stringMatching(/^hbid:linq\.delivery-idempotency:/u),
          skippedAt: new Date("2026-06-25T12:00:00.000Z"),
          sourceRef: expect.stringMatching(/^hbid:linq\.delivery-source-ref:/u),
          source: "hosted_runtime_linq_egress_guard",
          status: "skipped",
        }),
      }),
    );
  });

  it("does not authorize no-route participant sends from sender-line engagement", async () => {
    const lineLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!lineLookupKey) {
      throw new Error("Expected test Linq line lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
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
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^hbid:linq\.delivery-idempotency:/u),
          source: "hosted_runtime_linq_egress_guard",
          status: "skipped",
          targetKind: "participant",
        }),
      }),
    );
  });

  it("does not authorize a chat send from a different chat's recipient-phone freshness", async () => {
    const activeChatLookupKey = createHostedLinqChatLookupKey("chat-a");
    const recipientLookupKey = createHostedPhoneLookupKey("+15550199999");
    if (!activeChatLookupKey || !recipientLookupKey) {
      throw new Error("Expected test lookup keys.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
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
          linqChatLookupKey: activeChatLookupKey,
          linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
          linqRecipientPhoneLookupKey: recipientLookupKey,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      directRecipientPhoneNumber: "+15550199999",
      fromPhoneNumber: "+15550100001",
      idempotencyKey: "delivery-key-chat-b",
      intentId: "intent-chat-b",
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      target: "chat-b",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-b"),
          status: "skipped",
          targetKind: "thread",
        }),
      }),
    );
  });
});
