import { createHash } from "node:crypto";

import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

type StripeBillingPortalSessionCreateMock = (
  ...args: Parameters<Stripe["billingPortal"]["sessions"]["create"]>
) => Promise<unknown>;
type StripeSubscriptionRetrieveMock = (
  ...args: Parameters<Stripe["subscriptions"]["retrieve"]>
) => Promise<unknown>;
type StripeSubscriptionResumeMock = (
  ...args: Parameters<Stripe["subscriptions"]["resume"]>
) => Promise<unknown>;
type StripeSubscriptionUpdateMock = (
  ...args: Parameters<Stripe["subscriptions"]["update"]>
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  assertHostedBillingPlanSelectable: vi.fn(),
  applyStripeInvoicePaid: vi.fn(),
  cleanupHostedFamilySponsoredDirectSubscription: vi.fn(),
  getPrisma: vi.fn(),
  prepareHostedCryptoDomainRootCandidates: vi.fn(),
  preparedCryptoDomainRoots: new Map(),
  signalHostedRuntimeManualWakeBestEffort: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  requireValidatedHostedStripeBillingPlanConfig: vi.fn(),
  scheduleHostedBillingPlanSwitch: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
  stripe: {
    billingPortal: {
      sessions: {
        create: vi.fn<StripeBillingPortalSessionCreateMock>(),
      },
    },
    subscriptions: {
      retrieve: vi.fn<StripeSubscriptionRetrieveMock>(),
      resume: vi.fn<StripeSubscriptionResumeMock>(),
      update: vi.fn<StripeSubscriptionUpdateMock>(),
    },
  },
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedCryptoDomainRootCandidates:
    mocks.prepareHostedCryptoDomainRootCandidates,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/manual-wake", () => ({
  signalHostedRuntimeManualWakeBestEffort: mocks.signalHostedRuntimeManualWakeBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
  updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");
  return {
    ...actual,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock: mocks.withHostedMemberStripeMutationLock,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-eligibility", () => ({
  assertHostedBillingPlanSelectable:
    mocks.assertHostedBillingPlanSelectable,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitch: mocks.scheduleHostedBillingPlanSwitch,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig:
    mocks.requireValidatedHostedStripeBillingPlanConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  cleanupHostedFamilySponsoredDirectSubscription:
    mocks.cleanupHostedFamilySponsoredDirectSubscription,
}));

