import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: vi.fn(),
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  listHostedLinqAssignableHomeLines: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince: mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx: mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  listHostedLinqAssignableHomeLines: mocks.listHostedLinqAssignableHomeLines,
}));

import {
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHomeLineFromPoolTx,
  resolveHostedMemberLinqHomeLineRouteBindingTx,
  resolveHostedMemberActivationLinqRoute,
} from "@/src/lib/hosted-onboarding/linq-home-routing";

describe("readHostedLinqHomeLineAuthority", () => {
  const baseRouting = {
    linqChatId: null,
    linqHomeLineAssignedAt: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    replyAliasLookupKey: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  } as never;

  it("returns none without a routing row or route fields", () => {
    expect(readHostedLinqHomeLineAuthority(null)).toEqual({ kind: "none" });
    expect(readHostedLinqHomeLineAuthority(baseRouting)).toEqual({ kind: "none" });
  });

  it("prefers the home chat over pending state", () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    expect(readHostedLinqHomeLineAuthority({
      ...(baseRouting as Record<string, unknown>),
      linqChatId: "chat_home",
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      pendingLinqChatId: "chat_pending",
      pendingLinqRecipientPhone: "+15550100002",
    } as never)).toEqual({
      assignedAt,
      chatId: "chat_home",
      kind: "home",
      recipientPhone: "+15550100001",
    });
  });

  it("falls back to the home recipient for pending routes without a pending phone", () => {
    expect(readHostedLinqHomeLineAuthority({
      ...(baseRouting as Record<string, unknown>),
      linqRecipientPhone: "+15550100001",
      pendingLinqChatId: "chat_pending",
    } as never)).toEqual({
      assignedAt: null,
      chatId: "chat_pending",
      kind: "pending",
      recipientPhone: "+15550100001",
    });
  });

  it("treats a bare assigned recipient as durable authority", () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    expect(readHostedLinqHomeLineAuthority({
      ...(baseRouting as Record<string, unknown>),
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
    } as never)).toEqual({
      assignedAt,
      chatId: null,
      kind: "bare",
      recipientPhone: "+15550100001",
    });
  });
});

describe("reserveHostedLinqHomeLineFromPoolTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([]);
  });

  it("reserves the preferred line when it is healthy and under quota", async () => {
    const preferredLine = buildLine("+15550100001", { maxNewConversationsPerDay: 2 });
    const fallbackLine = buildLine("+15550100002", { maxNewConversationsPerDay: 2 });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      fallbackLine,
      preferredLine,
    ]);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([
        [fallbackLine.phoneNumber, 0],
        [preferredLine.phoneNumber, 1],
      ]),
    );

    await expect(
      reserveHostedLinqHomeLineFromPoolTx({
        preferredRecipientPhone: preferredLine.phoneNumber,
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      kind: "reserved",
      reservation: {
        line: preferredLine,
      },
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledTimes(1);
    expect(
      mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.listHostedLinqAssignableHomeLines.mock.invocationCallOrder[0]);
  });

  it("falls over to another assignable line when the preferred line is at quota", async () => {
    const preferredLine = buildLine("+15550100001", { maxNewConversationsPerDay: 1 });
    const fallbackLine = buildLine("+15550100002", { maxNewConversationsPerDay: 1 });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      preferredLine,
      fallbackLine,
    ]);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([
        [preferredLine.phoneNumber, 1],
        [fallbackLine.phoneNumber, 0],
      ]),
    );

    await expect(
      reserveHostedLinqHomeLineFromPoolTx({
        preferredRecipientPhone: preferredLine.phoneNumber,
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      kind: "reserved",
      reservation: {
        line: fallbackLine,
      },
    });
  });

  it("falls over when the preferred line is not in the assignable pool", async () => {
    const fallbackLine = buildLine("+15550100002");
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([fallbackLine]);

    await expect(
      reserveHostedLinqHomeLineFromPoolTx({
        preferredRecipientPhone: "+15550100001",
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      kind: "reserved",
      reservation: {
        line: fallbackLine,
      },
    });
  });
});

describe("resolveHostedMemberActivationLinqRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([]);
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
    mocks.upsertHostedMemberHomeLinqBindingTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockResolvedValue(undefined);
  });

  it("clears stale pending state when a durable home chat already exists", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqChatId: "chat_home",
          linqRecipientPhone: "+15550100001",
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100002",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_home",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: hashHostedLinqRouteIdentifier("chat_home"),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_home",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("preserves the existing assignment timestamp when a home recipient exists before chat binding", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550100001",
            kind: "linq",
          },
          target: "+15551234567",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: null,
        threadIsDirect: true,
      },
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("preserves an existing direct route assignment without consuming capacity", async () => {
    const assignedAt = new Date("2026-06-29T14:15:00.000Z");
    const line = buildLine("+15550100001", {
      activeMemberLimit: 1,
      maxNewConversationsPerDay: 1,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line]);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume daily capacity");
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume active capacity");
    });

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqHomeLineAssignedAt: assignedAt,
          linqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: line.phoneNumber,
            kind: "linq",
          },
        },
      },
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: assignedAt,
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: line.phoneNumber,
    });
  });

  it("reuses a pending Linq thread when its recipient matches the chosen home line", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: hashHostedLinqRouteIdentifier("chat_pending"),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("promotes an email-handle pending Linq thread without requiring a member phone", async () => {
    const emailLookupKey = "hbidx:email:v1:test";
    const member = buildMember({
      pendingLinqChatId: "chat_pending_email",
      pendingLinqParticipantContact: {
        kind: "email",
        lookupKey: emailLookupKey,
        observedAt: new Date("2026-04-12T00:01:00.000Z"),
        value: "buddy@icloud.com",
      },
      pendingLinqRecipientPhone: null,
    });
    member.identity = member.identity
      ? {
          ...member.identity,
          phoneLookupKey: null,
          phoneNumber: null,
        }
      : null;
    member.emailAuthorization = {
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: {
        address: "buddy@icloud.com",
        lookupKey: emailLookupKey,
        verifiedAt: new Date("2026-04-12T00:02:00.000Z"),
      },
    };

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member,
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: null,
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending_email",
        },
        identityId: hashHostedLinqRouteIdentifier(emailLookupKey, emailLookupKey),
        threadId: hashHostedLinqRouteIdentifier("chat_pending_email", emailLookupKey),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending_email",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: null,
    });
  });

  it("promotes an existing pending Linq thread even when that line is over daily cap", async () => {
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      buildLine("+15550100001", {
        maxNewConversationsPerDay: 1,
      }),
    ]);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([["+15550100001", 1]]),
    );

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
      },
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("promotes a pending Linq thread whose reservation phone lives on the home column", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqHomeLineAssignedAt: new Date("2026-06-30T14:15:00.000Z"),
          linqRecipientPhone: "+15550100001",
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: null,
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
      },
    });

    // The pending route must promote, not be cleared by a bare recipient
    // write that drops the pending chat.
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("promotes a reserved pending Linq thread even when its line left the assignable pool", async () => {
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      buildLine("+15550100002"),
    ]);

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqHomeLineAssignedAt: new Date("2026-06-30T14:15:00.000Z"),
          linqRecipientPhone: "+15550100001",
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
      },
    });

    // The existing pending route is durable authority: no pool read, no new
    // line claim, no lock.
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("assigns the pooled home line and builds a first-contact welcome route when there is no reusable pending thread", async () => {
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      buildLine("+15550100001", { activeMemberLimit: 3 }),
      buildLine("+15550100002", { activeMemberLimit: 3 }),
    ]);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        ["+15550100001", 3],
        ["+15550100002", 1],
      ]),
    );
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([
        ["+15550100001", 0],
        ["+15550100002", 0],
      ]),
    );

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550100002",
            kind: "linq",
          },
          target: "+15551234567",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: null,
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledTimes(1);
    // The routing state must be re-read under the pool lock before claiming.
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(2);
    expect(
      mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.readHostedMemberRoutingState.mock.invocationCallOrder[1]);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100002",
    });
  });

  it("fails closed when activation has no usable pending thread and no configured home-line pool", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: null,
        }),
        prisma: {} as never,
      }),
    ).rejects.toMatchObject({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      httpStatus: 500,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });
});

