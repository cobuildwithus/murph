import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedUsageCreditStripePriceMatchesPurchase: vi.fn(),
  buildHostedGroupSponsorshipPaymentAuthority: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  markHostedGroupSponsorshipRecoveryRequiredForPurchase: vi.fn(),
  materializeHostedGroupSponsorshipRecoveryNotification: vi.fn(),
  reconstructHostedUsageCreditStripeCheckoutRequest: vi.fn(),
  requireHostedStripeApiMode: vi.fn(),
  tryChargeHostedUsageCreditSavedCard: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApiMode: mocks.requireHostedStripeApiMode,
}));
vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
}));
vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >();
  return { ...actual, lockHostedMemberRow: vi.fn(async () => undefined) };
});
vi.mock("@/src/lib/hosted-onboarding/usage-credit-saved-card-payment", () => ({
  tryChargeHostedUsageCreditSavedCard:
    mocks.tryChargeHostedUsageCreditSavedCard,
}));
vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  buildHostedGroupSponsorshipPaymentAuthority:
    mocks.buildHostedGroupSponsorshipPaymentAuthority,
}));
vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-stripe", async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/usage-credit-purchase-stripe")
  >();
  return {
    ...actual,
    assertHostedUsageCreditStripePriceMatchesPurchase:
      mocks.assertHostedUsageCreditStripePriceMatchesPurchase,
    reconstructHostedUsageCreditStripeCheckoutRequest:
      mocks.reconstructHostedUsageCreditStripeCheckoutRequest,
  };
});
vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  markHostedGroupSponsorshipRecoveryRequiredForPurchase:
    mocks.markHostedGroupSponsorshipRecoveryRequiredForPurchase,
}));
vi.mock("@/src/lib/hosted-groups/group-sponsorship-notification", () => ({
  materializeHostedGroupSponsorshipRecoveryNotification:
    mocks.materializeHostedGroupSponsorshipRecoveryNotification,
}));

import {
  dispatchHostedGroupSponsorshipRefills,
} from "@/src/lib/hosted-groups/group-sponsorship-refill-dispatch";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const basePurchase = {
  beneficiaryMemberId: "member_group_runtime",
  cashAmountMinor: 500,
  cashCurrency: "usd",
  checkoutCancelUrl: "https://www.withmurph.ai/groups/fund/group",
  checkoutExpiresAt: new Date("2026-08-30T12:00:00.000Z"),
  checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v4",
  checkoutSuccessUrl: "https://www.withmurph.ai/groups/fund/group",
  clientRequestKey: "request_key_1234567890",
  createdAt: NOW,
  grantUsdMicros: 5_000_000n,
  groupSponsorshipAuthorizationId: "hgsa_abcdefghijklmnop",
  groupSponsorshipChargeOrdinal: 1,
  groupSponsorshipPeriodStartedAt: new Date("2026-07-30T10:00:00.000Z"),
  id: "hucp_abcdefghijklmnop",
  lastReconciledAt: null as Date | null,
  offerCode: "usage_5_usd",
  paidAt: null,
  payerMemberId: "member_payer",
  reconciliationVersion: 0n,
  remainingCreditUsdMicros: 0n,
  status:
    HostedUsageCreditPurchaseStatus.created as HostedUsageCreditPurchaseStatus,
  stripeChargeIdEncrypted: null,
  stripeChargeLookupKey: null,
  stripeCheckoutSessionIdEncrypted: null,
  stripeCheckoutSessionLookupKey: null,
  stripeCheckoutUrlEncrypted: null,
  stripeCustomerIdEncrypted: "sealed_customer",
  stripeCustomerLookupKey: "customer_lookup",
  stripeLiveMode: false,
  stripePaymentIntentIdEncrypted: null as string | null,
  stripePaymentIntentLookupKey: null as string | null,
  stripePriceIdEncrypted: "sealed_price",
  stripePriceLookupKey: "price_lookup",
  terminalAt: null as Date | null,
  updatedAt: NOW,
};

