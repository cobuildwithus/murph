import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";

import {
  buildHostedPulseTrialResetStripeUpdateParams,
  buildHostedPulseTrialResetWindow,
  classifyHostedPulseTrialResetSubscription,
  createPrismaHostedPulseTrialResetCandidateSource,
  parseHostedPulseTrialResetBatchSize,
  resetHostedPulseTrials,
  type HostedPulseTrialResetCandidate,
  type HostedPulseTrialResetCandidateSource,
  type HostedPulseTrialResetStripeClient,
  type HostedPulseTrialResetStripeSubscription,
  type HostedPulseTrialResetStripeUpdateParams,
} from "../src/lib/hosted-ops/pulse-trial-reset";
import {
  HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY,
} from "@/src/lib/hosted-onboarding/billing-plans";

describe("Pulse Trial reset service", () => {
  test("parses bounded batch sizes", () => {
    assert.equal(parseHostedPulseTrialResetBatchSize("25"), 25);
    assert.equal(parseHostedPulseTrialResetBatchSize("500"), 500);
    assert.throws(
      () => parseHostedPulseTrialResetBatchSize("0"),
      /--batch-size must be an integer from 1 to 500/u,
    );
  });

  test("builds a fresh 10-day trial window", () => {
    assert.deepEqual(
      buildHostedPulseTrialResetWindow(new Date("2026-06-30T12:00:00.000Z")),
      {
        trialEndsAt: new Date("2026-07-10T12:00:00.000Z"),
        trialStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      },
    );
  });

  test("normalizes trial end to Stripe whole-second precision", () => {
    assert.deepEqual(
      buildHostedPulseTrialResetWindow(new Date("2026-06-30T17:21:24.169Z")),
      {
        trialEndsAt: new Date("2026-07-10T17:21:24.000Z"),
        trialStartedAt: new Date("2026-06-30T17:21:24.169Z"),
      },
    );
  });

  test("validates Stripe trialing subscription ownership before reset", () => {
    const candidate = makeCandidate();
    assert.deepEqual(
      classifyHostedPulseTrialResetSubscription({
        candidate,
        subscription: makeSubscription(),
      }),
      { ok: true },
    );
    assert.deepEqual(
      classifyHostedPulseTrialResetSubscription({
        candidate,
        subscription: makeSubscription({ status: "active" }),
      }),
      {
        ok: false,
        reason: "stripe_subscription_not_trialing",
      },
    );
    assert.deepEqual(
      classifyHostedPulseTrialResetSubscription({
        candidate,
        subscription: makeSubscription({ customer: "cus_other" }),
      }),
      {
        ok: false,
        reason: "stripe_customer_mismatch",
      },
    );
  });

  test("dry-run counts eligible rows without touching Stripe or DB", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient();

    const summary = await resetHostedPulseTrials({
      candidateSource: source,
      now: new Date("2026-06-30T12:00:00.000Z"),
      stripe,
    });

    assert.equal(summary.candidates, 1);
    assert.equal(summary.wouldReset, 1);
    assert.equal(summary.reset, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("apply updates Stripe before the local billing row", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient();

    const summary = await resetHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: new Date("2026-06-30T12:00:00.000Z"),
      stripe,
    });

    assert.equal(summary.candidates, 1);
    assert.equal(summary.reset, 1);
    assert.equal(summary.usagePeriodsReset, 0);
    assert.equal(summary.wouldReset, 0);
    assert.equal(stripe.updateCalls.length, 1);
    assert.equal(source.updateCalls.length, 1);
    assert.deepEqual(stripe.updateCalls[0]?.params, {
      metadata: {
        checkoutOffer: "pulse_trial_7d",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
        [HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY]:
          "2026-06-30T12:00:00.000Z",
      },
      trial_end: 1_783_684_800,
    });
    assert.deepEqual(source.updateCalls[0]?.resetWindow, {
      trialEndsAt: new Date("2026-07-10T12:00:00.000Z"),
      trialStartedAt: new Date("2026-06-30T12:00:00.000Z"),
    });
  });

  test("builds Stripe update params with the current trial policy metadata", () => {
    assert.deepEqual(
      buildHostedPulseTrialResetStripeUpdateParams(
        buildHostedPulseTrialResetWindow(new Date("2026-06-30T12:00:00.000Z")),
      ),
      {
        metadata: {
          checkoutOffer: "pulse_trial_7d",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
          [HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY]:
            "2026-06-30T12:00:00.000Z",
        },
        trial_end: 1_783_684_800,
      },
    );
  });

  test("Prisma candidate updates reset billing and the matching AI usage period together", async () => {
    const billingRefUpdate = vi.fn(async (args: unknown) => args);
    const usagePeriodUpsert = vi.fn(async (args: unknown) => args);
    const tx = {
      hostedAiUsagePeriod: {
        upsert: usagePeriodUpsert,
      },
      hostedMemberBillingRef: {
        update: billingRefUpdate,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const resetWindow = buildHostedPulseTrialResetWindow(
      new Date("2026-06-30T17:21:24.169Z"),
    );

    const result = await createPrismaHostedPulseTrialResetCandidateSource(
      prisma as never,
    ).updateCandidateTrialWindow({
      candidate: makeCandidate(),
      resetWindow,
    });

    assert.deepEqual(result, {
      usagePeriodReset: true,
    });
    assert.equal(prisma.$transaction.mock.calls.length, 1);
    assert.equal(billingRefUpdate.mock.calls.length, 1);
    assert.equal(usagePeriodUpsert.mock.calls.length, 1);
    assert.deepEqual(billingRefUpdate.mock.calls[0]?.[0], {
      data: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: new Date("2026-07-10T17:21:24.000Z"),
        currentPeriodStart: new Date("2026-06-30T17:21:24.169Z"),
        currentTrialEndsAt: new Date("2026-07-10T17:21:24.000Z"),
        currentTrialStartedAt: new Date("2026-06-30T17:21:24.169Z"),
        lastStripeEventCreatedAt: new Date("2026-06-30T17:21:24.169Z"),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-30T17:21:24.169Z"),
      },
      where: {
        memberId: "member_123",
      },
    });
    assert.deepEqual(usagePeriodUpsert.mock.calls[0]?.[0], {
      create: {
        billingPlanCode: "launch_monthly",
        blockedAt: null,
        lastUsageAt: null,
        limitNoticeSentAt: null,
        limitUsdMicros: 4_500_000n,
        memberId: "member_123",
        periodEnd: new Date("2026-07-10T17:21:24.000Z"),
        periodStart: new Date("2026-06-30T17:21:24.169Z"),
        spentUsdMicros: 0n,
      },
      update: {
        billingPlanCode: "launch_monthly",
        blockedAt: null,
        lastUsageAt: null,
        limitNoticeSentAt: null,
        limitUsdMicros: 4_500_000n,
        periodEnd: new Date("2026-07-10T17:21:24.000Z"),
        spentUsdMicros: 0n,
      },
      where: {
        memberId_periodStart: {
          memberId: "member_123",
          periodStart: new Date("2026-06-30T17:21:24.169Z"),
        },
      },
    });
  });
});

