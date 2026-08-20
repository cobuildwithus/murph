import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateMoment: vi.fn(),
  appendMailbox: vi.fn(),
  hasCustomizationAuthority: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  projectTarget: vi.fn(),
  readMailboxItem: vi.fn(),
  readAuthorizationByPurchase: vi.fn(),
  readMoment: vi.fn(),
  resolveDestination: vi.fn(),
  signalRuntime: vi.fn(),
  withMemberLock: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendMailbox,
  readHostedMailboxItemByDedupeKey: mocks.readMailboxItem,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  withHostedMemberStripeMutationLock: mocks.withMemberLock,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-status-service", () => ({
  projectHostedUsageCreditPurchaseTarget: mocks.projectTarget,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: (value: {
    conversationShape: string;
  }) => value.conversationShape === "thread-container",
  resolveHostedAssistantNotificationDestination: mocks.resolveDestination,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-store", () => ({
  activateHostedGroupSponsorshipMomentTx: mocks.activateMoment,
  hasHostedGroupSponsorshipCustomizationAuthority:
    mocks.hasCustomizationAuthority,
  readHostedGroupSponsorshipMomentForNotification: mocks.readMoment,
}));

vi.mock(
  "@/src/lib/hosted-groups/group-sponsorship-authorization",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/hosted-groups/group-sponsorship-authorization")
    >();
    return {
      ...actual,
      readHostedGroupSponsorshipAuthorizationByPurchase:
        mocks.readAuthorizationByPurchase,
    };
  },
);

import {
  materializeHostedGroupSponsorshipIfApplicable,
  materializeHostedGroupSponsorshipRecoveryNotification,
} from "@/src/lib/hosted-groups/group-sponsorship-notification";

const PAID_AT = new Date("2026-07-27T12:00:00.000Z");
const DIRECT_DESTINATION = {
  conversationShape: "direct-member" as const,
  externalThreadRouteAuthority: null,
  route: {
    actorId: "member_sponsor",
    channel: "telegram" as const,
    delivery: { kind: "thread" as const, target: "telegram_direct" },
    identityId: "identity_sponsor",
    threadId: "thread_direct",
    threadIsDirect: true,
  },
};

const DESTINATION = {
  conversationShape: "thread-container" as const,
  externalThreadRouteAuthority: {
    channel: "telegram" as const,
    containerMemberId: "member_group_runtime",
    threadId: "telegram_group",
  },
  route: {
    actorId: null,
    channel: "telegram" as const,
    delivery: { kind: "thread" as const, target: "telegram_group" },
    identityId: "identity_group",
    threadId: "thread_group",
    threadIsDirect: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activateMoment.mockResolvedValue(undefined);
  mocks.appendMailbox.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: { id: "mailbox_item" },
  });
  mocks.hasCustomizationAuthority.mockResolvedValue(true);
  mocks.lockHostedMemberRow.mockResolvedValue(undefined);
  mocks.projectTarget.mockReturnValue({ kind: "group" });
  mocks.readAuthorizationByPurchase.mockResolvedValue(null);
  mocks.readMailboxItem.mockResolvedValue(null);
  mocks.readMoment.mockResolvedValue({
    celebrationScale: "medium",
    creativeRequest: {
      format: "song",
      prompt: "For whatever adventure comes next.",
      styleRequest: "Warm ensemble-sitcom theme with a bright acoustic intro.",
    },
    expiresAt: new Date("2026-07-28T12:00:00.000Z"),
    publicAlias: "The Group Historian",
    runningBitRequest: "Treat me like the exhausted CFO.",
    sponsorMessage: null,
  });
  mocks.resolveDestination.mockResolvedValue(DESTINATION);
  mocks.signalRuntime.mockResolvedValue(undefined);
  mocks.withMemberLock.mockImplementation(async (input: {
    prisma: unknown;
    run: (tx: unknown) => Promise<unknown>;
  }) => input.run(input.prisma));
});