describe("resolveHostedMemberLinqHomeLineRouteBindingTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  });

  it("reuses an existing pending route assignment without consuming another daily assignment", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    const line = buildLine("+15550100001", { maxNewConversationsPerDay: 1 });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: "chat_123",
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: "+15550100001",
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([["+15550100001", 1]]),
    );

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_123",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: assignedAt,
      kind: "bind",
      recipientPhone: line.phoneNumber,
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("resolves an already-bound home chat without touching the shared pool lock", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_123",
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_123",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: assignedAt,
      kind: "bind",
      recipientPhone: "+15550100001",
      routeAlreadyBound: true,
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
  });

  it("does not mark the route already bound while pending Linq state remains to clear", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_123",
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: "chat_pending",
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    const pendingResult = await resolveHostedMemberLinqHomeLineRouteBindingTx({
      incomingChatId: "chat_123",
      incomingDirectAttested: true,
      incomingRecipientPhone: "+15550100001",
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(pendingResult.kind).toBe("bind");
    expect(
      pendingResult.kind === "bind" ? pendingResult.routeAlreadyBound : null,
    ).toBeUndefined();
  });

  it("does not mark the route already bound when binding via the recipient line instead of the chat", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_original",
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    const result = await resolveHostedMemberLinqHomeLineRouteBindingTx({
      incomingChatId: "chat_new",
      incomingDirectAttested: true,
      incomingRecipientPhone: "+15550100001",
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(result.kind).toBe("bind");
    expect(
      result.kind === "bind" ? result.routeAlreadyBound : null,
    ).toBeUndefined();
  });

  it("redirects other-line inbound to a bare assigned home line without reserving", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_other_line",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100002",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeRecipientPhone: "+15550100001",
      kind: "redirect_to_home",
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("acquires the pool lock and re-resolves routing before reserving a new assignment", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      buildLine("+15550100001"),
    ]);

    const result = await resolveHostedMemberLinqHomeLineRouteBindingTx({
      incomingChatId: "chat_first_bind",
      incomingDirectAttested: true,
      incomingRecipientPhone: "+15550100001",
      memberId: "member_123",
      prisma: {} as never,
    });

    expect(result).toMatchObject({
      kind: "bind",
      recipientPhone: "+15550100001",
    });
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledTimes(1);
    // The routing state must be re-read under the lock before the claim.
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(2);
    expect(
      mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.readHostedMemberRoutingState.mock.invocationCallOrder[1]);
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalled();
  });

  it("rejects a stale home-chat member match before treating it as a first bind", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_stale_lookup",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
        memberAuthority: {
          kind: "home-linq-chat",
        },
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      kind: "ignore_unknown_home",
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("rejects a stale pending-contact member match before treating it as a first bind", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_new",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
        memberAuthority: {
          contact: {
            kind: "phone",
            lookupKey: "lookup:+15551234567",
            value: "+15551234567",
          },
          kind: "pending-contact",
        },
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      kind: "ignore_unknown_home",
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("reuses an existing same-phone route claim when the chat id changes", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    const line = buildLine("+15550100001", {
      activeMemberLimit: 1,
      maxNewConversationsPerDay: 1,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_old",
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockImplementation(async () => {
      throw new Error("existing same-phone route claims must not consume daily capacity");
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockImplementation(async () => {
      throw new Error("existing same-phone route claims must not consume active capacity");
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_new",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: assignedAt,
      kind: "bind",
      recipientPhone: line.phoneNumber,
    });
  });

  it("rejects a stale same-line rebind when the current route now requires direct attestation", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_current",
      linqHomeLineAssignedAt: new Date("2026-06-30T14:15:00.000Z"),
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_possible_group",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      kind: "ignore_unattested_direct",
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("rejects an unattested pending-route rebind before reserving line capacity", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: "chat_pending",
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: "+15550100001",
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_possible_group",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      kind: "ignore_unattested_direct",
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("uses the pending route recipient instead of a stale home recipient", async () => {
    const pendingLine = buildLine("+15550100002");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: new Date("2026-06-30T14:15:00.000Z"),
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: "chat_pending",
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: pendingLine.phoneNumber,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_pending",
        incomingDirectAttested: false,
        incomingRecipientPhone: pendingLine.phoneNumber,
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: new Date("2026-06-30T14:15:00.000Z"),
      kind: "bind",
      recipientPhone: pendingLine.phoneNumber,
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("preserves a migrated same-phone route claim without consuming capacity", async () => {
    const line = buildLine("+15550100001", {
      activeMemberLimit: 1,
      maxNewConversationsPerDay: 1,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_old",
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockImplementation(async () => {
      throw new Error("migrated same-phone route claims must not consume daily capacity");
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockImplementation(async () => {
      throw new Error("migrated same-phone route claims must not consume active capacity");
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_new",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: null,
      kind: "bind",
      recipientPhone: line.phoneNumber,
    });
  });

  it("binds an existing direct same-phone route without consuming capacity", async () => {
    const line = buildLine("+15550100001", {
      maxNewConversationsPerDay: 1,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume daily capacity");
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume active capacity");
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_new",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: null,
      kind: "bind",
      recipientPhone: line.phoneNumber,
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("preserves an existing direct route assignment when binding the provider chat", async () => {
    const assignedAt = new Date("2026-06-29T14:15:00.000Z");
    const line = buildLine("+15550100001", {
      activeMemberLimit: 1,
      maxNewConversationsPerDay: 1,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: assignedAt,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume daily capacity");
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockImplementation(async () => {
      throw new Error("existing direct routes must not consume active capacity");
    });

    await expect(
      resolveHostedMemberLinqHomeLineRouteBindingTx({
        incomingChatId: "chat_new",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: assignedAt,
      kind: "bind",
      recipientPhone: line.phoneNumber,
    });

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).not.toHaveBeenCalled();
  });
});

function buildLine(
  phoneNumber: string,
  overrides: Partial<{
    activeMemberLimit: number | null;
    assignmentWeight: number;
    maxNewConversationsPerDay: number | null;
  }> = {},
) {
  return {
    activeMemberLimit: overrides.activeMemberLimit ?? null,
    assignmentWeight: overrides.assignmentWeight ?? 100,
    maxNewConversationsPerDay: overrides.maxNewConversationsPerDay ?? null,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
  };
}

function hashHostedLinqRouteIdentifier(
  value: string,
  secret = "hbidx:phone:v1:test",
): string {
  return hashHostedAssistantConversationIdentifier(
    createHostedAssistantConversationIdentifierBlind({
      secret,
      userId: "member_123",
    }),
    value,
  );
}

function buildMember(
  overrides: Partial<HostedMemberSnapshot["routing"]> = {},
): HostedMemberSnapshot {
  return {
    billingRef: null,
    core: {
      billingStatus: "incomplete",
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    identity: {
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:test",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    },
    routing: {
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
      ...overrides,
    },
  };
}
