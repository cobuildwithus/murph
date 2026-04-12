import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  withHostedOnboardingTransaction: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRef: mocks.writeHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: () => ({
    subscriptions: {
      retrieve: mocks.retrieveStripeSubscription,
    },
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
    withHostedOnboardingTransaction: mocks.withHostedOnboardingTransaction,
  };
});

import { updateHostedMemberStripeBillingIfFresh } from "@/src/lib/hosted-onboarding/stripe-billing-policy";

describe("hosted onboarding stripe billing policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.retrieveStripeSubscription.mockResolvedValue({
      status: "active",
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue(undefined);
    mocks.withHostedOnboardingTransaction.mockImplementation(async (prisma, callback) =>
      callback(prisma as never),
    );
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("reads the canonical Stripe subscription before acquiring the hosted member lock", async () => {
    const trace: string[] = [];
    const transaction = {
      __tag: "tx",
    };

    mocks.readHostedMemberSnapshot.mockImplementation(async ({ prisma }) => {
      trace.push(prisma === transaction ? "locked-read" : "pre-lock-read");
      return makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      });
    });
    mocks.retrieveStripeSubscription.mockImplementation(async () => {
      trace.push("stripe-read");
      return {
        status: "active",
      };
    });
    mocks.withHostedOnboardingTransaction.mockImplementation(async (_prisma, callback) => {
      trace.push("with-transaction");
      return callback(transaction as never);
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-row");
    });

    await expect(
      updateHostedMemberStripeBillingIfFresh({
        billingStatus: HostedBillingStatus.past_due,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_123",
          sourceType: "stripe.customer.subscription.updated",
        },
        member: makeMemberSnapshot(),
        prisma: {} as never,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
    ).resolves.toEqual(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      }),
    );

    expect(trace).toEqual([
      "stripe-read",
      "with-transaction",
      "lock-row",
      "locked-read",
      "locked-read",
    ]);
  });

  it("refreshes the member snapshot before canonical lookup when invoice events need the stored subscription id", async () => {
    const trace: string[] = [];
    const rootPrisma = {
      __tag: "root",
    };
    const transaction = {
      __tag: "tx",
    };

    let readCount = 0;
    mocks.readHostedMemberSnapshot.mockImplementation(async ({ prisma }) => {
      readCount += 1;
      trace.push(prisma === rootPrisma ? "pre-lock-read" : "locked-read");

      return makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: readCount === 3 ? HostedBillingStatus.past_due : HostedBillingStatus.active,
        },
      });
    });
    mocks.retrieveStripeSubscription.mockImplementation(async (subscriptionId: string) => {
      trace.push(`stripe-read:${subscriptionId}`);
      return {
        status: "past_due",
      };
    });
    mocks.withHostedOnboardingTransaction.mockImplementation(async (_prisma, callback) => {
      trace.push("with-transaction");
      return callback(transaction as never);
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-row");
    });

    await expect(
      updateHostedMemberStripeBillingIfFresh({
        billingStatus: HostedBillingStatus.past_due,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_456",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: makeMemberSnapshot(),
        prisma: rootPrisma as never,
        stripeCustomerId: "cus_123",
      }),
    ).resolves.toEqual(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: HostedBillingStatus.past_due,
        },
      }),
    );

    expect(trace).toEqual([
      "pre-lock-read",
      "stripe-read:sub_456",
      "with-transaction",
      "lock-row",
      "locked-read",
      "locked-read",
    ]);
  });
});

function makeMemberSnapshot(overrides?: {
  billingRef?: HostedMemberSnapshot["billingRef"];
  core?: Partial<HostedMemberSnapshot["core"]>;
}): HostedMemberSnapshot {
  const core = overrides?.core ?? {};

  return {
    billingRef: overrides?.billingRef ?? null,
    core: {
      billingStatus: core.billingStatus ?? HostedBillingStatus.active,
      createdAt: core.createdAt ?? new Date("2026-04-12T00:00:00.000Z"),
      id: core.id ?? "member_123",
      suspendedAt: core.suspendedAt ?? null,
      updatedAt: core.updatedAt ?? new Date("2026-04-12T00:00:00.000Z"),
    },
    identity: null,
    routing: null,
  };
}