function makeCandidate(
  overrides: Partial<HostedPulseTrialResetCandidate> = {},
): HostedPulseTrialResetCandidate {
  return {
    currentTrialEndsAt: new Date("2026-07-01T12:00:00.000Z"),
    currentTrialStartedAt: new Date("2026-06-24T12:00:00.000Z"),
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<HostedPulseTrialResetStripeSubscription> = {},
): HostedPulseTrialResetStripeSubscription {
  return {
    customer: "cus_123",
    id: "sub_123",
    metadata: {
      checkoutOffer: "pulse_trial_7d",
    },
    status: "trialing",
    ...overrides,
  };
}

function makeCandidateSource(
  candidates: readonly HostedPulseTrialResetCandidate[],
): HostedPulseTrialResetCandidateSource & {
  updateCalls: Array<{
    candidate: HostedPulseTrialResetCandidate;
    resetWindow: ReturnType<typeof buildHostedPulseTrialResetWindow>;
  }>;
} {
  const updateCalls: Array<{
    candidate: HostedPulseTrialResetCandidate;
    resetWindow: ReturnType<typeof buildHostedPulseTrialResetWindow>;
  }> = [];
  return {
    async listCandidates(input) {
      const startIndex = input.afterMemberId
        ? candidates.findIndex((candidate) => candidate.memberId === input.afterMemberId) + 1
        : 0;
      return candidates.slice(startIndex, startIndex + input.limit);
    },
    async updateCandidateTrialWindow(input) {
      updateCalls.push(input);
    },
    updateCalls,
  };
}

function makeStripeClient(): HostedPulseTrialResetStripeClient & {
  updateCalls: Array<{
    options: { idempotencyKey: string };
    params: HostedPulseTrialResetStripeUpdateParams;
    subscriptionId: string;
  }>;
} {
  const updateCalls: Array<{
    options: { idempotencyKey: string };
    params: HostedPulseTrialResetStripeUpdateParams;
    subscriptionId: string;
  }> = [];
  return {
    async retrieveSubscription() {
      return makeSubscription();
    },
    async updateSubscription(subscriptionId, params, options) {
      updateCalls.push({
        options,
        params,
        subscriptionId,
      });
      return makeSubscription();
    },
    updateCalls,
  };
}
