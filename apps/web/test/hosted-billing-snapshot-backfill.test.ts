import type Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyStripeSubscriptionUpdated: vi.fn(),
  getPrisma: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    hostedMemberBillingRef: {
      findMany: vi.fn(),
    },
  },
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  resolveHostedStripeSubscriptionBillingPlanCode: vi.fn(),
  stripe: {
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
  resolveHostedStripeSubscriptionBillingPlanCode:
    mocks.resolveHostedStripeSubscriptionBillingPlanCode,
}));

import { parseHostedBillingSnapshotBackfillCliArgs } from "@/scripts/backfill-hosted-billing-snapshots";
import { backfillHostedBillingSnapshots } from "@/src/lib/hosted-onboarding/stripe-billing-snapshot-backfill";

describe("backfillHostedBillingSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requireHostedStripeApi.mockReturnValue(mocks.stripe);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.prisma),
    );
    mocks.prisma.hostedMemberBillingRef.findMany.mockResolvedValue([
      { memberId: "member_123" },
    ]);
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      currentBillingPlanCode: null,
      lastStripeEventCreatedAt: new Date("2026-05-04T12:00:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription({
      customer: "cus_123",
      status: "active",
    }));
    mocks.resolveHostedStripeSubscriptionBillingPlanCode.mockReturnValue("launch_monthly");
  });

  test("dry-runs missing hosted billing snapshots without mutating rows", async () => {
    await expect(backfillHostedBillingSnapshots({
      now: new Date("2026-05-06T00:00:00.000Z"),
      prisma: mocks.prisma as never,
      stripe: mocks.stripe as never,
    })).resolves.toMatchObject({
      apply: false,
      scanned: 1,
      updated: 0,
      wouldUpdate: 1,
    });

    expect(mocks.prisma.hostedMemberBillingRef.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        memberId: true,
      },
      take: 100,
      where: expect.objectContaining({
        stripeSubscriptionIdEncrypted: {
          not: null,
        },
      }),
    }));
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123", {
      expand: ["items.data.price"],
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("applies the existing Stripe subscription reconciliation path", async () => {
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce({
        currentBillingPlanCode: null,
        lastStripeEventCreatedAt: new Date("2026-05-04T12:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      })
      .mockResolvedValueOnce({
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        currentPeriodEnd: new Date("2026-06-03T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-05-03T00:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      });

    await expect(backfillHostedBillingSnapshots({
      apply: true,
      now: new Date("2026-05-06T00:00:00.000Z"),
      prisma: mocks.prisma as never,
      stripe: mocks.stripe as never,
    })).resolves.toMatchObject({
      apply: true,
      failed: 0,
      scanned: 1,
      updated: 1,
      wouldUpdate: 0,
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub_123",
      }),
      expect.objectContaining({
        eventCreatedAt: new Date("2026-05-04T12:00:00.000Z"),
        sourceEventId: expect.stringMatching(
          /^stripe-subscription-snapshot-backfill:[a-f0-9]{32}$/u,
        ),
        sourceType: "stripe.customer.subscription.updated.snapshot-backfill",
      }),
      mocks.prisma,
    );
  });

  test("skips customer mismatches and unresolved subscription plans", async () => {
    mocks.prisma.hostedMemberBillingRef.findMany.mockResolvedValue([
      { memberId: "member_customer_mismatch" },
      { memberId: "member_unresolved_plan" },
    ]);
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce({
        currentBillingPlanCode: null,
        memberId: "member_customer_mismatch",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_mismatch",
      })
      .mockResolvedValueOnce({
        currentBillingPlanCode: null,
        memberId: "member_unresolved_plan",
        stripeCustomerId: "cus_456",
        stripeSubscriptionId: "sub_unresolved",
      });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_other",
        status: "active",
      }))
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_456",
        status: "active",
      }));
    mocks.resolveHostedStripeSubscriptionBillingPlanCode.mockReturnValueOnce(null);

    await expect(backfillHostedBillingSnapshots({
      apply: true,
      prisma: mocks.prisma as never,
      stripe: mocks.stripe as never,
    })).resolves.toMatchObject({
      customerMismatch: 1,
      scanned: 2,
      unresolvedPlan: 1,
      updated: 0,
    });

    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });
});

describe("parseHostedBillingSnapshotBackfillCliArgs", () => {
  test("defaults to dry-run and parses apply plus limit", () => {
    expect(parseHostedBillingSnapshotBackfillCliArgs([])).toEqual({
      apply: false,
    });
    expect(parseHostedBillingSnapshotBackfillCliArgs(["--apply", "--limit=25"])).toEqual({
      apply: true,
      limit: 25,
    });
    expect(parseHostedBillingSnapshotBackfillCliArgs(["--apply", "--dry-run"])).toEqual({
      apply: false,
    });
    expect(parseHostedBillingSnapshotBackfillCliArgs(["--apply", "--dryrun"])).toEqual({
      apply: false,
    });
  });

  test("rejects unknown and invalid arguments", () => {
    expect(() => parseHostedBillingSnapshotBackfillCliArgs(["--wat"]))
      .toThrow("Unknown argument: --wat");
    expect(() => parseHostedBillingSnapshotBackfillCliArgs(["--limit", "0"]))
      .toThrow("--limit must be an integer between 1 and 1000.");
  });
});

function makeSubscription(input: {
  customer: string;
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Subscription.
  return {
    customer: input.customer,
    id: "sub_123",
    items: {
      data: [
        {
          id: "si_123",
          price: {
            id: "price_pulse_recurring",
          },
        },
      ],
    },
    metadata: {
      billingPlanCode: "launch_monthly",
    },
    object: "subscription",
    pending_update: null,
    status: input.status,
  } as Stripe.Subscription;
}