describe("group sponsorship notification", () => {
  it("queues one exact-group creative thank-you after verified fulfillment", async () => {
    const prisma = createPrismaHarness();

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      now: new Date("2026-07-27T12:05:00.000Z"),
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.withMemberLock).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member_group_runtime",
      prisma,
    }));
    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      activatedAt: PAID_AT,
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      purchaseId: "purchase_private_123",
    }));
    const envelope = mocks.appendMailbox.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken: expect.stringMatching(
          /^group-sponsorship:v1:[a-f0-9]{40}$/u,
        ),
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: expect.stringMatching(
          /^group-sponsorship:v1:[a-f0-9]{40}$/u,
        ),
        externalThreadRouteAuthority:
          DESTINATION.externalThreadRouteAuthority,
        notificationPromptProfile: "creative-response",
        responsePolicy: { kind: "require_send" },
        route: DESTINATION.route,
      },
      userId: "member_group_runtime",
    });
    expect(envelope.notification.notificationPromptProfile).toBe(
      "creative-response",
    );
    expect(envelope.notification.instructions).toContain(
      '"publicAlias":"The Group Historian"',
    );
    expect(envelope.notification.instructions).toContain(
      "credit it once and naturally",
    );
    expect(envelope.notification.instructions).toContain(
      "untrusted participant-authored creative material",
    );
    expect(envelope.notification.instructions).toContain(
      "urgent, medical, serious, sensitive, or conflict-heavy",
    );
    expect(envelope.notification.instructions).toContain(
      "calling murph.generate_song exactly once",
    );
    expect(envelope.notification.instructions).toContain(
      "current group conversation",
    );
    expect(envelope.notification.instructions).toContain(
      "a surprising hook that could only belong to this group",
    );
    expect(envelope.notification.instructions).toContain(
      "prefer it as the creative seed and blend it with the current conversation",
    );
    expect(envelope.notification.instructions).toContain(
      '"styleRequest":"Warm ensemble-sitcom theme with a bright acoustic intro."',
    );
    expect(envelope.notification.instructions).toContain(
      "translate any named song, show, soundtrack, artist, or genre into broad traits",
    );
    expect(envelope.notification.instructions).not.toContain(
      "unless it is independently part of the group's premise",
    );
    expect(envelope.notification.instructions).toContain(
      "without inventing personal facts or referring to sensitive history",
    );
    expect(envelope.notification.instructions).toContain(
      "fill the song naturally instead of treating it as a short sting",
    );
    expect(envelope.notification.instructions).toContain(
      "Do not use music-note emoji",
    );
    expect(envelope.notification.instructions).not.toContain("5–15 seconds");
    expect(envelope.notification.instructions).toContain(
      "gentle, respectful, and non-comedic",
    );
    expect(JSON.stringify(envelope)).not.toContain("purchase_private_123");
    expect(envelope.notification).not.toHaveProperty("amount");
    expect(envelope.notification).not.toHaveProperty("offerCode");
    expect(mocks.signalRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_item",
      prisma,
    });
  });

  it("keeps an explicit quiet sponsorship silent while still activating its moment", async () => {
    const prisma = createPrismaHarness();
    mocks.readMoment.mockResolvedValueOnce({
      celebrationScale: "medium",
      expiresAt: null,
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: null,
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      purchaseId: "purchase_private_123",
    }));
    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
    expect(mocks.signalRuntime).not.toHaveBeenCalled();
  });

  it.each(["message", "poem"] as const)(
    "queues a requested %s without asking for song generation",
    async (format) => {
      const prisma = createPrismaHarness();
      mocks.readMoment.mockResolvedValueOnce({
        celebrationScale: "small",
        creativeRequest: {
          format,
          prompt: "Celebrate the group finishing the challenge.",
          styleRequest: null,
        },
        expiresAt: null,
        publicAlias: null,
        runningBitRequest: null,
        sponsorMessage: null,
      });

      await expect(materializeHostedGroupSponsorshipIfApplicable({
        prisma: prisma as never,
        purchaseId: "purchase_private_123",
      })).resolves.toBe(true);

      const notification =
        mocks.appendMailbox.mock.calls[0]?.[0]?.envelope.notification;
      const instructions = notification.instructions;
      expect(notification.notificationPromptProfile).toBe(
        "creative-response-text",
      );
      expect(instructions).toContain(`Validated creative format: ${format}.`);
      expect(instructions).toContain("Do not call a tool");
      expect(instructions).not.toContain(
        "calling murph.generate_song exactly once",
      );
    },
  );

  it("keeps a legacy sponsorship row silent without an explicit creative request", async () => {
    const prisma = createPrismaHarness();
    mocks.readMoment.mockResolvedValueOnce({
      celebrationScale: "small",
      expiresAt: null,
      publicAlias: null,
      runningBitRequest: null,
      sponsorMessage: null,
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
    expect(mocks.signalRuntime).not.toHaveBeenCalled();
  });

  it("uses the actual $5 activation for the public moment, not the private monthly maximum", async () => {
    const prisma = createPrismaHarness({
      chargeOrdinal: 0,
      monthlyCapMinor: 2_000,
      offerCode: "usage_5_usd",
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      offerCode: "usage_5_usd",
    }));
    expect(mocks.readMoment).toHaveBeenCalledWith(expect.objectContaining({
      offerCode: "usage_5_usd",
    }));
  });

  it("re-signals an existing item without rebuilding participant content", async () => {
    const prisma = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      id: "mailbox_existing",
      kind: "assistant.notification.requested",
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.withMemberLock).not.toHaveBeenCalled();
    expect(mocks.readMoment).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
    expect(mocks.signalRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_existing",
      prisma,
    });
  });

  it("suppresses new creative content when participant authority expired", async () => {
    const prisma = createPrismaHarness();
    mocks.hasCustomizationAuthority.mockResolvedValueOnce(false);
    mocks.readMoment.mockResolvedValueOnce({
      celebrationScale: "medium",
      expiresAt: null,
      publicAlias: null,
      runningBitRequest: null,
      sponsorMessage: null,
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.activateMoment).toHaveBeenCalledWith(expect.objectContaining({
      customContentAuthorized: false,
    }));
    expect(mocks.readMoment).toHaveBeenCalledWith(expect.objectContaining({
      customContentAuthorized: false,
    }));
    expect(mocks.resolveDestination).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it.each([
    {
      currentOverrides: { targetKind: "personal" as const },
      destination: DESTINATION,
      reason: "purchase target is not a group",
    },
    {
      currentOverrides: {},
      destination: {
        ...DESTINATION,
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route: { ...DESTINATION.route, threadIsDirect: true },
      },
      reason: "only a direct fallback exists",
    },
  ])("does not notify when $reason", async ({
    currentOverrides,
    destination,
  }) => {
    const prisma = createPrismaHarness(currentOverrides);
    mocks.projectTarget.mockReturnValueOnce({
      kind: currentOverrides.targetKind ?? "group",
    });
    mocks.resolveDestination.mockReset();
    mocks.resolveDestination.mockResolvedValue(destination);

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.appendMailbox).not.toHaveBeenCalled();
  });

  it("keeps automatic refill fulfillment silent", async () => {
    const prisma = createPrismaHarness({
      chargeOrdinal: 1,
      hasMoment: false,
      monthlyCapMinor: 1_000,
      offerCode: "usage_5_usd",
    });

    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    expect(mocks.activateMoment).not.toHaveBeenCalled();
    expect(mocks.appendMailbox).not.toHaveBeenCalled();
    expect(mocks.resolveDestination).not.toHaveBeenCalled();
  });

  it("sends payment recovery privately and never to a thread container", async () => {
    const prisma = createPrismaHarness({
      authorizationStatus:
        HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    });
    mocks.readAuthorizationByPurchase.mockResolvedValue({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargeOrdinal: 1,
      monthlyCapMinor: 1_000,
      payerMemberId: "member_sponsor",
      periodStartedAt: new Date("2026-07-27T12:00:00.000Z"),
    });
    mocks.resolveDestination.mockResolvedValueOnce(DESTINATION);
    await expect(materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);
    expect(mocks.appendMailbox).not.toHaveBeenCalled();

    mocks.resolveDestination.mockResolvedValueOnce(DIRECT_DESTINATION);
    await expect(materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);
    expect(mocks.appendMailbox.mock.calls[0]?.[0]?.envelope.userId).toBe(
      "member_sponsor",
    );
  });

  it("materializes exactly one recovery notice after a transient first append failure", async () => {
    const prisma = createPrismaHarness({
      authorizationStatus:
        HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    });
    mocks.readAuthorizationByPurchase.mockResolvedValue({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargeOrdinal: 1,
      monthlyCapMinor: 1_000,
      payerMemberId: "member_sponsor",
      periodStartedAt: new Date("2026-07-27T12:00:00.000Z"),
    });
    mocks.resolveDestination.mockResolvedValue(DIRECT_DESTINATION);
    mocks.appendMailbox
      .mockRejectedValueOnce(new Error("mailbox unavailable"))
      .mockResolvedValueOnce({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: { id: "mailbox_recovered" },
      });

    await expect(materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).rejects.toThrow("mailbox unavailable");
    await expect(materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(true);

    expect(mocks.appendMailbox).toHaveBeenCalledTimes(2);
    expect(mocks.signalRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_sponsor",
      mailboxItemId: "mailbox_recovered",
      prisma,
    });
  });

  it("uses a fresh recovery notice identity for a later failed refill", async () => {
    const prisma = createPrismaHarness({
      authorizationStatus:
        HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    });
    mocks.readAuthorizationByPurchase.mockResolvedValue({
      authorizationId: "hgsa_abcdefghijklmnop",
      chargeOrdinal: 1,
      monthlyCapMinor: 2_000,
      payerMemberId: "member_sponsor",
      periodStartedAt: new Date("2026-07-27T12:00:00.000Z"),
    });
    mocks.resolveDestination.mockResolvedValue(DIRECT_DESTINATION);

    await materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_failed_1",
    });
    await materializeHostedGroupSponsorshipRecoveryNotification({
      prisma: prisma as never,
      purchaseId: "purchase_failed_2",
    });

    const keys = new Set(mocks.readMailboxItem.mock.calls.map(
      ([input]) => input.dedupeKey,
    ));
    expect(keys.size).toBe(2);
    for (const key of keys) {
      expect(key).toMatch(/^assistant\.notification\.requested:/u);
    }
  });

  it("does nothing before fulfillment and rejects a conflicting mailbox identity", async () => {
    const pending = createPrismaHarness({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });
    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: pending as never,
      purchaseId: "purchase_private_123",
    })).resolves.toBe(false);

    const fulfilled = createPrismaHarness();
    mocks.readMailboxItem.mockResolvedValueOnce({
      id: "mailbox_conflict",
      kind: "conversation.message",
    });
    await expect(materializeHostedGroupSponsorshipIfApplicable({
      prisma: fulfilled as never,
      purchaseId: "purchase_private_123",
    })).rejects.toThrow(/belongs to another mailbox kind/u);
  });
});

