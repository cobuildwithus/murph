import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(async (
    _tx: unknown,
    _memberId: string,
  ) => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >();
  return {
    ...actual,
    lockHostedMemberRow: sharedMocks.lockHostedMemberRow,
  };
});

import {
  addHostedGroupSponsorshipCalendarMonth,
  admitHostedGroupSponsorshipRefillTx,
  cancelHostedGroupSponsorshipsForPayerAccountDeletionTx,
  createHostedGroupSponsorshipAuthorizationTx,
  hasHostedGroupAutomaticRefillAvailable,
  isHostedGroupSponsorshipNearCapNotificationCurrentTx,
  manageHostedGroupSponsorshipAuthorization,
  markHostedGroupSponsorshipRecoveryRequiredForPurchase,
  parseHostedGroupSponsorshipManagementAction,
  parseHostedGroupSponsorshipMonthlyCapMinor,
  pauseHostedGroupSponsorshipForFinancialReversalTx,
  prepareHostedGroupSponsorshipRecoveryTx,
  type HostedGroupSponsorshipManagementAction,
} from "@/src/lib/hosted-groups/group-sponsorship-authorization";
import {
  closeExpiredUnattachedHostedUsageCreditPurchasesTx,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-status-service";

const PERIOD_START = new Date("2026-07-30T12:00:00.000Z");
const PERIOD_END = new Date("2026-08-30T12:00:00.000Z");
const NOW = new Date("2026-08-01T12:00:00.000Z");

beforeEach(() => {
  sharedMocks.lockHostedMemberRow.mockClear();
});

function createAutomaticRefillReadHarness(input: {
  authorization?: ReturnType<typeof buildAuthorization> | null;
  purchases?: Array<{
    cashAmountMinor: number;
    groupSponsorshipChargeOrdinal: number;
    groupSponsorshipPeriodStartedAt?: Date | null;
    status: HostedUsageCreditPurchaseStatus;
  }>;
  activation?: ReturnType<typeof buildActivationPurchase> | null;
}) {
  const purchases = input.purchases ?? [];
  const authorizationFindMany = vi.fn(async () => {
    if (!input.authorization) {
      return [];
    }
    return [{
      ...input.authorization,
      purchases: purchases
        .filter((purchase) =>
          purchase.groupSponsorshipChargeOrdinal > 0
          && (purchase.status === HostedUsageCreditPurchaseStatus.created
            || purchase.status === HostedUsageCreditPurchaseStatus.checkout_open
            || purchase.status ===
              HostedUsageCreditPurchaseStatus.payment_pending)
        )
        .map((purchase) => ({
          groupSponsorshipChargeOrdinal:
            purchase.groupSponsorshipChargeOrdinal,
          groupSponsorshipPeriodStartedAt:
            purchase.groupSponsorshipPeriodStartedAt ?? PERIOD_START,
          status: purchase.status,
        })),
    }];
  });
  const purchaseFindMany = vi.fn(async () => purchases);
  const findFirstPurchase = vi.fn(async () =>
    input.activation === undefined ? buildActivationPurchase() : input.activation
  );
  return {
    authorizationFindMany,
    findFirstPurchase,
    purchaseFindMany,
    prisma: {
      hostedGroupSponsorshipAuthorization: {
        findMany: authorizationFindMany,
      },
      hostedUsageCreditPurchase: {
        findFirst: findFirstPurchase,
        findMany: purchaseFindMany,
      },
    },
  };
}

function buildAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    anchorDay: 30,
    anchorEndOfMonth: false,
    beneficiaryMemberId: "member_group_runtime",
    canceledAt: null,
    createdAt: PERIOD_START,
    id: "hgsa_abcdefghijklmnop",
    monthlyCapMinor: 1_000,
    payerMemberId: "member_payer",
    pendingMonthlyCapMinor: null,
    periodEndsAt: PERIOD_END,
    periodStartedAt: PERIOD_START,
    recoveryStartedAt: null,
    status: HostedGroupSponsorshipAuthorizationStatus.active,
    updatedAt: PERIOD_START,
    ...overrides,
  };
}

function buildActivationPurchase() {
  return {
    checkoutCancelUrl:
      "https://www.withmurph.ai/groups/fund/example?usageCheckout=cancel&usagePurchase=hucp_activation_123",
    checkoutSuccessUrl:
      "https://www.withmurph.ai/groups/fund/example?usageCheckout=success&usagePurchase=hucp_activation_123",
    offerCode: "usage_5_usd",
    payerMemberId: "member_payer",
    status: HostedUsageCreditPurchaseStatus.fulfilled,
    stripeCustomerIdEncrypted: "sealed_customer",
    stripeCustomerLookupKey: "customer_lookup",
    stripeLiveMode: false,
    stripePriceIdEncrypted: "sealed_price",
    stripePriceLookupKey: "price_lookup",
  };
}

