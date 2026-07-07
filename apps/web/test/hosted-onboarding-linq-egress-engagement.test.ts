import { describe, expect, it, vi } from "vitest";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";

const mailboxMocks = vi.hoisted(() => ({
  decodeHostedMailboxStoredPayload: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>(
    "@/src/lib/hosted-mailbox/store",
  );

  return {
    ...actual,
    decodeHostedMailboxStoredPayload: mailboxMocks.decodeHostedMailboxStoredPayload,
    readHostedMailboxItemById: mailboxMocks.readHostedMailboxItemById,
    readHostedMailboxPayload: mailboxMocks.readHostedMailboxPayload,
  };
});

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  bindHostedMemberHomeLinqChatAndTrackInbound,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-shared";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
  assertHostedLinqRecentInboundEngagementForRuntime,
  decideHostedLinqRecentInbound,
  recordHostedMemberLinqInboundEngagementTx,
  recordHostedThreadRouteLinqInboundEngagementTx,
  readHostedLinqSideEffectRecentInboundDecision,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";

describe("hosted Linq egress engagement", () => {
  it("allows recent or missing-bookkeeping inbound proof and blocks stale inbound proof", () => {
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
      allowed: true,
      lastInboundAt: null,
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

  it("allows participant follow-up egress when the member replied to the hosted Linq line", async () => {
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
          linqChatLookupKey: null,
          linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
          linqRecipientPhoneLookupKey: homeLineLookupKey,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
      },
      hostedThreadRoute: {
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent-1",
      intentId: "intent-1",
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
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
      select: {
        linqChatLookupKey: true,
        linqLastInboundAt: true,
        linqRecipientPhoneLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqLastInboundAt: true,
        pendingLinqRecipientPhoneLookupKey: true,
      },
    });
    expect(prisma.hostedThreadRoute.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("rejects participant follow-up egress when the participant target is not the runtime user", async () => {
    const memberPhoneLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!memberPhoneLookupKey) {
      throw new Error("Expected test phone lookup key.");
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
        findUnique: vi.fn(),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent-1",
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      target: "+15550100002",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
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

  it("denies side-effect egress when no member can be resolved", async () => {
    await expect(readHostedLinqSideEffectRecentInboundDecision({
      payload: {
        chatId: "chat-1",
        message: "joined",
        occurredAt: "2026-06-25T12:00:00.000Z",
        replyToMessageId: "message-1",
        sourceEventId: "event-1",
        template: "group_join_offer_accepted",
      },
      prisma: {} as never,
    })).resolves.toEqual({
      allowed: false,
      lastInboundAt: null,
      reason: "missing_inbound",
    });
  });

  it("records home-route inbound engagement by member id only", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      binding: "home",
      memberId: "member-1",
      occurredAt: "2026-06-25T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledWith({
      data: {
        linqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
      },
      where: {
        memberId: "member-1",
        OR: [
          { linqLastInboundAt: null },
          { linqLastInboundAt: { lt: new Date("2026-06-25T12:00:00.000Z") } },
        ],
      },
    });
    expect(prisma.hostedMemberRouting.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("linqChatLookupKey");
    expect(prisma.hostedMemberRouting.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("pendingLinqChatLookupKey");
  });

  it("records pending-route inbound engagement by member id only", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      binding: "pending",
      memberId: "member-1",
      occurredAt: "2026-06-25T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledWith({
      data: {
        pendingLinqLastInboundAt: new Date("2026-06-25T12:00:00.000Z"),
      },
      where: {
        memberId: "member-1",
        OR: [
          { pendingLinqLastInboundAt: null },
          { pendingLinqLastInboundAt: { lt: new Date("2026-06-25T12:00:00.000Z") } },
        ],
      },
    });
    expect(prisma.hostedMemberRouting.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("linqChatLookupKey");
    expect(prisma.hostedMemberRouting.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("pendingLinqChatLookupKey");
  });

  it("keeps member-route inbound engagement stamps moving forward only", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      binding: "home",
      memberId: "member-1",
      occurredAt: "2026-06-24T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledWith({
      data: {
        linqLastInboundAt: new Date("2026-06-24T12:00:00.000Z"),
      },
      where: {
        memberId: "member-1",
        OR: [
          { linqLastInboundAt: null },
          { linqLastInboundAt: { lt: new Date("2026-06-24T12:00:00.000Z") } },
        ],
      },
    });
  });

  it("heals a drifted home Linq chat key and records the live webhook inbound", async () => {
    const driftedKey = createHostedLinqChatLookupKey("api-chat-id");
    const liveKey = createHostedLinqChatLookupKey("webhook-chat-id");
    const recipientLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!driftedKey || !liveKey || !recipientLookupKey) {
      throw new Error("Expected test Linq lookup keys.");
    }

    const occurredAt = new Date("2026-06-25T12:00:00.000Z");
    const routing: {
      linqChatLookupKey: string | null;
      linqLastInboundAt: Date | null;
      linqRecipientPhoneLookupKey: string | null;
      memberId: string;
      pendingLinqChatLookupKey: string | null;
      pendingLinqLastInboundAt: Date | null;
      pendingLinqRecipientPhoneLookupKey: string | null;
    } = {
      linqChatLookupKey: driftedKey,
      linqLastInboundAt: null,
      linqRecipientPhoneLookupKey: recipientLookupKey,
      memberId: "member-1",
      pendingLinqChatLookupKey: null,
      pendingLinqLastInboundAt: null,
      pendingLinqRecipientPhoneLookupKey: null,
    };
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDailyState: {
        upsert: vi.fn().mockResolvedValue({
          dayUtc: new Date("2026-06-25T00:00:00.000Z"),
          firstSeenAt: occurredAt,
          inboundCount: 1,
          lastSeenAt: occurredAt,
          memberId: "member-1",
        }),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve({
          linqChatLookupKey: routing.linqChatLookupKey,
          linqLastInboundAt: routing.linqLastInboundAt,
          linqRecipientPhoneLookupKey: routing.linqRecipientPhoneLookupKey,
          pendingLinqChatLookupKey: routing.pendingLinqChatLookupKey,
          pendingLinqLastInboundAt: routing.pendingLinqLastInboundAt,
          pendingLinqRecipientPhoneLookupKey: routing.pendingLinqRecipientPhoneLookupKey,
        })),
        updateMany: vi.fn().mockImplementation((input: {
          data?: {
            linqLastInboundAt?: Date | null;
            pendingLinqLastInboundAt?: Date | null;
          };
          where?: { memberId?: string };
        }) => {
          if (input.where?.memberId === routing.memberId) {
            if (input.data?.linqLastInboundAt instanceof Date) {
              routing.linqLastInboundAt = input.data.linqLastInboundAt;
            }
            if (input.data?.pendingLinqLastInboundAt instanceof Date) {
              routing.pendingLinqLastInboundAt = input.data.pendingLinqLastInboundAt;
            }
          }
          return Promise.resolve({ count: input.where?.memberId === routing.memberId ? 1 : 0 });
        }),
        upsert: vi.fn().mockImplementation((input: {
          update: {
            linqChatLookupKey?: string | null;
            linqLastInboundAt?: Date | null;
            linqRecipientPhoneLookupKey?: string | null;
            pendingLinqChatLookupKey?: string | null;
            pendingLinqLastInboundAt?: Date | null;
            pendingLinqRecipientPhoneLookupKey?: string | null;
          };
        }) => {
          if ("linqChatLookupKey" in input.update) {
            routing.linqChatLookupKey = input.update.linqChatLookupKey ?? null;
          }
          if ("linqLastInboundAt" in input.update) {
            routing.linqLastInboundAt = input.update.linqLastInboundAt ?? null;
          }
          if ("linqRecipientPhoneLookupKey" in input.update) {
            routing.linqRecipientPhoneLookupKey = input.update.linqRecipientPhoneLookupKey ?? null;
          }
          if ("pendingLinqChatLookupKey" in input.update) {
            routing.pendingLinqChatLookupKey = input.update.pendingLinqChatLookupKey ?? null;
          }
          if ("pendingLinqLastInboundAt" in input.update) {
            routing.pendingLinqLastInboundAt = input.update.pendingLinqLastInboundAt ?? null;
          }
          if ("pendingLinqRecipientPhoneLookupKey" in input.update) {
            routing.pendingLinqRecipientPhoneLookupKey =
              input.update.pendingLinqRecipientPhoneLookupKey ?? null;
          }
          return Promise.resolve(routing);
        }),
      },
    };

    await bindHostedMemberHomeLinqChatAndTrackInbound({
      chatId: "webhook-chat-id",
      homeLineAssignedAt: null,
      memberId: "member-1",
      occurredAt: occurredAt.toISOString(),
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(routing.linqChatLookupKey).toBe(liveKey);
    expect(routing.linqLastInboundAt).toEqual(occurredAt);
    expect(routing.pendingLinqChatLookupKey).toBeNull();
    expect(routing.pendingLinqLastInboundAt).toBeNull();
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenLastCalledWith({
      data: {
        linqLastInboundAt: occurredAt,
      },
      where: {
        memberId: "member-1",
        OR: [
          { linqLastInboundAt: null },
          { linqLastInboundAt: { lt: occurredAt } },
        ],
      },
    });
  });

  it("heals a drifted home Linq chat key without regressing newer inbound freshness", async () => {
    const driftedKey = createHostedLinqChatLookupKey("api-chat-id");
    const liveKey = createHostedLinqChatLookupKey("webhook-chat-id");
    const pendingKey = createHostedLinqChatLookupKey("pending-chat-id");
    const recipientLookupKey = createHostedPhoneLookupKey("+15550100001");
    const pendingRecipientLookupKey = createHostedPhoneLookupKey("+15550100002");
    if (!driftedKey || !liveKey || !pendingKey || !recipientLookupKey || !pendingRecipientLookupKey) {
      throw new Error("Expected test Linq lookup keys.");
    }

    const newerInboundAt = new Date("2026-06-26T12:00:00.000Z");
    const replayedOccurredAt = new Date("2026-06-25T12:00:00.000Z");
    const routing: {
      linqChatLookupKey: string | null;
      linqLastInboundAt: Date | null;
      linqRecipientPhoneLookupKey: string | null;
      memberId: string;
      pendingLinqChatLookupKey: string | null;
      pendingLinqLastInboundAt: Date | null;
      pendingLinqRecipientPhoneLookupKey: string | null;
    } = {
      linqChatLookupKey: driftedKey,
      linqLastInboundAt: newerInboundAt,
      linqRecipientPhoneLookupKey: null,
      memberId: "member-1",
      pendingLinqChatLookupKey: pendingKey,
      pendingLinqLastInboundAt: null,
      pendingLinqRecipientPhoneLookupKey: pendingRecipientLookupKey,
    };
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDailyState: {
        upsert: vi.fn().mockResolvedValue({
          dayUtc: new Date("2026-06-25T00:00:00.000Z"),
          firstSeenAt: replayedOccurredAt,
          inboundCount: 1,
          lastSeenAt: replayedOccurredAt,
          memberId: "member-1",
        }),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve({
          linqChatLookupKey: routing.linqChatLookupKey,
          linqLastInboundAt: routing.linqLastInboundAt,
          linqRecipientPhoneLookupKey: routing.linqRecipientPhoneLookupKey,
          pendingLinqChatLookupKey: routing.pendingLinqChatLookupKey,
          pendingLinqLastInboundAt: routing.pendingLinqLastInboundAt,
          pendingLinqRecipientPhoneLookupKey: routing.pendingLinqRecipientPhoneLookupKey,
        })),
        updateMany: vi.fn().mockImplementation((input: {
          data?: {
            linqLastInboundAt?: Date | null;
            pendingLinqLastInboundAt?: Date | null;
          };
          where?: {
            memberId?: string;
            OR?: Array<{
              linqLastInboundAt?: null | { lt: Date };
              pendingLinqLastInboundAt?: null | { lt: Date };
            }>;
          };
        }) => {
          if (input.where?.memberId !== routing.memberId) {
            return Promise.resolve({ count: 0 });
          }

          if (input.data?.linqLastInboundAt instanceof Date) {
            const shouldUpdate = input.where.OR?.some((condition) => {
              const clause = condition.linqLastInboundAt;
              if (clause === null) {
                return routing.linqLastInboundAt === null;
              }
              return Boolean(
                clause
                && routing.linqLastInboundAt
                && routing.linqLastInboundAt.getTime() < clause.lt.getTime(),
              );
            }) ?? true;
            if (!shouldUpdate) {
              return Promise.resolve({ count: 0 });
            }
            routing.linqLastInboundAt = input.data.linqLastInboundAt;
            return Promise.resolve({ count: 1 });
          }

          if (input.data?.pendingLinqLastInboundAt instanceof Date) {
            routing.pendingLinqLastInboundAt = input.data.pendingLinqLastInboundAt;
            return Promise.resolve({ count: 1 });
          }

          return Promise.resolve({ count: 0 });
        }),
        upsert: vi.fn().mockImplementation((input: {
          update: {
            linqChatLookupKey?: string | null;
            linqLastInboundAt?: Date | null;
            linqRecipientPhoneLookupKey?: string | null;
            pendingLinqChatLookupKey?: string | null;
            pendingLinqLastInboundAt?: Date | null;
            pendingLinqRecipientPhoneLookupKey?: string | null;
          };
        }) => {
          if ("linqChatLookupKey" in input.update) {
            routing.linqChatLookupKey = input.update.linqChatLookupKey ?? null;
          }
          if ("linqLastInboundAt" in input.update) {
            routing.linqLastInboundAt = input.update.linqLastInboundAt ?? null;
          }
          if ("linqRecipientPhoneLookupKey" in input.update) {
            routing.linqRecipientPhoneLookupKey = input.update.linqRecipientPhoneLookupKey ?? null;
          }
          if ("pendingLinqChatLookupKey" in input.update) {
            routing.pendingLinqChatLookupKey = input.update.pendingLinqChatLookupKey ?? null;
          }
          if ("pendingLinqLastInboundAt" in input.update) {
            routing.pendingLinqLastInboundAt = input.update.pendingLinqLastInboundAt ?? null;
          }
          if ("pendingLinqRecipientPhoneLookupKey" in input.update) {
            routing.pendingLinqRecipientPhoneLookupKey =
              input.update.pendingLinqRecipientPhoneLookupKey ?? null;
          }
          return Promise.resolve(routing);
        }),
      },
    };

    await bindHostedMemberHomeLinqChatAndTrackInbound({
      chatId: "webhook-chat-id",
      homeLineAssignedAt: null,
      memberId: "member-1",
      occurredAt: replayedOccurredAt.toISOString(),
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(routing.linqChatLookupKey).toBe(liveKey);
    expect(routing.linqRecipientPhoneLookupKey).toBe(recipientLookupKey);
    expect(routing.linqLastInboundAt).toEqual(newerInboundAt);
    expect(routing.pendingLinqChatLookupKey).toBeNull();
    expect(routing.pendingLinqLastInboundAt).toBeNull();
    expect(routing.pendingLinqRecipientPhoneLookupKey).toBeNull();
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenLastCalledWith({
      data: {
        linqLastInboundAt: replayedOccurredAt,
      },
      where: {
        memberId: "member-1",
        OR: [
          { linqLastInboundAt: null },
          { linqLastInboundAt: { lt: replayedOccurredAt } },
        ],
      },
    });
  });

  it("records current-inbound member proof by member id instead of stored chat key", async () => {
    mailboxMocks.decodeHostedMailboxStoredPayload.mockReset();
    mailboxMocks.readHostedMailboxItemById.mockReset();
    mailboxMocks.readHostedMailboxPayload.mockReset();

    const driftedKey = createHostedLinqChatLookupKey("api-chat-id");
    const contactLookupKey = createHostedPhoneLookupKey("+15550100001");
    if (!driftedKey || !contactLookupKey) {
      throw new Error("Expected test Linq lookup keys.");
    }

    const occurredAt = "2026-06-25T12:00:00.000Z";
    const wake = buildHostedExecutionLinqConversationMessageWake({
      contactKind: "phone",
      contactLookupKey,
      eventId: "evt-current-inbound",
      linqMessage: {
        chatId: "webhook-chat-id",
        from: "+15550100001",
        isFromMe: false,
        messageId: "msg-current-inbound",
        parts: [],
        reactionEligible: true,
        threadIsDirect: true,
      },
      occurredAt,
      phoneLookupKey: contactLookupKey,
      userId: "member-1",
    });
    mailboxMocks.readHostedMailboxItemById.mockResolvedValue({
      dedupeKey: "evt-current-inbound",
      expiresAt: null,
      id: "mailbox-evt-current-inbound",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: 1n,
      occurredAt,
      payloadInlineCiphertext: "ciphertext",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox.conversation-message.v1",
      userId: "member-1",
    });
    mailboxMocks.decodeHostedMailboxStoredPayload.mockResolvedValue(wake);

    const prisma = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: driftedKey,
          linqLastInboundAt: null,
          linqRecipientPhoneLookupKey: null,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      currentInbound: {
        dedupeKey: "evt-current-inbound",
        eventId: "evt-current-inbound",
        mailboxItemId: "mailbox-evt-current-inbound",
        occurredAt,
        replyToMessageId: "msg-current-inbound",
        target: "webhook-chat-id",
      },
      fromPhoneNumber: "+15550100001",
      idempotencyKey: "delivery-key-current-inbound",
      intentId: "intent-current-inbound",
      memberId: "member-1",
      now: new Date("2026-06-25T12:05:00.000Z"),
      prisma: prisma as never,
      target: "webhook-chat-id",
      targetKind: "thread",
    })).resolves.toBeUndefined();

    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledWith({
      data: {
        linqLastInboundAt: new Date(occurredAt),
      },
      where: {
        memberId: "member-1",
        OR: [
          { linqLastInboundAt: null },
          { linqLastInboundAt: { lt: new Date(occurredAt) } },
        ],
      },
    });
    expect(prisma.hostedMemberRouting.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("linqChatLookupKey");
  });

  it("caps future-dated inbound member engagement at server receipt time", async () => {
    const prisma = {
      hostedMemberRouting: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedMemberLinqInboundEngagementTx({
      binding: "home",
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
  });

  it("caps future-dated inbound thread-route engagement at server receipt time", async () => {
    const prisma = {
      hostedThreadRoute: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await recordHostedThreadRouteLinqInboundEngagementTx({
      chatId: "chat-1",
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
          threadIdentityLookupKey: {
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:external-thread-identity:/u),
            ]),
          },
        }),
      }),
    );
    expect(prisma.hostedThreadRoute.updateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("threadLookupKey");
  });

  it("records skipped runtime sends when recorded inbound is stale", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("chat-1");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([]),
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
      details: {
        lastInboundAt: "2026-05-01T12:00:00.000Z",
        reason: "stale_inbound",
      },
      httpStatus: 403,
    });

    expect(prisma.hostedLinqLine.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^hbid:linq\.delivery-idempotency:/u),
          skippedAt: new Date("2026-06-25T12:00:00.000Z"),
          skipReason: `last_inbound_at=2026-05-01T12:00:00.000Z; window_days=28`,
          sourceRef: expect.stringMatching(/^hbid:linq\.delivery-source-ref:/u),
          source: "hosted_runtime_linq_egress_guard",
          status: "skipped",
        }),
      }),
    );
  });

  it("allows runtime sends when a matched member route has null inbound bookkeeping", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("chat-1");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([]),
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
    })).resolves.toBeUndefined();

    expect(prisma.hostedLinqLine.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });

  it("records skipped runtime sends when no member route matches the target", async () => {
    const otherChatLookupKey = createHostedLinqChatLookupKey("other-chat");
    if (!otherChatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_skip" }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([]),
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
          linqChatLookupKey: otherChatLookupKey,
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
