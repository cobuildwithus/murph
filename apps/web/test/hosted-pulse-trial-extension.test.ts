import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedMemberBillingSnapshot: vi.fn(),
  reconcileHostedAiUsageAllowancePeriodForMemberTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  withHostedMemberStripeMutationLockForOps: vi.fn(),
  writeHostedMemberStripeBillingRefTx: vi.fn(),
}));

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
const CONTACT_PRIVACY_KEY = Buffer.alloc(32, 7).toString("base64");
const originalContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
const originalContactPrivacyVersion =
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

describe("single-member Pulse Trial extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${CONTACT_PRIVACY_KEY}`;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
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
    stripe.retrieveSubscription.mockResolvedValue(paused);
    stripe.updateSubscription.mockImplementation(async (_id, params) =>
      makeSubscription({
        extensionDays: params.metadata.murphTrialExtensionDays,
        extensionOperation:
          params.metadata.murphTrialExtensionOperation,
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
        proration_behavior: "none",
        trial_end: TARGET_FROM_PAUSED,
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-member-trial-extension:[A-Za-z0-9_-]{43}$/u,
        ),
        maxNetworkRetries: 0,
        timeout: 80_000,
      }),
    );
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
      expect.objectContaining({ trial_end: TARGET_FROM_LIVE }),
      expect.any(Object),
    );
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
    stripe.retrieveSubscription.mockResolvedValue(paused);
    stripe.updateSubscription.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(applyHostedPulseTrialExtension({
      memberId: MEMBER_ID,
      now: new Date("2026-07-14T16:02:00.000Z"),
      previewProof: preview.previewProof,
      priceId: PRICE_ID,
      prisma: {} as never,
      stripe,
    })).rejects.toBeInstanceOf(HostedPulseTrialExtensionProviderError);

    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    expect(
      mocks.reconcileHostedAiUsageAllowancePeriodForMemberTx,
    ).not.toHaveBeenCalled();
  });

  test("reconciles an expired exact marker after an ambiguous provider success", async () => {
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
    stripe.updateSubscription.mockImplementationOnce(async () => {
      providerSubscription = makeSubscription({
        extensionDays: "7",
        extensionOperation: operationId,
        status: "trialing",
        trialEnd: TARGET_FROM_PAUSED,
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
    updateSubscription: vi.fn<
      (
        id: string,
        params: {
          metadata: Record<string, string>;
          proration_behavior: "none";
          trial_end: number;
        },
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
