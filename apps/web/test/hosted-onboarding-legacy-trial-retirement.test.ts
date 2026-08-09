import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  clearHostedMemberLegacyTrialBillingUnderLockTx: vi.fn(),
  ensureHostedStarterUsageGrantTx: vi.fn(),
  logHostedStripeFailure: vi.fn(),
  readHostedLegacyTrialConsumedUsageUsdMicrosTx: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  clearHostedMemberLegacyTrialBillingUnderLockTx:
    mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
  withHostedMemberStripeMutationLock:
    mocks.withHostedMemberStripeMutationLock,
  withHostedMemberStripeMutationLockForOps: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/starter-usage-grant", () => ({
  ensureHostedStarterUsageGrantTx: mocks.ensureHostedStarterUsageGrantTx,
  readHostedLegacyTrialConsumedUsageUsdMicrosTx:
    mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-error-log", () => ({
  logHostedStripeFailure: mocks.logHostedStripeFailure,
}));

import {
  retireHostedLegacyPulseTrialToStarter,
} from "@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup";

const MEMBER_ID = "member_123";
const CUSTOMER_ID = "cus_123";
const SUBSCRIPTION_ID = "sub_123";
const PRICE_ID = "price_pulse";
const TRIAL_STARTED_AT = new Date("2026-07-10T12:00:00.000Z");
const tx = { kind: "tx" };

describe("legacy Pulse trial retirement to Starter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (transaction: typeof tx) => Promise<unknown> }) =>
        input.run(tx),
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
      buildMemberSnapshot(),
    );
    mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx.mockResolvedValue(
      1_250_000n,
    );
    mocks.ensureHostedStarterUsageGrantTx.mockResolvedValue({
      balanceUsdMicros: 3_250_000n,
      effectiveAt: TRIAL_STARTED_AT,
      entryId: "huce_starter",
      granted: true,
      ledgerVersion: 2n,
    });
    mocks.clearHostedMemberLegacyTrialBillingUnderLockTx.mockResolvedValue(
      undefined,
    );
  });

  it("preserves consumed usage before canceling and clearing the legacy identity", async () => {
    const stripe = buildStripe("trialing");

    await expect(retireHostedLegacyPulseTrialToStarter({
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: stripe as never,
    })).resolves.toBe(true);

    expect(
      mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
    ).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      trialStartedAt: TRIAL_STARTED_AT,
      tx,
    });
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledWith({
      effectiveAt: TRIAL_STARTED_AT,
      initialConsumedUsdMicros: 1_250_000n,
      memberId: MEMBER_ID,
      source: "legacy_trial_migration",
      tx,
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).toHaveBeenCalledWith({
      billingStatusAfterClear: HostedBillingStatus.active,
      memberId: MEMBER_ID,
      tx,
    });
    expect(
      mocks.ensureHostedStarterUsageGrantTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      stripe.subscriptions.cancel.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
  });

  it("uses the redeemed timestamp when an older row lost its trial-start projection", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      ...buildMemberSnapshot(),
      billingRef: {
        ...buildMemberSnapshot().billingRef,
        currentTrialStartedAt: null,
      },
    });
    const stripe = buildStripe("trialing");

    await expect(retireHostedLegacyPulseTrialToStarter({
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: stripe as never,
    })).resolves.toBe(true);

    expect(
      mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
    ).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      trialStartedAt: TRIAL_STARTED_AT,
      tx,
    });
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveAt: TRIAL_STARTED_AT,
        initialConsumedUsdMicros: 1_250_000n,
      }),
    );
  });

  it("preserves a terminal member without granting new capacity", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(
      buildMemberSnapshot({
        billingStatus: HostedBillingStatus.canceled,
      }),
    );
    const stripe = buildStripe("canceled");

    await expect(retireHostedLegacyPulseTrialToStarter({
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: stripe as never,
    })).resolves.toBe(true);

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).toHaveBeenCalledWith({
      billingStatusAfterClear: HostedBillingStatus.canceled,
      memberId: MEMBER_ID,
      tx,
    });
  });

  it("fails closed before changing capacity when provider state may be paid", async () => {
    const stripe = buildStripe("active");

    await expect(retireHostedLegacyPulseTrialToStarter({
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: stripe as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
  });
});

function buildMemberSnapshot(input: {
  billingStatus?: HostedBillingStatus;
} = {}) {
  return {
    billingRef: {
      currentBillingPhase: "trial",
      currentTrialStartedAt: TRIAL_STARTED_AT,
      pulseTrialRedeemedAt: TRIAL_STARTED_AT,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
    },
    core: {
      billingStatus: input.billingStatus ?? HostedBillingStatus.active,
      createdAt: new Date("2026-07-09T12:00:00.000Z"),
      id: MEMBER_ID,
      suspendedAt: null,
      updatedAt: new Date("2026-07-10T12:00:00.000Z"),
    },
  };
}

function buildStripe(status: Stripe.Subscription.Status) {
  const subscription = {
    customer: CUSTOMER_ID,
    id: SUBSCRIPTION_ID,
    items: {
      data: [
        {
          id: "si_trial",
          price: {
            id: PRICE_ID,
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
            },
          },
          quantity: 1,
        },
      ],
      has_more: false,
    },
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: MEMBER_ID,
      trialDurationDays: "14",
      trialPolicyVersion: "pulse-trial-2026-07-15-v3",
      trialUsageLimitUsdMicros: "4500000",
    },
    status,
  } as unknown as Stripe.Subscription;
  return {
    subscriptions: {
      cancel: vi.fn(async () => subscription),
      retrieve: vi.fn(async () => subscription),
    },
  };
}
