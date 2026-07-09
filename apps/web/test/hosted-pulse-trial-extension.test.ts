import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";

import {
  withHostedMemberStripeMutationLock,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  buildHostedPulseTrialExtensionStripeUpdateParams,
  classifyHostedPulseTrialExtensionSubscription,
  createPrismaHostedPulseTrialExtensionCandidateSource,
  extendHostedPulseTrials,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY,
  HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY,
  type HostedPulseTrialExtensionCandidate,
  type HostedPulseTrialExtensionCandidateSource,
  type HostedPulseTrialExtensionStripeClient,
  type HostedPulseTrialExtensionStripeSubscription,
  type HostedPulseTrialExtensionStripeUpdateParams,
} from "../src/lib/hosted-ops/pulse-trial-extension";

const NOW = new Date("2026-07-09T12:00:00.000Z");
const ORIGINAL_TRIAL_END = new Date("2026-07-12T12:00:00.000Z");
const EXTENDED_TRIAL_END = new Date("2026-07-19T12:00:00.000Z");

describe("Pulse Trial beta extension", () => {
  test("holds the member row lock for the serialized Stripe mutation", async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        events.push("lock");
        return [];
      }),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<string>) => {
        events.push("transaction");
        const result = await callback(tx);
        events.push("commit");
        return result;
      }),
    };

    const result = await withHostedMemberStripeMutationLock({
      memberId: "member_test",
      prisma: prisma as never,
      run: async () => {
        events.push("stripe");
        return "done";
      },
    });

    assert.equal(result, "done");
    assert.deepEqual(events, ["transaction", "lock", "stripe", "commit"]);
    assert.equal(tx.$queryRaw.mock.calls.length, 1);
  });

  test("validates current Stripe trial ownership and campaign state", () => {
    const candidate = makeCandidate();
    assert.deepEqual(
      classifyHostedPulseTrialExtensionSubscription({
        candidate,
        nowUnixSeconds: toUnixSeconds(NOW),
        subscription: makeSubscription(),
      }),
      {
        alreadyMarked: false,
        ok: true,
        stripeTrialEnd: toUnixSeconds(ORIGINAL_TRIAL_END),
      },
    );

    assert.deepEqual(
      classifyHostedPulseTrialExtensionSubscription({
        candidate,
        nowUnixSeconds: toUnixSeconds(NOW),
        subscription: makeSubscription({ customer: "cus_other" }),
      }),
      { ok: false, reason: "stripe_customer_mismatch" },
    );
    assert.deepEqual(
      classifyHostedPulseTrialExtensionSubscription({
        candidate,
        nowUnixSeconds: toUnixSeconds(NOW),
        subscription: makeSubscription({
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "pulse_trial_7d",
            [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]: "another-campaign",
          },
        }),
      }),
      { ok: false, reason: "stripe_campaign_marker_conflict" },
    );
  });

  test("rejects mismatched Stripe subscription, offer, and plan facts", () => {
    const candidate = makeCandidate();
    const cases: Array<{
      expectedReason:
        | "stripe_billing_plan_mismatch"
        | "stripe_checkout_offer_mismatch"
        | "stripe_subscription_id_mismatch";
      subscription: HostedPulseTrialExtensionStripeSubscription;
    }> = [
      {
        expectedReason: "stripe_subscription_id_mismatch",
        subscription: makeSubscription({ id: "sub_other" }),
      },
      {
        expectedReason: "stripe_checkout_offer_mismatch",
        subscription: makeSubscription({
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "another_offer",
          },
        }),
      },
      {
        expectedReason: "stripe_billing_plan_mismatch",
        subscription: makeSubscription({
          metadata: {
            billingPlanCode: "edge_monthly",
            checkoutOffer: "pulse_trial_7d",
          },
        }),
      },
    ];

    for (const entry of cases) {
      assert.deepEqual(
        classifyHostedPulseTrialExtensionSubscription({
          candidate,
          nowUnixSeconds: toUnixSeconds(NOW),
          subscription: entry.subscription,
        }),
        { ok: false, reason: entry.expectedReason },
      );
    }
  });

  test("dry-run reports eligible trials without mutating Stripe or local state", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient();

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      now: NOW,
      stripe,
    });

    assert.equal(summary.candidates, 1);
    assert.equal(summary.wouldExtend, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("apply extends from the existing Stripe end by exactly seven days before local reconciliation", async () => {
    const events: string[] = [];
    const source = makeCandidateSource([makeCandidate()], { events });
    const stripe = makeStripeClient(makeSubscription(), events);

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.stripeTrialsExtended, 1);
    assert.equal(summary.localWindowsReconciled, 1);
    assert.deepEqual(events, ["stripe", "database"]);
    assert.deepEqual(stripe.updateCalls[0]?.params, {
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
      proration_behavior: "none",
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    });
    assert.match(
      stripe.updateCalls[0]?.options.idempotencyKey ?? "",
      /pulse-beta-extension-2026-07/u,
    );
    assert.deepEqual(source.candidates[0], {
      ...makeCandidate(),
      currentPeriodEnd: EXTENDED_TRIAL_END,
      currentTrialEndsAt: EXTENDED_TRIAL_END,
      usagePeriodEnd: EXTENDED_TRIAL_END,
    });
  });

  test("a repeated apply does not extend Stripe twice", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient();

    const first = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });
    const second = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(first.stripeTrialsExtended, 1);
    assert.equal(second.stripeTrialsExtended, 0);
    assert.equal(second.alreadyExtended, 1);
    assert.equal(stripe.updateCalls.length, 1);
    assert.equal(source.updateCalls.length, 1);
  });

  test("a retry repairs local state after Stripe succeeded without extending Stripe again", async () => {
    const source = makeCandidateSource([makeCandidate()], { failUpdates: 1 });
    const stripe = makeStripeClient();

    const first = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });
    const second = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(first.stripeTrialsExtended, 1);
    assert.equal(first.failures.db_update_failed, 1);
    assert.equal(second.stripeTrialsExtended, 0);
    assert.equal(second.localWindowsReconciled, 1);
    assert.equal(stripe.updateCalls.length, 1);
    assert.equal(source.updateCalls.length, 2);
    assert.equal(source.candidates[0]?.currentTrialEndsAt?.getTime(), EXTENDED_TRIAL_END.getTime());
  });

  test("does not reconcile local windows when the Stripe extension fails", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const updateSubscription = vi.fn(async () => {
      throw new Error("Synthetic Stripe update failure.");
    });
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        return makeSubscription();
      },
      updateSubscription,
    };

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.failures.stripe_update_failed, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(updateSubscription.mock.calls.length, 1);
    assert.equal(source.updateCalls.length, 0);
  });

  test("does not call Stripe when the matching local usage period is missing", async () => {
    const source = makeCandidateSource([makeCandidate({ usagePeriodEnd: null })]);
    const stripe = makeStripeClient();

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.skipped.local_usage_period_missing, 1);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
  });

  test("uses current Stripe trial status when local end timestamps are stale", async () => {
    const staleLocalEnd = new Date("2026-07-08T12:00:00.000Z");
    const source = makeCandidateSource([makeCandidate({
      currentPeriodEnd: staleLocalEnd,
      currentTrialEndsAt: staleLocalEnd,
      usagePeriodEnd: staleLocalEnd,
    })]);
    const stripe = makeStripeClient();

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.stripeTrialsExtended, 1);
    assert.equal(summary.localWindowsReconciled, 1);
    assert.equal(source.candidates[0]?.currentTrialEndsAt?.getTime(), EXTENDED_TRIAL_END.getTime());
  });

  test("does not restore a trial when paid conversion wins the shared mutation lock", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const initialTrial = makeSubscription();
    const convertedSubscription = makeSubscription({
      status: "active",
      trial_end: null,
    });
    let retrieveCalls = 0;
    const updateSubscription = vi.fn();
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        retrieveCalls += 1;
        return retrieveCalls === 1 ? initialTrial : convertedSubscription;
      },
      updateSubscription,
    };

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(retrieveCalls, 2);
    assert.equal(summary.skipped.stripe_subscription_not_trialing, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(source.updateCalls.length, 0);
    assert.equal(updateSubscription.mock.calls.length, 0);
  });

  test("Prisma reconciliation updates only billing and usage end timestamps in one transaction", async () => {
    const billingUpdate = vi.fn(async (input: unknown) => {
      void input;
      return { count: 1 };
    });
    const usageUpdate = vi.fn(async (input: unknown) => {
      void input;
      return { count: 1 };
    });
    const tx = {
      hostedAiUsagePeriod: { updateMany: usageUpdate },
      hostedMemberBillingRef: { updateMany: billingUpdate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    await createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
    ).updateCandidateTrialEnd({
      candidate: makeCandidate(),
      trialEndsAt: EXTENDED_TRIAL_END,
    });

    assert.deepEqual(billingUpdate.mock.calls[0]?.[0], {
      data: {
        currentPeriodEnd: EXTENDED_TRIAL_END,
        currentTrialEndsAt: EXTENDED_TRIAL_END,
      },
      where: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
        memberId: "member_test",
      },
    });
    assert.deepEqual(usageUpdate.mock.calls[0]?.[0], {
      data: { periodEnd: EXTENDED_TRIAL_END },
      where: {
        billingPlanCode: "launch_monthly",
        memberId: "member_test",
        periodStart: new Date("2026-07-02T12:00:00.000Z"),
      },
    });
  });

  test("Prisma candidate scan selects active unsuspended trial refs without trusting a local end cutoff", async () => {
    const findMany = vi.fn(async (input: unknown) => {
      void input;
      return [];
    });
    const prisma = {
      hostedMemberBillingRef: { findMany },
    };

    await createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
    ).listCandidates({
      afterMemberId: null,
      limit: 100,
    });

    assert.deepEqual(findMany.mock.calls[0]?.[0], {
      orderBy: { memberId: "asc" },
      take: 100,
      where: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        member: {
          billingStatus: "active",
          suspendedAt: null,
        },
      },
    });
  });

  test("builds a metadata-preserving, non-prorating Stripe update", () => {
    assert.deepEqual(
      buildHostedPulseTrialExtensionStripeUpdateParams({
        subscription: makeSubscription(),
        targetTrialEnd: toUnixSeconds(EXTENDED_TRIAL_END),
      }),
      {
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_test",
          [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
            HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
          [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
        },
        proration_behavior: "none",
        trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
      },
    );
  });
});

