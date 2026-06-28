import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
  assertHostedLinqRecentInboundEngagementForRuntime,
  decideHostedLinqRecentInbound,
  recordHostedMemberLinqInboundEngagementTx,
  recordHostedThreadRouteLinqInboundEngagementTx,
  readHostedLinqSideEffectRecentInboundDecision,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";

describe("hosted Linq egress engagement", () => {
  it("allows recent inbound and blocks missing or stale inbound proof", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");

    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-06-01T12:00:00.000Z"),
      now,
    })).toMatchObject({
      allowed: true,
    });
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: null,
      now,
    })).toMatchObject({
      allowed: false,
      lastInboundAt: null,
      reason: "missing_inbound",
    });
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-05-01T12:00:00.000Z"),
      now,
    })).toMatchObject({
      allowed: false,
      reason: "stale_inbound",
    });
    expect(decideHostedLinqRecentInbound({
      lastInboundAt: new Date("2026-07-25T12:00:00.000Z"),
      now,
    })).toMatchObject({
      allowed: false,
      reason: "stale_inbound",
    });
  });

  it("allows explicit signup welcome first contact for the bound runtime user", async () => {
    const memberPhoneLookupKey = createHostedPhoneLookupKey("+15550100001");
    const homeLineLookupKey = createHostedPhoneLookupKey("+15550100099");
    if (!memberPhoneLookupKey || !homeLineLookupKey) {
      throw new Error("Expected test phone lookup keys.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          phoneLookupKey: memberPhoneLookupKey,
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqRecipientPhoneLookupKey: homeLineLookupKey,
        }),
      },
      hostedThreadRoute: {
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-1",
      intentId: "intent-1",
      memberId: "member-1",
      prisma: prisma as never,
      target: "+15550100001",
      targetKind: "participant",
    })).resolves.toBeUndefined();

    expect(prisma.hostedMemberIdentity.findUnique).toHaveBeenCalledWith({
      where: { memberId: "member-1" },
      select: { phoneLookupKey: true },
    });
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalledWith({
      where: { memberId: "member-1" },
      select: { linqRecipientPhoneLookupKey: true },
    });
    expect(prisma.hostedThreadRoute.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("rejects signup welcome first contact when the participant route does not match durable member routing", async () => {
    const memberPhoneLookupKey = createHostedPhoneLookupKey("+15550100001");
    const homeLineLookupKey = createHostedPhoneLookupKey("+15550100099");
    if (!memberPhoneLookupKey || !homeLineLookupKey) {
      throw new Error("Expected test phone lookup keys.");
    }
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          phoneLookupKey: memberPhoneLookupKey,
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqRecipientPhoneLookupKey: homeLineLookupKey,
        }),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-1",
      memberId: "member-1",
      prisma: prisma as never,
      target: "+15550100002",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
      fromPhoneNumber: "+15550100100",
      idempotencyKey: "signup-welcome:member-1",
      memberId: "member-1",
      prisma: prisma as never,
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-1",
      memberId: "member-1",
      prisma: prisma as never,
      target: "chat-1",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("rejects first-contact runtime egress without signup welcome authority", async () => {
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
      idempotencyKey: "signup-welcome:member-2",
      memberId: "member-1",
      prisma: prisma as never,
      target: "chat-1",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("allows invite side effects as explicit first contact", async () => {
    await expect(readHostedLinqSideEffectRecentInboundDecision({
      payload: {
        chatId: "chat-1",
        inviteId: "invite-1",
        memberId: "member-1",
        occurredAt: "2026-06-25T12:00:00.000Z",
        replyToMessageId: null,
        template: "invite_signup",
      },
      prisma: {} as never,
    })).resolves.toEqual({
      allowed: true,
      lastInboundAt: null,
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
    const lineLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!lineLookupKey) {
      throw new Error("Expected test Linq line lookup key.");
    }
    const prisma = {
      hostedThreadRoute: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedThreadRouteLinqInboundEngagementTx({
      chatId: "chat-1",
      linePhoneNumberLookupKey: lineLookupKey,
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
        where: expect.objectContaining({
          channel: "linq",
          containerMemberId: "member-1",
          threadLookupKey: {
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:external-thread:/u),
            ]),
          },
        }),
      }),
    );
    expect(prisma.hostedThreadRoute.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("threadIdentityLookupKey");
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

  it("records skipped runtime sends when inbound proof is missing", async () => {
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
          linqLastInboundAt: null,
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
      details: {
        lastInboundAt: null,
        reason: "missing_inbound",
      },
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skipReason: `last_inbound_at=null; window_days=28`,
          status: "skipped",
        }),
      }),
    );
  });

  it("rejects non-Linq route authority before using it as freshness proof", async () => {
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      routeAuthority: {
        accountLookupKey: "hbidx:email:v1:account",
        channel: "email",
        containerMemberId: "member-1",
        threadId: "email-thread-1",
      },
      target: "chat-b",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("rejects Linq route authority for a different requested thread", async () => {
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-a",
      },
      target: "chat-b",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("requires Linq route authority to match the provider chat and payload member", () => {
    expect(assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: "chat-a",
      memberId: "member-1",
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-a",
      },
    })).toMatchObject({
      channel: "linq",
      containerMemberId: "member-1",
      threadId: "chat-a",
    });

    let threadMismatch: unknown = null;
    try {
      assertHostedLinqRouteAuthorityMatchesTarget({
        chatId: "chat-b",
        memberId: "member-1",
        routeAuthority: {
          accountLookupKey: "hbidx:phone:v1:account",
          channel: "linq",
          containerMemberId: "member-1",
          threadId: "chat-a",
        },
      });
    } catch (error) {
      threadMismatch = error;
    }
    expect(threadMismatch).toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    let memberMismatch: unknown = null;
    try {
      assertHostedLinqRouteAuthorityMatchesTarget({
        chatId: "chat-a",
        memberId: "member-2",
        routeAuthority: {
          accountLookupKey: "hbidx:phone:v1:account",
          channel: "linq",
          containerMemberId: "member-1",
          threadId: "chat-a",
        },
      });
    } catch (error) {
      memberMismatch = error;
    }
    expect(memberMismatch).toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });
  });

});