describe("automatic group sponsorship refill availability", () => {
  it("reports current cap headroom without exposing sponsorship details", async () => {
    const harness = createAutomaticRefillReadHarness({
      authorization: buildAuthorization(),
      purchases: [{
        cashAmountMinor: 500,
        groupSponsorshipChargeOrdinal: 0,
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      }],
    });

    await expect(hasHostedGroupAutomaticRefillAvailable({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      prisma: harness.prisma as never,
    })).resolves.toBe(true);
  });

  it.each([
    [
      HostedUsageCreditPurchaseStatus.created,
      HostedGroupSponsorshipAuthorizationStatus.active,
    ],
    [
      HostedUsageCreditPurchaseStatus.checkout_open,
      HostedGroupSponsorshipAuthorizationStatus.active,
    ],
    [
      HostedUsageCreditPurchaseStatus.payment_pending,
      HostedGroupSponsorshipAuthorizationStatus.active,
    ],
    [
      HostedUsageCreditPurchaseStatus.payment_pending,
      HostedGroupSponsorshipAuthorizationStatus.paused,
    ],
    [
      HostedUsageCreditPurchaseStatus.payment_pending,
      HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    ],
    [
      HostedUsageCreditPurchaseStatus.payment_pending,
      HostedGroupSponsorshipAuthorizationStatus.canceled,
    ],
  ])(
    "treats a current-period %s refill as available for a %s authorization",
    async (purchaseStatus, status) => {
      const harness = createAutomaticRefillReadHarness({
        activation: {
          ...buildActivationPurchase(),
          stripeCustomerIdEncrypted: "",
        },
        authorization: buildAuthorization({ status }),
        purchases: [{
          cashAmountMinor: 500,
          groupSponsorshipChargeOrdinal: 1,
          status: purchaseStatus,
        }],
      });

      await expect(hasHostedGroupAutomaticRefillAvailable({
        beneficiaryMemberId: "member_group_runtime",
        now: NOW,
        prisma: harness.prisma as never,
      })).resolves.toBe(true);
      expect(harness.findFirstPurchase).not.toHaveBeenCalled();
      expect(harness.purchaseFindMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    HostedGroupSponsorshipAuthorizationStatus.active,
    HostedGroupSponsorshipAuthorizationStatus.paused,
    HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    HostedGroupSponsorshipAuthorizationStatus.canceled,
  ])(
    "does not treat a terminal refill as available for a %s authorization",
    async (status) => {
      const harness = createAutomaticRefillReadHarness({
        activation: {
          ...buildActivationPurchase(),
          stripeCustomerIdEncrypted: "",
        },
        authorization: buildAuthorization({ status }),
        purchases: [{
          cashAmountMinor: 500,
          groupSponsorshipChargeOrdinal: 1,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        }],
      });

      await expect(hasHostedGroupAutomaticRefillAvailable({
        beneficiaryMemberId: "member_group_runtime",
        now: NOW,
        prisma: harness.prisma as never,
      })).resolves.toBe(false);
    },
  );

  it("reports no automatic recovery after the current cap is fulfilled", async () => {
    const harness = createAutomaticRefillReadHarness({
      authorization: buildAuthorization(),
      purchases: [
        {
          cashAmountMinor: 500,
          groupSponsorshipChargeOrdinal: 0,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        },
        {
          cashAmountMinor: 500,
          groupSponsorshipChargeOrdinal: 1,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        },
      ],
    });

    await expect(hasHostedGroupAutomaticRefillAvailable({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      prisma: harness.prisma as never,
    })).resolves.toBe(false);
  });

  it("fails closed when no active automatic sponsor exists", async () => {
    const harness = createAutomaticRefillReadHarness({ authorization: null });

    await expect(hasHostedGroupAutomaticRefillAvailable({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      prisma: harness.prisma as never,
    })).resolves.toBe(false);
    expect(harness.findFirstPurchase).not.toHaveBeenCalled();
  });

  it("fails closed when the activation has no reusable payment authority", async () => {
    const harness = createAutomaticRefillReadHarness({
      activation: {
        ...buildActivationPurchase(),
        stripeCustomerIdEncrypted: "",
      },
      authorization: buildAuthorization(),
      purchases: [{
        cashAmountMinor: 500,
        groupSponsorshipChargeOrdinal: 0,
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      }],
    });

    await expect(hasHostedGroupAutomaticRefillAvailable({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      prisma: harness.prisma as never,
    })).resolves.toBe(false);
    expect(harness.purchaseFindMany).not.toHaveBeenCalled();
  });

  it("uses the next period and its pending cap after a lazy rollover", async () => {
    const expiredPeriodEnd = new Date("2026-07-31T12:00:00.000Z");
    const harness = createAutomaticRefillReadHarness({
      authorization: buildAuthorization({
        monthlyCapMinor: 1_000,
        pendingMonthlyCapMinor: 500,
        periodEndsAt: expiredPeriodEnd,
        periodStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      }),
      purchases: [],
    });

    await expect(hasHostedGroupAutomaticRefillAvailable({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      prisma: harness.prisma as never,
    })).resolves.toBe(true);
    expect(harness.purchaseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        groupSponsorshipPeriodStartedAt: expiredPeriodEnd,
      }),
    }));
  });
});