type PurchaseRow = typeof basePurchase & {
  authorizationStatus: HostedGroupSponsorshipAuthorizationStatus;
};

function buildPurchase(overrides: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    ...basePurchase,
    authorizationStatus: HostedGroupSponsorshipAuthorizationStatus.active,
    ...overrides,
  };
}

function createPrisma(initialRows: PurchaseRow[] = [buildPurchase()]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const updateMany = vi.fn(async ({ data, where }: {
    data: Record<string, unknown>;
    where: {
      id?: string;
      status?: HostedUsageCreditPurchaseStatus | {
        in: readonly HostedUsageCreditPurchaseStatus[];
      };
    };
  }) => {
    let count = 0;
    for (const row of rows) {
      const statusMatches = where.status === undefined ||
        (typeof where.status === "string"
          ? row.status === where.status
          : where.status.in.includes(row.status));
      if ((where.id === undefined || row.id === where.id) && statusMatches) {
        for (const [key, value] of Object.entries(data)) {
          if (
            key === "reconciliationVersion" &&
            value !== null &&
            typeof value === "object" &&
            "increment" in value
          ) {
            row.reconciliationVersion += BigInt(String(value.increment));
            continue;
          }
          Object.assign(row, { [key]: value });
        }
        count += 1;
      }
    }
    return { count };
  });
  const prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    hostedUsageCreditPurchase: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: typeof updateMany;
    };
  } = {
    $transaction: vi.fn(),
    hostedUsageCreditPurchase: {
      findMany: vi.fn(async ({ take, where }: {
        take: number;
        where: {
          status?: HostedUsageCreditPurchaseStatus;
        };
      }) => {
        const recovery = where.status ===
          HostedUsageCreditPurchaseStatus.payment_failed;
        return rows
          .filter((row) => recovery
            ? row.status === HostedUsageCreditPurchaseStatus.payment_failed &&
              row.authorizationStatus ===
                HostedGroupSponsorshipAuthorizationStatus.recovery_required
            : row.groupSponsorshipChargeOrdinal > 0 &&
              (
                row.status === HostedUsageCreditPurchaseStatus.created ||
                row.status === HostedUsageCreditPurchaseStatus.payment_pending
              ))
          .sort((left, right) => {
            const leftAttempt = left.lastReconciledAt?.getTime() ?? -1;
            const rightAttempt = right.lastReconciledAt?.getTime() ?? -1;
            return leftAttempt - rightAttempt ||
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id);
          })
          .slice(0, take);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null),
      updateMany,
    },
  };
  prisma.$transaction.mockImplementation(
    async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  return { prisma, rows, updateMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHostedStripeApiMode.mockReturnValue({
    stripe: { label: "stripe" },
    stripeLiveMode: false,
  });
  mocks.buildHostedGroupSponsorshipPaymentAuthority.mockImplementation(
    ({ purchase }: { purchase: PurchaseRow }) => ({
      authorizationId: purchase.groupSponsorshipAuthorizationId,
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      chargeOrdinal: purchase.groupSponsorshipChargeOrdinal,
      mode: "automatic",
      periodStartedAt: purchase.groupSponsorshipPeriodStartedAt,
    }),
  );
  mocks.reconstructHostedUsageCreditStripeCheckoutRequest.mockResolvedValue({
    customer: "cus_123",
  });
  mocks.assertHostedUsageCreditStripePriceMatchesPurchase.mockResolvedValue(
    undefined,
  );
  mocks.materializeHostedGroupSponsorshipRecoveryNotification.mockResolvedValue(
    true,
  );
});

