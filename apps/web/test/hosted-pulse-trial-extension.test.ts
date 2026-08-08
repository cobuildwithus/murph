import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveHostedFamilySponsorship: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  reconcileHostedAiUsageAllowancePeriodForMemberTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  withHostedMemberStripeMutationLockForOps: vi.fn(),
  writeHostedMemberStripeBillingRefTx: vi.fn(),
}));

vi.mock("../src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-onboarding/member-access")
  >("../src/lib/hosted-onboarding/member-access");
  return {
    ...actual,
    readActiveHostedFamilySponsorship:
      mocks.readActiveHostedFamilySponsorship,
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-onboarding/hosted-member-store")
  >("../src/lib/hosted-onboarding/hosted-member-store");
  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-onboarding/hosted-member-billing-store")
  >("../src/lib/hosted-onboarding/hosted-member-billing-store");
  return {
    ...actual,
    withHostedMemberStripeMutationLockForOps:
      mocks.withHostedMemberStripeMutationLockForOps,
    writeHostedMemberStripeBillingRefTx:
      mocks.writeHostedMemberStripeBillingRefTx,
  };
});

vi.mock("../src/lib/hosted-execution/usage-allowance", () => ({
  reconcileHostedAiUsageAllowancePeriodForMemberTx:
    mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
}));

import type { HostedMemberBillingSnapshot } from "../src/lib/hosted-onboarding/hosted-member-store";
import { HostedMemberStripeMutationLockBusyError } from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  applyHostedPulseTrialExtension,
  classifyHostedPulseTrialExtensionProviderState,
  HostedPulseTrialExtensionLockBusyError,
  HostedPulseTrialExtensionPreviewStaleError,
  HostedPulseTrialExtensionProviderError,
  previewHostedPulseTrialExtension,
  type HostedPulseTrialExtensionStripeResumeParams,
  type HostedPulseTrialExtensionStripeUpdateParams,
  type HostedPulseTrialExtensionSubscription,
} from "../src/lib/hosted-ops/pulse-trial-extension";

const NOW = new Date("2026-07-14T16:00:00.000Z");
const MEMBER_ID = "hbm_target_1";
const CUSTOMER_ID = "cus_target";
const SUBSCRIPTION_ID = "sub_target";
const PRICE_ID = "price_pulse";
const ORIGINAL_TRIAL_END = Math.floor(
  new Date("2026-07-18T16:00:00.000Z").getTime() / 1000,
);
const TARGET_FROM_PAUSED = Math.floor(
  new Date("2026-07-21T16:00:00.000Z").getTime() / 1000,
);
const TARGET_FROM_LIVE = Math.floor(
  new Date("2026-07-25T16:00:00.000Z").getTime() / 1000,
);
const RECOVERABLE_OPERATION_ID = "a".repeat(43);
const CONTACT_PRIVACY_KEY = Buffer.alloc(32, 7).toString("base64");
const originalContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
const originalContactPrivacyVersion =
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