function createRefillHarness(input: {
  authorization?: ReturnType<typeof buildAuthorization>;
  purchases?: Array<{
    cashAmountMinor: number;
    checkoutCancelUrl?: string;
    checkoutSuccessUrl?: string;
    groupSponsorshipChargeOrdinal: number;
    id: string;
    reconciliationVersion?: bigint;
    status: HostedUsageCreditPurchaseStatus;
  }>;
} = {}) {
  let authorization = input.authorization ?? buildAuthorization();
  const purchases = (input.purchases ?? [{
    cashAmountMinor: 500,
    groupSponsorshipChargeOrdinal: 0,
    id: "hucp_activation_123",
    status: HostedUsageCreditPurchaseStatus.fulfilled,
  }]).map((purchase) => ({
    ...purchase,
    checkoutCancelUrl: purchase.checkoutCancelUrl ??
      `https://www.withmurph.ai/groups/fund/example?usageCheckout=cancel&usagePurchase=${purchase.id}`,
    checkoutSuccessUrl: purchase.checkoutSuccessUrl ??
      `https://www.withmurph.ai/groups/fund/example?usageCheckout=success&usagePurchase=${purchase.id}`,
    reconciliationVersion: purchase.reconciliationVersion ?? 0n,
  }));
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    purchases.push({
      cashAmountMinor: Number(data.cashAmountMinor),
      checkoutCancelUrl: String(data.checkoutCancelUrl),
      checkoutSuccessUrl: String(data.checkoutSuccessUrl),
      groupSponsorshipChargeOrdinal: Number(
        data.groupSponsorshipChargeOrdinal,
      ),
      id: String(data.id),
      reconciliationVersion: 0n,
      status: data.status as HostedUsageCreditPurchaseStatus,
    });
    return data;
  });
  const tx = {
    hostedGroupSponsorshipAuthorization: {
      findFirst: vi.fn(async () => authorization),
      findUnique: vi.fn(async () => authorization),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        authorization = { ...authorization, ...data };
        return { count: 1 };
      }),
    },
    hostedUsageCreditPurchase: {
      aggregate: vi.fn(async ({ where }: {
        where: {
          status: HostedUsageCreditPurchaseStatus | {
            in: readonly HostedUsageCreditPurchaseStatus[];
          };
        };
      }) => {
        const statuses = typeof where.status === "string"
          ? [where.status]
          : where.status.in;
        return {
          _sum: {
            cashAmountMinor: purchases.reduce((sum, purchase) =>
              statuses.includes(purchase.status)
                ? sum + purchase.cashAmountMinor
                : sum, 0),
          },
        };
      }),
      create,
      findFirst: vi.fn(async () => buildActivationPurchase()),
      findMany: vi.fn(async ({ where }: { where: {
        groupSponsorshipPeriodStartedAt: Date;
      } }) => purchases.filter(() =>
        where.groupSponsorshipPeriodStartedAt.getTime() ===
          authorization.periodStartedAt.getTime()
      )),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async ({ data, where }: {
        data: Record<string, unknown>;
        where: { id: string; reconciliationVersion: bigint };
      }) => {
        const purchase = purchases.find((candidate) =>
          candidate.id === where.id &&
          candidate.reconciliationVersion === where.reconciliationVersion
        );
        if (!purchase) {
          return { count: 0 };
        }
        purchase.checkoutCancelUrl = String(data.checkoutCancelUrl);
        purchase.checkoutSuccessUrl = String(data.checkoutSuccessUrl);
        purchase.reconciliationVersion += 1n;
        return { count: 1 };
      }),
    },
  };
  return {
    create,
    get authorization() {
      return authorization;
    },
    purchases,
    tx,
  };
}

