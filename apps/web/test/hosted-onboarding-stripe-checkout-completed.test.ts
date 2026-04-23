import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  findMemberForStripeCheckoutSession: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
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
  };
});

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeCheckoutSession,
  };
});

import { applyStripeCheckoutCompleted } from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("applyStripeCheckoutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(makeMemberSnapshot());
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      lastStripeEventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
  });

  it("writes checkout-session refs with a session-derived freshness watermark", async () => {
    await expect(
      applyStripeCheckoutCompleted(
        {
          created: 1_744_416_000,
          customer: "cus_123",
          id: "cs_123",
          subscription: "sub_123",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeEventCreatedAt: new Date(1_744_416_000 * 1000),
      stripeSubscriptionId: "sub_123",
      tx: {},
    });
  });

  it("ignores stale checkout sessions once a fresher billing ref watermark exists", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T02:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_current",
        stripeSubscriptionId: "sub_current",
      },
    }));

    await expect(
      applyStripeCheckoutCompleted(
        {
          created: 1_744_412_400,
          customer: "cus_old",
          id: "cs_old",
          subscription: "sub_old",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  });
});

function makeMemberSnapshot(overrides?: {
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
}): HostedMemberBillingSnapshot {
  return {
    billingRef: overrides?.billingRef ?? {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: HostedBillingStatus.not_started,
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
  };
}