describe("single-member Pulse Trial extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${CONTACT_PRIVACY_KEY}`;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember());
    mocks.withHostedMemberStripeMutationLockForOps.mockImplementation(
      async (input: { run: (tx: object) => Promise<unknown> }) => input.run({}),
    );
    mocks.updateHostedMemberCoreState.mockResolvedValue({
      ...makeMember().core,
      billingStatus: HostedBillingStatus.active,
    });
    mocks.writeHostedMemberStripeBillingRefTx.mockImplementation(
      async (input: { currentTrialEndsAt: Date }) => ({
        ...makeMember().billingRef,
        currentBillingPhase: "trial",
        currentPeriodEnd: input.currentTrialEndsAt,
        currentTrialEndsAt: input.currentTrialEndsAt,
      }),
    );
    mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx.mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", originalContactPrivacyKeys);
    restoreEnv(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      originalContactPrivacyVersion,
    );
  });

  test("accepts only owned live or lapsed paused Pulse Trials", () => {
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({ status: "trialing" }),
    })).toBeNull();
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({ status: "paused", trialEnd: 1_700_000_000 }),
    })).toBeNull();
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({ status: "active", trialEnd: null }),
    })).toBe("provider_subscription_not_extendable");
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({
        extensionDays: "7",
        extensionOperation: RECOVERABLE_OPERATION_ID,
        extensionTargetTrialEnd: TARGET_FROM_PAUSED,
        status: "active",
        trialEnd: 1_700_000_000,
      }),
    })).toBeNull();
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({
        extensionDays: "7",
        extensionOperation: RECOVERABLE_OPERATION_ID,
        extensionTargetTrialEnd: Math.floor(NOW.getTime() / 1000) - 1,
        status: "active",
        trialEnd: 1_700_000_000,
      }),
    })).toBe("provider_subscription_not_extendable");
    expect(classifyHostedPulseTrialExtensionProviderState({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      subscription: makeSubscription({ customerId: "cus_other" }),
    })).toBe("provider_identity_mismatch");
  });

  test("previews a lapsed paused trial for seven days from Preview", async () => {
    const stripe = makeStripeClient(makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    }));

    const result = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result).toMatchObject({
      currentTrialEndsAt: new Date(1_700_000_000 * 1000).toISOString(),
      eligibilityCode: "eligible",
      eligible: true,
      localBillingStatus: "paused",
      memberId: MEMBER_ID,
      outcome: "preview",
      providerStatus: "paused",
      targetTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000).toISOString(),
    });
    expect(result.previewProof?.token).toMatch(
      /^pulse-member-preview-v1\.v1\.[A-Za-z0-9_-]{43}$/u,
    );
    expect(JSON.stringify(result)).not.toContain(CUSTOMER_ID);
    expect(JSON.stringify(result)).not.toContain(SUBSCRIPTION_ID);
  });

  test("rejects active Family sponsorship before reading Stripe", async () => {
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(true);
    const stripe = makeStripeClient(makeSubscription({ status: "paused" }));

    const result = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result).toMatchObject({
      eligibilityCode: "family_sponsored",
      eligible: false,
      message: "This member already has access through an active Family plan.",
      providerStatus: null,
      targetTrialEndsAt: null,
    });
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
  });

  test("rejects Apply if Family sponsorship became active after Preview", async () => {
    mocks.readActiveHostedFamilySponsorship
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const prisma = {};
    const lockTx = {};
    mocks.withHostedMemberStripeMutationLockForOps.mockImplementationOnce(
      async (input: { run: (tx: object) => Promise<unknown> }) =>
        input.run(lockTx),
    );
    const stripe = makeStripeClient(makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    }));
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: prisma as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }
    stripe.retrieveSubscription.mockClear();

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: prisma as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(mocks.readActiveHostedFamilySponsorship).toHaveBeenNthCalledWith(
      1,
      { memberId: MEMBER_ID, prisma },
    );
    expect(mocks.readActiveHostedFamilySponsorship).toHaveBeenNthCalledWith(
      2,
      { memberId: MEMBER_ID, prisma: lockTx },
    );
    expect(
      mocks.withHostedMemberStripeMutationLockForOps.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readActiveHostedFamilySponsorship.mock.invocationCallOrder[1] ?? 0,
    );
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("does not recover a completed extension after the provider becomes paid active", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.active,
      trialEndsAt: new Date(TARGET_FROM_PAUSED * 1000),
    }));
    let providerSubscription = makeSubscription({
      extensionDays: "7",
      extensionOperation: RECOVERABLE_OPERATION_ID,
      extensionTargetTrialEnd: TARGET_FROM_PAUSED,
      status: "trialing",
      trialEnd: TARGET_FROM_PAUSED,
    });
    const stripe = makeStripeClient(providerSubscription);
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    const preConversionPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preConversionPreview.previewProof) {
      throw new Error("Expected an eligible pre-conversion preview.");
    }

    providerSubscription = makeSubscription({
      extensionDays: "7",
      extensionOperation: RECOVERABLE_OPERATION_ID,
      extensionTargetTrialEnd: TARGET_FROM_PAUSED,
      status: "active",
      trialEnd: TARGET_FROM_PAUSED,
    });

    const result = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result).toMatchObject({
      eligibilityCode: "provider_subscription_not_extendable",
      eligible: false,
      localBillingPhase: "trial",
      localBillingStatus: "active",
      outcome: "preview",
      providerStatus: "active",
    });
    expect(result.previewProof).toBeNull();
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preConversionPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("extends a paused trial once and reconciles local billing under the lock", async () => {
    const paused = makeSubscription({ status: "paused", trialEnd: 1_700_000_000 });
    const stripe = makeStripeClient(paused);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = preview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    let providerSubscription = paused;
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    stripe.updateSubscription.mockImplementation(async (_id, params) => {
      providerSubscription = makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation:
          params.metadata.murphTrialExtensionOperation,
        extensionTargetTrialEnd: Number(
          params.metadata.murphTrialExtensionTargetTrialEnd,
        ),
        status: params.trial_end === undefined ? "paused" : "trialing",
        trialEnd: params.trial_end ?? 1_700_000_000,
      });
      return providerSubscription;
    });
    stripe.resumeSubscription.mockImplementation(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        extensionTargetTrialEnd: TARGET_FROM_PAUSED,
        status: "active",
        trialEnd: 1_700_000_000,
      });
      return providerSubscription;
    });

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(stripe.updateSubscription).toHaveBeenNthCalledWith(
      1,
      SUBSCRIPTION_ID,
      {
        metadata: {
          murphTrialExtensionDays: "7",
          murphTrialExtensionOperation: operationId,
          murphTrialExtensionTargetTrialEnd: TARGET_FROM_PAUSED.toString(),
        },
      },
      expect.objectContaining({
        idempotencyKey:
          `hosted-member-trial-extension:prepare:${operationId}`,
        maxNetworkRetries: 0,
        timeout: 80_000,
      }),
    );
    expect(providerSubscription.metadata).not.toHaveProperty(
      "murphTrialExtensionTargetTrialEnd",
    );
    expect(stripe.resumeSubscription).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      {
        billing_cycle_anchor: "unchanged",
        proration_behavior: "none",
      },
      expect.objectContaining({
        idempotencyKey:
          `hosted-member-trial-extension:resume:${operationId}`,
        maxNetworkRetries: 0,
        timeout: 80_000,
      }),
    );
    expect(stripe.updateSubscription).toHaveBeenNthCalledWith(
      2,
      SUBSCRIPTION_ID,
      {
        metadata: {
          murphTrialExtensionDays: "7",
          murphTrialExtensionOperation: operationId,
          murphTrialExtensionTargetTrialEnd: "",
        },
        proration_behavior: "none",
        trial_end: TARGET_FROM_PAUSED,
      },
      expect.objectContaining({
        idempotencyKey:
          `hosted-member-trial-extension:update:${operationId}`,
        maxNetworkRetries: 0,
        timeout: 80_000,
      }),
    );
    const prepareOrder = stripe.updateSubscription.mock.invocationCallOrder[0];
    const resumeOrder = stripe.resumeSubscription.mock.invocationCallOrder[0];
    const updateOrder = stripe.updateSubscription.mock.invocationCallOrder[1];
    if (
      prepareOrder === undefined ||
      resumeOrder === undefined ||
      updateOrder === undefined
    ) {
      throw new Error("Expected all three Stripe mutation steps.");
    }
    expect(prepareOrder).toBeLessThan(resumeOrder);
    expect(resumeOrder).toBeLessThan(updateOrder);
    expect(mocks.withHostedMemberStripeMutationLockForOps).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisitionTimeoutMs: 25_000,
        memberId: MEMBER_ID,
        transactionTimeoutMs: 190_000,
      }),
    );
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.active,
        memberId: MEMBER_ID,
      }),
    );
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000),
        memberId: MEMBER_ID,
      }),
    );
    expect(
      mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
    }));
    expect(result).toMatchObject({
      currentTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000).toISOString(),
      localBillingPhase: "trial",
      localBillingStatus: "active",
      outcome: "extended",
      providerStatus: "trialing",
    });
  });

  test("extends a live trial from its existing provider end", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.active,
      trialEndsAt: new Date(ORIGINAL_TRIAL_END * 1000),
    }));
    const live = makeSubscription({ status: "trialing" });
    const stripe = makeStripeClient(live);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(preview.targetTrialEndsAt).toBe(
      new Date(TARGET_FROM_LIVE * 1000).toISOString(),
    );
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    stripe.retrieveSubscription.mockResolvedValue(live);
    stripe.updateSubscription.mockImplementation(async (_id, params) =>
      makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation: params.metadata.murphTrialExtensionOperation,
        status: "trialing",
        trialEnd: params.trial_end,
      })
    );

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(stripe.updateSubscription).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          murphTrialExtensionTargetTrialEnd: "",
        }),
        trial_end: TARGET_FROM_LIVE,
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-member-trial-extension:update:[A-Za-z0-9_-]{43}$/u,
        ),
      }),
    );
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      currentTrialEndsAt: new Date(TARGET_FROM_LIVE * 1000).toISOString(),
      outcome: "extended",
      providerStatus: "trialing",
    });
  });

  test("never retrieves or mutates Stripe for paid billing", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember({
      billingPhase: "paid",
      billingStatus: HostedBillingStatus.active,
    }));
    const stripe = makeStripeClient(makeSubscription({ status: "active" }));

    const result = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result).toMatchObject({
      eligibilityCode: "paid_billing",
      eligible: false,
      previewProof: null,
    });
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
  });

  test("leaves scheduled, canceling, terminal, and mismatched billing unchanged", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMember({
      scheduledBillingPlanCode: "edge_monthly",
    }));
    const scheduledStripe = makeStripeClient(makeSubscription());
    const scheduled = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: scheduledStripe,
    });

    expect(scheduled.eligibilityCode).toBe("scheduled_billing_change");
    expect(scheduledStripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(scheduledStripe.updateSubscription).not.toHaveBeenCalled();

    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember());
    for (const [subscription, eligibilityCode] of [
      [
        makeSubscription({ cancelAtPeriodEnd: true }),
        "provider_subscription_canceling",
      ],
      [
        makeSubscription({ status: "canceled" }),
        "provider_subscription_not_extendable",
      ],
      [
        makeSubscription({ customerId: "cus_other" }),
        "provider_identity_mismatch",
      ],
    ] as const) {
      const stripe = makeStripeClient(subscription);
      const result = await previewHostedPulseTrialExtension({
        memberId: MEMBER_ID,
        now: NOW,
        priceId: PRICE_ID,
        prisma: {} as never,
        stripe,
      });

      expect(result.eligibilityCode).toBe(eligibilityCode);
      expect(result.previewProof).toBeNull();
      expect(stripe.updateSubscription).not.toHaveBeenCalled();
    }
  });

  test("rejects Apply when local billing changed after Preview", async () => {
    const paused = makeSubscription({ status: "paused", trialEnd: 1_700_000_000 });
    const stripe = makeStripeClient(paused);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMember({
      trialEndsAt: new Date("2026-07-13T16:00:00.000Z"),
    }));

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
  });

  test("rejects expired and tampered Preview proofs before Stripe mutation", async () => {
    const paused = makeSubscription({ status: "paused", trialEnd: 1_700_000_000 });
    const stripe = makeStripeClient(paused);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:15:00.001Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.retrieveSubscription).toHaveBeenCalledTimes(2);
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();

    const originalDigest = preview.previewProof.token.at(-1);
    const tamperedToken = `${preview.previewProof.token.slice(0, -1)}${
      originalDigest === "a" ? "b" : "a"
    }`;
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: {
        ...preview.previewProof,
        token: tamperedToken,
      },
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: {
        ...preview.previewProof,
        targetTrialEndsAt: preview.previewProof.targetTrialEndsAt.replace(
          ".000Z",
          ".999Z",
        ),
      },
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);

    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
  });

  test("reports lock contention and Stripe failures without local reconciliation", async () => {
    const live = makeSubscription({ status: "trialing" });
    const stripe = makeStripeClient(live);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }

    mocks.withHostedMemberStripeMutationLockForOps.mockRejectedValueOnce(
      new HostedMemberStripeMutationLockBusyError(),
    );
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionLockBusyError);

    mocks.withHostedMemberStripeMutationLockForOps.mockImplementation(
      async (input: { run: (tx: object) => Promise<unknown> }) => input.run({}),
    );
    stripe.retrieveSubscription.mockResolvedValue(live);
    stripe.updateSubscription.mockRejectedValueOnce({
      code: "api_connection_error",
      message: `sensitive ${MEMBER_ID} ${CUSTOMER_ID} ${SUBSCRIPTION_ID}`,
      requestId: "req_private",
      statusCode: 503,
      type: "StripeConnectionError",
    });
    const updateError = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    }).catch((error: unknown) => error);

    expect(updateError).toBeInstanceOf(HostedPulseTrialExtensionProviderError);
    expect((updateError as HostedPulseTrialExtensionProviderError).logDetails)
      .toEqual({
        code: "api_connection_error",
        operationName: "update_subscription",
        requestIdPresent: true,
        statusCode: 503,
        type: "StripeConnectionError",
      });
    expect(JSON.stringify(
      (updateError as HostedPulseTrialExtensionProviderError).logDetails,
    )).not.toMatch(/hbm_|cus_|sub_|req_|sensitive/u);

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    expect(
      mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
    ).not.toHaveBeenCalled();
  });

  test("projects a failed Stripe lookup into identifier-free diagnostics", async () => {
    const stripe = makeStripeClient(makeSubscription());
    stripe.retrieveSubscription.mockRejectedValueOnce({
      code: "resource_missing",
      message: `No such subscription: ${SUBSCRIPTION_ID}`,
      param: "subscription",
      rawType: "invalid_request_error",
      requestId: "req_private",
      statusCode: 404,
    });

    const lookupError = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    }).catch((error: unknown) => error);

    expect(lookupError).toBeInstanceOf(HostedPulseTrialExtensionProviderError);
    expect((lookupError as HostedPulseTrialExtensionProviderError).logDetails)
      .toEqual({
        code: "resource_missing",
        operationName: "retrieve_subscription",
        requestIdPresent: true,
        statusCode: 404,
        type: "invalid_request_error",
      });
    expect(JSON.stringify(
      (lookupError as HostedPulseTrialExtensionProviderError).logDetails,
    )).not.toMatch(/hbm_|cus_|sub_|req_|message|param/u);
  });

  test("rejects identifier-shaped metadata and tolerates throwing provider getters", async () => {
    const stripe = makeStripeClient(makeSubscription());
    stripe.retrieveSubscription
      .mockRejectedValueOnce({
        code: "whsec_private",
        rawType: SUBSCRIPTION_ID,
        requestId: "req_private",
        statusCode: 600,
        type: "sk_private",
      })
      .mockRejectedValueOnce(Object.defineProperties({}, {
        code: {
          get: () => {
            throw new Error(`sensitive ${MEMBER_ID}`);
          },
        },
        rawType: { get: () => "invalid_request_error" },
        requestId: {
          get: () => {
            throw new Error("sensitive request ID");
          },
        },
        statusCode: {
          get: () => {
            throw new Error("sensitive status");
          },
        },
        type: {
          get: () => {
            throw new Error("sensitive type");
          },
        },
      }));

    const identifierError = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    }).catch((error: unknown) => error);
    const getterError = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    }).catch((error: unknown) => error);

    expect(identifierError).toBeInstanceOf(HostedPulseTrialExtensionProviderError);
    expect((identifierError as HostedPulseTrialExtensionProviderError).logDetails)
      .toEqual({
        operationName: "retrieve_subscription",
        requestIdPresent: true,
      });
    expect(getterError).toBeInstanceOf(HostedPulseTrialExtensionProviderError);
    expect((getterError as HostedPulseTrialExtensionProviderError).logDetails)
      .toEqual({
        operationName: "retrieve_subscription",
        requestIdPresent: false,
        type: "invalid_request_error",
      });
    expect(JSON.stringify([
      (identifierError as HostedPulseTrialExtensionProviderError).logDetails,
      (getterError as HostedPulseTrialExtensionProviderError).logDetails,
    ])).not.toMatch(/cus_|hbm_|req_|sensitive|sk_|sub_|whsec_/u);
  });

  test("identifies post-update validation failure without local reconciliation", async () => {
    const live = makeSubscription({ status: "trialing" });
    const stripe = makeStripeClient(live);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    stripe.retrieveSubscription.mockResolvedValue(live);
    stripe.updateSubscription.mockResolvedValue(makeSubscription({
      status: "trialing",
      trialEnd: TARGET_FROM_LIVE,
    }));

    const validationError = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    }).catch((error: unknown) => error);

    expect(validationError).toBeInstanceOf(HostedPulseTrialExtensionProviderError);
    expect((validationError as HostedPulseTrialExtensionProviderError).logDetails)
      .toEqual({ operationName: "validate_updated_subscription" });
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    expect(
      mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
    ).not.toHaveBeenCalled();
  });

  test("validates prepared and resumed paused states before local reconciliation", async () => {
    const paused = makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    });
    const prepareStripe = makeStripeClient(paused);
    const preparePreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: prepareStripe,
    });
    if (!preparePreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    prepareStripe.retrieveSubscription.mockResolvedValue(paused);
    prepareStripe.updateSubscription.mockResolvedValue(paused);

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preparePreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: prepareStripe,
    })).rejects.toMatchObject({
      logDetails: { operationName: "validate_prepared_subscription" },
    });
    expect(prepareStripe.resumeSubscription).not.toHaveBeenCalled();

    const resumeStripe = makeStripeClient(paused);
    const resumePreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: resumeStripe,
    });
    if (!resumePreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = resumePreview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    const prepared = makeSubscription({
      extensionDays: "7",
      extensionOperation: operationId,
      extensionTargetTrialEnd: TARGET_FROM_PAUSED,
      status: "paused",
      trialEnd: 1_700_000_000,
    });
    resumeStripe.retrieveSubscription.mockResolvedValue(paused);
    resumeStripe.updateSubscription.mockResolvedValue(prepared);
    resumeStripe.resumeSubscription.mockResolvedValue(prepared);

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: resumePreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe: resumeStripe,
    })).rejects.toMatchObject({
      logDetails: { operationName: "validate_resumed_subscription" },
    });
    expect(resumeStripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("recovers a prepared paused trial through a fresh Preview after response loss", async () => {
    let providerSubscription = makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    });
    const stripe = makeStripeClient(providerSubscription);
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    const initialPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!initialPreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = initialPreview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    let losePrepareResponse = true;
    stripe.updateSubscription.mockImplementation(async (_id, params) => {
      providerSubscription = makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation: params.metadata.murphTrialExtensionOperation,
        extensionTargetTrialEnd: Number(
          params.metadata.murphTrialExtensionTargetTrialEnd,
        ),
        status: params.trial_end === undefined ? "paused" : "trialing",
        trialEnd: params.trial_end ?? 1_700_000_000,
      });
      if (params.trial_end === undefined && losePrepareResponse) {
        losePrepareResponse = false;
        throw new Error("response lost after prepare");
      }
      return providerSubscription;
    });
    stripe.resumeSubscription.mockImplementation(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        extensionTargetTrialEnd: TARGET_FROM_PAUSED,
        status: "active",
        trialEnd: 1_700_000_000,
      });
      return providerSubscription;
    });

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: initialPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toMatchObject({
      logDetails: expect.objectContaining({
        operationName: "prepare_subscription",
      }),
    });
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();

    const recoveryPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:03:00.000Z"),
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    expect(recoveryPreview).toMatchObject({
      eligible: true,
      message: "This unfinished Pulse Trial extension can be completed.",
      providerStatus: "paused",
      targetTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000).toISOString(),
    });
    if (!recoveryPreview.previewProof) {
      throw new Error("Expected a recovery preview proof.");
    }

    const recoveryDigestEnd = recoveryPreview.previewProof.token.at(-1);
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: {
        ...recoveryPreview.previewProof,
        token: `${recoveryPreview.previewProof.token.slice(0, -1)}${
          recoveryDigestEnd === "a" ? "b" : "a"
        }`,
      },
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: recoveryPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result.outcome).toBe("extended");
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(2);
    expect(stripe.resumeSubscription).toHaveBeenCalledTimes(1);
    expect(stripe.updateSubscription.mock.calls[1]?.[1].metadata)
      .toMatchObject({ murphTrialExtensionOperation: operationId });
  });

  test("recovers an active intermediate through a fresh Preview after resume response loss", async () => {
    let providerSubscription = makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    });
    const stripe = makeStripeClient(providerSubscription);
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    const initialPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!initialPreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = initialPreview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    stripe.updateSubscription.mockImplementation(async (_id, params) => {
      providerSubscription = makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation: params.metadata.murphTrialExtensionOperation,
        extensionTargetTrialEnd: Number(
          params.metadata.murphTrialExtensionTargetTrialEnd,
        ),
        status: params.trial_end === undefined ? "paused" : "trialing",
        trialEnd: params.trial_end ?? 1_700_000_000,
      });
      return providerSubscription;
    });
    stripe.resumeSubscription.mockImplementationOnce(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        extensionTargetTrialEnd: TARGET_FROM_PAUSED,
        status: "active",
        trialEnd: 1_700_000_000,
      });
      throw new Error("response lost after resume");
    });

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: initialPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toMatchObject({
      logDetails: expect.objectContaining({
        operationName: "resume_subscription",
      }),
    });
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();

    const recoveryPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:03:00.000Z"),
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    expect(recoveryPreview).toMatchObject({
      eligible: true,
      message: "This unfinished Pulse Trial extension can be completed.",
      providerStatus: "active",
      targetTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000).toISOString(),
    });
    if (!recoveryPreview.previewProof) {
      throw new Error("Expected a recovery preview proof.");
    }

    const finalRecoveryDigestEnd = recoveryPreview.previewProof.token.at(-1);
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: {
        ...recoveryPreview.previewProof,
        token: `${recoveryPreview.previewProof.token.slice(0, -1)}${
          finalRecoveryDigestEnd === "a" ? "b" : "a"
        }`,
      },
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: recoveryPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result.outcome).toBe("extended");
    expect(stripe.resumeSubscription).toHaveBeenCalledTimes(1);
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(2);
    expect(stripe.updateSubscription.mock.calls[1]?.[1].metadata)
      .toMatchObject({ murphTrialExtensionOperation: operationId });
  });

  test("fresh Preview reconciles the exact target after final update response loss", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMember({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.active,
      trialEndsAt: new Date(ORIGINAL_TRIAL_END * 1000),
    }));
    let providerSubscription = makeSubscription({ status: "trialing" });
    const stripe = makeStripeClient(providerSubscription);
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    const initialPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!initialPreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = initialPreview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    stripe.updateSubscription.mockImplementationOnce(async (_id, params) => {
      providerSubscription = makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation: params.metadata.murphTrialExtensionOperation,
        extensionTargetTrialEnd: Number(
          params.metadata.murphTrialExtensionTargetTrialEnd,
        ),
        status: "trialing",
        trialEnd: params.trial_end,
      });
      throw new Error("response lost after final update");
    });

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: initialPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionProviderError);

    const recoveryPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:03:00.000Z"),
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    expect(recoveryPreview).toMatchObject({
      message: "This unfinished Pulse Trial extension can be completed.",
      targetTrialEndsAt: new Date(TARGET_FROM_LIVE * 1000).toISOString(),
    });
    if (!recoveryPreview.previewProof) {
      throw new Error("Expected a recovery preview proof.");
    }

    const reconciledRecoveryDigestEnd = recoveryPreview.previewProof.token.at(-1);
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: {
        ...recoveryPreview.previewProof,
        token: `${recoveryPreview.previewProof.token.slice(0, -1)}${
          reconciledRecoveryDigestEnd === "a" ? "b" : "a"
        }`,
      },
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionPreviewStaleError);
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: recoveryPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result.outcome).toBe("reconciled");
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(stripe.resumeSubscription).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledTimes(1);
  });

  test("reconciles a completed paused extension after the local write fails", async () => {
    let providerSubscription = makeSubscription({
      status: "paused",
      trialEnd: 1_700_000_000,
    });
    const stripe = makeStripeClient(providerSubscription);
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    const initialPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!initialPreview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = initialPreview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    stripe.updateSubscription.mockImplementation(async (_id, params) => {
      providerSubscription = makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation: params.metadata.murphTrialExtensionOperation,
        extensionTargetTrialEnd: Number(
          params.metadata.murphTrialExtensionTargetTrialEnd,
        ),
        status: params.trial_end === undefined ? "paused" : "trialing",
        trialEnd: params.trial_end ?? 1_700_000_000,
      });
      return providerSubscription;
    });
    stripe.resumeSubscription.mockImplementation(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        extensionTargetTrialEnd: TARGET_FROM_PAUSED,
        status: "active",
        trialEnd: 1_700_000_000,
      });
      return providerSubscription;
    });
    mocks.writeHostedMemberStripeBillingRefTx.mockRejectedValueOnce(
      new Error("local billing write failed"),
    );

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: initialPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toThrow("local billing write failed");
    expect(providerSubscription).toMatchObject({
      status: "trialing",
      trial_end: TARGET_FROM_PAUSED,
    });
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(2);
    expect(stripe.resumeSubscription).toHaveBeenCalledTimes(1);

    const recoveryPreview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:03:00.000Z"),
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    expect(recoveryPreview).toMatchObject({
      message: "This unfinished Pulse Trial extension can be completed.",
      targetTrialEndsAt: new Date(TARGET_FROM_PAUSED * 1000).toISOString(),
    });
    if (!recoveryPreview.previewProof) {
      throw new Error("Expected a recovery preview proof.");
    }

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:04:00.000Z"),
      previewProof: recoveryPreview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result.outcome).toBe("reconciled");
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(2);
    expect(stripe.resumeSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledTimes(2);
  });

  test("reconciles an expired exact marker after an ambiguous provider success", async () => {
    const live = makeSubscription({ status: "trialing" });
    const stripe = makeStripeClient(live);
    const preview = await previewHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: NOW,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });
    if (!preview.previewProof) {
      throw new Error("Expected an eligible preview.");
    }
    const operationId = preview.previewProof.token.split(".")[2];
    if (!operationId) {
      throw new Error("Expected an operation ID.");
    }
    let providerSubscription = live;
    stripe.retrieveSubscription.mockImplementation(
      async () => providerSubscription,
    );
    stripe.updateSubscription.mockImplementationOnce(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        status: "trialing",
        trialEnd: TARGET_FROM_LIVE,
      });
      throw new Error("response lost after provider success");
    });

    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:03:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionProviderError);

    const result = await applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:16:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    });

    expect(result.outcome).toBe("reconciled");
    expect(stripe.updateSubscription).toHaveBeenCalledTimes(1);
    expect(stripe.retrieveSubscription).toHaveBeenCalledTimes(3);
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledTimes(1);
  });
});