import {
  continueHostedPulseTrialPaidPlan,
  startHostedPulseTrialPaidPlan,
  startHostedTrialPaidPlan,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";
import {
  createResendFetch,
  makeStripeProviderError,
  readResendRequest,
  stubAlertEnvironment,
} from "./support/hosted-stripe-alert-fixture";

describe("startHostedPulseTrialPaidPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedBillingPlanSelectable.mockResolvedValue(undefined);
    mocks.applyStripeInvoicePaid.mockResolvedValue({});
    mocks.cleanupHostedFamilySponsoredDirectSubscription.mockResolvedValue(undefined);
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValue(
      mocks.preparedCryptoDomainRoots,
    );
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef());
    mocks.scheduleHostedBillingPlanSwitch.mockResolvedValue({
      effectiveAt: "2026-05-10T00:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (tx: unknown) => Promise<unknown> }) =>
        input.run(mocks.prismaClient),
    );
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeBillingPlanConfig.mockImplementation(
      (input: { billingPlanCode: string }) => ({
        billingPlanCode: input.billingPlanCode,
        priceId:
          input.billingPlanCode === "launch_group_monthly"
            ? "price_group_recurring"
            : "price_pulse_recurring",
        stripe: mocks.stripe,
        stripeLiveMode: true,
      }),
    );
    mocks.requireValidatedHostedStripeBillingPlanConfig.mockImplementation(
      mocks.requireHostedStripeBillingPlanConfig,
    );
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/session_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.subscriptions.resume.mockResolvedValue(makeSubscription({
      latestInvoice: makeInvoice({
        status: "draft",
      }),
      status: "active",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.update.mockImplementation(
      async (_subscriptionId: string, params?: Stripe.SubscriptionUpdateParams) => {
        const selectedPriceId = readUpdatedSubscriptionPriceId(params);
        const items = selectedPriceId
          ? [makeSubscriptionItem({
              priceId: selectedPriceId,
              quantity: 1,
              usageType: "licensed",
            })]
          : undefined;

        return params?.trial_end === "now"
          ? makeSubscription({
            items,
            latestInvoice: makeInvoice({ status: "draft" }),
            status: "active",
            trialEnd: null,
          })
          : makeSubscription({
            defaultPaymentMethod: params?.default_source
              ? null
              : params?.default_payment_method,
            defaultSource: params?.default_source,
            items,
            latestInvoice: null,
            status: "paused",
            trialEnd: null,
          });
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("ends an active Pulse trial with allow_incomplete and returns billing_pending while Stripe is settling", async () => {
    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123", {
      expand: ["customer", "items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      },
      {
        idempotencyKey: buildExpectedStartPaidPulseIdempotencyKey(
          "active-trial-end-now-v2",
        ),
      },
    );
    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      run: expect.any(Function),
    });
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("starts eligible Group billing now by replacing the Pulse trial item", async () => {
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_group_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    })).resolves.toEqual({
      billingPlanCode: "launch_group_monthly",
      status: "billing_pending",
    });

    expect(mocks.assertHostedBillingPlanSelectable).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      targetPlanCode: "launch_group_monthly",
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: [
          "items.data.price",
          "latest_invoice",
          "latest_invoice.payment_intent",
        ],
        items: [{
          id: "si_price_pulse_recurring",
          price: "price_group_recurring",
          quantity: 1,
        }],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      },
      {
        idempotencyKey: buildExpectedStartPaidPulseIdempotencyKey(
          "active-trial-end-now-v2",
          "price_group_recurring",
        ),
      },
    );
  });

  test("schedules card-backed Group continuation at the active trial end", async () => {
    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "settings",
      targetPlanCode: "launch_group_monthly",
      timing: "at_trial_end",
    })).resolves.toEqual({
      effectiveAt: "2026-05-10T00:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });

    expect(mocks.scheduleHostedBillingPlanSwitch).toHaveBeenCalledWith({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      prisma: undefined,
      requiredSourceBillingPhase: "trial",
      targetPlanCode: "launch_group_monthly",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("sends cardless Group continuation to payment setup without scheduling", async () => {
    mocks.scheduleHostedBillingPlanSwitch.mockResolvedValueOnce({
      billingPlanCode: "launch_group_monthly",
      status: "payment_method_required",
    });

    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "conversation",
      targetPlanCode: "launch_group_monthly",
      timing: "at_trial_end",
    })).resolves.toEqual({
      billingPlanCode: "launch_group_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      flow_data: {
        after_completion: {
          redirect: {
            return_url:
              "https://join.example.test/settings?startGroup=payment_method_saved#subscription",
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: "https://join.example.test/settings#subscription",
    });
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("alerts when cardless Group payment setup fails at Stripe", async () => {
    stubAlertEnvironment();
    const fetchMock = createResendFetch();
    vi.stubGlobal("fetch", fetchMock);
    mocks.scheduleHostedBillingPlanSwitch.mockResolvedValueOnce({
      billingPlanCode: "launch_group_monthly",
      status: "payment_method_required",
    });
    mocks.stripe.billingPortal.sessions.create.mockRejectedValueOnce(
      makeStripeProviderError(),
    );

    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "conversation",
      targetPlanCode: "launch_group_monthly",
      timing: "at_trial_end",
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      httpStatus: 502,
    });

    expect(mocks.after).toHaveBeenCalledTimes(1);
    const alertTask = mocks.after.mock.calls[0]?.[0];
    expect(alertTask).toBeTypeOf("function");
    await alertTask?.();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readResendRequest(fetchMock, 0).body).toContain(
      "operation: billing.start-paid-trial",
    );
  });

  test("rechecks Group eligibility inside the billing lock before Stripe mutation", async () => {
    mocks.assertHostedBillingPlanSelectable.mockRejectedValueOnce(
      Object.assign(new Error("Group plan unavailable."), {
        code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
      }),
    );

    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects a new Pulse trial action while another plan change is scheduled", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      scheduledBillingPlanCode: "launch_group_monthly",
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_CHANGE_ALREADY_SCHEDULED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("keeps a card-backed active Pulse trial running until its natural end", async () => {
    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "continuing",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123", {
      expand: ["customer", "items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
  });

  test("collects a default payment method and returns the chat continuation to its exact action", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "conversation",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      flow_data: {
        after_completion: {
          redirect: {
            return_url: expect.stringMatching(
              /^https:\/\/join\.example\.test\/api\/settings\/billing\/pulse-trial-continuation\?action=continue_pulse&expires=[0-9]+&signature=[A-Za-z0-9_-]{43}$/u,
            ),
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: "https://join.example.test/settings#subscription",
    });
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("rejects continuation after the local Pulse trial has ended without contacting Stripe", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START",
      httpStatus: 409,
    });

    expect(mocks.requireHostedStripeBillingPlanConfig).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
  });

  test("returns the reconciled paid plan without contacting Stripe", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "paid",
    }));

    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.requireHostedStripeBillingPlanConfig).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
  });

  test("requires a fresh start-now choice when Stripe has just paused the local trial", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "trial",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));

    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("routes no-card trials through Stripe payment-method setup before ending the trial", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "settings",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      resumeStartAfterPaymentMethodSetup: true,
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      flow_data: {
        after_completion: {
          redirect: {
            return_url: "https://join.example.test/settings?startPulse=complete#subscription",
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: "https://join.example.test/settings#subscription",
    });
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("returns no-card Group setup to Settings without auto-starting Pulse", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "settings",
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    })).resolves.toEqual({
      billingPlanCode: "launch_group_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      flow_data: {
        after_completion: {
          redirect: {
            return_url:
              "https://join.example.test/settings?startGroup=payment_method_saved#subscription",
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: "https://join.example.test/settings#subscription",
    });
  });

  test("returns conversational no-card starts through the signed exact-action bridge", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "conversation",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        flow_data: expect.objectContaining({
          after_completion: {
            redirect: {
              return_url: expect.stringMatching(
                /^https:\/\/join\.example\.test\/api\/settings\/billing\/pulse-trial-continuation\?action=start_pulse_now&expires=[0-9]+&signature=[A-Za-z0-9_-]{43}$/u,
              ),
            },
            type: "redirect",
          },
        }),
      }),
    );
  });

  test("wraps Stripe portal creation failures without ending the trial", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));
    mocks.stripe.billingPortal.sessions.create.mockRejectedValueOnce({
      requestId: "req_portal_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName: "billingPortal.sessions.create.payment-method-update",
        requestIdPresent: true,
        statusCode: 500,
        type: "StripeAPIError",
      },
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("delivers request-id-free start-paid failures with stable replay identity", async () => {
    stubAlertEnvironment();
    const fetchMock = createResendFetch();
    vi.stubGlobal("fetch", fetchMock);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));
    mocks.stripe.billingPortal.sessions.create.mockRejectedValue(
      makeStripeProviderError(),
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(startHostedPulseTrialPaidPlan({
        memberId: "member_123",
        now: new Date("2026-05-06T00:00:00.000Z"),
      })).rejects.toMatchObject({
        code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
        httpStatus: 502,
      });
    }

    expect(mocks.after).toHaveBeenCalledTimes(2);
    for (const [task] of mocks.after.mock.calls) {
      await task();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = readResendRequest(fetchMock, 0);
    const secondRequest = readResendRequest(fetchMock, 1);
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(secondRequest.body).toBe(firstRequest.body);
    expect(firstRequest.body).toContain("operation: billing.start-paid-trial");
    expect(firstRequest.body).not.toContain("member_123");
  });

  test("fails retryably when Stripe portal creation omits the session URL", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));
    mocks.stripe.billingPortal.sessions.create.mockResolvedValueOnce({
      url: null,
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_METHOD_URL_MISSING",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("reconciles an ambiguous Stripe failure without a second trial-ending update", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription());
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    const firstKey = mocks.stripe.subscriptions.update.mock.calls[0]?.[2]?.idempotencyKey;
    expect(firstKey).toBe(buildExpectedStartPaidPulseIdempotencyKey(
      "active-trial-end-now-v2",
    ));
    expect(mocks.stripe.subscriptions.update.mock.calls[0]?.[1]).toEqual({
      expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
      metadata: { murphTrialExtensionTargetTrialEnd: "" },
      payment_behavior: "allow_incomplete",
      trial_end: "now",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  test("reconciles when the member-lock transaction fails after Stripe succeeds", async () => {
    const updatedSubscription = makeSubscription({
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(updatedSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(updatedSubscription);
    mocks.withHostedMemberStripeMutationLock.mockImplementationOnce(
      async (input: { run: () => Promise<unknown> }) => {
        await input.run();
        throw new Error("Synthetic transaction completion failure.");
      },
    );

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("canonical-reconciles when local invoice reconciliation fails after Stripe succeeds", async () => {
    const paidSubscription = makeSubscription({
      latestInvoice: makeInvoice({ status: "paid" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(paidSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(paidSubscription);
    mocks.applyStripeInvoicePaid
      .mockRejectedValueOnce(new Error("Synthetic local invoice reconciliation failure."))
      .mockResolvedValueOnce({});
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(2);
  });

  test("surfaces deterministic Stripe update failures instead of returning billing_pending", async () => {
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_bad_request",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName: "subscription.update.trial-end-now",
        requestIdPresent: true,
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("rejects terminal reconciliation state after an ambiguous Stripe update failure", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        status: "canceled",
        trialEnd: null,
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("treats timeout-shaped Stripe update failures without an HTTP status as ambiguous", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription());
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      code: "ETIMEDOUT",
      requestId: "req_timeout",
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("rejects a retired metered companion before trial conversion", async () => {
    const preMutationTrial = makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_pulse_usage",
          quantity: null,
          usageType: "metered",
        }),
      ],
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(preMutationTrial);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("does not send a second update when reconciliation retrieval finds a conversion invoice", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        latestInvoice: makeInvoice({
          hostedInvoiceUrl: "https://invoice.stripe.test/in_retry",
          paymentIntentStatus: "requires_action",
          status: "open",
        }),
        status: "active",
        trialEnd: null,
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_retry",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("reconciles a paid invoice after an ambiguous Stripe failure without retrying the update", async () => {
    const invoice = makeInvoice({
      status: "paid",
    });
    const reconciledSubscription = makeSubscription({
      latestInvoice: invoice,
      status: "active",
      trialEnd: null,
    });
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(reconciledSubscription);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });
    mocks.applyStripeInvoicePaid.mockResolvedValueOnce({
      cleanupFamilySponsoredStripeSubscriptionId: "sub_123",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({
        sourceEventId: "stripe.invoice.paid:in_123",
        sourceType: "stripe.invoice.paid",
      }),
      mocks.prismaClient,
      HostedBillingStatus.active,
      reconciledSubscription,
      mocks.preparedCryptoDomainRoots,
    );
    expect(mocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledWith({
      prisma: mocks.prismaClient,
      userId: "member_123",
    });
    expect(
      mocks.prepareHostedCryptoDomainRootCandidates.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.prismaClient.$transaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(
      mocks.cleanupHostedFamilySponsoredDirectSubscription,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      sourceEventId:
        "stripe.invoice.paid:in_123:family-sponsored-cleanup",
      subscriptionId: "sub_123",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("rejects paid invoice recovery when a successful trial-ending update returns unsupported items", async () => {
    const unsupportedSubscription = makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_addon",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({
        status: "paid",
      }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(unsupportedSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(unsupportedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("rejects unsupported item shapes during ambiguous-failure invoice reconciliation", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        items: [
          makeSubscriptionItem({
            priceId: "price_pulse_recurring",
            quantity: 1,
            usageType: "licensed",
          }),
          makeSubscriptionItem({
            priceId: "price_unknown_addon",
            quantity: 1,
            usageType: "licensed",
          }),
        ],
        latestInvoice: makeInvoice({
          status: "paid",
        }),
        status: "active",
        trialEnd: null,
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("canonical-reconciles when a successful paused resume returns unsupported items", async () => {
    const canonicalInvoice = makeInvoice({
      status: "paid",
    });
    const canonicalSubscription = makeSubscription({
      latestInvoice: canonicalInvoice,
      status: "active",
      trialEnd: null,
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: null,
      }))
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription({
        customer: makeCustomer({
          defaultPaymentMethod: "pm_customer_123",
          defaultSource: null,
        }),
        defaultPaymentMethod: null,
        defaultSource: null,
        status: "paused",
        trialEnd: null,
      }))
      .mockResolvedValueOnce(canonicalSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_addon",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({
        status: "paid",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      canonicalInvoice,
      expect.objectContaining({
        sourceEventId: "stripe.invoice.paid:in_123",
        sourceType: "stripe.invoice.paid",
      }),
      mocks.prismaClient,
      HostedBillingStatus.active,
      canonicalSubscription,
      mocks.preparedCryptoDomainRoots,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("canonical-reconciles when local invoice reconciliation fails after paused resume", async () => {
    const paidSubscription = makeSubscription({
      latestInvoice: makeInvoice({ status: "paid" }),
      status: "active",
      trialEnd: null,
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: null,
      }))
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription({
        customer: makeCustomer({
          defaultPaymentMethod: "pm_customer_123",
          defaultSource: null,
        }),
        status: "paused",
        trialEnd: null,
      }))
      .mockResolvedValueOnce(paidSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(paidSubscription);
    mocks.applyStripeInvoicePaid
      .mockRejectedValueOnce(new Error("Synthetic local invoice reconciliation failure."))
      .mockResolvedValueOnce({});

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(2);
  });

  test("commits the paused-resume fence before Stripe and leaves active to invoice reconciliation", async () => {
    let releaseFirstLock: (() => void) | undefined;
    let signalFirstLock: (() => void) | undefined;
    const firstLockEntered = new Promise<void>((resolve) => {
      signalFirstLock = resolve;
    });
    const firstLockRelease = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      latestInvoice: null,
      status: "paused",
      trialEnd: null,
    }));
    mocks.withHostedMemberStripeMutationLock.mockImplementationOnce(
      async (input: { run: (tx: unknown) => Promise<unknown> }) => {
        signalFirstLock?.();
        await firstLockRelease;
        return input.run(mocks.prismaClient);
      },
    );

    const startPromise = startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    });
    await firstLockEntered;

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();

    releaseFirstLock?.();
    await expect(startPromise).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_123",
        expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
        items: [{
          id: "si_price_pulse_recurring",
          price: "price_pulse_recurring",
          quantity: 1,
        }],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
      },
      {
        idempotencyKey: buildExpectedPausedCleanupIdempotencyKey(),
      },
    );
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      mocks.updateHostedMemberCoreState.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("blocks a stale paused resume after Family sponsorship wins the member lock", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    }));
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "family_group_123",
      kind: "active_sponsorship",
      ownerMemberId: "family_owner_123",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("checks Family ownership before opening payment setup for a cardless paused trial", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "family_group_123",
      kind: "active_sponsorship",
      ownerMemberId: "family_owner_123",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "settings",
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("clears a prepared extension target before resuming paused paid billing", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    const preparedPausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      metadata: {
        murphTrialExtensionDays: "7",
        murphTrialExtensionOperation: "a".repeat(43),
        murphTrialExtensionTargetTrialEnd: "1779024000",
      },
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      preparedPausedSubscription,
    );
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      latestInvoice: null,
      metadata: {
        murphTrialExtensionDays: "7",
        murphTrialExtensionOperation: "a".repeat(43),
      },
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_123",
        expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
        items: [{
          id: "si_price_pulse_recurring",
          price: "price_pulse_recurring",
          quantity: 1,
        }],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
      },
      {
        idempotencyKey: buildExpectedPausedCleanupIdempotencyKey(),
      },
    );
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("retries a committed resume fence with the same paused-plan claim", async () => {
    mocks.readHostedMemberCoreState
      .mockResolvedValueOnce({
        billingStatus: HostedBillingStatus.paused,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: null,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        billingStatus: HostedBillingStatus.incomplete,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: null,
        updatedAt: new Date("2026-05-01T00:00:01.000Z"),
      });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    }));

    await startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    });
    await startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    });

    const firstCleanupKey =
      mocks.stripe.subscriptions.update.mock.calls[0]?.[2]?.idempotencyKey;
    const secondCleanupKey =
      mocks.stripe.subscriptions.update.mock.calls[1]?.[2]?.idempotencyKey;
    expect(firstCleanupKey).toBe(buildExpectedPausedCleanupIdempotencyKey());
    expect(secondCleanupKey).toBe(firstCleanupKey);
    expect(mocks.stripe.subscriptions.update.mock.calls[1]?.[1])
      .toEqual(mocks.stripe.subscriptions.update.mock.calls[0]?.[1]);
    expect(mocks.stripe.subscriptions.resume.mock.calls[0]?.[2]?.idempotencyKey)
      .toBe(mocks.stripe.subscriptions.resume.mock.calls[1]?.[2]?.idempotencyKey);
  });

  test("rejects a conflicting paused-plan choice before another resume", async () => {
    mocks.readHostedMemberCoreState
      .mockResolvedValueOnce({
        billingStatus: HostedBillingStatus.paused,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: null,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        billingStatus: HostedBillingStatus.incomplete,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: null,
        updatedAt: new Date("2026-05-01T00:00:01.000Z"),
      });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef({
      currentBillingPhase: null,
    }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(pausedSubscription);
    mocks.stripe.subscriptions.update
      .mockResolvedValueOnce(pausedSubscription)
      .mockRejectedValueOnce({
        statusCode: 400,
        type: "StripeIdempotencyError",
      });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({ status: "billing_pending" });
    await expect(startHostedTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update.mock.calls[0]?.[2]?.idempotencyKey)
      .toBe(mocks.stripe.subscriptions.update.mock.calls[1]?.[2]?.idempotencyKey);
    expect(mocks.stripe.subscriptions.update.mock.calls[0]?.[1]).toMatchObject({
      items: [{ price: "price_pulse_recurring" }],
    });
    expect(mocks.stripe.subscriptions.update.mock.calls[1]?.[1]).toMatchObject({
      items: [{ price: "price_group_recurring" }],
      proration_behavior: "none",
    });
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
  });

  test("canonical-reconciles an ambiguous paused metadata cleanup without resuming", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_paused_cleanup",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledOnce();
    expect(mocks.updateHostedMemberCoreState).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
  });

  test("surfaces a deterministic resume failure after paused cleanup succeeds", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    });
    const cleanedPausedSubscription = makeSubscription({
      latestInvoice: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(cleanedPausedSubscription);
    mocks.stripe.subscriptions.resume.mockRejectedValueOnce({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName: "subscription.resume.paused-trial",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("surfaces deterministic resume failures after ordinary paused cleanup", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockRejectedValueOnce({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName: "subscription.resume.paused-trial",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("keeps a follow-up status check pending when Stripe already left trialing without invoice proof", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("rejects canceled subscriptions before exposing an old hosted invoice URL", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_canceled",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "canceled",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("returns billing_pending when reconciliation retrieval is no longer trialing", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        status: "active",
        trialEnd: null,
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("returns billing_pending when reconciliation retrieval still has no invoice proof", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        trialEnd: 1_777_996_799,
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("resumes a paused no-card Pulse trial after payment method setup", async () => {
    const invoice = makeInvoice({
      attempted: false,
      hostedInvoiceUrl: "https://invoice.stripe.test/in_resume",
      paymentIntentStatus: null,
      status: "open",
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(makeSubscription({
      latestInvoice: invoice,
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_resume",
      status: "payment_required",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.updateHostedMemberCoreState).toHaveBeenLastCalledWith({
      billingStatus: HostedBillingStatus.incomplete,
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_customer_123",
        expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
        items: [{
          id: "si_price_pulse_recurring",
          price: "price_pulse_recurring",
          quantity: 1,
        }],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
      },
      {
        idempotencyKey: buildExpectedPausedCleanupIdempotencyKey(),
      },
    );
    const expectedResumeParams: Stripe.SubscriptionResumeParams = {
      billing_cycle_anchor: "now",
      expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
    };
    const expectedResumeRequestOptions: Stripe.RequestOptions = {
      idempotencyKey: buildExpectedStartPaidPulseIdempotencyKey(
        "paused-resume-v2",
      ),
    };
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledWith(
      "sub_123",
      expectedResumeParams,
      expectedResumeRequestOptions,
    );
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test.each([
    {
      customer: "cus_123",
      label: "Subscription",
      sourceId: "src_subscription_123",
      subscriptionSource: "src_subscription_123",
    },
    {
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: "src_customer_123",
      }),
      label: "Customer",
      sourceId: "src_customer_123",
      subscriptionSource: null,
    },
  ])("preserves a legacy Source inherited from the $label before resume", async (input) => {
    const invoice = makeInvoice({
      attempted: false,
      hostedInvoiceUrl: "https://invoice.stripe.test/in_legacy_source",
      paymentIntentStatus: null,
      status: "open",
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: input.customer,
      defaultPaymentMethod: null,
      defaultSource: input.subscriptionSource,
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(makeSubscription({
      latestInvoice: invoice,
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_legacy_source",
      status: "payment_required",
    });

    const updateParams = mocks.stripe.subscriptions.update.mock.calls[0]?.[1];
    expect(updateParams).toMatchObject({ default_source: input.sourceId });
    expect(updateParams).not.toHaveProperty("default_payment_method");
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
  });

  test("does not resume when Stripe omits the requested subscription payment method", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_STATE_UNSUPPORTED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("routes paused no-card Pulse trials through payment-method setup before resume", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "settings",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      resumeStartAfterPaymentMethodSetup: true,
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      return_url: "https://join.example.test/settings#subscription",
    }));
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("does not reopen payment setup for a paused continue-at-trial-end choice", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "trial",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    }));

    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodContinuation: "conversation",
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("does not resume paused subscriptions when local billing state is already paid", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "paid",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      status: "paused",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("uses the expanded customer default payment method before requiring payment setup", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      }),
      expect.any(Object),
    );
  });

  test("rejects manual invoice collection before starting paid billing", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      collectionMethod: "send_invoice",
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_METHOD_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test.each([
    "keep_as_draft",
    "mark_uncollectible",
    "void",
  ] as const)("rejects paused collection with %s before starting paid billing", async (behavior) => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      pauseCollection: {
        behavior,
        resumes_at: null,
      },
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_PAUSED",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("returns payment_required for a retry after failed payment without requiring active access", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_123",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("rejects payment recovery when the latest invoice customer mismatches", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        customer: "cus_other",
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects payment recovery before returning invoice URLs for unsupported item shapes", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_addon",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects paid invoice recovery for active trial conversions with unsupported item shapes", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_addon",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({
        status: "paid",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("reconciles a paid trial-conversion invoice with the webhook source type before returning started", async () => {
    const invoice = makeInvoice({
      status: "paid",
    });
    const subscription = makeSubscription({
      latestInvoice: invoice,
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(subscription);
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({
        sourceEventId: "stripe.invoice.paid:in_123",
        sourceType: "stripe.invoice.paid",
      }),
      mocks.prismaClient,
      HostedBillingStatus.active,
      subscription,
      mocks.preparedCryptoDomainRoots,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("rejects payment-required invoices without a hosted payment URL", async () => {
    const paymentRequiredSubscription = makeSubscription({
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: null,
        paymentIntentStatus: "requires_payment_method",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(paymentRequiredSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(paymentRequiredSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_URL_MISSING",
      httpStatus: 409,
    });
  });

  test("rejects retired metered usage items before ending the trial", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_pulse_usage",
          quantity: null,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects metered usage items with unsupported quantities", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_pulse_usage",
          quantity: 1,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects unmarked no-quantity metered items", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_usage",
          quantity: null,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("accepts a single recurring Pulse item", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalled();
  });
});

function makeBillingRef(input: {
  currentBillingPhase?: string | null;
  scheduledBillingPlanCode?: string | null;
} = {}) {
  return {
    currentBillingPhase: input.currentBillingPhase === undefined ? "trial" : input.currentBillingPhase,
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentTrialEndsAt: new Date("2026-05-13T00:00:00.000Z"),
    memberId: "member_123",
    scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  };
}

function buildExpectedStartPaidPulseIdempotencyKey(
  operation?: "active-trial-end-now-v2" | "paused-resume-v2",
  priceId = "price_pulse_recurring",
): string {
  const payload = {
    memberId: "member_123",
    priceId,
    stripeSubscriptionId: "sub_123",
    trialEnd: "2026-05-13T00:00:00.000Z",
  };
  const keyPayload = operation ? { ...payload, operation } : payload;

  return `hosted-billing-start-paid-pulse:${
    createHash("sha256").update(JSON.stringify(keyPayload)).digest("hex")
  }`;
}

function buildExpectedPausedCleanupIdempotencyKey(): string {
  const payload = {
    memberId: "member_123",
    operation: "paused-pre-resume-v3",
    stripeSubscriptionId: "sub_123",
    trialEnd: "2026-05-13T00:00:00.000Z",
  };

  return `hosted-billing-start-paid-pulse:paused-cleanup:${
    createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  }`;
}

function readUpdatedSubscriptionPriceId(
  params?: Stripe.SubscriptionUpdateParams,
): string | null {
  const price = params?.items?.[0]?.price;
  return typeof price === "string" ? price : null;
}

function makeSubscription(input: {
  collectionMethod?: Stripe.Subscription["collection_method"];
  customer?: Stripe.Subscription["customer"];
  defaultPaymentMethod?: string | null;
  defaultSource?: string | null;
  items?: Stripe.SubscriptionItem[];
  latestInvoice?: Stripe.Invoice | null;
  metadata?: Record<string, string>;
  pauseCollection?: Stripe.Subscription["pause_collection"];
  status?: Stripe.Subscription.Status;
  trialEnd?: number | null;
} = {}): Stripe.Subscription {
  return {
    cancel_at_period_end: false,
    collection_method: input.collectionMethod ?? "charge_automatically",
    customer: input.customer ?? "cus_123",
    default_payment_method: input.defaultPaymentMethod === undefined
      ? "pm_123"
      : input.defaultPaymentMethod,
    default_source: input.defaultSource ?? null,
    id: "sub_123",
    items: {
      data: input.items ?? [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
    },
    latest_invoice: input.latestInvoice ?? null,
    metadata: input.metadata ?? {},
    object: "subscription",
    pause_collection: input.pauseCollection ?? null,
    pending_update: null,
    schedule: null,
    status: input.status ?? "trialing",
    trial_end: input.trialEnd === undefined ? 1_778_428_800 : input.trialEnd,
  } as unknown as Stripe.Subscription;
}

function makeCustomer(input: {
  defaultPaymentMethod?: string | null;
  defaultSource?: string | null;
} = {}): Stripe.Customer {
  return {
    default_source: input.defaultSource ?? null,
    id: "cus_123",
    invoice_settings: {
      default_payment_method: input.defaultPaymentMethod === undefined
        ? "pm_123"
        : input.defaultPaymentMethod,
    },
    object: "customer",
  } as unknown as Stripe.Customer;
}

function makeSubscriptionItem(input: {
  priceId: string;
  quantity: number | null;
  usageType: Stripe.Price.Recurring.UsageType;
}): Stripe.SubscriptionItem {
  return {
    id: `si_${input.priceId}`,
    object: "subscription_item",
    price: {
      id: input.priceId,
      metadata: {},
      object: "price",
      recurring: {
        interval: "month",
        usage_type: input.usageType,
      },
    },
    quantity: input.quantity,
  } as unknown as Stripe.SubscriptionItem;
}

function makeInvoice(input: {
  attempted?: boolean;
  customer?: string;
  hostedInvoiceUrl?: string | null;
  paymentIntentStatus?: Stripe.PaymentIntent.Status | null;
  status: Stripe.Invoice.Status;
}): Stripe.Invoice {
  return {
    amount_remaining: input.status === "open" ? 800 : 0,
    attempted: input.attempted ?? input.status === "open",
    billing_reason: "subscription_cycle",
    customer: input.customer ?? "cus_123",
    hosted_invoice_url: input.hostedInvoiceUrl === undefined
      ? "https://invoice.stripe.test/in_123"
      : input.hostedInvoiceUrl,
    id: "in_123",
    object: "invoice",
    payment_intent: input.paymentIntentStatus
      ? {
          id: "pi_123",
          object: "payment_intent",
          status: input.paymentIntentStatus,
        }
      : null,
    status: input.status,
    subscription: "sub_123",
  } as unknown as Stripe.Invoice;
}