describe("hosted capped group sponsorship authorization", () => {
  it("accepts only the three explicit monthly maximums and closed management payloads", () => {
    expect(parseHostedGroupSponsorshipMonthlyCapMinor(500)).toBe(500);
    expect(parseHostedGroupSponsorshipMonthlyCapMinor(1_000)).toBe(1_000);
    expect(parseHostedGroupSponsorshipMonthlyCapMinor(2_000)).toBe(2_000);
    expect(parseHostedGroupSponsorshipMonthlyCapMinor(1_500)).toBeNull();
    expect(parseHostedGroupSponsorshipManagementAction({
      action: "change_cap",
      authorizationId: "hgsa_abcdefghijklmnop",
      confirmed: true,
      monthlyCapMinor: 2_000,
    })).toEqual({
      action: "change_cap",
      authorizationId: "hgsa_abcdefghijklmnop",
      confirmed: true,
      monthlyCapMinor: 2_000,
    });
    expect(() => parseHostedGroupSponsorshipManagementAction({
      action: "change_cap",
      authorizationId: "hgsa_abcdefghijklmnop",
      confirmed: false,
      monthlyCapMinor: 2_000,
    })).toThrow(/valid monthly sponsorship change/u);
    for (const action of ["cancel", "pause", "recover", "resume"] as const) {
      expect(parseHostedGroupSponsorshipManagementAction({
        action,
        authorizationId: "hgsa_abcdefghijklmnop",
      })).toEqual({ action, authorizationId: "hgsa_abcdefghijklmnop" });
    }
    expect(() => parseHostedGroupSponsorshipManagementAction({
      action: "pause",
    })).toThrow(/valid monthly sponsorship change/u);
    expect(() => parseHostedGroupSponsorshipManagementAction({
      action: "pause",
      authorizationId: "hgsa_stale",
    })).toThrow(/valid monthly sponsorship change/u);
  });

  it("replaces an expired unbound pending activation from another payer", async () => {
    const oldAuthorization = buildAuthorization({
      payerMemberId: "member_old_payer",
      status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
    });
    let authorization = oldAuthorization;
    let purchase = {
      beneficiaryMemberId: "member_group_runtime",
      checkoutExpiresAt: new Date("2026-08-01T11:59:59.000Z"),
      groupSponsorshipAuthorizationId: oldAuthorization.id,
      groupSponsorshipChargeOrdinal: 0,
      id: "hucp_expiredinitial",
      paidAt: null,
      payerMemberId: "member_old_payer",
      reconciliationVersion: 0n,
      status: HostedUsageCreditPurchaseStatus.created,
      stripeChargeIdEncrypted: null,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCheckoutUrlEncrypted: null,
      stripePaymentIntentIdEncrypted: null,
      stripePaymentIntentLookupKey: null,
      terminalAt: null,
    };
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      expect(authorization.status).toBe(
        HostedGroupSponsorshipAuthorizationStatus.canceled,
      );
      authorization = { ...buildAuthorization(), ...data };
      return authorization;
    });
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        create,
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: vi.fn(async ({ data, where }: {
          data: Record<string, unknown>;
          where: { id: string };
        }) => {
          if (where.id !== oldAuthorization.id) {
            return { count: 0 };
          }
          authorization = { ...authorization, ...data };
          return { count: 1 };
        }),
      },
      hostedUsageCreditPurchase: {
        findFirst: vi.fn(async ({ select }: {
          select: Record<string, boolean>;
        }) => "status" in select
          ? { status: purchase.status }
          : {
              id: purchase.id,
              reconciliationVersion: purchase.reconciliationVersion,
            }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          purchase = {
            ...purchase,
            ...data,
            reconciliationVersion: purchase.reconciliationVersion + 1n,
          };
          return { count: 1 };
        }),
      },
    };

    await expect(createHostedGroupSponsorshipAuthorizationTx({
      beneficiaryMemberId: "member_group_runtime",
      monthlyCapMinor: 1_000,
      now: NOW,
      payerMemberId: "member_new_payer",
      tx: tx as never,
    })).resolves.toMatchObject({
      authorizationId: expect.stringMatching(/^hgsa_[A-Za-z0-9_-]{16}$/u),
      periodStartedAt: NOW,
    });

    expect(sharedMocks.lockHostedMemberRow.mock.calls.map(([, memberId]) =>
      memberId
    )).toEqual(["member_new_payer", "member_old_payer"]);
    expect(tx.hostedUsageCreditPurchase.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
        reconciliationVersion: true,
      },
      where: expect.objectContaining({
        checkoutExpiresAt: { lte: NOW },
        groupSponsorshipAuthorizationId: oldAuthorization.id,
        groupSponsorshipChargeOrdinal: 0,
        stripeChargeIdEncrypted: null,
        stripeChargeLookupKey: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCheckoutUrlEncrypted: null,
        stripePaymentIntentIdEncrypted: null,
        stripePaymentIntentLookupKey: null,
      }),
    });
    expect(purchase).toMatchObject({
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: NOW,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        beneficiaryMemberId: "member_group_runtime",
        payerMemberId: "member_new_payer",
        status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
      }),
    });
  });

  it("protects a non-expired pending activation owned by another payer", async () => {
    const authorization = buildAuthorization({
      payerMemberId: "member_old_payer",
      status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
    });
    const create = vi.fn();
    const purchaseUpdate = vi.fn();
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        create,
        findFirst: vi.fn(async () => authorization),
      },
      hostedUsageCreditPurchase: {
        findFirst: vi.fn(async () => null),
        updateMany: purchaseUpdate,
      },
    };

    await expect(createHostedGroupSponsorshipAuthorizationTx({
      beneficiaryMemberId: "member_group_runtime",
      monthlyCapMinor: 1_000,
      now: NOW,
      payerMemberId: "member_new_payer",
      tx: tx as never,
    })).rejects.toThrow(/already has a monthly sponsor/u);
    expect(create).not.toHaveBeenCalled();
    expect(purchaseUpdate).not.toHaveBeenCalled();
  });

  it("protects an expired pending activation after Stripe binding begins", async () => {
    const authorization = buildAuthorization({
      payerMemberId: "member_old_payer",
      status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
    });
    const findFirst = vi.fn(async ({ select, where }: {
      select: Record<string, boolean>;
      where: Record<string, unknown>;
    }) => {
      if ("status" in select) {
        return { status: HostedUsageCreditPurchaseStatus.created };
      }
      expect(where).toMatchObject({
        checkoutExpiresAt: { lte: NOW },
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCheckoutUrlEncrypted: null,
      });
      // A real provider-bound row has non-null values here, so it cannot match
      // the exact unbound predicate and remains available for reconciliation.
      return null;
    });
    const create = vi.fn();
    const purchaseUpdate = vi.fn();
    const authorizationUpdate = vi.fn();
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        create,
        findFirst: vi.fn(async () => authorization),
        updateMany: authorizationUpdate,
      },
      hostedUsageCreditPurchase: {
        findFirst,
        updateMany: purchaseUpdate,
      },
    };

    await expect(createHostedGroupSponsorshipAuthorizationTx({
      beneficiaryMemberId: "member_group_runtime",
      monthlyCapMinor: 1_000,
      now: NOW,
      payerMemberId: "member_new_payer",
      tx: tx as never,
    })).rejects.toThrow(/already has a monthly sponsor/u);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(purchaseUpdate).not.toHaveBeenCalled();
    expect(authorizationUpdate).not.toHaveBeenCalled();
  });

  it("keeps payer cleanup purchase-only and lazily cancels the activation under the beneficiary owner", async () => {
    const purchaseUpdate = vi.fn(async () => ({ count: 1 }));
    const payerCleanupTx = {
      hostedUsageCreditPurchase: { updateMany: purchaseUpdate },
    };

    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now: NOW,
      payerMemberId: "member_old_payer",
      purchaseId: "hucp_expiredinitial",
      tx: payerCleanupTx as never,
    });

    expect(purchaseUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: HostedUsageCreditPurchaseStatus.expired,
        terminalAt: NOW,
      }),
      where: {
        checkoutExpiresAt: { lte: NOW },
        id: "hucp_expiredinitial",
        payerMemberId: "member_old_payer",
        status: HostedUsageCreditPurchaseStatus.created,
      },
    });
    expect(payerCleanupTx).not.toHaveProperty(
      "hostedGroupSponsorshipAuthorization",
    );

    let authorization = buildAuthorization({
      payerMemberId: "member_old_payer",
      status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
    });
    const authorizationUpdate = vi.fn(async ({ data }: {
      data: Record<string, unknown>;
    }) => {
      authorization = { ...authorization, ...data };
      return { count: 1 };
    });
    const beneficiaryTx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: authorizationUpdate,
      },
      hostedUsageCreditPurchase: {
        findFirst: vi.fn(async () => ({
          status: HostedUsageCreditPurchaseStatus.expired,
        })),
      },
    };

    await expect(admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: beneficiaryTx as never,
    })).resolves.toBeNull();
    expect(authorization).toMatchObject({
      status: HostedGroupSponsorshipAuthorizationStatus.canceled,
      canceledAt: NOW,
    });
  });

  it("keeps end-of-month activation anchored to month end", () => {
    const february = addHostedGroupSponsorshipCalendarMonth({
      anchorDay: 31,
      anchorEndOfMonth: true,
      date: new Date("2027-01-31T18:45:00.000Z"),
    });
    const march = addHostedGroupSponsorshipCalendarMonth({
      anchorDay: 31,
      anchorEndOfMonth: true,
      date: february,
    });

    expect(february.toISOString()).toBe("2027-02-28T18:45:00.000Z");
    expect(march.toISOString()).toBe("2027-03-31T18:45:00.000Z");
  });

  it("serializes duplicate low-capacity admission to one deterministic exact-$5 purchase", async () => {
    const harness = createRefillHarness();

    const first = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "low",
      now: NOW,
      tx: harness.tx as never,
    });
    const second = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: harness.tx as never,
    });

    expect(first).toEqual(second);
    expect(first?.purchaseId).toMatch(/^hucp_[A-Za-z0-9_-]{16}$/u);
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cashAmountMinor: 500,
        grantUsdMicros: 5_000_000n,
        groupSponsorshipChargeOrdinal: 1,
        offerCode: "usage_5_usd",
        status: HostedUsageCreditPurchaseStatus.created,
      }),
    });
    const created = harness.create.mock.calls[0]?.[0].data;
    expect(created).toBeDefined();
    const refillPurchaseId = String(created?.id);
    expect(new URL(String(created?.checkoutSuccessUrl)).searchParams.get(
      "usagePurchase",
    )).toBe(refillPurchaseId);
    expect(new URL(String(created?.checkoutCancelUrl)).searchParams.get(
      "usagePurchase",
    )).toBe(refillPurchaseId);
    expect(harness.tx).not.toHaveProperty("hostedGroupSponsorshipMoment");
  });

  it("counts fulfilled plus pending purchases against the cap", async () => {
    const pending: {
      cashAmountMinor: number;
      groupSponsorshipChargeOrdinal: number;
      id: string;
      status: HostedUsageCreditPurchaseStatus;
    } = {
      cashAmountMinor: 500,
      groupSponsorshipChargeOrdinal: 1,
      id: "hucp_pending_1234",
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    };
    const harness = createRefillHarness({ purchases: [
      {
        cashAmountMinor: 500,
        groupSponsorshipChargeOrdinal: 0,
        id: "hucp_activation_123",
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      },
      pending,
    ] });

    await expect(admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "low",
      now: NOW,
      tx: harness.tx as never,
    })).resolves.toEqual({
      authorizationId: "hgsa_abcdefghijklmnop",
      purchaseId: pending.id,
    });
    expect(harness.create).not.toHaveBeenCalled();

    pending.status = HostedUsageCreditPurchaseStatus.fulfilled;
    const persistedPending = harness.purchases.find((purchase) =>
      purchase.id === pending.id
    );
    if (persistedPending) {
      persistedPending.status = HostedUsageCreditPurchaseStatus.fulfilled;
    }
    await expect(admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "low",
      now: NOW,
      tx: harness.tx as never,
    })).resolves.toBeNull();
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("repairs a pre-fix created refill before returning it for recovery", async () => {
    const refillPurchaseId = "hucp_refill_legacy_1";
    const harness = createRefillHarness({ purchases: [
      {
        cashAmountMinor: 500,
        groupSponsorshipChargeOrdinal: 0,
        id: "hucp_activation_123",
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      },
      {
        cashAmountMinor: 500,
        checkoutCancelUrl:
          "https://www.withmurph.ai/groups/fund/example?usageCheckout=cancel&usagePurchase=hucp_activation_123",
        checkoutSuccessUrl:
          "https://www.withmurph.ai/groups/fund/example?usageCheckout=success&usagePurchase=hucp_activation_123",
        groupSponsorshipChargeOrdinal: 1,
        id: refillPurchaseId,
        reconciliationVersion: 3n,
        status: HostedUsageCreditPurchaseStatus.created,
      },
    ] });

    await expect(admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "low",
      now: NOW,
      tx: harness.tx as never,
    })).resolves.toEqual({
      authorizationId: "hgsa_abcdefghijklmnop",
      purchaseId: refillPurchaseId,
    });

    const repaired = harness.purchases.find((purchase) =>
      purchase.id === refillPurchaseId
    );
    expect(new URL(repaired?.checkoutSuccessUrl ?? "").searchParams.get(
      "usagePurchase",
    )).toBe(refillPurchaseId);
    expect(new URL(repaired?.checkoutCancelUrl ?? "").searchParams.get(
      "usagePurchase",
    )).toBe(refillPurchaseId);
    expect(repaired?.reconciliationVersion).toBe(4n);
  });

  it("rolls the cap lazily while leaving previously purchased credit outside sponsorship state", async () => {
    const harness = createRefillHarness({
      authorization: buildAuthorization({
        monthlyCapMinor: 1_000,
        pendingMonthlyCapMinor: 500,
        periodEndsAt: new Date("2026-07-31T12:00:00.000Z"),
        periodStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      }),
      purchases: [],
    });

    const first = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: harness.tx as never,
    });
    const replay = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: harness.tx as never,
    });
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ authorizationId: "hgsa_abcdefghijklmnop" });

    expect(harness.authorization).toMatchObject({
      monthlyCapMinor: 500,
      pendingMonthlyCapMinor: null,
      periodEndsAt: new Date("2026-08-30T12:00:00.000Z"),
      periodStartedAt: new Date("2026-07-31T12:00:00.000Z"),
    });
    expect(harness.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({
        remainingCreditUsdMicros: expect.anything(),
      }),
    });
  });

  it.each([
    {
      label: "a confirmed cap increase",
      authorization: buildAuthorization({ monthlyCapMinor: 500 }),
      action: {
        action: "change_cap" as const,
        authorizationId: "hgsa_abcdefghijklmnop",
        confirmed: true as const,
        monthlyCapMinor: 1_000 as const,
      },
    },
    {
      label: "resume",
      authorization: buildAuthorization({
        status: HostedGroupSponsorshipAuthorizationStatus.paused,
      }),
      action: {
        action: "resume" as const,
        authorizationId: "hgsa_abcdefghijklmnop",
      },
    },
  ])("admits one deterministic refill from an exhausted gate after $label", async ({
    action,
    authorization,
  }) => {
    const harness = createRefillHarness({ authorization });
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof harness.tx) => unknown) =>
        run(harness.tx)),
    };

    await manageHostedGroupSponsorshipAuthorization({
      action,
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      payerMemberId: "member_payer",
      prisma: prisma as never,
    });
    const first = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: harness.tx as never,
    });
    const replay = await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "exhausted",
      now: NOW,
      tx: harness.tx as never,
    });

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      authorizationId: "hgsa_abcdefghijklmnop",
      purchaseId: expect.stringMatching(/^hucp_[A-Za-z0-9_-]{16}$/u),
    });
    expect(harness.create).toHaveBeenCalledTimes(1);
  });

  it("reserves pending cap without presenting it as charged", async () => {
    let authorization = buildAuthorization();
    const aggregate = vi.fn(async ({ where }: {
      where: {
        status: HostedUsageCreditPurchaseStatus | {
          in: readonly HostedUsageCreditPurchaseStatus[];
        };
      };
    }) => ({
      _sum: {
        cashAmountMinor:
          where.status === HostedUsageCreditPurchaseStatus.fulfilled
            ? 500
            : typeof where.status !== "string" &&
                where.status.in.includes(
                  HostedUsageCreditPurchaseStatus.fulfilled,
                )
              ? 1_000
              : 500,
      },
    }));
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          authorization = { ...authorization, ...data };
          return { count: 1 };
        }),
      },
      hostedUsageCreditPurchase: { aggregate },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };

    await expect(manageHostedGroupSponsorshipAuthorization({
      action: {
        action: "change_cap",
        authorizationId: "hgsa_abcdefghijklmnop",
        confirmed: true,
        monthlyCapMinor: 500,
      },
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      payerMemberId: "member_payer",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      chargedThisPeriodMinor: 500,
      monthlyCapMinor: 1_000,
      pendingThisPeriodMinor: 500,
      pendingMonthlyCapMinor: 500,
    });
  });

  it("validates near-cap notices against the exact active payer, period, cap, and committed spend", async () => {
    const authorization = buildAuthorization();
    const purchase = {
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipPeriodStartedAt: authorization.periodStartedAt,
      payerMemberId: authorization.payerMemberId,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
    };
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findUnique: vi.fn(async () => authorization),
      },
      hostedUsageCreditPurchase: {
        aggregate: vi.fn(async () => ({ _sum: { cashAmountMinor: 500 } })),
        findUnique: vi.fn(async () => purchase),
      },
    };

    await expect(isHostedGroupSponsorshipNearCapNotificationCurrentTx({
      authorizationId: authorization.id,
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      monthlyCapMinor: 1_000,
      now: NOW,
      payerMemberId: "member_payer",
      periodStartedAt: PERIOD_START,
      purchaseId: "hucp_refill_123456",
      tx: tx as never,
    })).resolves.toBe(true);
  });

  it.each([
    {
      label: "a canceled authorization",
      authorization: buildAuthorization({
        canceledAt: NOW,
        status: HostedGroupSponsorshipAuthorizationStatus.canceled,
      }),
      purchasePeriodStartedAt: PERIOD_START,
      requestedPeriodStartedAt: PERIOD_START,
    },
    {
      label: "a delayed prior-period fulfillment",
      authorization: buildAuthorization({
        periodEndsAt: new Date("2026-09-30T12:00:00.000Z"),
        periodStartedAt: PERIOD_END,
      }),
      purchasePeriodStartedAt: PERIOD_START,
      requestedPeriodStartedAt: PERIOD_START,
    },
  ])("rejects a near-cap notice for $label", async ({
    authorization,
    purchasePeriodStartedAt,
    requestedPeriodStartedAt,
  }) => {
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findUnique: vi.fn(async () => authorization),
      },
      hostedUsageCreditPurchase: {
        aggregate: vi.fn(async () => ({ _sum: { cashAmountMinor: 500 } })),
        findUnique: vi.fn(async () => ({
          beneficiaryMemberId: "member_group_runtime",
          groupSponsorshipAuthorizationId: "hgsa_abcdefghijklmnop",
          groupSponsorshipPeriodStartedAt: purchasePeriodStartedAt,
          payerMemberId: "member_payer",
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        })),
      },
    };

    await expect(isHostedGroupSponsorshipNearCapNotificationCurrentTx({
      authorizationId: "hgsa_abcdefghijklmnop",
      beneficiaryMemberId: "member_group_runtime",
      monthlyCapMinor: 1_000,
      now: NOW,
      payerMemberId: "member_payer",
      periodStartedAt: requestedPeriodStartedAt,
      purchaseId: "hucp_refill_123456",
      tx: tx as never,
    })).resolves.toBe(false);
  });

  it("applies confirmed increases immediately and preserves pause, resume, and cancel state", async () => {
    let authorization = buildAuthorization({ monthlyCapMinor: 500 });
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          authorization = { ...authorization, ...data };
          return { count: 1 };
        }),
      },
      hostedUsageCreditPurchase: {
        aggregate: vi.fn(async () => ({ _sum: { cashAmountMinor: 500 } })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };
    const base = {
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: "member_payer",
      prisma: prisma as never,
    };

    await expect(manageHostedGroupSponsorshipAuthorization({
      ...base,
      action: {
        action: "change_cap",
        authorizationId: "hgsa_abcdefghijklmnop",
        confirmed: true,
        monthlyCapMinor: 2_000,
      },
      now: new Date("2026-08-01T12:01:00.000Z"),
    })).resolves.toMatchObject({ monthlyCapMinor: 2_000, status: "active" });
    await expect(manageHostedGroupSponsorshipAuthorization({
      ...base,
      action: { action: "pause", authorizationId: "hgsa_abcdefghijklmnop" },
      now: new Date("2026-08-01T12:02:00.000Z"),
    })).resolves.toMatchObject({ status: "paused" });
    await expect(manageHostedGroupSponsorshipAuthorization({
      ...base,
      action: { action: "resume", authorizationId: "hgsa_abcdefghijklmnop" },
      now: new Date("2026-08-01T12:03:00.000Z"),
    })).resolves.toMatchObject({ status: "active" });
    await expect(manageHostedGroupSponsorshipAuthorization({
      ...base,
      action: { action: "cancel", authorizationId: "hgsa_abcdefghijklmnop" },
      now: new Date("2026-08-01T12:04:00.000Z"),
    })).resolves.toBeNull();
    expect(authorization).toMatchObject({
      canceledAt: new Date("2026-08-01T12:04:00.000Z"),
      monthlyCapMinor: 2_000,
      payerMemberId: "member_payer",
      status: HostedGroupSponsorshipAuthorizationStatus.canceled,
    });
  });

  it("rejects every stale management action before mutating a newer authorization", async () => {
    const authorization = buildAuthorization({ id: "hgsa_qrstuvwxyzABCDEF" });
    const updateMany = vi.fn();
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        updateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };
    const actions: HostedGroupSponsorshipManagementAction[] = [
      { action: "pause", authorizationId: "hgsa_abcdefghijklmnop" },
      { action: "resume", authorizationId: "hgsa_abcdefghijklmnop" },
      { action: "cancel", authorizationId: "hgsa_abcdefghijklmnop" },
      { action: "recover", authorizationId: "hgsa_abcdefghijklmnop" },
      {
        action: "change_cap",
        authorizationId: "hgsa_abcdefghijklmnop",
        confirmed: true,
        monthlyCapMinor: 2_000,
      },
    ];

    for (const action of actions) {
      await expect(manageHostedGroupSponsorshipAuthorization({
        action,
        beneficiaryMemberId: "member_group_runtime",
        now: NOW,
        payerMemberId: "member_payer",
        prisma: prisma as never,
      })).rejects.toThrow(/changed\. Refresh and try again/u);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not let pause clear payment recovery state", async () => {
    const recoveryStartedAt = new Date("2026-08-01T11:45:00.000Z");
    const authorization = buildAuthorization({
      recoveryStartedAt,
      status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    });
    const updateMany = vi.fn();
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        updateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };

    await expect(manageHostedGroupSponsorshipAuthorization({
      action: {
        action: "pause",
        authorizationId: authorization.id,
      },
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      now: NOW,
      payerMemberId: "member_payer",
      prisma: prisma as never,
    })).rejects.toThrow(/changed\. Refresh and try again/u);
    expect(updateMany).not.toHaveBeenCalled();
    expect(authorization).toMatchObject({
      recoveryStartedAt,
      status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    });
  });

  it("rejects recovery for a stale displayed authorization", async () => {
    const authorization = buildAuthorization({
      id: "hgsa_qrstuvwxyzABCDEF",
      recoveryStartedAt: NOW,
      status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    });
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
      },
    };

    await expect(prepareHostedGroupSponsorshipRecoveryTx({
      authorizationId: "hgsa_abcdefghijklmnop",
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      capacityState: "low",
      checkoutExpiresAt: new Date("2026-08-01T13:00:00.000Z"),
      now: NOW,
      payerMemberId: "member_payer",
      tx: tx as never,
    })).rejects.toThrow(/recovery is no longer available/u);
  });

  it("locks beneficiaries before the payer when account deletion cancels sponsorships", async () => {
    const liveAuthorizations = [
      { beneficiaryMemberId: "member_group_z" },
      { beneficiaryMemberId: "member_group_a" },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce(liveAuthorizations)
      .mockResolvedValueOnce(liveAuthorizations);
    const updateMany = vi.fn(async () => ({ count: 2 }));

    await expect(cancelHostedGroupSponsorshipsForPayerAccountDeletionTx({
      now: NOW,
      payerMemberIds: ["member_payer", "member_payer"],
      tx: {
        hostedGroupSponsorshipAuthorization: { findMany, updateMany },
      } as never,
    })).resolves.toBe(2);

    expect(sharedMocks.lockHostedMemberRow.mock.calls.map(([, memberId]) =>
      memberId
    )).toEqual(["member_group_a", "member_group_z", "member_payer"]);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canceledAt: NOW,
        recoveryStartedAt: null,
        status: HostedGroupSponsorshipAuthorizationStatus.canceled,
      }),
      where: expect.objectContaining({
        payerMemberId: { in: ["member_payer"] },
      }),
    });
  });

  it("pauses automatic sponsorship after a refund or dispute reversal", async () => {
    let authorization = buildAuthorization();
    const updateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      authorization = { ...authorization, ...data };
      return { count: 1 };
    });
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findUnique: vi.fn(async () => authorization),
        updateMany,
      },
      hostedUsageCreditPurchase: {
        findUnique: vi.fn(async () => ({
          groupSponsorshipAuthorizationId: authorization.id,
        })),
      },
    };
    await expect(pauseHostedGroupSponsorshipForFinancialReversalTx({
      effectiveAt: NOW,
      purchaseId: "hucp_refill_123456",
      tx: tx as never,
    })).resolves.toBe(true);
    expect(authorization).toMatchObject({
      recoveryStartedAt: null,
      status: HostedGroupSponsorshipAuthorizationStatus.paused,
    });
  });

  it("fails closed after a safely canceled charge and reuses that exact purchase for payer recovery", async () => {
    let authorization = buildAuthorization();
    let purchase = {
      beneficiaryMemberId: "member_group_runtime",
      cashAmountMinor: 500,
      checkoutCancelUrl:
        "https://www.withmurph.ai/groups/fund/example?usageCheckout=cancel&usagePurchase=hucp_activation_123",
      checkoutSuccessUrl:
        "https://www.withmurph.ai/groups/fund/example?usageCheckout=success&usagePurchase=hucp_activation_123",
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipChargeOrdinal: 1,
      groupSponsorshipPeriodStartedAt: PERIOD_START,
      id: "hucp_refill_123456",
      payerMemberId: "member_payer",
      reconciliationVersion: 0n,
      status: HostedUsageCreditPurchaseStatus.created,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    };
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          authorization = { ...authorization, ...data };
          return { count: 1 };
        }),
      },
      hostedUsageCreditPurchase: {
        aggregate: vi.fn(async () => ({ _sum: { cashAmountMinor: 0 } })),
        findFirst: vi.fn(async () => purchase),
        findUnique: vi.fn(async () => purchase),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          purchase = {
            ...purchase,
            ...data,
            reconciliationVersion: purchase.reconciliationVersion + 1n,
          };
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };

    await expect(markHostedGroupSponsorshipRecoveryRequiredForPurchase({
      now: NOW,
      prisma: prisma as never,
      purchaseId: purchase.id,
    })).resolves.toEqual({
      authorizationId: authorization.id,
      payerMemberId: "member_payer",
    });
    expect(authorization.status).toBe(
      HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    );
    expect(purchase.status).toBe(HostedUsageCreditPurchaseStatus.payment_failed);

    await expect(prepareHostedGroupSponsorshipRecoveryTx({
      authorizationId: "hgsa_abcdefghijklmnop",
      beneficiaryMemberId: "member_group_runtime",
      capacityState: "low",
      checkoutExpiresAt: new Date("2026-08-01T13:30:00.000Z"),
      now: new Date("2026-08-01T12:30:00.000Z"),
      payerMemberId: "member_payer",
      tx: tx as never,
    })).resolves.toEqual({ kind: "purchase", purchaseId: purchase.id });
    expect(purchase.status).toBe(HostedUsageCreditPurchaseStatus.created);
    expect(new URL(purchase.checkoutSuccessUrl).searchParams.get(
      "usagePurchase",
    )).toBe(purchase.id);
    expect(new URL(purchase.checkoutCancelUrl).searchParams.get(
      "usagePurchase",
    )).toBe(purchase.id);
    expect(authorization.status).toBe(
      HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    );
  });

  it("does not recover a failed refill above a cap reduced to fulfilled spend", async () => {
    let authorization = buildAuthorization({
      recoveryStartedAt: NOW,
      status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
    });
    const purchase = {
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      cashAmountMinor: 500,
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipChargeOrdinal: 1,
      groupSponsorshipPeriodStartedAt: PERIOD_START,
      id: "hucp_refill_failed_cap",
      payerMemberId: authorization.payerMemberId,
      reconciliationVersion: 1n,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    };
    const aggregate = vi.fn(async ({ where }: {
      where: {
        status: HostedUsageCreditPurchaseStatus | {
          in: readonly HostedUsageCreditPurchaseStatus[];
        };
      };
    }) => ({
      _sum: {
        cashAmountMinor:
          where.status === HostedUsageCreditPurchaseStatus.fulfilled ||
              (
                typeof where.status !== "string" &&
                where.status.in.includes(
                  HostedUsageCreditPurchaseStatus.fulfilled,
                )
              )
            ? 500
            : 0,
      },
    }));
    const updatePurchase = vi.fn(async () => ({ count: 1 }));
    const tx = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => authorization),
        findUnique: vi.fn(async () => authorization),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          authorization = { ...authorization, ...data };
          return { count: 1 };
        }),
      },
      hostedUsageCreditPurchase: {
        aggregate,
        findFirst: vi.fn(async () => purchase),
        updateMany: updatePurchase,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };

    await expect(manageHostedGroupSponsorshipAuthorization({
      action: {
        action: "change_cap",
        authorizationId: authorization.id,
        confirmed: true,
        monthlyCapMinor: 500,
      },
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      now: NOW,
      payerMemberId: authorization.payerMemberId,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      chargedThisPeriodMinor: 500,
      monthlyCapMinor: 500,
      pendingThisPeriodMinor: 0,
    });

    await expect(prepareHostedGroupSponsorshipRecoveryTx({
      authorizationId: authorization.id,
      beneficiaryMemberId: authorization.beneficiaryMemberId,
      capacityState: "low",
      checkoutExpiresAt: new Date("2026-08-01T13:30:00.000Z"),
      now: new Date("2026-08-01T12:30:00.000Z"),
      payerMemberId: authorization.payerMemberId,
      tx: tx as never,
    })).resolves.toEqual({ kind: "reactivated" });

    expect(authorization).toMatchObject({
      monthlyCapMinor: 500,
      recoveryStartedAt: null,
      status: HostedGroupSponsorshipAuthorizationStatus.active,
    });
    expect(purchase.status).toBe(
      HostedUsageCreditPurchaseStatus.payment_failed,
    );
    expect(updatePurchase).not.toHaveBeenCalled();
  });
});
