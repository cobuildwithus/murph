import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMailbox: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readMailboxItem: vi.fn(),
  readAuthorizationByPurchase: vi.fn(),
  resolveDestination: vi.fn(),
  signalRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendMailbox,
  readHostedMailboxItemByDedupeKey: mocks.readMailboxItem,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalRuntime,
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

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: (value: {
    conversationShape: string;
  }) => value.conversationShape === "thread-container",
  resolveHostedAssistantNotificationDestination: mocks.resolveDestination,
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
  materializeHostedGroupSponsorshipRecoveryNotification,
} from "@/src/lib/hosted-groups/group-sponsorship-notification";
import type {
  HostedGroupSponsorshipMonthlyCapMinor,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";

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
  mocks.appendMailbox.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: { id: "mailbox_item" },
  });
  mocks.lockHostedMemberRow.mockResolvedValue(undefined);
  mocks.readAuthorizationByPurchase.mockResolvedValue(null);
  mocks.readMailboxItem.mockResolvedValue(null);
  mocks.resolveDestination.mockResolvedValue(DESTINATION);
  mocks.signalRuntime.mockResolvedValue(undefined);
});

describe("group sponsorship notification", () => {
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

});

function createPrismaHarness(input: {
  authorizationStatus?: HostedGroupSponsorshipAuthorizationStatus;
  chargeOrdinal?: number;
  monthlyCapMinor?: HostedGroupSponsorshipMonthlyCapMinor;
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
