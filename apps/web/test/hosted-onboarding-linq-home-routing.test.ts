import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  claimHostedLinqProactiveConversationCapacityTx: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  listHostedLinqAssignableHomeLines: vi.fn(),
  readHostedLinqRecentMessageEffectCountsTx: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx: mocks.acquireHostedMemberHomeLinqRouteLockTx,
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx: mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-planning-load", () => ({
  buildHostedLinqAssignmentPlanningMessages: (snapshot: {
    byRecipientPhone: ReadonlyMap<string, { plannedMessages: number }>;
    unprojectedGroupThreadCount: number;
  }) => new Map(
    [...snapshot.byRecipientPhone].map(([recipientPhone, load]) => [
      recipientPhone,
      load.plannedMessages + snapshot.unprojectedGroupThreadCount * 25,
    ]),
  ),
  readHostedLinqLinePlanningLoadSnapshot: vi.fn(async (input: {
    excludedActiveMemberId?: string | null;
    lines: ReadonlyArray<{
      phoneNumber: string;
    }>;
    now: Date;
    prisma: unknown;
  }) => {
    const activeMembers =
      await mocks.countHostedMemberHomeLinqBindingsByRecipientPhone({
        ...(input.excludedActiveMemberId
          ? { excludedMemberId: input.excludedActiveMemberId }
          : {}),
        now: input.now,
        prisma: input.prisma,
        recipientPhones: input.lines.map((line) => line.phoneNumber),
      });
    return {
      byRecipientPhone: new Map(input.lines.map((line) => {
        const activeMemberCount = activeMembers.get(line.phoneNumber) ?? 0;
        return [
          line.phoneNumber,
          {
            activeDirectMemberCount: activeMemberCount,
            plannedMessages: activeMemberCount * 10,
            provisionedGroupThreadCount: 0,
          },
        ] as const;
      })),
      projectionCoverageComplete: true,
      unprojectedGroupThreadCount: 0,
    };
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  claimHostedLinqProactiveConversationCapacityTx:
    mocks.claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqAssignableHomeLines: mocks.listHostedLinqAssignableHomeLines,
  readHostedLinqRecentMessageEffectCountsTx:
    mocks.readHostedLinqRecentMessageEffectCountsTx,
}));

import {
  materializeHostedSignupWelcomeHomeRouteTx,
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHomeLineFromPoolTx,
  resolveHostedMemberLinqHomeLineRouteBindingTx,
  resolveHostedMemberActivationLinqRoute,
  startOfUtcDay,
} from "@/src/lib/hosted-onboarding/linq-home-routing";