function createPrismaHarness(input: {
  authorizationStatus?: HostedGroupSponsorshipAuthorizationStatus;
  chargeOrdinal?: number;
  hasMoment?: boolean;
  monthlyCapMinor?: 500 | 1_000 | 2_000;
  offerCode?: "usage_5_usd" | "usage_10_usd";
  status?: HostedUsageCreditPurchaseStatus;
  targetKind?: "group" | "personal";
} = {}) {
  const status = input.status ?? HostedUsageCreditPurchaseStatus.fulfilled;
  const periodStartedAt = new Date("2026-07-27T12:00:00.000Z");
  const monthlyCapMinor = input.monthlyCapMinor
    ?? (input.authorizationStatus === undefined ? null : 1_000);
  const authorization = monthlyCapMinor === null
    ? null
    : {
        beneficiaryMemberId: "member_group_runtime",
        monthlyCapMinor,
        payerMemberId: "member_sponsor",
        status: input.authorizationStatus
          ?? HostedGroupSponsorshipAuthorizationStatus.active,
      };
  const purchase = {
    beneficiaryMemberId: "member_group_runtime",
    groupSponsorshipAuthorization: authorization,
    groupSponsorshipAuthorizationId: authorization
      ? "hgsa_abcdefghijklmnop"
      : null,
    groupSponsorshipChargeOrdinal: authorization
      ? input.chargeOrdinal ?? 0
      : null,
    groupSponsorshipMoment: input.hasMoment === false
      ? null
      : { creatorMemberId: "member_sponsor" },
    groupSponsorshipPeriodStartedAt: authorization ? periodStartedAt : null,
    id: "purchase_private_123",
    offerCode: input.offerCode ?? "usage_10_usd",
    paidAt: PAID_AT,
    payerMemberId: "member_sponsor",
    status,
    targetKind: input.targetKind ?? "group",
  };
  type PrismaHarness = {
    $transaction: ReturnType<typeof vi.fn>;
    hostedGroupSponsorshipAuthorization: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    hostedUsageCreditPurchase: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  const prisma: PrismaHarness = {
    $transaction: vi.fn(),
    hostedGroupSponsorshipAuthorization: {
      findUnique: vi.fn(async () => authorization),
    },
    hostedUsageCreditPurchase: {
      findUnique: vi.fn(async () => purchase),
    },
  };
  prisma.$transaction.mockImplementation(async (
    run: (tx: PrismaHarness) => Promise<unknown>,
  ) => run(prisma));
  return prisma;
}
