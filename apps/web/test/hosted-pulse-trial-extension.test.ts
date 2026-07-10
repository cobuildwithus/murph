import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileHostedAiUsageAllowancePeriodForMemberTx: vi.fn(async () => {}),
}));

vi.mock("../src/lib/hosted-execution/usage-allowance", () => ({
  reconcileHostedAiUsageAllowancePeriodForMemberTx:
    mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
}));

import {
  withHostedMemberStripeMutationLock,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  classifyHostedPulseTrialExtensionSubscription as classifyHostedPulseTrialExtensionSubscriptionWithPrice,
  createPrismaHostedPulseTrialExtensionCandidateSource,
  deriveHostedPulseTrialExtensionCampaign,
  extendHostedPulseTrials as extendHostedPulseTrialsWithPrice,
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
const PRICE_ID = "price_pulse_recurring";
const ORIGINAL_TRIAL_END = new Date("2026-07-12T12:00:00.000Z");
const EXTENDED_TRIAL_END = new Date("2026-07-19T12:00:00.000Z");

describe("Pulse Trial beta extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("holds the member row lock for the serialized Stripe mutation", async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        events.push("lock");
        return [];
      }),
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (transaction: typeof tx) => Promise<string>,
        options?: unknown,
      ) => {
        void options;
        events.push("transaction");
        const result = await callback(tx);
        events.push("commit");
        return result;
      }),
    };

    const result = await withHostedMemberStripeMutationLock({
      memberId: "member_test",
      prisma: prisma as never,
      run: async (lockedTx) => {
        assert.equal(lockedTx, tx);
        events.push("stripe");
        return "done";
      },
    });

    assert.equal(result, "done");
    assert.deepEqual(events, ["transaction", "lock", "stripe", "commit"]);
    assert.equal(tx.$queryRaw.mock.calls.length, 1);
    assert.deepEqual(prisma.$transaction.mock.calls[0]?.[1], {
      maxWait: 5_000,
      timeout: 780_000,
    });
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
        | "stripe_price_mismatch"
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
      {
        expectedReason: "stripe_price_mismatch",
        subscription: makeSubscription({
          items: {
            data: [makeSubscriptionItem({ priceId: "price_other" })],
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

  test.each([
    ["period end", { cancel_at_period_end: true }],
    ["explicit time", { cancel_at: toUnixSeconds(ORIGINAL_TRIAL_END) }],
  ] as const)("skips a trial scheduled to cancel at %s", async (_label, cancellation) => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient(makeSubscription(cancellation));

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.skipped.stripe_subscription_canceling, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
    expect(mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx).not.toHaveBeenCalled();
  });

  test.each([
    ["period end", { cancel_at_period_end: true }],
    ["explicit time", { cancel_at: toUnixSeconds(ORIGINAL_TRIAL_END) }],
  ] as const)("does not locally reconcile a marked trial canceled at %s", async (
    _label,
    cancellation,
  ) => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient(makeSubscription({
      ...cancellation,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    }));

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.skipped.stripe_subscription_canceling, 1);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
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
    assert.equal(stripe.updateCalls[0]?.options.maxNetworkRetries, 2);
    assert.equal(stripe.updateCalls[0]?.options.timeout, 80_000);
    assert.deepEqual(source.candidates[0], {
      ...makeCandidate(),
      currentPeriodEnd: EXTENDED_TRIAL_END,
      currentTrialEndsAt: EXTENDED_TRIAL_END,
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
    assert.equal(source.updateCalls.length, 2);
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
    assert.equal(source.lockCalls, 2);
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

  test("uses current Stripe trial status when local end timestamps are stale", async () => {
    const staleLocalEnd = new Date("2026-07-08T12:00:00.000Z");
    const source = makeCandidateSource([makeCandidate({
      currentPeriodEnd: staleLocalEnd,
      currentTrialEndsAt: staleLocalEnd,
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
    const convertedSubscription = makeSubscription({
      status: "active",
      trial_end: null,
    });
    let retrieveCalls = 0;
    const updateSubscription = vi.fn();
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        retrieveCalls += 1;
        return convertedSubscription;
      },
      updateSubscription,
    };

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(retrieveCalls, 1);
    assert.equal(summary.skipped.stripe_subscription_not_trialing, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(source.updateCalls.length, 0);
    assert.equal(updateSubscription.mock.calls.length, 0);
  });

  test("does not update a trial without the full post-retrieve provider runway", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:05:00.000Z");
      const nearTrialEnd = new Date(safeClock.getTime() + 361_000);
      vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
      const source = makeCandidateSource([makeCandidate({
        currentPeriodEnd: nearTrialEnd,
        currentTrialEndsAt: nearTrialEnd,
      })]);
      const updateSubscription = vi.fn();
      const stripe: HostedPulseTrialExtensionStripeClient = {
        async retrieveSubscription() {
          vi.setSystemTime(safeClock);
          return makeSubscription({ trial_end: toUnixSeconds(nearTrialEnd) });
        },
        updateSubscription,
      };

      const summary = await extendHostedPulseTrials({
        candidateSource: source,
        mode: "apply",
        stripe,
      });

      assert.equal(summary.skipped.stripe_trial_end_invalid, 1);
      assert.equal(summary.stripeTrialsExtended, 0);
      assert.equal(summary.localWindowsReconciled, 0);
      assert.equal(updateSubscription.mock.calls.length, 0);
      assert.equal(source.updateCalls.length, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("dry-run does not report an extension without the full post-retrieve runway", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:05:00.000Z");
      const nearTrialEnd = new Date(safeClock.getTime() + 361_000);
      vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
      const source = makeCandidateSource([makeCandidate({
        currentPeriodEnd: nearTrialEnd,
        currentTrialEndsAt: nearTrialEnd,
      })]);
      const updateSubscription = vi.fn();
      const stripe: HostedPulseTrialExtensionStripeClient = {
        async retrieveSubscription() {
          vi.setSystemTime(safeClock);
          return makeSubscription({ trial_end: toUnixSeconds(nearTrialEnd) });
        },
        updateSubscription,
      };

      const summary = await extendHostedPulseTrials({
        candidateSource: source,
        mode: "dry-run",
        stripe,
      });

      assert.equal(summary.skipped.stripe_trial_end_invalid, 1);
      assert.equal(summary.wouldExtend, 0);
      assert.equal(updateSubscription.mock.calls.length, 0);
      assert.equal(source.updateCalls.length, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("dry-run reports an extension above the post-retrieve runway boundary", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:05:00.000Z");
      const safeTrialEnd = new Date(safeClock.getTime() + 362_000);
      vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
      const source = makeCandidateSource([makeCandidate({
        currentPeriodEnd: safeTrialEnd,
        currentTrialEndsAt: safeTrialEnd,
      })]);
      const updateSubscription = vi.fn();
      const stripe: HostedPulseTrialExtensionStripeClient = {
        async retrieveSubscription() {
          vi.setSystemTime(safeClock);
          return makeSubscription({ trial_end: toUnixSeconds(safeTrialEnd) });
        },
        updateSubscription,
      };

      const summary = await extendHostedPulseTrials({
        candidateSource: source,
        mode: "dry-run",
        stripe,
      });

      assert.equal(summary.skipped.stripe_trial_end_invalid, 0);
      assert.equal(summary.wouldExtend, 1);
      assert.equal(updateSubscription.mock.calls.length, 0);
      assert.equal(source.updateCalls.length, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("updates a trial with more than the full post-retrieve provider runway", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:05:00.000Z");
      const safeTrialEnd = new Date(safeClock.getTime() + 362_000);
      vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
      const source = makeCandidateSource([makeCandidate({
        currentPeriodEnd: safeTrialEnd,
        currentTrialEndsAt: safeTrialEnd,
      })]);
      const stripe = makeStripeClient(makeSubscription({
        trial_end: toUnixSeconds(safeTrialEnd),
      }));
      const retrieveSubscription = vi.spyOn(stripe, "retrieveSubscription")
        .mockImplementationOnce(async () => {
          vi.setSystemTime(safeClock);
          return makeSubscription({ trial_end: toUnixSeconds(safeTrialEnd) });
        });

      const summary = await extendHostedPulseTrials({
        candidateSource: source,
        mode: "apply",
        stripe,
      });

      assert.equal(retrieveSubscription.mock.calls.length, 1);
      assert.equal(summary.stripeTrialsExtended, 1);
      assert.equal(summary.localWindowsReconciled, 1);
      assert.equal(stripe.updateCalls.length, 1);
      assert.equal(stripe.updateCalls[0]?.options.maxNetworkRetries, 2);
      assert.equal(stripe.updateCalls[0]?.options.timeout, 80_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not touch Stripe when the locked local re-read is no longer eligible", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    source.withStripeMutationLock = (input) => input.run({
      candidate: null,
      async updateTrialEnd() {
        throw new Error("A changed candidate must not be reconciled.");
      },
    });
    const stripe = makeStripeClient();

    const summary = await extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.skipped.local_candidate_changed, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("keeps local reconciliation inside the lock when paid conversion starts after Stripe extension", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const withMemberLock = makeAsyncMutex();
    const providerUpdated = makeDeferred();
    const allowProviderReturn = makeDeferred();
    const events: string[] = [];
    let subscription = makeSubscription();

    source.withStripeMutationLock = (input) => withMemberLock(async () =>
      input.run({
        candidate: source.candidates[0] ?? null,
        async updateTrialEnd(trialEndsAt) {
          events.push("extension-local");
          const candidate = source.candidates[0];
          if (!candidate) {
            throw new Error("Synthetic candidate was not found.");
          }
          source.updateCalls.push({ candidate, trialEndsAt });
          candidate.currentPeriodEnd = trialEndsAt;
          candidate.currentTrialEndsAt = trialEndsAt;
        },
      })
    );

    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        return subscription;
      },
      async updateSubscription(_subscriptionId, params) {
        events.push("extension-stripe");
        subscription = {
          ...subscription,
          metadata: params.metadata,
          trial_end: params.trial_end,
        };
        providerUpdated.resolve();
        await allowProviderReturn.promise;
        return subscription;
      },
    };

    const extension = extendHostedPulseTrials({
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });
    await providerUpdated.promise;

    events.push("paid-attempt");
    const paidConversion = withMemberLock(async () => {
      events.push("paid-wins");
      subscription = makeSubscription({ status: "active", trial_end: null });
      const candidate = source.candidates[0];
      if (candidate) {
        candidate.currentPeriodEnd = null;
        candidate.currentTrialEndsAt = null;
      }
    });
    allowProviderReturn.resolve();

    const [summary] = await Promise.all([extension, paidConversion]);
    assert.equal(summary.stripeTrialsExtended, 1);
    assert.equal(summary.localWindowsReconciled, 1);
    assert.deepEqual(events, [
      "extension-stripe",
      "paid-attempt",
      "extension-local",
      "paid-wins",
    ]);
    assert.equal(subscription.status, "active");
    assert.equal(source.candidates[0]?.currentTrialEndsAt, null);
  });

  test("Prisma reconciliation updates billing then delegates the usage projection to its owner", async () => {
    const billingUpdate = vi.fn(async (input: unknown) => {
      void input;
      return { count: 1 };
    });
    const candidate = makeCandidate();
    const findFirst = vi.fn(async (input: unknown) => {
      void input;
      return {
        currentPeriodEnd: ORIGINAL_TRIAL_END,
        currentTrialEndsAt: ORIGINAL_TRIAL_END,
        currentTrialStartedAt: candidate.currentTrialStartedAt,
        lastStripeEventCreatedAt: candidate.lastStripeEventCreatedAt,
        memberId: candidate.memberId,
      };
    });
    const tx = {
      $queryRaw: vi.fn(async () => []),
      hostedMemberBillingRef: { findFirst, updateMany: billingUpdate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    await createPrismaHostedPulseTrialExtensionCandidateSource(prisma as never)
      .withStripeMutationLock({
        candidate,
        run: async (locked) => {
          assert.ok(locked.candidate);
          await locked.updateTrialEnd(EXTENDED_TRIAL_END, NOW);
        },
      });

    assert.equal(tx.$queryRaw.mock.calls.length, 1);
    assert.equal(findFirst.mock.calls.length, 1);
    assert.deepEqual(billingUpdate.mock.calls[0]?.[0], {
      data: {
        currentPeriodEnd: EXTENDED_TRIAL_END,
        currentTrialEndsAt: EXTENDED_TRIAL_END,
      },
      where: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: ORIGINAL_TRIAL_END,
        currentTrialEndsAt: ORIGINAL_TRIAL_END,
        currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
        lastStripeEventCreatedAt: new Date("2026-07-02T12:00:00.000Z"),
        memberId: "member_test",
        member: {
          billingStatus: "active",
          suspendedAt: null,
        },
      },
    });
    expect(mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx).toHaveBeenCalledWith({
      memberId: "member_test",
      now: NOW,
      tx,
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

  test("Prisma candidate scan narrows to one member when a member filter is set", async () => {
    const findMany = vi.fn(async (input: unknown) => {
      void input;
      return [];
    });
    const prisma = {
      hostedMemberBillingRef: { findMany },
    };

    await createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      { memberId: "member_only" },
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
        memberId: "member_only",
      },
    });
  });

});

describe("Pulse Trial extension campaign occasions", () => {
  const DATED_CAMPAIGN = "pulse-beta-extension-2026-07-10";

  test("derives the campaign key from the UTC day", () => {
    assert.equal(
      deriveHostedPulseTrialExtensionCampaign(new Date("2026-07-10T23:59:59.000Z")),
      DATED_CAMPAIGN,
    );
    assert.equal(
      deriveHostedPulseTrialExtensionCampaign(new Date("2026-07-11T00:00:00.000Z")),
      "pulse-beta-extension-2026-07-11",
    );
  });

  test("rejects campaign keys outside the extension family", async () => {
    await assert.rejects(
      extendHostedPulseTrials({
        campaign: "not-a-trial-campaign",
        candidateSource: makeCandidateSource([]),
        mode: "dry-run",
        now: NOW,
        stripe: makeStripeClient(),
      }),
      /campaign key is invalid/,
    );
  });

  test("treats an earlier extension campaign marker as extendable, not a conflict", () => {
    const candidate = makeCandidate();
    const markedByEarlierCampaign = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
    });

    assert.deepEqual(
      classifyHostedPulseTrialExtensionSubscription({
        campaign: DATED_CAMPAIGN,
        candidate,
        nowUnixSeconds: toUnixSeconds(NOW),
        subscription: markedByEarlierCampaign,
      }),
      {
        alreadyMarked: false,
        ok: true,
        stripeTrialEnd: toUnixSeconds(ORIGINAL_TRIAL_END),
      },
    );
    assert.deepEqual(
      classifyHostedPulseTrialExtensionSubscription({
        campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        candidate,
        nowUnixSeconds: toUnixSeconds(NOW),
        subscription: markedByEarlierCampaign,
      }),
      {
        alreadyMarked: true,
        ok: true,
        stripeTrialEnd: toUnixSeconds(ORIGINAL_TRIAL_END),
      },
    );
  });

  test("a later campaign extends again and overwrites the earlier marker", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient(makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
    }));

    const summary = await extendHostedPulseTrials({
      campaign: DATED_CAMPAIGN,
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.campaign, DATED_CAMPAIGN);
    assert.equal(summary.stripeTrialsExtended, 1);
    assert.equal(summary.localWindowsReconciled, 1);
    const update = stripe.updateCalls[0];
    assert.equal(
      update?.params.metadata[HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY],
      DATED_CAMPAIGN,
    );
    assert.equal(update?.params.trial_end, toUnixSeconds(EXTENDED_TRIAL_END));
    assert.equal(
      update?.options.idempotencyKey,
      `hosted-pulse-trial-extension:${DATED_CAMPAIGN}:sub_test`,
    );
  });

  test("the same campaign stays idempotent under its marker", async () => {
    const source = makeCandidateSource([makeCandidate({
      currentPeriodEnd: EXTENDED_TRIAL_END,
      currentTrialEndsAt: EXTENDED_TRIAL_END,
    })]);
    const stripe = makeStripeClient(makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]: DATED_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    }));

    const summary = await extendHostedPulseTrials({
      campaign: DATED_CAMPAIGN,
      candidateSource: source,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.alreadyExtended, 1);
    assert.equal(stripe.updateCalls.length, 0);
  });
});

function extendHostedPulseTrials(
  input: Omit<Parameters<typeof extendHostedPulseTrialsWithPrice>[0], "priceId">,
) {
  return extendHostedPulseTrialsWithPrice({
    ...input,
    priceId: PRICE_ID,
  });
}

function classifyHostedPulseTrialExtensionSubscription(
  input: Omit<
    Parameters<typeof classifyHostedPulseTrialExtensionSubscriptionWithPrice>[0],
    "priceId"
  >,
) {
  return classifyHostedPulseTrialExtensionSubscriptionWithPrice({
    ...input,
    priceId: PRICE_ID,
  });
}

function makeCandidate(
  overrides: Partial<HostedPulseTrialExtensionCandidate> = {},
): HostedPulseTrialExtensionCandidate {
  return {
    currentPeriodEnd: ORIGINAL_TRIAL_END,
    currentTrialEndsAt: ORIGINAL_TRIAL_END,
    currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
    lastStripeEventCreatedAt: new Date("2026-07-02T12:00:00.000Z"),
    memberId: "member_test",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<HostedPulseTrialExtensionStripeSubscription> = {},
): HostedPulseTrialExtensionStripeSubscription {
  return {
    cancel_at: null,
    cancel_at_period_end: false,
    customer: "cus_test",
    id: "sub_test",
    items: {
      data: [makeSubscriptionItem()],
    },
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

function makeSubscriptionItem(input: { priceId?: string } = {}) {
  return {
    id: "si_recurring",
    price: {
      id: input.priceId ?? PRICE_ID,
      metadata: {},
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
    },
    quantity: 1,
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
  readonly lockCalls: number;
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
  let lockCalls = 0;
  let remainingFailures = options.failUpdates ?? 0;

  return {
    candidates,
    get lockCalls() {
      return lockCalls;
    },
    async listCandidates(input) {
      const startIndex = input.afterMemberId
        ? candidates.findIndex((candidate) => candidate.memberId === input.afterMemberId) + 1
        : 0;
      return candidates.slice(startIndex, startIndex + input.limit);
    },
    updateCalls,
    async withStripeMutationLock(input) {
      lockCalls += 1;
      const candidate = candidates.find(
        (entry) => entry.memberId === input.candidate.memberId,
      ) ?? null;
      return input.run({
        candidate,
        async updateTrialEnd(trialEndsAt) {
          options.events?.push("database");
          if (!candidate) {
            throw new Error("Synthetic candidate was not found.");
          }
          updateCalls.push({ candidate, trialEndsAt });
          if (remainingFailures > 0) {
            remainingFailures -= 1;
            throw new Error("Synthetic local write failure.");
          }
          candidate.currentPeriodEnd = trialEndsAt;
          candidate.currentTrialEndsAt = trialEndsAt;
        },
      });
    },
  };
}

function makeStripeClient(
  initialSubscription = makeSubscription(),
  events?: string[],
): HostedPulseTrialExtensionStripeClient & {
  retrieveCalls: number;
  updateCalls: Array<{
    options: {
      idempotencyKey: string;
      maxNetworkRetries: 2;
      timeout: 80_000;
    };
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
      options: {
        idempotencyKey: string;
        maxNetworkRetries: 2;
        timeout: 80_000;
      };
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
      options: {
        idempotencyKey: string;
        maxNetworkRetries: 2;
        timeout: 80_000;
      },
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

function makeAsyncMutex() {
  let tail = Promise.resolve();

  return async function withLock<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    const previous = tail;
    let release = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  };
}

function makeDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function toUnixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}