describe("hosted group sponsorship refill dispatch", () => {
  it.each([
    HostedUsageCreditPurchaseStatus.created,
    HostedUsageCreditPurchaseStatus.payment_pending,
  ])("resumes %s work through the existing saved-card owner", async (status) => {
    const purchase = buildPurchase({ status });
    const { prisma } = createPrisma([purchase]);
    mocks.tryChargeHostedUsageCreditSavedCard.mockResolvedValue({
      ...purchase,
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 1, dispatched: 1, recoveryRequired: 0 });

    expect(mocks.tryChargeHostedUsageCreditSavedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAuthority: {
          automaticSponsorship: expect.objectContaining({
            authorizationId: purchase.groupSponsorshipAuthorizationId,
            chargeOrdinal: 1,
          }),
          kind: "group",
        },
        now: NOW,
        prisma,
        purchase: expect.objectContaining({ id: purchase.id, status }),
      }),
    );
  });

  it.each([
    HostedGroupSponsorshipAuthorizationStatus.paused,
    HostedGroupSponsorshipAuthorizationStatus.canceled,
  ])(
    "revisits bound payment_pending work after the authorization becomes %s",
    async (authorizationStatus) => {
      const purchase = buildPurchase({
        authorizationStatus,
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripePaymentIntentIdEncrypted: "encrypted:pi_refill",
        stripePaymentIntentLookupKey: "billing:pi_refill",
      });
      const { prisma } = createPrisma([purchase]);
      mocks.tryChargeHostedUsageCreditSavedCard.mockResolvedValue({
        ...purchase,
        status: HostedUsageCreditPurchaseStatus.expired,
      });

      await expect(dispatchHostedGroupSponsorshipRefills({
        now: NOW,
        prisma: prisma as never,
      })).resolves.toEqual({
        attempted: 1,
        dispatched: 0,
        recoveryRequired: 0,
      });

      expect(mocks.tryChargeHostedUsageCreditSavedCard).toHaveBeenCalledWith(
        expect.objectContaining({
          purchase: expect.objectContaining({
            id: purchase.id,
            status: HostedUsageCreditPurchaseStatus.payment_pending,
          }),
        }),
      );
    },
  );

  it("rotates more than twenty poison rows so later valid work is attempted", async () => {
    const poison = Array.from({ length: 25 }, (_, index) => buildPurchase({
      createdAt: new Date(NOW.getTime() + index),
      id: `hucp_poison_${String(index).padStart(2, "0")}`,
    }));
    const valid = buildPurchase({
      createdAt: new Date(NOW.getTime() + 100),
      id: "hucp_valid_after_poison",
    });
    const { prisma } = createPrisma([...poison, valid]);
    mocks.tryChargeHostedUsageCreditSavedCard.mockImplementation(
      async ({ purchase }: { purchase: PurchaseRow }) => {
        if (purchase.id !== valid.id) {
          throw new Error("permanent test failure");
        }
        return {
          ...purchase,
          status: HostedUsageCreditPurchaseStatus.payment_pending,
        };
      },
    );

    await dispatchHostedGroupSponsorshipRefills({ now: NOW, prisma: prisma as never });
    await dispatchHostedGroupSponsorshipRefills({
      now: new Date(NOW.getTime() + 60_000),
      prisma: prisma as never,
    });

    expect(mocks.tryChargeHostedUsageCreditSavedCard).toHaveBeenCalledWith(
      expect.objectContaining({ purchase: expect.objectContaining({ id: valid.id }) }),
    );
  });

  it("expires elapsed unbound work without initializing Stripe", async () => {
    const elapsed = buildPurchase({
      checkoutExpiresAt: new Date(NOW.getTime() - 1),
    });
    const { prisma, rows } = createPrisma([elapsed]);

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 1, dispatched: 0, recoveryRequired: 0 });

    expect(rows[0]).toMatchObject({
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: NOW,
    });
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
    expect(mocks.tryChargeHostedUsageCreditSavedCard).not.toHaveBeenCalled();
  });

  it("retries a swallowed recovery-notification failure on a later sweep", async () => {
    const failed = buildPurchase({
      authorizationStatus:
        HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    });
    const { prisma } = createPrisma([failed]);
    mocks.materializeHostedGroupSponsorshipRecoveryNotification
      .mockRejectedValueOnce(new Error("mailbox unavailable"))
      .mockResolvedValueOnce(true);

    await dispatchHostedGroupSponsorshipRefills({ now: NOW, prisma: prisma as never });
    await dispatchHostedGroupSponsorshipRefills({
      now: new Date(NOW.getTime() + 60_000),
      prisma: prisma as never,
    });

    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .toHaveBeenCalledTimes(2);
    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .toHaveBeenLastCalledWith({
        now: new Date(NOW.getTime() + 60_000),
        prisma,
        purchaseId: failed.id,
      });
  });

  it("moves a safely canceled charge into private recovery without retrying it", async () => {
    const purchase = buildPurchase();
    const { prisma, rows } = createPrisma([purchase]);
    mocks.tryChargeHostedUsageCreditSavedCard.mockImplementationOnce(async () => {
      Object.assign(rows[0], {
        status: HostedUsageCreditPurchaseStatus.created,
        stripePaymentIntentIdEncrypted: null,
        stripePaymentIntentLookupKey: null,
      });
      return null;
    });
    mocks.markHostedGroupSponsorshipRecoveryRequiredForPurchase
      .mockImplementationOnce(async () => {
        Object.assign(rows[0], {
          authorizationStatus:
            HostedGroupSponsorshipAuthorizationStatus.recovery_required,
          status: HostedUsageCreditPurchaseStatus.payment_failed,
          terminalAt: NOW,
        });
        return {
          authorizationId: purchase.groupSponsorshipAuthorizationId,
          payerMemberId: purchase.payerMemberId,
        };
      });

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 1, dispatched: 0, recoveryRequired: 1 });
    expect(rows[0]).toMatchObject({
      authorizationStatus:
        HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
      terminalAt: NOW,
    });
    expect(mocks.markHostedGroupSponsorshipRecoveryRequiredForPurchase)
      .toHaveBeenCalledWith({ now: NOW, prisma, purchaseId: purchase.id });
    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .toHaveBeenCalledWith({ now: NOW, prisma, purchaseId: purchase.id });

    const retryAt = new Date(NOW.getTime() + 60_000);
    await dispatchHostedGroupSponsorshipRefills({
      now: retryAt,
      prisma: prisma as never,
    });

    expect(mocks.tryChargeHostedUsageCreditSavedCard).toHaveBeenCalledOnce();
    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .toHaveBeenLastCalledWith({ now: retryAt, prisma, purchaseId: purchase.id });
  });

  it("keeps an ambiguous bound charge silent and retries it on the next sweep", async () => {
    const purchase = buildPurchase({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      stripePaymentIntentIdEncrypted: "sealed_intent",
      stripePaymentIntentLookupKey: "intent_lookup",
    });
    const { prisma, rows } = createPrisma([purchase]);
    mocks.tryChargeHostedUsageCreditSavedCard
      .mockRejectedValueOnce(new Error("Stripe request timed out"))
      .mockResolvedValueOnce({
        ...purchase,
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripeChargeIdEncrypted: "sealed_charge",
        stripeChargeLookupKey: "charge_lookup",
      });

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 1, dispatched: 0, recoveryRequired: 0 });
    expect(rows[0]).toMatchObject({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      stripePaymentIntentIdEncrypted: "sealed_intent",
      stripePaymentIntentLookupKey: "intent_lookup",
    });
    expect(mocks.markHostedGroupSponsorshipRecoveryRequiredForPurchase)
      .not.toHaveBeenCalled();
    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .not.toHaveBeenCalled();

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: new Date(NOW.getTime() + 60_000),
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 1, dispatched: 1, recoveryRequired: 0 });

    expect(mocks.tryChargeHostedUsageCreditSavedCard).toHaveBeenCalledTimes(2);
    expect(mocks.markHostedGroupSponsorshipRecoveryRequiredForPurchase)
      .not.toHaveBeenCalled();
    expect(mocks.materializeHostedGroupSponsorshipRecoveryNotification)
      .not.toHaveBeenCalled();
  });

  it("does not initialize Stripe when no admitted purchase exists", async () => {
    const { prisma } = createPrisma([]);

    await expect(dispatchHostedGroupSponsorshipRefills({
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({ attempted: 0, dispatched: 0, recoveryRequired: 0 });
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
  });
});