describe("materializeHostedSignupWelcomeHomeRouteTx", () => {
  const assignedAt = new Date("2026-07-15T20:27:00.000Z");
  const directRecipientPhoneNumber = "+15550100001";
  const fromPhoneNumber = "+15550100099";
  const linqChatId = "chat_signup_welcome";
  const memberId = "member_123";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqBindingTx.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildMaterializationRouting());
  });

  it("materializes a provider-dispatched welcome chat onto the assigned home line", async () => {
    const prisma = buildMaterializationPrisma();

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).resolves.toEqual({ kind: "materialized" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledWith({
      memberId,
      prisma,
    });
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: assignedAt,
      linqChatId,
      memberId,
      participantContact: {
        kind: "phone",
        lookupKey: requireLookupKey(
          createHostedPhoneLookupKeyReadCandidates(directRecipientPhoneNumber),
        ),
      },
      prisma,
      recipientPhone: fromPhoneNumber,
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    );
    expect(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.upsertHostedMemberHomeLinqBindingTx.mock.invocationCallOrder[0],
    );
  });

  it("replays idempotently when the same chat is already the home route", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildMaterializationRouting({
      linqChatId,
    }));
    const prisma = buildMaterializationPrisma({
      acceptedAt: new Date("2026-07-15T20:28:00.000Z"),
      linqChatLookupKey: requireLookupKey(
        createHostedLinqChatLookupKeyReadCandidates(linqChatId),
      ),
    });

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).resolves.toEqual({ kind: "already_materialized" });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledTimes(1);
  });

  it("materializes a durable home line without a historical assignment timestamp", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildMaterializationRouting({
      linqHomeLineAssignedAt: null,
    }));
    const prisma = buildMaterializationPrisma();

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).resolves.toEqual({ kind: "materialized" });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        homeLineAssignedAt: null,
        linqChatId,
        memberId,
      }),
    );
  });

  it.each([
    ["home", { linqChatId: "chat_newer", pendingLinqChatId: null }],
    ["pending", { linqChatId: null, pendingLinqChatId: "chat_inbound" }],
  ])("preserves a different %s route established before a delayed callback", async (
    _kind,
    routingOverride,
  ) => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(
      buildMaterializationRouting(routingOverride),
    );
    const prisma = buildMaterializationPrisma();

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).resolves.toEqual({ kind: "superseded" });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });

  it("preserves current authority when the member phone changed after provider entry", async () => {
    const prisma = buildMaterializationPrisma({
      identityPhoneLookupKey: requireLookupKey(
        createHostedPhoneLookupKeyReadCandidates("+15550100002"),
      ),
    });

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).resolves.toEqual({ kind: "superseded" });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });

  it.each([
    ["dispatch source", { deliverySource: "webhook" }],
    ["assigned sender line", {
      deliveryPhoneNumberLookupKey: requireLookupKey(
        createHostedPhoneLookupKeyReadCandidates("+15550100098"),
      ),
    }],
    ["accepted provider chat", {
      acceptedAt: new Date("2026-07-15T20:28:00.000Z"),
      linqChatLookupKey: requireLookupKey(
        createHostedLinqChatLookupKeyReadCandidates("chat_other"),
      ),
    }],
  ])("fails closed when the %s does not match pre-provider dispatch provenance", async (
    _label,
    deliveryOverride,
  ) => {
    const prisma = buildMaterializationPrisma(deliveryOverride);

    await expect(materializeHostedSignupWelcomeHomeRouteTx({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: `signup-welcome:${memberId}`,
      linqChatId,
      memberId,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_SIGNUP_WELCOME_DELIVERY_PROVENANCE_MISMATCH",
      httpStatus: 409,
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });

  function buildMaterializationPrisma(overrides: {
    acceptedAt?: Date | null;
    deliveryPhoneNumberLookupKey?: string;
    deliverySource?: string;
    identityPhoneLookupKey?: string;
    linqChatLookupKey?: string | null;
  } = {}) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedLinqDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          acceptedAt: overrides.acceptedAt ?? null,
          linqChatLookupKey: overrides.linqChatLookupKey ?? null,
          phoneNumberLookupKey: overrides.deliveryPhoneNumberLookupKey
            ?? requireLookupKey(
              createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber),
            ),
          source: overrides.deliverySource ?? "hosted_runtime_linq_delivery",
          targetKind: "participant",
        }),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          phoneLookupKey: overrides.identityPhoneLookupKey ?? requireLookupKey(
            createHostedPhoneLookupKeyReadCandidates(directRecipientPhoneNumber),
          ),
          phoneNumberVerifiedAt: new Date("2026-07-15T20:26:00.000Z"),
        }),
      },
    };
  }

  function buildMaterializationRouting(overrides: {
    linqChatId?: string | null;
    linqHomeLineAssignedAt?: Date | null;
    pendingLinqChatId?: string | null;
  } = {}) {
    return {
      hasPendingLinqRouteState: Boolean(overrides.pendingLinqChatId),
      linqChatId: overrides.linqChatId ?? null,
      linqHomeLineAssignedAt:
        overrides.linqHomeLineAssignedAt === undefined
          ? assignedAt
          : overrides.linqHomeLineAssignedAt,
      linqParticipantContact: null,
      linqRecipientPhone: fromPhoneNumber,
      memberId,
      pendingLinqChatId: overrides.pendingLinqChatId ?? null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: overrides.pendingLinqChatId
        ? fromPhoneNumber
        : null,
      replyAliasLookupKey: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    };
  }

  function requireLookupKey(candidates: readonly string[]): string {
    const [lookupKey] = candidates;
    if (!lookupKey) {
      throw new Error("Expected a test lookup key.");
    }
    return lookupKey;
  }
});

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
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.claimHostedLinqProactiveConversationCapacityTx.mockResolvedValue(true);
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([]);
    mocks.readHostedLinqRecentMessageEffectCountsTx.mockResolvedValue(new Map());
  });

  it("reserves the preferred line when it is healthy and under quota", async () => {
    const preferredLine = buildLine("+15550100001", { maxNewConversationsPerDay: 2 });
    const fallbackLine = buildLine("+15550100002", { maxNewConversationsPerDay: 2 });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      fallbackLine,
      preferredLine,
    ]);

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

    expect(mocks.listHostedLinqAssignableHomeLines).toHaveBeenCalledTimes(1);
  });

  it("uses recent message load when selecting a genuinely new home line", async () => {
    const busyLine = buildLine("+15550100001");
    const quietLine = buildLine("+15550100002");
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      busyLine,
      quietLine,
    ]);
    mocks.readHostedLinqRecentMessageEffectCountsTx.mockResolvedValue(new Map([
      [busyLine.phoneNumberLookupKey, 9_000],
      [quietLine.phoneNumberLookupKey, 100],
    ]));

    await expect(
      reserveHostedLinqHomeLineFromPoolTx({
        preferredRecipientPhone: null,
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      kind: "reserved",
      reservation: {
        line: quietLine,
      },
    });

    expect(mocks.readHostedLinqRecentMessageEffectCountsTx).toHaveBeenCalledWith({
      lineLookupKeys: [
        busyLine.phoneNumberLookupKey,
        quietLine.phoneNumberLookupKey,
      ],
      now: expect.any(Date),
      prisma: {},
    });
  });

  it("keeps the preferred line for member-initiated routing at the proactive quota", async () => {
    const preferredLine = buildLine("+15550100001", {
      maxNewConversationsPerDay: 1,
      proactiveConversationCount: 1,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    const fallbackLine = buildLine("+15550100002", { maxNewConversationsPerDay: 1 });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      preferredLine,
      fallbackLine,
    ]);

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

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
  });

  it("keeps a healthy contacted line when planning would prefer a paced-out fallback", async () => {
    const preferredLine = buildLine("+15550100001", {
      maxNewConversationsPerDay: 1,
      proactiveConversationCount: 1,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    const fallbackLine = buildLine("+15550100002", {
      maxNewConversationsPerDay: 1,
      proactiveConversationCount: 1,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      preferredLine,
      fallbackLine,
    ]);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        [preferredLine.phoneNumber, 500],
        [fallbackLine.phoneNumber, 1],
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
        proactiveConversationReserved: false,
      },
    });

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone)
      .not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
  });

  it("selects a fallback without claiming capacity during inbound routing", async () => {
    const fallbackLine = buildLine("+15550100002", {
      maxNewConversationsPerDay: 10,
      proactiveConversationCount: 10,
      proactiveConversationDayUtc: new Date("2020-01-01T00:00:00.000Z"),
    });
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
        proactiveConversationReserved: false,
      },
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
    expect(mocks.readHostedLinqRecentMessageEffectCountsTx).not.toHaveBeenCalled();
  });

  it("keeps inbound routing available when every fallback is at its proactive limit", async () => {
    const fallbackLine = buildLine("+15550100002", {
      maxNewConversationsPerDay: 10,
      proactiveConversationCount: 10,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
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
        proactiveConversationReserved: false,
      },
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
  });

  it("leaves the final fallback claim to the participant-chat planner", async () => {
    const fallbackLine = buildLine("+15550100002", {
      maxNewConversationsPerDay: 10,
      proactiveConversationCount: 9,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
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
        proactiveConversationReserved: false,
      },
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
  });
});

describe("resolveHostedMemberActivationLinqRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.claimHostedLinqProactiveConversationCapacityTx.mockResolvedValue(true);
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([]);
    mocks.readHostedLinqRecentMessageEffectCountsTx.mockResolvedValue(new Map());
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
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:test",
      },
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.readHostedMemberRoutingState.mock.invocationCallOrder[0]);
  });

  it("keeps a legacy phone-backed home route on its existing thread", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqChatId: "chat_legacy",
          linqParticipantContact: null,
          linqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_legacy",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: hashHostedLinqRouteIdentifier("chat_legacy"),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });

  it("keeps a legacy email-only home route on its existing thread", async () => {
    const emailLookupKey = "hbidx:email:v1:legacy";
    const member = buildMember({
      linqChatId: "chat_legacy_email",
      linqParticipantContact: null,
      linqRecipientPhone: "+15550100001",
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
        address: "legacy@icloud.com",
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
          target: "chat_legacy_email",
        },
        identityId: hashHostedLinqRouteIdentifier(emailLookupKey, emailLookupKey),
        threadId: hashHostedLinqRouteIdentifier("chat_legacy_email", emailLookupKey),
        threadIsDirect: true,
      },
    });
  });

  it("keeps activation on credential-compatible identity after participant authority changes", async () => {
    const participantLookupKey = "hbidx:phone:v1:observed";
    const member = buildMember({
      linqChatId: "chat_observed",
      linqParticipantContact: {
        kind: "phone",
        lookupKey: participantLookupKey,
      },
      linqRecipientPhone: "+15550100001",
    });
    if (member.identity) {
      member.identity.phoneLookupKey = "hbidx:phone:v1:current";
      member.identity.phoneNumber = "+15551230002";
    }

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member,
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551230002", "hbidx:phone:v1:current"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_observed",
        },
        identityId: hashHostedLinqRouteIdentifier(
          "hbidx:phone:v1:current",
          "hbidx:phone:v1:current",
        ),
        threadId: hashHostedLinqRouteIdentifier(
          "chat_observed",
          "hbidx:phone:v1:current",
        ),
        threadIsDirect: true,
      },
    });
  });

  it("reserves welcome capacity for a home recipient assigned before activation", async () => {
    const line = buildLine("+15550100001");
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line]);

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

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("preserves an existing direct route assignment while reserving welcome capacity", async () => {
    const assignedAt = new Date("2026-06-29T14:15:00.000Z");
    const line = buildLine("+15550100001", {
      maxNewConversationsPerDay: 1,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line]);
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

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledWith({
      excludedMemberId: "member_123",
      now: expect.any(Date),
      prisma: {} as never,
      recipientPhones: [line.phoneNumber],
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: assignedAt,
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: line.phoneNumber,
    });
  });

  it("keeps a phone-backed pending thread on the credential-compatible identity", async () => {
    const pendingPhoneLookupKey = "hbidx:phone:v1:pending-a";
    const member = buildMember({
      pendingLinqChatId: "chat_pending",
      pendingLinqParticipantContact: {
        kind: "phone",
        lookupKey: pendingPhoneLookupKey,
        observedAt: new Date("2026-04-12T00:00:00.000Z"),
        value: "+15551230001",
      },
      pendingLinqRecipientPhone: "+15550100001",
    });
    if (member.identity) {
      member.identity.phoneLookupKey = "hbidx:phone:v1:member-b";
      member.identity.phoneNumber = "+15551230002";
    }

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member,
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551230002", "hbidx:phone:v1:member-b"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
        identityId: hashHostedLinqRouteIdentifier(
          "hbidx:phone:v1:member-b",
          "hbidx:phone:v1:member-b",
        ),
        threadId: hashHostedLinqRouteIdentifier(
          "chat_pending",
          "hbidx:phone:v1:member-b",
        ),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      participantContact: {
        kind: "phone",
        lookupKey: pendingPhoneLookupKey,
      },
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
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending_email",
      memberId: "member_123",
      participantContact: {
        kind: "email",
        lookupKey: emailLookupKey,
      },
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

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:test",
      },
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
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:test",
      },
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

    // The existing pending route is durable authority: the locked decision
    // does not read the pool or claim new capacity.
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      participantContact: {
        kind: "phone",
        lookupKey: "hbidx:phone:v1:test",
      },
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("assigns the pooled home line and builds a first-contact welcome route when there is no reusable pending thread", async () => {
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      buildLine("+15550100001"),
      buildLine("+15550100002"),
    ]);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        ["+15550100001", 3],
        ["+15550100002", 1],
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
    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.readHostedMemberRoutingState.mock.invocationCallOrder[0]);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100002",
    });
  });

  it("uses the route read after taking the member lock without claiming capacity", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildMember({
      linqChatId: "chat_concurrent",
      linqRecipientPhone: "+15550100001",
    }).routing);

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "thread",
          target: "chat_concurrent",
        },
      },
    });

    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("falls back to another line when the preferred line reaches 50 proactive conversations", async () => {
    const assignedAt = new Date("2026-07-15T12:00:00.000Z");
    const dayUtc = startOfUtcDay(new Date());
    const preferredLine = buildLine("+15550100001", {
      proactiveConversationCount: 50,
      proactiveConversationDayUtc: dayUtc,
    });
    const fallbackLine = buildLine("+15550100002", {
      proactiveConversationCount: 4,
      proactiveConversationDayUtc: dayUtc,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([
      preferredLine,
      fallbackLine,
    ]);
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqHomeLineAssignedAt: assignedAt,
          linqRecipientPhone: preferredLine.phoneNumber,
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          source: {
            fromPhoneNumber: fallbackLine.phoneNumber,
            kind: "linq",
          },
        },
      },
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).toHaveBeenCalledWith({
      dayUtc: expect.any(Date),
      limit: 50,
      phoneNumberLookupKey: fallbackLine.phoneNumberLookupKey,
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: fallbackLine.phoneNumber,
    });
    expect(
      mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mock.calls[0]?.[0]
        ?.homeLineAssignedAt,
    ).not.toEqual(assignedAt);
  });

  it("retries the same line once when a rollover claim loses but capacity remains", async () => {
    const line = buildLine("+15550100001", {
      proactiveConversationCount: 0,
      proactiveConversationDayUtc: new Date("2026-07-22T00:00:00.000Z"),
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line]);
    mocks.claimHostedLinqProactiveConversationCapacityTx
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          source: {
            fromPhoneNumber: line.phoneNumber,
          },
        },
      },
    });

    expect(
      mocks.claimHostedLinqProactiveConversationCapacityTx,
    ).toHaveBeenCalledTimes(2);
  });

  it("tries another line when an atomic capacity claim loses twice", async () => {
    const fallbackLine = buildLine("+15550100002", {
      proactiveConversationCount: 4,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    const line = buildLine("+15550100001", {
      proactiveConversationCount: 49,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line, fallbackLine]);
    mocks.claimHostedLinqProactiveConversationCapacityTx
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqRecipientPhone: line.phoneNumber,
        }),
        prisma: {} as never,
      }),
    ).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          source: {
            fromPhoneNumber: fallbackLine.phoneNumber,
          },
        },
      },
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).toHaveBeenNthCalledWith(1, {
      dayUtc: expect.any(Date),
      limit: 50,
      phoneNumberLookupKey: line.phoneNumberLookupKey,
      prisma: {} as never,
    });
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).toHaveBeenNthCalledWith(2, {
      dayUtc: expect.any(Date),
      limit: 50,
      phoneNumberLookupKey: line.phoneNumberLookupKey,
      prisma: {} as never,
    });
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).toHaveBeenNthCalledWith(3, {
      dayUtc: expect.any(Date),
      limit: 50,
      phoneNumberLookupKey: fallbackLine.phoneNumberLookupKey,
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: fallbackLine.phoneNumber,
    });
    expect(
      mocks.claimHostedLinqProactiveConversationCapacityTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mock.invocationCallOrder[0],
    );
  });

  it("keeps the home assignment but suppresses the welcome when every atomic claim loses", async () => {
    const line = buildLine("+15550100001", {
      proactiveConversationCount: 49,
      proactiveConversationDayUtc: startOfUtcDay(new Date()),
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([line]);
    mocks.claimHostedLinqProactiveConversationCapacityTx.mockResolvedValue(false);

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: null,
    });

    expect(
      mocks.claimHostedLinqProactiveConversationCapacityTx,
    ).toHaveBeenCalledTimes(2);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: line.phoneNumber,
    });
    expect(
      mocks.claimHostedLinqProactiveConversationCapacityTx.mock.invocationCallOrder[1],
    ).toBeLessThan(
      mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mock.invocationCallOrder[0],
    );
  });

  it("assigns a home line but suppresses the welcome when every line is at the hard cap", async () => {
    const dayUtc = startOfUtcDay(new Date());
    const firstLine = buildLine("+15550100001", {
      proactiveConversationCount: 50,
      proactiveConversationDayUtc: dayUtc,
    });
    const secondLine = buildLine("+15550100002", {
      proactiveConversationCount: 50,
      proactiveConversationDayUtc: dayUtc,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([firstLine, secondLine]);
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: null,
    });

    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: firstLine.phoneNumber,
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

  it("allows companion activation to continue without an assignable proactive line", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        allowNoAssignableLine: true,
        member: buildMember(),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: null,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx)
      .not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });

  it("keeps maximum-cardinality assignment set-based and bounded", async () => {
    const lines = Array.from({ length: 250 }, (_, index) =>
      buildLine(`+15552${String(index).padStart(6, "0")}`)
    );
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue(lines);

    await expect(resolveHostedMemberActivationLinqRoute({
      member: buildMember(),
      prisma: {} as never,
    })).resolves.toMatchObject({
      welcomeRoute: {
        delivery: {
          kind: "participant",
        },
      },
    });

    expect(mocks.listHostedLinqAssignableHomeLines).toHaveBeenCalledOnce();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone)
      .toHaveBeenCalledOnce();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone)
      .toHaveBeenCalledWith(expect.objectContaining({
        recipientPhones: lines.map((line) => line.phoneNumber),
      }));
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx)
      .toHaveBeenCalledOnce();
  });

  it("bounds maximum-cardinality capacity contention to two claims per line", async () => {
    const lines = Array.from({ length: 250 }, (_, index) =>
      buildLine(`+15553${String(index).padStart(6, "0")}`)
    );
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue(lines);
    mocks.claimHostedLinqProactiveConversationCapacityTx.mockResolvedValue(false);

    await expect(resolveHostedMemberActivationLinqRoute({
      member: buildMember(),
      prisma: {} as never,
    })).resolves.toEqual({
      welcomeRoute: null,
    });

    expect(mocks.listHostedLinqAssignableHomeLines).toHaveBeenCalledOnce();
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone)
      .toHaveBeenCalledOnce();
    expect(mocks.readHostedLinqRecentMessageEffectCountsTx).toHaveBeenCalledOnce();
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx)
      .toHaveBeenCalledTimes(500);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledOnce();
  });
});