function makeMember(input: {
  billingPhase?: string | null;
  billingStatus?: HostedBillingStatus;
  scheduledBillingPlanCode?: string;
  trialEndsAt?: Date;
} = {}): HostedMemberBillingSnapshot {
  const trialStartedAt = new Date("2026-07-01T16:00:00.000Z");
  const trialEndsAt = input.trialEndsAt ??
    new Date("2026-07-11T16:00:00.000Z");
  return {
    billingRef: {
      currentBillingPhase: input.billingPhase ?? null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: trialEndsAt,
      currentPeriodStart: trialStartedAt,
      currentTrialEndsAt: trialEndsAt,
      currentTrialStartedAt: trialStartedAt,
      memberId: MEMBER_ID,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: trialStartedAt,
      scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
    },
    core: {
      billingStatus: input.billingStatus ?? HostedBillingStatus.paused,
      createdAt: new Date("2026-06-01T16:00:00.000Z"),
      id: MEMBER_ID,
      suspendedAt: null,
      updatedAt: NOW,
    },
  };
}

function makeSubscription(input: {
  cancelAtPeriodEnd?: boolean;
  customerId?: string;
  extensionDays?: string;
  extensionOperation?: string;
  extensionTargetTrialEnd?: number;
  status?: Stripe.Subscription.Status;
  trialEnd?: number | null;
} = {}): HostedPulseTrialExtensionSubscription {
  return {
    cancel_at: null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    customer: input.customerId ?? CUSTOMER_ID,
    id: SUBSCRIPTION_ID,
    items: {
      data: [{
        id: "si_base",
        price: {
          id: PRICE_ID,
          metadata: {},
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "licensed",
          },
        },
        quantity: 1,
      }],
      has_more: false,
    },
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: MEMBER_ID,
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
      ...(input.extensionDays
        ? { murphTrialExtensionDays: input.extensionDays }
        : {}),
      ...(input.extensionOperation
        ? { murphTrialExtensionOperation: input.extensionOperation }
        : {}),
      ...(input.extensionTargetTrialEnd
        ? {
            murphTrialExtensionTargetTrialEnd:
              input.extensionTargetTrialEnd.toString(),
          }
        : {}),
    },
    status: input.status ?? "trialing",
    trial_end: input.trialEnd === undefined
      ? ORIGINAL_TRIAL_END
      : input.trialEnd,
    trial_settings: {
      end_behavior: { missing_payment_method: "pause" },
    },
    trial_start: Math.floor(
      new Date("2026-07-01T16:00:00.000Z").getTime() / 1000,
    ),
  };
}

function makeStripeClient(subscription: HostedPulseTrialExtensionSubscription) {
  return {
    retrieveSubscription: vi.fn(async () => subscription),
    resumeSubscription: vi.fn<
      (
        id: string,
        params: HostedPulseTrialExtensionStripeResumeParams,
        options: Stripe.RequestOptions,
      ) => Promise<HostedPulseTrialExtensionSubscription>
    >(async () => subscription),
    updateSubscription: vi.fn<
      (
        id: string,
        params: HostedPulseTrialExtensionStripeUpdateParams,
        options: Stripe.RequestOptions,
      ) => Promise<HostedPulseTrialExtensionSubscription>
    >(async () => subscription),
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
