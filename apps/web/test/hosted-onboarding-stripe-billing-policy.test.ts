import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
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
  };
});

import {
  prepareHostedMemberStripeBillingWrite,
  updateHostedMemberStripeBillingIfFreshTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";

describe("hosted onboarding stripe billing policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.readHostedMemberCoreState.mockResolvedValue(makeMemberSnapshot().core);
    mocks.retrieveStripeSubscription.mockResolvedValue({
      status: "active",
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue(undefined);
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("reads the canonical Stripe subscription before acquiring the hosted member lock", async () => {
    const trace: string[] = [];
    const rootPrisma = {
      __tag: "root",
    };
    const tx = {
      __tag: "tx",
    };

    mocks.readHostedMemberBillingSnapshot.mockImplementation(async ({ prisma }) => {
      trace.push(prisma === tx ? "locked-billing-read" : "pre-lock-read");
      return makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      });
    });
    mocks.readHostedMemberCoreState.mockImplementation(async () => {
      trace.push("locked-core-read");
      return makeMemberSnapshot().core;
    });
    mocks.retrieveStripeSubscription.mockImplementation(async () => {
      trace.push("stripe-read");
      return {
        status: "active",
      };
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-row");
    });
    const prepared = await prepareHostedMemberStripeBillingWrite({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_123",
        sourceType: "stripe.customer.subscription.updated",
      },
      member: makeMemberSnapshot(),
      prisma: rootPrisma as never,
      stripeSubscriptionId: "sub_123",
    });

    await expect(
      updateHostedMemberStripeBillingIfFreshTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: prepared.canonicalBillingStatus,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_123",
          sourceType: "stripe.customer.subscription.updated",
        },
        member: prepared.member,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx: tx as never,
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
      "lock-row",
      "locked-core-read",
      "locked-billing-read",
    ]);
  });

  it("refreshes the member snapshot before canonical lookup when invoice events need the stored subscription id", async () => {
    const trace: string[] = [];
    const rootPrisma = {
      __tag: "root",
    };
    const tx = {
      __tag: "tx",
    };

    let currentBillingStatus = HostedBillingStatus.active;
    mocks.readHostedMemberBillingSnapshot.mockImplementation(async ({ prisma }) => {
      trace.push(prisma === rootPrisma ? "pre-lock-read" : "locked-billing-read");

      return makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_456",
        },
        core: {
          billingStatus: currentBillingStatus,
        },
      });
    });
    mocks.readHostedMemberCoreState.mockImplementation(async () => {
      trace.push("locked-core-read");
      return makeMemberSnapshot({
        core: {
          billingStatus: currentBillingStatus,
        },
      }).core;
    });
    mocks.updateHostedMemberCoreState.mockImplementation(async ({ billingStatus }) => {
      currentBillingStatus = billingStatus;
      return makeMemberSnapshot({
        core: {
          billingStatus,
        },
      }).core;
    });
    mocks.retrieveStripeSubscription.mockImplementation(async (subscriptionId: string) => {
      trace.push(`stripe-read:${subscriptionId}`);
      return {
        status: "past_due",
      };
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-row");
    });
    const prepared = await prepareHostedMemberStripeBillingWrite({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
        occurredAt: "2026-04-12T00:00:00.000Z",
        sourceEventId: "evt_456",
        sourceType: "stripe.invoice.payment_failed",
      },
      member: makeMemberSnapshot(),
      prisma: rootPrisma as never,
    });

    await expect(
      updateHostedMemberStripeBillingIfFreshTx({
        billingStatus: HostedBillingStatus.past_due,
        canonicalBillingStatus: prepared.canonicalBillingStatus,
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_456",
          sourceType: "stripe.invoice.payment_failed",
        },
        member: prepared.member,
        stripeCustomerId: "cus_123",
        tx: tx as never,
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
      "lock-row",
      "locked-core-read",
      "locked-billing-read",
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