describe("resolveHostedMemberLinqHomeLineRouteBindingTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.claimHostedLinqProactiveConversationCapacityTx.mockResolvedValue(true);
    mocks.readHostedLinqRecentMessageEffectCountsTx.mockResolvedValue(new Map());
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

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("resolves an already-bound home chat under the member lock", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      hasPendingLinqRouteState: false,
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
    });

    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {} as never,
    });
  });

  it("returns the former home chat when the same assigned line binds a new direct chat", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      hasPendingLinqRouteState: false,
      linqChatId: "chat_previous",
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
        incomingChatId: "chat_current",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
        memberId: "member_123",
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      homeLineAssignedAt: assignedAt,
      kind: "bind",
      recipientPhone: "+15550100001",
    });
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

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("acquires the member lock before reserving a new assignment", async () => {
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
    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.readHostedMemberRoutingState.mock.invocationCallOrder[0]);
    expect(mocks.claimHostedLinqProactiveConversationCapacityTx).not.toHaveBeenCalled();
  });

  it("resolves the route after taking the member lock", async () => {
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

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledTimes(1);
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

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("reuses an existing same-phone route claim when the chat id changes", async () => {
    const assignedAt = new Date("2026-06-30T14:15:00.000Z");
    const line = buildLine("+15550100001", {
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

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("preserves a migrated same-phone route claim without consuming capacity", async () => {
    const line = buildLine("+15550100001", {
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

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
  });

  it("preserves an existing direct route assignment when binding the provider chat", async () => {
    const assignedAt = new Date("2026-06-29T14:15:00.000Z");
    const line = buildLine("+15550100001", {
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
  });
});

function buildLine(
  phoneNumber: string,
  overrides: Partial<{
    assignmentWeight: number;
    maxNewConversationsPerDay: number | null;
    proactiveConversationCount: number | null;
    proactiveConversationDayUtc: Date | null;
  }> = {},
) {
  return {
    assignmentWeight: overrides.assignmentWeight ?? 100,
    maxNewConversationsPerDay: overrides.maxNewConversationsPerDay ?? null,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
    proactiveConversationCount: overrides.proactiveConversationCount ?? null,
    proactiveConversationDayUtc: overrides.proactiveConversationDayUtc ?? null,
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
  overrides: Partial<NonNullable<HostedMemberSnapshot["routing"]>> = {},
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
      linqParticipantContact: overrides.linqChatId
        ? {
            kind: "phone",
            lookupKey: "hbidx:phone:v1:test",
          }
        : null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: overrides.pendingLinqChatId
        ? {
            kind: "phone",
            lookupKey: "hbidx:phone:v1:test",
            observedAt: new Date("2026-04-12T00:00:00.000Z"),
            value: "+15551234567",
          }
        : null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
      ...overrides,
    },
  };
}