function makeCandidate(
  overrides: Partial<HostedPulseTrialExtensionCandidate> = {},
): HostedPulseTrialExtensionCandidate {
  return {
    currentPeriodEnd: ORIGINAL_TRIAL_END,
    currentTrialEndsAt: ORIGINAL_TRIAL_END,
    currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
    memberId: "member_test",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    usagePeriodEnd: ORIGINAL_TRIAL_END,
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<HostedPulseTrialExtensionStripeSubscription> = {},
): HostedPulseTrialExtensionStripeSubscription {
  return {
    customer: "cus_test",
    id: "sub_test",
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_test",
    },
    status: "trialing",
    trial_end: toUnixSeconds(ORIGINAL_TRIAL_END),
    ...overrides,
  };
}

function makeCandidateSource(
  initialCandidates: readonly HostedPulseTrialExtensionCandidate[],
  options: {
    events?: string[];
    failUpdates?: number;
  } = {},
): HostedPulseTrialExtensionCandidateSource & {
  candidates: HostedPulseTrialExtensionCandidate[];
  updateCalls: Array<{
    candidate: HostedPulseTrialExtensionCandidate;
    trialEndsAt: Date;
  }>;
} {
  const candidates = initialCandidates.map((candidate) => ({ ...candidate }));
  const updateCalls: Array<{
    candidate: HostedPulseTrialExtensionCandidate;
    trialEndsAt: Date;
  }> = [];
  let remainingFailures = options.failUpdates ?? 0;

  return {
    candidates,
    async listCandidates(input) {
      const startIndex = input.afterMemberId
        ? candidates.findIndex((candidate) => candidate.memberId === input.afterMemberId) + 1
        : 0;
      return candidates.slice(startIndex, startIndex + input.limit);
    },
    async updateCandidateTrialEnd(input) {
      options.events?.push("database");
      updateCalls.push(input);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("Synthetic local write failure.");
      }

      const candidate = candidates.find(
        (entry) => entry.memberId === input.candidate.memberId,
      );
      if (!candidate) {
        throw new Error("Synthetic candidate was not found.");
      }
      candidate.currentPeriodEnd = input.trialEndsAt;
      candidate.currentTrialEndsAt = input.trialEndsAt;
      candidate.usagePeriodEnd = input.trialEndsAt;
    },
    updateCalls,
    async withStripeMutationLock(input) {
      return input.run();
    },
  };
}

function makeStripeClient(
  initialSubscription = makeSubscription(),
  events?: string[],
): HostedPulseTrialExtensionStripeClient & {
  retrieveCalls: number;
  updateCalls: Array<{
    options: { idempotencyKey: string };
    params: HostedPulseTrialExtensionStripeUpdateParams;
    subscriptionId: string;
  }>;
} {
  let subscription = {
    ...initialSubscription,
    metadata: { ...(initialSubscription.metadata ?? {}) },
  };
  const client = {
    retrieveCalls: 0,
    updateCalls: [] as Array<{
      options: { idempotencyKey: string };
      params: HostedPulseTrialExtensionStripeUpdateParams;
      subscriptionId: string;
    }>,
    async retrieveSubscription() {
      client.retrieveCalls += 1;
      return subscription;
    },
    async updateSubscription(
      subscriptionId: string,
      params: HostedPulseTrialExtensionStripeUpdateParams,
      options: { idempotencyKey: string },
    ) {
      events?.push("stripe");
      client.updateCalls.push({ options, params, subscriptionId });
      subscription = {
        ...subscription,
        metadata: { ...params.metadata },
        trial_end: params.trial_end,
      };
      return subscription;
    },
  };
  return client;
}

function toUnixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}
