import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileHostedAiUsageAllowancePeriodForMemberTx: vi.fn(async () => {}),
}));

vi.mock("../src/lib/hosted-execution/usage-allowance", () => ({
  reconcileHostedAiUsageAllowancePeriodForMemberTx:
    mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
}));

import type {
  HostedAutoPulseTrialCampaignDisposition,
} from "../src/lib/hosted-onboarding/auto-trial-enrollment-service";
import {
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLock,
  withHostedMemberStripeMutationLockForOps,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import { buildHostedMemberBillingPrivateColumns } from "../src/lib/hosted-onboarding/member-private-codecs";
import {
  classifyHostedPulseTrialExtensionSubscription as classifyHostedPulseTrialExtensionSubscriptionWithPrice,
  createPrismaHostedPulseTrialExtensionCandidateSource,
  extendHostedPulseTrials as extendHostedPulseTrialsWithPrice,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY,
  HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO,
  HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY,
  HostedPulseTrialExtensionContinuationError,
  HostedPulseTrialExtensionPreviewMismatchError,
  type HostedPulseTrialExtensionCandidate,
  type HostedPulseTrialExtensionCandidateSource,
  type HostedPulseTrialExtensionStripeClient,
  type HostedPulseTrialExtensionStripeRequestOptions,
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

  test("maps the Ops PostgreSQL lock timeout to a typed busy result", async () => {
    const lockTimeoutError = new Prisma.PrismaClientKnownRequestError(
      "canceling statement due to lock timeout",
      {
        clientVersion: "test",
        code: "P2010",
        meta: { code: "55P03" },
      },
    );
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(lockTimeoutError),
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (transaction: typeof tx) => Promise<unknown>,
        options: unknown,
      ) => {
        void options;
        return callback(tx);
      }),
    };

    await expect(withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: 25_000,
      memberId: "member_test",
      prisma: prisma as never,
      run: async () => "unreachable",
      transactionTimeoutMs: 190_000,
    })).rejects.toBeInstanceOf(HostedMemberStripeMutationLockBusyError);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 190_000,
    });
    assert.equal(tx.$queryRaw.mock.calls.length, 2);
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
      {
        expectedReason: "stripe_price_mismatch",
        subscription: makeSubscription({
          items: {
            data: [makeSubscriptionItem()],
            has_more: true,
          },
        }),
      },
      {
        expectedReason: "stripe_price_mismatch",
        subscription: makeSubscription({
          metadata: { memberId: "member_other" },
        }),
      },
      {
        expectedReason: "stripe_price_mismatch",
        subscription: makeSubscription({
          metadata: {
            trialDurationDays: "7",
            trialPolicyVersion: "pulse-trial-2026-05-05-v1",
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

  test("canceled, expired, mismatched, and foreign-campaign subscriptions remain untouched", async () => {
    const cases: Array<{
      expectedReason:
        | "stripe_campaign_marker_conflict"
        | "stripe_price_mismatch"
        | "stripe_subscription_not_trialing";
      label: string;
      subscription: HostedPulseTrialExtensionStripeSubscription;
    }> = [
      {
        expectedReason: "stripe_subscription_not_trialing",
        label: "canceled",
        subscription: makeSubscription({ status: "canceled" }),
      },
      {
        expectedReason: "stripe_subscription_not_trialing",
        label: "expired",
        subscription: makeSubscription({ status: "incomplete_expired" }),
      },
      {
        expectedReason: "stripe_price_mismatch",
        label: "mismatched",
        subscription: makeSubscription({
          items: {
            data: [makeSubscriptionItem({ priceId: "price_other" })],
          },
        }),
      },
      {
        expectedReason: "stripe_campaign_marker_conflict",
        label: "foreign campaign",
        subscription: makeSubscription({
          metadata: {
            [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
              "pulse-beta-extension-another-occasion",
          },
        }),
      },
    ];

    for (const entry of cases) {
      const source = makeCandidateSource([makeCandidate()]);
      const stripe = makeStripeClient(entry.subscription);

      const summary = await extendHostedPulseTrials({
        candidateSource: source,
        mode: "apply",
        now: NOW,
        stripe,
      });

      assert.equal(summary.skipped[entry.expectedReason], 1, entry.label);
      assert.equal(summary.stripeTrialsExtended, 0, entry.label);
      assert.equal(summary.localWindowsReconciled, 0, entry.label);
      assert.equal(stripe.updateCalls.length, 0, entry.label);
      assert.equal(source.updateCalls.length, 0, entry.label);
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
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
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
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
      proration_behavior: "none",
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    });
    assert.match(
      stripe.updateCalls[0]?.options.idempotencyKey ?? "",
      /pulse-beta-extension-2026-07/u,
    );
    assert.deepEqual(stripe.retrieveOptions[0], {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });
    assert.equal(stripe.updateCalls[0]?.options.maxNetworkRetries, 0);
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

    assert.equal(retrieveCalls, 2);
    assert.equal(summary.skipped.stripe_subscription_not_trialing, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(source.updateCalls.length, 0);
    assert.equal(updateSubscription.mock.calls.length, 0);
  });

  test("does not update a trial without the derived one-attempt provider runway", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:01:20.000Z");
      const nearTrialEnd = new Date(safeClock.getTime() + 81_000);
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

  test("dry-run does not report an extension at the derived runway boundary", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:01:20.000Z");
      const nearTrialEnd = new Date(safeClock.getTime() + 81_000);
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

  test("dry-run reports an extension above the derived runway boundary", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:01:20.000Z");
      const safeTrialEnd = new Date(safeClock.getTime() + 82_000);
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

  test("updates a trial with five minutes left using one bounded provider attempt", async () => {
    vi.useFakeTimers();
    try {
      const safeClock = new Date("2026-07-09T12:01:20.000Z");
      const safeTrialEnd = new Date(safeClock.getTime() + 300_000);
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

      assert.equal(retrieveSubscription.mock.calls.length, 2);
      assert.equal(summary.stripeTrialsExtended, 1);
      assert.equal(summary.localWindowsReconciled, 1);
      assert.equal(stripe.updateCalls.length, 1);
      assert.equal(stripe.updateCalls[0]?.options.maxNetworkRetries, 0);
      assert.equal(stripe.updateCalls[0]?.options.timeout, 80_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not touch Stripe when the locked local re-read is no longer eligible", async () => {
    const source = makeCandidateSource([makeCandidate()]);
    source.withStripeMutationLock = (input) => input.run({
      async applyProviderOnlyDisposition() {
        return "recovered";
      },
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

    assert.equal(summary.failures.preview_state_changed, 1);
    assert.equal(summary.stripeTrialsExtended, 0);
    assert.equal(summary.localWindowsReconciled, 0);
    assert.equal(stripe.retrieveCalls, 1);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("stable local ineligibility skips without blocking the next page member", async () => {
    const source = makeCandidateSource([
      makeCandidate({
        memberId: "member_suspended",
        memberSuspendedAt: new Date("2026-07-09T10:00:00.000Z"),
        stripeCustomerId: "cus_suspended",
        stripeSubscriptionId: "sub_suspended",
      }),
      makeCandidate({ memberId: "member_eligible" }),
    ]);
    const previewStripe = makeStripeClient(
      makeSubscription(),
      undefined,
      makeCandidateSubscriptionResolver(source.candidates),
    );
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: previewStripe,
    });

    assert.equal(preview.skipped.local_candidate_changed, 1);
    assert.equal(preview.wouldExtend, 1);
    assert.equal(previewStripe.retrieveCalls, 1);

    const applyStripe = makeStripeClient(
      makeSubscription(),
      undefined,
      makeCandidateSubscriptionResolver(source.candidates),
    );
    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: applyStripe,
    });

    assert.equal(applied.skipped.local_candidate_changed, 1);
    assert.equal(applied.failures.preview_state_changed, 0);
    assert.equal(applied.stripeTrialsExtended, 1);
    assert.equal(applyStripe.retrieveCalls, 1);
    assert.equal(applyStripe.updateCalls.length, 1);
  });

  test("an active-to-suspended race after Preview rejects before Stripe", async () => {
    const previewSource = makeCandidateSource([makeCandidate()]);
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: previewSource,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });
    const source = makeCandidateSource([makeCandidate()]);
    source.withStripeMutationLock = async (input) => {
      const candidate = source.candidates[0];
      assert.ok(candidate);
      candidate.memberSuspendedAt = new Date("2026-07-09T12:00:01.000Z");
      return input.run({
        async applyProviderOnlyDisposition() {
          return "recovered";
        },
        candidate,
        async updateTrialEnd() {
          throw new Error("A stale local candidate must not be reconciled.");
        },
      });
    };
    const stripe = makeStripeClient();

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
  });

  test("a busy member lock returns a bounded retry result without Stripe work", async () => {
    const candidates = [
      makeCandidate({ memberId: "member_1" }),
      makeCandidate({ memberId: "member_2" }),
    ];
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: makeCandidateSource(candidates),
      maxCandidates: 1,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });
    const source = makeCandidateSource(candidates);
    let acquisitionTimeoutMs = 0;
    let transactionTimeoutMs = 0;
    source.withStripeMutationLock = async (input) => {
      acquisitionTimeoutMs = input.acquisitionTimeoutMs;
      transactionTimeoutMs = input.transactionTimeoutMs;
      throw new HostedMemberStripeMutationLockBusyError();
    };
    const stripe = makeStripeClient();

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 1,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(acquisitionTimeoutMs, 25_000);
    assert.equal(transactionTimeoutMs, 190_000);
    assert.equal(applied.failures.member_lock_busy, 1);
    assert.equal(applied.hasMoreCandidates, true);
    assert.equal(applied.nextContinuationToken, null);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
  });

  test("the operation deadline prevents a later candidate from crossing the route budget", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const candidates = [
        makeCandidate({
          memberId: "member_1",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
        }),
        makeCandidate({
          memberId: "member_2",
          stripeCustomerId: "cus_2",
          stripeSubscriptionId: "sub_2",
        }),
      ];
      const preview = await extendHostedPulseTrialsWithPrice({
        candidateSource: makeCandidateSource(candidates),
        maxCandidates: 4,
        mode: "dry-run",
        now: NOW,
        priceId: PRICE_ID,
        stripe: makeStripeClient(
          makeSubscription(),
          undefined,
          makeCandidateSubscriptionResolver(candidates),
        ),
      });
      const source = makeCandidateSource(candidates);
      const baseLock = source.withStripeMutationLock.bind(source);
      source.withStripeMutationLock = async (input) => {
        const result = await baseLock(input);
        vi.setSystemTime(new Date(Date.now() + 600_001));
        return result;
      };
      const stripe = makeStripeClient(
        makeSubscription(),
        undefined,
        makeCandidateSubscriptionResolver(candidates),
      );

      const applied = await extendHostedPulseTrialsWithPrice({
        candidateSource: source,
        expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
        expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
        maxCandidates: 4,
        mode: "apply",
        now: NOW,
        priceId: PRICE_ID,
        stripe,
      });

      assert.equal(applied.stripeTrialsExtended, 1);
      assert.equal(applied.failures.route_runway_exhausted, 1);
      assert.equal(source.lockCalls, 1);
      assert.equal(stripe.retrieveCalls, 1);
      assert.equal(stripe.updateCalls.length, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("extends and recovers a provider-only pre-cutoff trial in one Apply", async () => {
    const providerOnlyCandidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_test",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const recovery = vi.fn(async (
      disposition: Exclude<
        HostedAutoPulseTrialCampaignDisposition,
        { kind: "not-applicable" }
      >,
    ) => {
      void disposition;
      return "recovered" as const;
    });
    const source = makeCandidateSource([providerOnlyCandidate], {
      applyProviderOnlyDisposition: recovery,
      inspectProviderOnlyTrial: async () => ({
        kind: "recoverable",
        subscription: providerSubscription as never,
      }),
    });
    const previewStripe = makeStripeClient(providerSubscription);
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: previewStripe,
    });

    assert.equal(preview.wouldRecoverProviderTrial, 1);
    assert.equal(preview.wouldExtend, 1);

    const updatedSubscription = {
      ...providerSubscription,
      metadata: {
        ...providerSubscription.metadata,
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    };
    const retrieveSubscription = vi.fn(async () => providerSubscription);
    const updateSubscription = vi.fn(async (...input: [
      string,
      HostedPulseTrialExtensionStripeUpdateParams,
      {
        idempotencyKey: string;
      } & HostedPulseTrialExtensionStripeRequestOptions,
    ]) => {
      void input;
      return updatedSubscription;
    });
    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: { retrieveSubscription, updateSubscription },
    });

    assert.equal(applied.providerTrialsRecovered, 1);
    assert.equal(applied.stripeTrialsExtended, 1);
    assert.equal(recovery.mock.calls.length, 1);
    assert.equal(retrieveSubscription.mock.calls.length, 0);
    assert.equal(updateSubscription.mock.calls.length, 1);
    assert.equal(recovery.mock.calls[0]?.[0].subscription, updatedSubscription);
    expect(updateSubscription.mock.calls[0]?.[2]).toEqual({
      idempotencyKey:
        "hosted-pulse-trial-extension:pulse-beta-extension-2026-07:sub_test",
      maxNetworkRetries: 0,
      timeout: 80_000,
    });
  });

  test("replays provider-only finalization without extending Stripe twice", async () => {
    const providerOnlyCandidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    let providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const updateSubscription = vi.fn(async (
      _subscriptionId: string,
      params: HostedPulseTrialExtensionStripeUpdateParams,
    ) => {
      providerSubscription = {
        ...providerSubscription,
        metadata: { ...params.metadata },
        trial_end: params.trial_end,
      };
      return providerSubscription;
    });
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        return providerSubscription;
      },
      updateSubscription,
    };
    const finalize = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic local finalization failure"))
      .mockResolvedValueOnce("recovered" as const);
    const source = makeCandidateSource([providerOnlyCandidate], {
      applyProviderOnlyDisposition: finalize,
      inspectProviderOnlyTrial: async () => ({
        kind: "recoverable",
        subscription: providerSubscription as never,
      }),
    });

    const firstPreview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    const firstApply = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: firstPreview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: firstPreview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(firstApply.failures.provider_recovery_failed, 1);
    assert.equal(updateSubscription.mock.calls.length, 1);

    const retryPreview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(retryPreview.wouldRecoverProviderTrial, 1);
    assert.equal(retryPreview.wouldReconcile, 1);
    assert.equal(retryPreview.wouldExtend, 0);

    const retryApply = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: retryPreview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: retryPreview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(retryApply.providerTrialsRecovered, 1);
    assert.equal(retryApply.stripeTrialsExtended, 0);
    assert.equal(updateSubscription.mock.calls.length, 1);
    assert.equal(finalize.mock.calls.length, 2);
  });

  test("member-scoped service recovers one exact provider trial and retries its failed sibling as cleanup", async () => {
    const buildProviderCandidate = (subscriptionId: string) => makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      memberId: "member_target",
      providerCustomerId: "cus_target",
      providerSubscriptionId: subscriptionId,
      pulseTrialRedeemedAt: null,
      stripeCustomerId: "cus_target",
      stripeSubscriptionId: null,
    });
    const providerCandidates = [
      buildProviderCandidate("sub_provider_a"),
      buildProviderCandidate("sub_provider_b"),
    ];
    const subscriptions = new Map(providerCandidates.map((candidate) => [
      candidate.providerSubscriptionId!,
      makeSubscription({
        customer: "cus_target",
        id: candidate.providerSubscriptionId!,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_target",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
      }),
    ]));
    let currentSubscriptionId: string | null = null;
    let firstCandidateFailed = false;
    const cleanedSubscriptionIds: string[] = [];
    const buildLockedCandidate = (
      candidate: HostedPulseTrialExtensionCandidate,
    ): HostedPulseTrialExtensionCandidate => currentSubscriptionId
      ? makeCandidate({
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentPeriodEnd: EXTENDED_TRIAL_END,
          currentTrialEndsAt: EXTENDED_TRIAL_END,
          currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
          memberId: "member_target",
          providerCustomerId: candidate.providerCustomerId,
          providerSubscriptionId: candidate.providerSubscriptionId,
          pulseTrialRedeemedAt: new Date("2026-07-02T12:00:00.000Z"),
          stripeCustomerId: "cus_target",
          stripeSubscriptionId: currentSubscriptionId,
        })
      : candidate;
    const source: HostedPulseTrialExtensionCandidateSource = {
      async listCandidates() {
        if (!currentSubscriptionId) {
          return {
            candidates: providerCandidates,
            nextContinuationToken: "member-provider-page",
          };
        }
        const remainingProviderCandidates = providerCandidates
          .filter((candidate) =>
            candidate.providerSubscriptionId !== currentSubscriptionId &&
            !cleanedSubscriptionIds.includes(candidate.providerSubscriptionId!)
          )
          .map(buildLockedCandidate);
        if (remainingProviderCandidates.length > 0) {
          return {
            candidates: remainingProviderCandidates,
            nextContinuationToken: "member-provider-page",
          };
        }
        return {
          candidates: [makeCandidate({
            currentBillingPhase: "trial",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: "pulse_trial_7d",
            currentPeriodEnd: EXTENDED_TRIAL_END,
            currentTrialEndsAt: EXTENDED_TRIAL_END,
            currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
            memberId: "member_target",
            providerCustomerId: null,
            providerSubscriptionId: null,
            pulseTrialRedeemedAt: new Date("2026-07-02T12:00:00.000Z"),
            stripeCustomerId: "cus_target",
            stripeSubscriptionId: currentSubscriptionId,
          })],
          nextContinuationToken: null,
        };
      },
      async inspectProviderOnlyTrial({ candidate }) {
        const subscription = subscriptions.get(candidate.providerSubscriptionId!);
        if (!subscription) {
          return {
            kind: "not-applicable",
            reason: "provider-trial-not-found",
            subscription: null,
          };
        }
        return currentSubscriptionId && currentSubscriptionId !== subscription.id
          ? { kind: "cleanup-obsolete", subscription }
          : { kind: "recoverable", subscription };
      },
      async withStripeMutationLock(input) {
        const lockedCandidate = buildLockedCandidate(input.candidate);
        return input.run({
          async applyProviderOnlyDisposition(disposition) {
            if (
              disposition.kind === "recoverable" &&
              disposition.subscription.id === "sub_provider_a" &&
              !firstCandidateFailed
            ) {
              firstCandidateFailed = true;
              throw new Error("synthetic local finalization failure");
            }
            if (disposition.kind === "recoverable") {
              currentSubscriptionId = disposition.subscription.id;
              return "recovered";
            }
            cleanedSubscriptionIds.push(disposition.subscription.id);
            return "cleaned-up";
          },
          candidate: lockedCandidate,
          async updateTrialEnd() {
            throw new Error("Provider-only candidates must not use local trial updates.");
          },
        });
      },
    };
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription(subscriptionId) {
        const subscription = subscriptions.get(subscriptionId);
        if (!subscription) {
          throw new Error("Synthetic subscription was not found.");
        }
        return subscription;
      },
      async updateSubscription(subscriptionId, params) {
        const subscription = subscriptions.get(subscriptionId);
        if (!subscription) {
          throw new Error("Synthetic subscription was not found.");
        }
        const updated = {
          ...subscription,
          metadata: { ...params.metadata },
          trial_end: params.trial_end,
        };
        subscriptions.set(subscriptionId, updated);
        return updated;
      },
    };

    const firstPreview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(firstPreview.wouldRecoverProviderTrial, 2);
    const firstApply = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: firstPreview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: firstPreview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(firstApply.failures.provider_recovery_failed, 1);
    assert.equal(firstApply.providerTrialsRecovered, 1);
    assert.equal(firstApply.nextContinuationToken, null);
    assert.equal(currentSubscriptionId, "sub_provider_b");

    const cleanupPreview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(cleanupPreview.wouldCleanupProviderTrial, 1);
    const cleanupApply = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: cleanupPreview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: cleanupPreview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(cleanupApply.providerTrialsCleanedUp, 1);
    expect(cleanedSubscriptionIds).toEqual(["sub_provider_a"]);

    const localClosure = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });
    assert.equal(localClosure.alreadyExtended, 1);
    assert.equal(localClosure.wouldCleanupProviderTrial, 0);
    assert.equal(localClosure.wouldRecoverProviderTrial, 0);
  });

  test.each([
    [81, 0, 1],
    [82, 1, 0],
  ] as const)(
    "provider-only trial with %i seconds remaining applies the shared runway rule",
    async (secondsRemaining, wouldRecover, invalidSkips) => {
      const providerOnlyCandidate = makeCandidate({
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        memberBillingStatus: "not_started",
        pulseTrialRedeemedAt: null,
        stripeSubscriptionId: null,
      });
      const providerSubscription = makeSubscription({
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_test",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
        trial_end: toUnixSeconds(NOW) + secondsRemaining,
      });
      const source = makeCandidateSource([providerOnlyCandidate], {
        inspectProviderOnlyTrial: async () => ({
          kind: "recoverable",
          subscription: providerSubscription as never,
        }),
      });

      const preview = await extendHostedPulseTrialsWithPrice({
        candidateSource: source,
        maxCandidates: 4,
        mode: "dry-run",
        now: NOW,
        priceId: PRICE_ID,
        stripe: makeStripeClient(providerSubscription),
      });

      assert.equal(preview.wouldRecoverProviderTrial, wouldRecover);
      assert.equal(preview.wouldExtend, wouldRecover);
      assert.equal(preview.skipped.stripe_trial_end_invalid, invalidSkips);
    },
  );

  test("provider-only Apply rechecks runway after its owner lookup", async () => {
    const providerOnlyCandidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_test",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
      trial_end: toUnixSeconds(NOW) + 82,
    });
    const recovery = vi.fn(async () => "recovered" as const);
    const source = makeCandidateSource([providerOnlyCandidate], {
      applyProviderOnlyDisposition: recovery,
      inspectProviderOnlyTrial: async () => ({
        kind: "recoverable",
        subscription: providerSubscription as never,
      }),
    });
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(providerSubscription),
    });
    const stripe = makeStripeClient(providerSubscription);
    let clockReads = 0;

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      currentTime: () => {
        clockReads += 1;
        return clockReads === 1
          ? NOW
          : new Date(NOW.getTime() + 2_000);
      },
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(recovery.mock.calls.length, 0);
    assert.equal(clockReads, 2);
  });

  test("provider-origin recovery never mutates Stripe for a suspended member", async () => {
    const providerOnlyCandidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      memberSuspendedAt: NOW,
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_test",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const finalize = vi.fn(async () => "recovered" as const);
    const source = makeCandidateSource([providerOnlyCandidate], {
      applyProviderOnlyDisposition: finalize,
      inspectProviderOnlyTrial: async () => ({
        kind: "recoverable",
        subscription: providerSubscription as never,
      }),
    });
    const stripe = makeStripeClient(providerSubscription);

    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(preview.skipped.local_candidate_changed, 1);
    assert.equal(preview.wouldRecoverProviderTrial, 0);
    assert.equal(preview.wouldExtend, 0);

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    assert.equal(applied.skipped.local_candidate_changed, 1);
    assert.equal(stripe.retrieveCalls, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(finalize.mock.calls.length, 0);
  });

  test.each([
    [
      "cancellation flag",
      { cancel_at_period_end: true },
      "stripe_subscription_canceling",
    ],
    [
      "non-unit quantity",
      {
        items: {
          data: [{ ...makeSubscriptionItem(), quantity: 2 }],
        },
      },
      "stripe_price_mismatch",
    ],
    [
      "unsupported extra recurring item",
      {
        items: {
          data: [
            makeSubscriptionItem(),
            {
              ...makeSubscriptionItem({ priceId: "price_other" }),
              id: "si_other",
            },
          ],
        },
      },
      "stripe_price_mismatch",
    ],
    [
      "mismatched price",
      {
        items: {
          data: [makeSubscriptionItem({ priceId: "price_other" })],
        },
      },
      "stripe_price_mismatch",
    ],
  ] as const)(
    "provider-only trial rejects %s before recovery",
    async (_label, overrides, expectedReason) => {
      const candidate = makeCandidate({
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        memberBillingStatus: "not_started",
        pulseTrialRedeemedAt: null,
        stripeSubscriptionId: null,
      });
      const subscription = makeSubscription({
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_test",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
        ...overrides,
      });
      const source = makeCandidateSource([candidate], {
        inspectProviderOnlyTrial: async () => ({
          kind: "recoverable",
          subscription: subscription as never,
        }),
      });

      const preview = await extendHostedPulseTrialsWithPrice({
        candidateSource: source,
        maxCandidates: 4,
        mode: "dry-run",
        now: NOW,
        priceId: PRICE_ID,
        stripe: makeStripeClient(subscription),
      });

      assert.equal(preview.wouldRecoverProviderTrial, 0);
      assert.equal(preview.wouldExtend, 0);
      assert.equal(preview.skipped[expectedReason], 1);
    },
  );

  test("a provider-only race after Preview rejects Apply as stale", async () => {
    const providerOnlyCandidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const recovery = vi.fn(async () => "recovered" as const);
    const source = makeCandidateSource([providerOnlyCandidate], {
      applyProviderOnlyDisposition: recovery,
      beforeLock(candidates) {
        const candidate = candidates[0];
        if (!candidate) {
          throw new Error("Synthetic candidate was not found.");
        }
        candidate.memberBillingStatus = "active";
        candidate.pulseTrialRedeemedAt = new Date("2026-07-09T12:00:00.000Z");
      },
      inspectProviderOnlyTrial: async () => ({
        kind: "recoverable",
        subscription: providerSubscription as never,
      }),
    });
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(providerSubscription),
    });

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(providerSubscription),
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.providerTrialsCleanedUp, 0);
    assert.equal(applied.providerTrialsRecovered, 0);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(recovery.mock.calls.length, 0);
  });

  test("applies an active-paid provider cleanup only from the exact Preview proof", async () => {
    const paidCandidate = makeCandidate({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "active",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: "sub_paid",
    });
    const obsoleteTrial = makeSubscription({ id: "sub_obsolete_trial" });
    const cleanup = vi.fn(async () => "cleaned-up" as const);
    const source = makeCandidateSource([paidCandidate], {
      applyProviderOnlyDisposition: cleanup,
      inspectProviderOnlyTrial: async () => ({
        kind: "cleanup-obsolete",
        subscription: obsoleteTrial as never,
      }),
    });
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(preview.wouldCleanupProviderTrial, 1);
    assert.equal(preview.wouldExtend, 0);

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(applied.providerTrialsCleanedUp, 1);
    assert.equal(applied.providerTrialsRecovered, 0);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(cleanup.mock.calls.length, 1);
  });

  test("does not clean up an obsolete provider trial owned by another campaign", async () => {
    const paidCandidate = makeCandidate({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "active",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: "sub_paid",
    });
    const obsoleteTrial = makeSubscription({
      id: "sub_obsolete_trial",
      metadata: {
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]: "another-campaign",
      },
    });
    const cleanup = vi.fn(async () => "cleaned-up" as const);
    const source = makeCandidateSource([paidCandidate], {
      applyProviderOnlyDisposition: cleanup,
      inspectProviderOnlyTrial: async () => ({
        kind: "cleanup-obsolete",
        subscription: obsoleteTrial as never,
      }),
    });
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(preview.wouldCleanupProviderTrial, 0);
    assert.equal(preview.skipped.stripe_campaign_marker_conflict, 1);

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(applied.providerTrialsCleanedUp, 0);
    assert.equal(applied.skipped.stripe_campaign_marker_conflict, 1);
    assert.equal(cleanup.mock.calls.length, 0);
  });

  test("rejects a changed provider-only cleanup target under the member lock", async () => {
    const paidCandidate = makeCandidate({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "active",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: "sub_paid",
    });
    const inspectProviderOnlyTrial = vi.fn()
      .mockResolvedValueOnce({
        kind: "cleanup-obsolete" as const,
        subscription: makeSubscription({ id: "sub_obsolete_preview" }) as never,
      })
      .mockResolvedValueOnce({
        kind: "cleanup-obsolete" as const,
        subscription: makeSubscription({ id: "sub_obsolete_apply" }) as never,
      });
    const cleanup = vi.fn(async () => "cleaned-up" as const);
    const source = makeCandidateSource([paidCandidate], {
      applyProviderOnlyDisposition: cleanup,
      inspectProviderOnlyTrial,
    });
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.providerTrialsCleanedUp, 0);
    assert.equal(cleanup.mock.calls.length, 0);
    assert.equal(inspectProviderOnlyTrial.mock.calls.length, 2);
  });

  test("provider traversal excludes a trial that starts at the fixed cutoff", async () => {
    const providerSubscription = makeSubscription({
      trial_end: toUnixSeconds(new Date("2026-07-24T00:00:00.000Z")),
      trial_start: toUnixSeconds(new Date("2026-07-14T00:00:00.000Z")),
    });
    const findMany = vi.fn(async () => []);
    const list = vi.fn(async () => ({
      data: [providerSubscription],
      has_more: false,
    }));
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: { findMany },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 4,
    });

    assert.deepEqual(page.candidates, []);
    assert.equal(page.nextContinuationToken, null);
    assert.equal(findMany.mock.calls.length, 1);
    assert.equal(list.mock.calls.length, 1);
  });

  test("an ended provider trial does not block the other candidates in its batch", async () => {
    const candidates = [
      makeCandidate({
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        memberBillingStatus: "not_started",
        memberId: "member_a",
        pulseTrialRedeemedAt: null,
        stripeSubscriptionId: null,
      }),
      makeCandidate({
        memberId: "member_b",
        stripeCustomerId: "cus_b",
        stripeSubscriptionId: "sub_b",
      }),
      makeCandidate({
        memberId: "member_c",
        stripeCustomerId: "cus_c",
        stripeSubscriptionId: "sub_c",
      }),
      makeCandidate({
        memberId: "member_d",
        stripeCustomerId: "cus_d",
        stripeSubscriptionId: "sub_d",
      }),
    ];
    const source = makeCandidateSource(candidates, {
      inspectProviderOnlyTrial: async () => ({
        kind: "not-applicable",
        reason: "provider-trial-ended",
        subscription: makeSubscription({ status: "paused" }) as never,
      }),
    });

    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(
        makeSubscription(),
        undefined,
        makeCandidateSubscriptionResolver(candidates),
      ),
    });

    assert.equal(preview.candidates, 4);
    assert.equal(preview.candidatePreviewTokens?.length, 4);
    assert.equal(preview.skipped.provider_trial_ended, 1);
    assert.equal(preview.wouldExtend, 3);
    assert.equal(
      Object.values(preview.failures).reduce((total, count) => total + count, 0),
      0,
    );
  });

  test("provider-only verification fails closed when one customer exceeds one bounded page", async () => {
    const candidate = makeCandidate({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "not_started",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: null,
    });
    const source = makeCandidateSource([candidate], {
      inspectProviderOnlyTrial: async () => {
        throw new Error("bounded provider lookup incomplete");
      },
    });

    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: makeStripeClient(),
    });

    assert.equal(preview.failures.provider_recovery_lookup_failed, 1);
    assert.deepEqual(preview.candidatePreviewTokens, [""]);
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
        async applyProviderOnlyDisposition() {
          return "recovered";
        },
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
        createdAt: candidate.billingRefCreatedAt,
        currentPeriodEnd: ORIGINAL_TRIAL_END,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: ORIGINAL_TRIAL_END,
        currentTrialStartedAt: candidate.currentTrialStartedAt,
        lastStripeEventCreatedAt: candidate.lastStripeEventCreatedAt,
        member: {
          billingStatus: "active",
          suspendedAt: null,
        },
        memberId: candidate.memberId,
        pulseTrialRedeemedAt: candidate.pulseTrialRedeemedAt,
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
        acquisitionTimeoutMs: 25_000,
        candidate,
        run: async (locked) => {
          assert.ok(locked.candidate);
          await locked.updateTrialEnd(EXTENDED_TRIAL_END, NOW);
        },
        transactionTimeoutMs: 190_000,
      });

    assert.equal(tx.$queryRaw.mock.calls.length, 2);
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

  test("Prisma candidate scan uses redemption for finalized trials and reservation time only for provider-only rows", async () => {
    assert.equal(
      HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO,
      "2026-07-14T00:00:00.000Z",
    );
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
      continuationToken: null,
      limit: 100,
    });

    assert.deepEqual(findMany.mock.calls[0]?.[0], {
      include: {
        member: {
          select: {
            billingStatus: true,
            suspendedAt: true,
          },
        },
      },
      orderBy: { memberId: "asc" },
      take: 101,
      where: {
        OR: [
          {
            pulseTrialRedeemedAt: {
              lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
            },
          },
          {
            createdAt: {
              lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
            },
            pulseTrialRedeemedAt: null,
          },
        ],
      },
    });
  });

  test("local cohort includes a July 13 redemption and excludes the cutoff instant", async () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const stripeSubscription = makeSubscription({
      trial_end: toUnixSeconds(new Date("2026-07-20T12:00:00.000Z")),
    });
    const eligibleSource = makeCandidateSource([makeCandidate({
      pulseTrialRedeemedAt: new Date("2026-07-13T11:59:59.999Z"),
    })]);
    const excludedSource = makeCandidateSource([makeCandidate({
      pulseTrialRedeemedAt: new Date("2026-07-14T00:00:00.000Z"),
    })]);

    const eligible = await extendHostedPulseTrials({
      candidateSource: eligibleSource,
      now,
      stripe: makeStripeClient(stripeSubscription),
    });
    const excludedStripe = makeStripeClient(stripeSubscription);
    const excluded = await extendHostedPulseTrials({
      candidateSource: excludedSource,
      now,
      stripe: excludedStripe,
    });

    assert.equal(eligible.wouldExtend, 1);
    assert.equal(eligible.skipped.outside_campaign_cohort, 0);
    assert.equal(excluded.wouldExtend, 0);
    assert.equal(excluded.skipped.outside_campaign_cohort, 1);
    assert.equal(excludedStripe.retrieveCalls, 0);
    assert.equal(excludedStripe.updateCalls.length, 0);
  });

  test("provider phase discovers a pre-cutoff trial whose billing row arrived after the cutoff", async () => {
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_late_event",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
      trial_end: toUnixSeconds(new Date("2026-07-23T12:00:00.000Z")),
      trial_start: toUnixSeconds(new Date("2026-07-13T12:00:00.000Z")),
    });
    const lateRecord = {
      ...makePrismaCandidateRecord("member_late_event"),
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
      pulseTrialRedeemedAt: null,
    };
    const findMany = vi.fn(async () => []);
    const list = vi.fn(async () => ({
      data: [providerSubscription],
      has_more: false,
    }));
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn(async () => lateRecord),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 4,
    });

    assert.equal(page.candidates.length, 1);
    assert.equal(page.candidates[0]?.memberId, "member_late_event");
    assert.equal(page.candidates[0]?.pulseTrialRedeemedAt, null);
    assert.equal(page.candidates[0]?.providerCustomerId, "cus_test");
    assert.equal(page.candidates[0]?.stripeCustomerId, null);
    assert.ok(page.nextContinuationToken);
    assert.equal(page.nextContinuationToken.includes("member_late_event"), false);
    assert.equal(findMany.mock.calls.length, 0);
    expect(list).toHaveBeenCalledWith({
      limit: 4,
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });
  });

  test.each<[
    string,
    Date,
    Date | null,
    "active" | "not_started",
    "cleanup" | "stripe_customer_mismatch" | "local_candidate_changed",
  ]>([
    [
      "post-cutoff local row",
      new Date("2026-07-15T12:00:00.000Z"),
      null,
      "not_started",
      "stripe_customer_mismatch",
    ],
    [
      "pre-cutoff redeemed local row",
      new Date("2026-07-02T12:00:00.000Z"),
      new Date("2026-07-02T12:00:00.000Z"),
      "not_started",
      "cleanup",
    ],
    [
      "active row with no durable subscription winner",
      new Date("2026-07-15T12:00:00.000Z"),
      null,
      "active",
      "local_candidate_changed",
    ],
  ])("provider phase skips cross-customer recovery without a durable winner on a %s", async (
    _case,
    createdAt,
    pulseTrialRedeemedAt,
    billingStatus,
    expectedSkipReason,
  ) => {
    const providerSubscription = makeSubscription({
      customer: "cus_provider_owner",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_customer_conflict",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const conflictingRecord = {
      ...makePrismaCandidateRecord("member_customer_conflict"),
      ...(await buildHostedMemberBillingPrivateColumns({
        memberId: "member_customer_conflict",
        stripeCustomerId: "cus_durable_owner",
        stripeSubscriptionId: null,
      })),
      createdAt,
      member: {
        billingStatus,
        suspendedAt: null,
      },
      pulseTrialRedeemedAt,
    };
    const findMany = vi.fn(async () => []);
    const list = vi.fn(async () => ({
      data: [providerSubscription],
      has_more: false,
    }));
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn(async () => conflictingRecord),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 4,
    });

    expect(page.candidates).toHaveLength(1);
    const stripe = makeStripeClient(providerSubscription);
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe,
    });

    if (expectedSkipReason !== "cleanup") {
      expect(preview.skipped).toMatchObject({ [expectedSkipReason]: 1 });
    }
    assert.equal(preview.wouldRecoverProviderTrial, 0);
    assert.equal(preview.wouldCleanupProviderTrial, expectedSkipReason === "cleanup" ? 1 : 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(findMany.mock.calls.length, 0);
    expect(list).toHaveBeenCalledTimes(3);
  });

  test("provider phase discovers a pre-cutoff trial with no local billing owner", async () => {
    const providerSubscription = makeSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_unowned",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMember: {
        findUnique: vi.fn(async () => ({
          billingRef: null,
          billingStatus: "not_started",
          createdAt: new Date("2026-07-01T12:00:00.000Z"),
          id: "member_unowned",
          suspendedAt: null,
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        })),
      },
      hostedMemberBillingRef: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: {
          subscriptions: {
            list: vi.fn(async () => ({
              data: [providerSubscription],
              has_more: false,
            })),
          },
        } as never,
      },
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 4,
    });

    expect(page.candidates[0]).toMatchObject({
      memberBillingStatus: "not_started",
      memberId: "member_unowned",
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_test",
      pulseTrialRedeemedAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    assert.ok(page.nextContinuationToken);
  });

  test.each([
    [
      "pre-cutoff local redemption",
      new Date("2026-07-02T12:00:00.000Z"),
      new Date("2026-07-02T12:00:00.000Z"),
    ],
    [
      "post-cutoff local row",
      new Date("2026-07-15T12:00:00.000Z"),
      null,
    ],
  ])("provider phase keeps an obsolete exact subscription beside the durable winner for %s", async (
    _case,
    createdAt,
    pulseTrialRedeemedAt,
  ) => {
    const obsoleteSubscription = makeSubscription({
      id: "sub_obsolete",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const durableSubscription = makeSubscription({
      id: "sub_durable",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const record = {
      ...makePrismaCandidateRecord("member_test"),
      ...(await buildHostedMemberBillingPrivateColumns({
        memberId: "member_test",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_durable",
      })),
      createdAt,
      pulseTrialRedeemedAt,
    };
    const list = vi.fn()
      .mockResolvedValueOnce({
        data: [obsoleteSubscription, durableSubscription],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [obsoleteSubscription, durableSubscription],
        has_more: false,
      });
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => record),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 4,
    });

    expect(page.candidates.map((candidate) => candidate.providerSubscriptionId)).toEqual(
      pulseTrialRedeemedAt
        ? ["sub_obsolete"]
        : ["sub_obsolete", "sub_durable"],
    );
    expect(page.candidates[0]).toMatchObject({
      providerSubscriptionId: "sub_obsolete",
      stripeSubscriptionId: "sub_durable",
    });
    await expect(source.inspectProviderOnlyTrial({
      candidate: page.candidates[0]!,
      now: NOW,
    })).resolves.toEqual({
      kind: "cleanup-obsolete",
      subscription: obsoleteSubscription,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      customer: "cus_test",
      limit: 100,
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });
  });

  test.each(["active", "paused"] as const)(
    "provider phase discovers an exact %s obsolete campaign subscription",
    async (status) => {
      const obsoleteSubscription = makeSubscription({
        id: "sub_obsolete",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_test",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
        status,
      });
      const record = {
        ...makePrismaCandidateRecord("member_test"),
        ...(await buildHostedMemberBillingPrivateColumns({
          memberId: "member_test",
          stripeCustomerId: "cus_test",
          stripeSubscriptionId: "sub_durable",
        })),
        currentBillingPhase: "paid",
        currentCheckoutOffer: "standard",
        pulseTrialRedeemedAt: new Date("2026-07-02T12:00:00.000Z"),
      };
      const list = vi.fn(async () => ({
        data: [obsoleteSubscription],
        has_more: false,
      }));
      const source = createPrismaHostedPulseTrialExtensionCandidateSource({
        hostedMemberBillingRef: {
          findMany: vi.fn(async () => []),
          findUnique: vi.fn(async () => record),
        },
      } as never, {
        campaignRecovery: {
          priceId: PRICE_ID,
          stripe: { subscriptions: { list } } as never,
        },
      });

      const page = await source.listCandidates({
        continuationToken: null,
        limit: 4,
      });

      expect(page.candidates).toHaveLength(1);
      expect(page.candidates[0]).toMatchObject({
        providerSubscriptionId: "sub_obsolete",
        stripeSubscriptionId: "sub_durable",
      });
      await expect(source.inspectProviderOnlyTrial({
        candidate: page.candidates[0]!,
        now: NOW,
      })).resolves.toEqual({
        kind: "cleanup-obsolete",
        subscription: obsoleteSubscription,
      });
    },
  );

  test("locked provider cleanup proof uses the current durable subscription owner", async () => {
    const providerSubscription = makeSubscription({
      id: "sub_provider",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const previewCandidate = makeCandidate({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      memberBillingStatus: "active",
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_provider",
      pulseTrialRedeemedAt: null,
      stripeSubscriptionId: "sub_previous",
    });
    const lockedRecord = {
      ...makePrismaCandidateRecord("member_test"),
      ...(await buildHostedMemberBillingPrivateColumns({
        memberId: "member_test",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_provider",
      })),
      createdAt: previewCandidate.billingRefCreatedAt,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      pulseTrialRedeemedAt: null,
    };
    const list = vi.fn(async () => ({
      data: [providerSubscription],
      has_more: false,
    }));
    const cancel = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async () => []),
      hostedMemberBillingRef: {
        findFirst: vi.fn(async () => lockedRecord),
      },
    };
    const prismaSource = createPrismaHostedPulseTrialExtensionCandidateSource({
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { cancel, list } } as never,
      },
    });
    const source: HostedPulseTrialExtensionCandidateSource = {
      ...prismaSource,
      async listCandidates() {
        return {
          candidates: [previewCandidate],
          nextContinuationToken: null,
        };
      },
    };
    const extensionStripe = makeStripeClient(providerSubscription);
    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: extensionStripe,
    });
    assert.equal(preview.wouldCleanupProviderTrial, 1);

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: extensionStripe,
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.providerTrialsCleanedUp, 0);
    assert.equal(cancel.mock.calls.length, 0);
    assert.equal(extensionStripe.updateCalls.length, 0);
  });

  test("production source cleans cross-customer provider A beside durable B before closure", async () => {
    let obsoleteStatus: HostedPulseTrialExtensionStripeSubscription["status"] = "trialing";
    const buildObsoleteSubscription = () => makeSubscription({
      customer: "cus_provider_owner",
      id: "sub_obsolete",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
      status: obsoleteStatus,
    });
    const durableSubscription = makeSubscription({
      customer: "cus_durable_owner",
      id: "sub_durable",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_test",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
        [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
          HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
        [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]: "7",
      },
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    });
    const record = {
      ...makePrismaCandidateRecord("member_test"),
      ...(await buildHostedMemberBillingPrivateColumns({
        memberId: "member_test",
        stripeCustomerId: "cus_durable_owner",
        stripeSubscriptionId: "sub_durable",
      })),
      currentPeriodEnd: EXTENDED_TRIAL_END,
      currentTrialEndsAt: EXTENDED_TRIAL_END,
      pulseTrialRedeemedAt: new Date("2026-07-02T12:00:00.000Z"),
    };
    const memberRecord = {
      billingRef: record,
      billingStatus: "active",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      id: "member_test",
      suspendedAt: null,
      updatedAt: new Date("2026-07-02T12:00:00.000Z"),
    };
    const list = vi.fn(async (params: { customer?: string }) => ({
      data: params.customer === "cus_provider_owner"
        ? [buildObsoleteSubscription()]
        : params.customer === "cus_durable_owner"
          ? [durableSubscription]
          : [buildObsoleteSubscription(), durableSubscription],
      has_more: false,
    }));
    const cancel = vi.fn(async (subscriptionId: string) => {
      assert.equal(subscriptionId, "sub_obsolete");
      obsoleteStatus = "canceled";
      return buildObsoleteSubscription();
    });
    const findMany = vi.fn(async () => [record]);
    const tx = {
      $queryRaw: vi.fn(async () => []),
      hostedMember: {
        findUnique: vi.fn(async () => memberRecord),
      },
      hostedMemberBillingRef: {
        findFirst: vi.fn(async () => record),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn(async () => record),
      },
    };
    const source = createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      {
        campaignRecovery: {
          priceId: PRICE_ID,
          stripe: {
            subscriptions: { cancel, list },
          } as never,
        },
      },
    );
    const extensionStripe = {
      retrieveSubscription: vi.fn(async () => durableSubscription),
      updateSubscription: vi.fn(),
    };

    const preview = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: extensionStripe,
    });
    assert.equal(preview.wouldCleanupProviderTrial, 1);
    assert.equal(preview.hasMoreCandidates, true);

    const applied = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      priceId: PRICE_ID,
      stripe: extensionStripe,
    });
    assert.equal(applied.providerTrialsCleanedUp, 1);
    assert.equal(cancel.mock.calls.length, 1);
    expect(list.mock.invocationCallOrder.at(-1) ?? 0).toBeLessThan(
      cancel.mock.invocationCallOrder[0] ?? 0,
    );
    expect(cancel).toHaveBeenCalledWith(
      "sub_obsolete",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
    );
    assert.equal(extensionStripe.retrieveSubscription.mock.calls.length, 0);
    assert.equal(extensionStripe.updateSubscription.mock.calls.length, 0);

    const closure = await extendHostedPulseTrialsWithPrice({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      priceId: PRICE_ID,
      stripe: extensionStripe,
    });
    assert.equal(closure.wouldCleanupProviderTrial, 0);
    assert.equal(closure.wouldRecoverProviderTrial, 0);
    assert.equal(closure.wouldExtend, 0);
    assert.equal(closure.wouldReconcile, 0);
    assert.equal(closure.alreadyExtended, 1);
    assert.equal(cancel.mock.calls.length, 1);
  });

  test("provider discovery resumes across bounded Stripe pages before entering member traversal", async () => {
    const unrelatedSubscription = makeSubscription({
      id: "sub_unrelated",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_unrelated",
      },
    });
    const historicalSubscription = makeSubscription({
      id: "sub_historical",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_historical",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const list = vi.fn()
      .mockResolvedValueOnce({
        data: [unrelatedSubscription],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [historicalSubscription],
        has_more: false,
      });
    const memberFindMany = vi.fn(async () => []);
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMember: {
        findUnique: vi.fn(async () => ({
          billingRef: null,
          billingStatus: "not_started",
          createdAt: new Date("2026-07-01T12:00:00.000Z"),
          id: "member_historical",
          suspendedAt: null,
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        })),
      },
      hostedMemberBillingRef: {
        findMany: memberFindMany,
        findUnique: vi.fn(async () => null),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: {
          subscriptions: { list },
        } as never,
      },
    });

    const firstPage = await source.listCandidates({
      continuationToken: null,
      limit: 1,
    });
    assert.equal(firstPage.candidates.length, 0);
    assert.ok(firstPage.nextContinuationToken);
    assert.equal(memberFindMany.mock.calls.length, 0);

    const secondPage = await source.listCandidates({
      continuationToken: firstPage.nextContinuationToken,
      limit: 1,
    });
    assert.equal(secondPage.candidates[0]?.memberId, "member_historical");
    assert.ok(secondPage.nextContinuationToken);
    assert.equal(memberFindMany.mock.calls.length, 0);
    expect(list).toHaveBeenNthCalledWith(2, {
      limit: 1,
      starting_after: "sub_unrelated",
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });

    const memberPage = await source.listCandidates({
      continuationToken: secondPage.nextContinuationToken,
      limit: 1,
    });
    assert.equal(memberPage.candidates.length, 0);
    assert.equal(memberPage.nextContinuationToken, null);
    assert.equal(list.mock.calls.length, 2);
    assert.equal(memberFindMany.mock.calls.length, 1);
  });

  test("member-scoped traversal reaches its provider trial beyond unrelated raw pages", async () => {
    const unrelatedSubscription = makeSubscription({
      id: "sub_unrelated",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_unrelated",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const targetSubscription = makeSubscription({
      id: "sub_target",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_target",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [unrelatedSubscription], has_more: true })
      .mockResolvedValueOnce({ data: [targetSubscription], has_more: false });
    const findMany = vi.fn(async () => []);
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMember: {
        findUnique: vi.fn(async () => ({
          billingRef: null,
          billingStatus: "not_started",
          createdAt: new Date("2026-07-01T12:00:00.000Z"),
          id: "member_target",
          suspendedAt: null,
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        })),
      },
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn(async () => null),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
      memberId: "member_target",
    });

    const memberPage = await source.listCandidates({
      continuationToken: null,
      limit: 1,
    });
    assert.equal(memberPage.candidates.length, 0);
    assert.ok(memberPage.nextContinuationToken);
    assert.equal(findMany.mock.calls.length, 0);

    const allMembersSource = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: { findMany },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
    });
    await expect(allMembersSource.listCandidates({
      continuationToken: memberPage.nextContinuationToken,
      limit: 1,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionContinuationError);

    const targetProviderPage = await source.listCandidates({
      continuationToken: memberPage.nextContinuationToken,
      limit: 1,
    });
    expect(targetProviderPage.candidates).toHaveLength(1);
    expect(targetProviderPage.candidates[0]).toMatchObject({
      memberId: "member_target",
      providerSubscriptionId: "sub_target",
    });
    assert.ok(targetProviderPage.nextContinuationToken);
    expect(list).toHaveBeenNthCalledWith(2, {
      limit: 1,
      starting_after: "sub_unrelated",
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });

    const localPage = await source.listCandidates({
      continuationToken: targetProviderPage.nextContinuationToken,
      limit: 1,
    });
    expect(localPage.candidates).toHaveLength(0);
    expect(localPage.nextContinuationToken).toBeNull();
    expect(findMany).toHaveBeenCalledOnce();
  });

  test("member-scoped traversal returns every exact provider obligation before its local candidate", async () => {
    const firstProviderSubscription = makeSubscription({
      id: "sub_provider_a",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_target",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const secondProviderSubscription = {
      ...firstProviderSubscription,
      id: "sub_provider_b",
    };
    const localRecord = makePrismaCandidateRecord("member_target");
    const findMany = vi.fn(async () => [localRecord]);
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany,
        findUnique: vi.fn(async () => localRecord),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: {
          subscriptions: {
            list: vi.fn(async () => ({
              data: [firstProviderSubscription, secondProviderSubscription],
              has_more: false,
            })),
          },
        } as never,
      },
      memberId: "member_target",
    });

    const providerPage = await source.listCandidates({
      continuationToken: null,
      limit: 10,
    });
    expect(providerPage.candidates.map((candidate) => candidate.providerSubscriptionId))
      .toEqual(["sub_provider_a", "sub_provider_b"]);
    expect(findMany).not.toHaveBeenCalled();
    expect(providerPage.nextContinuationToken).not.toBeNull();

    const localPage = await source.listCandidates({
      continuationToken: providerPage.nextContinuationToken,
      limit: 10,
    });
    expect(localPage.candidates).toHaveLength(1);
    expect(localPage.candidates[0]?.memberId).toBe("member_target");
    expect(findMany).toHaveBeenCalledOnce();
  });

  test("member-scoped provider traversal retries the same first page after a provider failure", async () => {
    const providerSubscription = makeSubscription({
      id: "sub_provider_retry",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_target",
        trialDurationDays: "10",
        trialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialUsageLimitUsdMicros: "4500000",
      },
    });
    const list = vi.fn()
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce({ data: [providerSubscription], has_more: false });
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
      },
      hostedMember: {
        findUnique: vi.fn(async () => ({
          billingRef: null,
          billingStatus: "not_started",
          createdAt: new Date("2026-07-01T12:00:00.000Z"),
          id: "member_target",
          suspendedAt: null,
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        })),
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: { subscriptions: { list } } as never,
      },
      memberId: "member_target",
    });

    await expect(source.listCandidates({ continuationToken: null, limit: 10 }))
      .rejects.toThrow("temporary provider failure");
    await expect(source.listCandidates({ continuationToken: null, limit: 10 }))
      .resolves.toMatchObject({
        candidates: [expect.objectContaining({
          providerSubscriptionId: "sub_provider_retry",
        })],
      });
    expect(list).toHaveBeenNthCalledWith(1, {
      limit: 10,
      status: "all",
    }, expect.anything());
    expect(list).toHaveBeenNthCalledWith(2, {
      limit: 10,
      status: "all",
    }, expect.anything());
  });

  test("member-scoped traversal moves from an empty provider phase to its finalized local trial", async () => {
    const localRecord = makePrismaCandidateRecord("member_target");
    const findMany = vi.fn(async () => [localRecord]);
    const source = createPrismaHostedPulseTrialExtensionCandidateSource({
      hostedMemberBillingRef: {
        findMany,
      },
    } as never, {
      campaignRecovery: {
        priceId: PRICE_ID,
        stripe: {
          subscriptions: {
            list: vi.fn(async () => ({ data: [], has_more: false })),
          },
        } as never,
      },
      memberId: "member_target",
    });

    const page = await source.listCandidates({
      continuationToken: null,
      limit: 10,
    });

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0]?.memberId).toBe("member_target");
    expect(page.candidates[0]?.providerSubscriptionId).toBeNull();
    expect(findMany).toHaveBeenCalledOnce();
  });

  test("continuations cannot cross all-member or member-specific scopes", async () => {
    const unrelatedSubscription = makeSubscription({
      id: "sub_unrelated",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_unrelated",
      },
    });
    const allList = vi.fn(async () => ({
      data: [unrelatedSubscription],
      has_more: true,
    }));
    const prisma = {
      hostedMemberBillingRef: {
        findMany: vi.fn(async () => []),
      },
    };
    const allMembersSource = createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      {
        campaignRecovery: {
          priceId: PRICE_ID,
          stripe: { subscriptions: { list: allList } } as never,
        },
      },
    );
    const allMembersPage = await allMembersSource.listCandidates({
      continuationToken: null,
      limit: 1,
    });
    assert.ok(allMembersPage.nextContinuationToken);

    const memberASource = createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      {
        campaignRecovery: {
          priceId: PRICE_ID,
          stripe: {
            subscriptions: {
              list: vi.fn(async () => ({
                data: [unrelatedSubscription],
                has_more: true,
              })),
            },
          } as never,
        },
        memberId: "member_a",
      },
    );
    await expect(memberASource.listCandidates({
      continuationToken: allMembersPage.nextContinuationToken,
      limit: 1,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionContinuationError);

    const memberAPage = await memberASource.listCandidates({
      continuationToken: null,
      limit: 1,
    });
    assert.ok(memberAPage.nextContinuationToken);
    const memberBSource = createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      {
        campaignRecovery: {
          priceId: PRICE_ID,
          stripe: {
            subscriptions: {
              list: vi.fn(async () => ({
                data: [unrelatedSubscription],
                has_more: true,
              })),
            },
          } as never,
        },
        memberId: "member_b",
      },
    );
    await expect(memberBSource.listCandidates({
      continuationToken: memberAPage.nextContinuationToken,
      limit: 1,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionContinuationError);
  });

  test("Prisma candidate continuation is opaque, deletion-safe keyset state", async () => {
    const firstRecord = makePrismaCandidateRecord("member_a");
    const findMany = vi.fn()
      .mockResolvedValueOnce([firstRecord, makePrismaCandidateRecord("member_b")])
      .mockResolvedValueOnce([]);
    const prisma = {
      hostedMemberBillingRef: { findMany },
    };
    const source = createPrismaHostedPulseTrialExtensionCandidateSource(prisma as never);

    const firstPage = await source.listCandidates({
      continuationToken: null,
      limit: 1,
    });
    assert.equal(firstPage.candidates[0]?.memberId, "member_a");
    assert.ok(firstPage.nextContinuationToken);
    assert.equal(firstPage.nextContinuationToken.includes("member_a"), false);

    await source.listCandidates({
      continuationToken: firstPage.nextContinuationToken,
      limit: 1,
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      orderBy: { memberId: "asc" },
      take: 2,
      where: {
        memberId: { gt: "member_a" },
      },
    });

    await expect(source.listCandidates({
      continuationToken: `${firstPage.nextContinuationToken}tampered`,
      limit: 1,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionContinuationError);

    await expect(source.listCandidates({
      continuationToken:
        `pulse-cursor-v3.v1.${"a".repeat(16)}.${"b".repeat(8)}.${"c".repeat(22)}`,
      limit: 1,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionContinuationError);
  });

  test("Prisma candidate scan narrows to one member when a member filter is set", async () => {
    const findMany = vi.fn(async (input: unknown) => {
      void input;
      return [];
    });
    const prisma = {
      hostedMemberBillingRef: { findMany },
    };

    const source = createPrismaHostedPulseTrialExtensionCandidateSource(
      prisma as never,
      { memberId: "member_only" },
    );
    await source.listCandidates({
      continuationToken: null,
      limit: 100,
    });

    assert.deepEqual(findMany.mock.calls[0]?.[0], {
      include: {
        member: {
          select: {
            billingStatus: true,
            suspendedAt: true,
          },
        },
      },
      orderBy: { memberId: "asc" },
      take: 101,
      where: {
        memberId: "member_only",
        OR: [
          {
            pulseTrialRedeemedAt: {
              lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
            },
          },
          {
            createdAt: {
              lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
            },
            pulseTrialRedeemedAt: null,
          },
        ],
      },
    });
  });

  test("candidate pages keep every request bounded and reach candidates above four", async () => {
    const source = makeCandidateSource([
      makeCandidate({ memberId: "member_1" }),
      makeCandidate({ memberId: "member_2" }),
      makeCandidate({ memberId: "member_3" }),
      makeCandidate({ memberId: "member_4" }),
      makeCandidate({ memberId: "member_5" }),
    ]);
    const stripe = makeStripeClient();

    const firstPage = await extendHostedPulseTrials({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe,
    });
    const secondPage = await extendHostedPulseTrials({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      continuationToken: firstPage.nextContinuationToken,
      stripe,
    });

    assert.equal(firstPage.candidates, 4);
    assert.equal(firstPage.hasMoreCandidates, true);
    assert.equal(secondPage.candidates, 1);
    assert.equal(secondPage.hasMoreCandidates, false);
    assert.deepEqual(source.listInputs, [
      { continuationToken: null, limit: 4 },
      { continuationToken: "cursor:member_4", limit: 4 },
    ]);
    assert.equal(source.lockCalls, 0);
    assert.equal(stripe.retrieveCalls, 5);
    assert.equal(stripe.updateCalls.length, 0);
  });

  test("keyset continuation reaches an unvisited member after an earlier account deletion", async () => {
    const source = makeCandidateSource([
      makeCandidate({ memberId: "member_a" }),
      makeCandidate({ memberId: "member_b" }),
      makeCandidate({ memberId: "member_c" }),
      makeCandidate({ memberId: "member_d" }),
      makeCandidate({ memberId: "member_e" }),
    ]);
    const stripe = makeStripeClient();

    const firstBatch = await extendHostedPulseTrials({
      candidateSource: source,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe,
    });
    source.candidates.splice(1, 1);
    const terminalBatch = await extendHostedPulseTrials({
      candidateSource: source,
      continuationToken: firstBatch.nextContinuationToken,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe,
    });

    assert.equal(terminalBatch.candidates, 1);
    assert.equal(terminalBatch.hasMoreCandidates, false);
    assert.deepEqual(source.listInputs, [
      { continuationToken: null, limit: 4 },
      { continuationToken: "cursor:member_d", limit: 4 },
    ]);
    assert.equal(stripe.retrieveCalls, 5);
  });

  test("candidate snapshot digest rejects a changed bounded set before provider work", async () => {
    const previewSource = makeCandidateSource([makeCandidate()]);
    const previewStripe = makeStripeClient();
    const preview = await extendHostedPulseTrials({
      candidateSource: previewSource,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe: previewStripe,
    });

    assert.match(preview.candidateSnapshotDigest ?? "", /^pulse-candidates-v4\./u);
    assert.equal(preview.candidatePreviewTokens?.length, 1);
    assert.match(preview.candidatePreviewTokens?.[0] ?? "", /^pulse-target-v4\./u);
    assert.doesNotMatch(preview.candidateSnapshotDigest ?? "", /member_test/u);

    const changedSource = makeCandidateSource([
      makeCandidate(),
      makeCandidate({ memberId: "member_new" }),
    ]);
    const changedStripe = makeStripeClient();
    await assert.rejects(
      extendHostedPulseTrials({
        candidateSource: changedSource,
        expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
        maxCandidates: 4,
        mode: "apply",
        now: NOW,
        stripe: changedStripe,
      }),
      HostedPulseTrialExtensionPreviewMismatchError,
    );
    assert.equal(changedSource.lockCalls, 0);
    assert.equal(changedStripe.retrieveCalls, 0);
    assert.equal(changedStripe.updateCalls.length, 0);

    const changedReferenceSource = makeCandidateSource([
      makeCandidate({ stripeSubscriptionId: "sub_replaced" }),
    ]);
    const changedReferenceStripe = makeStripeClient();
    await assert.rejects(
      extendHostedPulseTrials({
        candidateSource: changedReferenceSource,
        expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
        maxCandidates: 4,
        mode: "apply",
        now: NOW,
        stripe: changedReferenceStripe,
      }),
      HostedPulseTrialExtensionPreviewMismatchError,
    );
    assert.equal(changedReferenceSource.lockCalls, 0);
    assert.equal(changedReferenceStripe.retrieveCalls, 0);
    assert.equal(changedReferenceStripe.updateCalls.length, 0);

    const changedContinuationSource = makeCandidateSource([makeCandidate()]);
    const changedContinuationStripe = makeStripeClient();
    await assert.rejects(
      extendHostedPulseTrials({
        candidateSource: changedContinuationSource,
        continuationToken: "cursor:member_before",
        expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
        expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
        maxCandidates: 4,
        mode: "apply",
        now: NOW,
        stripe: changedContinuationStripe,
      }),
      HostedPulseTrialExtensionPreviewMismatchError,
    );
    assert.equal(changedContinuationSource.lockCalls, 0);
    assert.equal(changedContinuationStripe.retrieveCalls, 0);
    assert.equal(changedContinuationStripe.updateCalls.length, 0);

    const matchingSource = makeCandidateSource([makeCandidate()]);
    const matchingStripe = makeStripeClient();
    const applied = await extendHostedPulseTrials({
      candidateSource: matchingSource,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      stripe: matchingStripe,
    });
    assert.equal(applied.stripeTrialsExtended, 1);
    assert.equal(applied.candidateSnapshotDigest, null);
  });

  test("provider state proof blocks a changed target before its Stripe update", async () => {
    const previewSource = makeCandidateSource([makeCandidate()]);
    const preview = await extendHostedPulseTrials({
      candidateSource: previewSource,
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe: makeStripeClient(),
    });
    const changedStripe = makeStripeClient(makeSubscription({
      trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
    }));

    const applied = await extendHostedPulseTrials({
      candidateSource: makeCandidateSource([makeCandidate()]),
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      stripe: changedStripe,
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(changedStripe.retrieveCalls, 1);
    assert.equal(changedStripe.updateCalls.length, 0);
  });

  test.each([
    [
      "an incomplete item page",
      makeSubscription({
        items: {
          data: [makeSubscriptionItem()],
          has_more: true,
        },
      }),
    ],
    [
      "different member ownership",
      makeSubscription({ metadata: { memberId: "member_other" } }),
    ],
    [
      "a different trial policy",
      makeSubscription({
        metadata: {
          trialDurationDays: "7",
          trialPolicyVersion: "pulse-trial-2026-05-05-v1",
        },
      }),
    ],
  ])("provider state proof binds %s before its Stripe update", async (
    _label,
    changedSubscription,
  ) => {
    const preview = await extendHostedPulseTrials({
      candidateSource: makeCandidateSource([makeCandidate()]),
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe: makeStripeClient(),
    });
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient(changedSubscription);

    const applied = await extendHostedPulseTrials({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(stripe.updateCalls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("rejects an incomplete Stripe update result before local reconciliation", async () => {
    const preview = await extendHostedPulseTrials({
      candidateSource: makeCandidateSource([makeCandidate()]),
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe: makeStripeClient(),
    });
    const source = makeCandidateSource([makeCandidate()]);
    const stripe = makeStripeClient();
    stripe.updateSubscription = vi.fn(async (_subscriptionId, params) =>
      makeSubscription({
        items: {
          data: [makeSubscriptionItem()],
          has_more: true,
        },
        metadata: params.metadata,
        trial_end: params.trial_end,
      })
    );

    const applied = await extendHostedPulseTrials({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.equal(applied.failures.stripe_update_result_invalid, 1);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(source.updateCalls.length, 0);
  });

  test("rechecks provider preview proof while the member mutation lock is held", async () => {
    const preview = await extendHostedPulseTrials({
      candidateSource: makeCandidateSource([makeCandidate()]),
      maxCandidates: 4,
      mode: "dry-run",
      now: NOW,
      stripe: makeStripeClient(),
    });
    const source = makeCandidateSource([makeCandidate()]);
    const events: string[] = [];
    source.withStripeMutationLock = async (input) => {
      events.push("lock-enter");
      try {
        return await input.run({
          async applyProviderOnlyDisposition() {
            return "recovered";
          },
          candidate: source.candidates[0] ?? null,
          async updateTrialEnd() {
            throw new Error("A stale provider target must not be reconciled.");
          },
        });
      } finally {
        events.push("lock-exit");
      }
    };
    const updateSubscription = vi.fn();
    const stripe: HostedPulseTrialExtensionStripeClient = {
      async retrieveSubscription() {
        events.push("provider-retrieve");
        return makeSubscription({
          trial_end: toUnixSeconds(EXTENDED_TRIAL_END),
        });
      },
      updateSubscription,
    };

    const applied = await extendHostedPulseTrials({
      candidateSource: source,
      expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? undefined,
      expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? undefined,
      maxCandidates: 4,
      mode: "apply",
      now: NOW,
      stripe,
    });

    assert.deepEqual(events, ["lock-enter", "provider-retrieve", "lock-exit"]);
    assert.equal(applied.failures.preview_state_changed, 1);
    assert.equal(applied.stripeTrialsExtended, 0);
    assert.equal(updateSubscription.mock.calls.length, 0);
    assert.equal(source.updateCalls.length, 0);
  });
});

async function extendHostedPulseTrials(input: {
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  continuationToken?: string | null;
  expectedCandidatePreviewTokens?: readonly string[];
  expectedCandidateSnapshotDigest?: string;
  maxCandidates?: number;
  mode?: "apply" | "dry-run";
  now?: Date;
  stripe: HostedPulseTrialExtensionStripeClient;
}) {
  const commonInput = {
    candidateSource: input.candidateSource,
    continuationToken: input.continuationToken,
    maxCandidates: input.maxCandidates ?? 4,
    now: input.now,
    priceId: PRICE_ID,
    stripe: input.stripe,
  };
  if (input.mode !== "apply") {
    return extendHostedPulseTrialsWithPrice({
      ...commonInput,
      mode: "dry-run",
    });
  }
  if (
    input.expectedCandidatePreviewTokens !== undefined ||
    input.expectedCandidateSnapshotDigest !== undefined
  ) {
    return extendHostedPulseTrialsWithPrice({
      ...commonInput,
      expectedCandidatePreviewTokens: input.expectedCandidatePreviewTokens ?? [],
      expectedCandidateSnapshotDigest: input.expectedCandidateSnapshotDigest ?? "",
      mode: "apply",
    });
  }
  const preview = await extendHostedPulseTrialsWithPrice({
    ...commonInput,
    mode: "dry-run",
  });
  return extendHostedPulseTrialsWithPrice({
    ...commonInput,
    expectedCandidatePreviewTokens: preview.candidatePreviewTokens ?? [],
    expectedCandidateSnapshotDigest: preview.candidateSnapshotDigest ?? "",
    mode: "apply",
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
    billingRefCreatedAt: new Date("2026-07-01T12:00:00.000Z"),
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentPeriodEnd: ORIGINAL_TRIAL_END,
    currentTrialEndsAt: ORIGINAL_TRIAL_END,
    currentTrialStartedAt: new Date("2026-07-02T12:00:00.000Z"),
    lastStripeEventCreatedAt: new Date("2026-07-02T12:00:00.000Z"),
    memberBillingStatus: "active",
    memberId: "member_test",
    memberSuspendedAt: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    pulseTrialRedeemedAt: new Date("2026-07-02T12:00:00.000Z"),
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    ...overrides,
  };
}

function makePrismaCandidateRecord(memberId: string) {
  const candidate = makeCandidate({ memberId });
  return {
    createdAt: candidate.billingRefCreatedAt,
    currentBillingPhase: candidate.currentBillingPhase,
    currentBillingPlanCode: candidate.currentBillingPlanCode,
    currentCheckoutOffer: candidate.currentCheckoutOffer,
    currentPeriodEnd: candidate.currentPeriodEnd,
    currentPeriodStart: candidate.currentTrialStartedAt,
    currentTrialEndsAt: candidate.currentTrialEndsAt,
    currentTrialStartedAt: candidate.currentTrialStartedAt,
    lastStripeEventCreatedAt: candidate.lastStripeEventCreatedAt,
    member: {
      billingStatus: candidate.memberBillingStatus,
      suspendedAt: candidate.memberSuspendedAt,
    },
    memberId,
    pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
    pulseTrialRedeemedAt: candidate.pulseTrialRedeemedAt,
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    stripeCustomerIdEncrypted: null,
    stripeSubscriptionIdEncrypted: null,
    stripeSubscriptionScheduleIdEncrypted: null,
  };
}

function makeSubscription(
  overrides: Partial<HostedPulseTrialExtensionStripeSubscription> = {},
): HostedPulseTrialExtensionStripeSubscription {
  const { items, metadata, ...rest } = overrides;
  return {
    cancel_at: null,
    cancel_at_period_end: false,
    customer: "cus_test",
    id: "sub_test",
    items: {
      data: items?.data ?? [makeSubscriptionItem()],
      has_more: items?.has_more ?? false,
    },
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_test",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
      ...metadata,
    },
    status: "trialing",
    trial_end: toUnixSeconds(ORIGINAL_TRIAL_END),
    trial_start: toUnixSeconds(new Date("2026-07-02T12:00:00.000Z")),
    ...rest,
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
    applyProviderOnlyDisposition?: (
      disposition: Exclude<
        Awaited<ReturnType<HostedPulseTrialExtensionCandidateSource["inspectProviderOnlyTrial"]>>,
        { kind: "not-applicable" }
      >,
      now: Date,
    ) => Promise<"cleaned-up" | "recovered">;
    beforeLock?: (candidates: HostedPulseTrialExtensionCandidate[]) => void;
    events?: string[];
    failUpdates?: number;
    inspectProviderOnlyTrial?: HostedPulseTrialExtensionCandidateSource[
      "inspectProviderOnlyTrial"
    ];
  } = {},
): HostedPulseTrialExtensionCandidateSource & {
  candidates: HostedPulseTrialExtensionCandidate[];
  listInputs: Array<{
    continuationToken: string | null;
    limit: number;
  }>;
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
  const listInputs: Array<{
    continuationToken: string | null;
    limit: number;
  }> = [];
  let lockCalls = 0;
  let remainingFailures = options.failUpdates ?? 0;

  return {
    candidates,
    get lockCalls() {
      return lockCalls;
    },
    listInputs,
    async listCandidates(input) {
      listInputs.push(input);
      const afterMemberId = input.continuationToken?.replace(/^cursor:/u, "") ?? null;
      const startIndex = afterMemberId
        ? candidates.findIndex((candidate) => candidate.memberId > afterMemberId)
        : 0;
      const normalizedStartIndex = startIndex < 0 ? candidates.length : startIndex;
      const pageCandidates = candidates.slice(
        normalizedStartIndex,
        normalizedStartIndex + input.limit,
      );
      const hasMore = normalizedStartIndex + pageCandidates.length < candidates.length;
      return {
        candidates: pageCandidates,
        nextContinuationToken: hasMore
          ? `cursor:${pageCandidates.at(-1)?.memberId ?? ""}`
          : null,
      };
    },
    updateCalls,
    inspectProviderOnlyTrial: options.inspectProviderOnlyTrial ??
      (async () => ({
        kind: "not-applicable",
        reason: "provider-trial-not-found",
        subscription: null,
      })),
    async withStripeMutationLock(input) {
      lockCalls += 1;
      options.beforeLock?.(candidates);
      const candidate = candidates.find(
        (entry) => entry.memberId === input.candidate.memberId,
      ) ?? null;
      return input.run({
        applyProviderOnlyDisposition: options.applyProviderOnlyDisposition ??
          (async () => "recovered"),
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
  resolveSubscription?: (
    subscriptionId: string,
  ) => HostedPulseTrialExtensionStripeSubscription,
): HostedPulseTrialExtensionStripeClient & {
  retrieveCalls: number;
  retrieveOptions: HostedPulseTrialExtensionStripeRequestOptions[];
  updateCalls: Array<{
    options: {
      idempotencyKey: string;
      maxNetworkRetries: 0;
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
    retrieveOptions: [] as HostedPulseTrialExtensionStripeRequestOptions[],
    updateCalls: [] as Array<{
      options: {
        idempotencyKey: string;
        maxNetworkRetries: 0;
        timeout: 80_000;
      };
      params: HostedPulseTrialExtensionStripeUpdateParams;
      subscriptionId: string;
    }>,
    async retrieveSubscription(
      subscriptionId: string,
      options: HostedPulseTrialExtensionStripeRequestOptions,
    ) {
      client.retrieveCalls += 1;
      client.retrieveOptions.push(options);
      if (resolveSubscription) {
        const resolvedSubscription = resolveSubscription(subscriptionId);
        subscription = {
          ...resolvedSubscription,
          metadata: { ...(resolvedSubscription.metadata ?? {}) },
        };
      }
      return subscription;
    },
    async updateSubscription(
      subscriptionId: string,
      params: HostedPulseTrialExtensionStripeUpdateParams,
      options: {
        idempotencyKey: string;
        maxNetworkRetries: 0;
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

function makeCandidateSubscriptionResolver(
  candidates: readonly HostedPulseTrialExtensionCandidate[],
) {
  return (subscriptionId: string): HostedPulseTrialExtensionStripeSubscription => {
    const candidate = candidates.find(
      (current) => current.stripeSubscriptionId === subscriptionId,
    );
    return makeSubscription({
      customer: candidate?.stripeCustomerId ?? "cus_test",
      id: subscriptionId,
      metadata: {
        memberId: candidate?.memberId ?? "member_test",
      },
    });
  };
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
