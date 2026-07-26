import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";
import { makeSafeStripePortalConfiguration } from "./support/stripe-portal";

const mocks = vi.hoisted(() => ({
  applyStripeInvoicePaid: vi.fn(),
  applyStripeRecurringFinancialState: vi.fn(),
  applyStripeSubscriptionUpdated: vi.fn(),
  getPrisma: vi.fn(),
  signalHostedRuntimeManualWakeBestEffort: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  resolveHostedStripePortalConfigurationId: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
  stripe: {
    billingPortal: {
      configurations: {
        retrieve: vi.fn(),
      },
      sessions: {
        create: vi.fn(),
      },
    },
    invoicePayments: {
      list: vi.fn(),
    },
    invoices: {
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
      resume: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const invoiceFixtures = new Map<string, Stripe.Invoice>();
const invoicePaymentFixtures = new Map<string, Stripe.InvoicePayment[]>();

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/manual-wake", () => ({
  signalHostedRuntimeManualWakeBestEffort: mocks.signalHostedRuntimeManualWakeBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock: mocks.withHostedMemberStripeMutationLock,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
  resolveHostedStripePortalConfigurationId:
    mocks.resolveHostedStripePortalConfigurationId,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeRecurringFinancialState:
    mocks.applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

import {
  continueHostedPulseTrialPaidPlan,
  startHostedPulseTrialPaidPlan,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";

describe("startHostedPulseTrialPaidPlan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invoiceFixtures.clear();
    invoicePaymentFixtures.clear();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
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
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef());
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (tx: unknown) => Promise<unknown> }) =>
        input.run(mocks.prismaClient),
    );
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValue(undefined);
    mocks.applyStripeRecurringFinancialState.mockResolvedValue({
      blockActiveProjection: false,
      state: "healthy",
    });
    mocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse_recurring",
      stripe: mocks.stripe,
    });
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/session_123",
    });
    mocks.stripe.billingPortal.configurations.retrieve.mockImplementation(
      async (configurationId: string) =>
        makeSafeStripePortalConfiguration({
          configurationId,
          kind: "payment_recovery",
        }),
    );
    mocks.stripe.invoicePayments.list.mockImplementation(
      async (params: Stripe.InvoicePaymentListParams) => ({
        data: invoicePaymentFixtures.get(params.invoice ?? "") ?? [],
        has_more: false,
        object: "list",
        url: `/v1/invoice_payments?invoice=${params.invoice ?? ""}`,
      }),
    );
    mocks.stripe.invoices.retrieve.mockImplementation(
      async (invoiceId: string) => {
        const invoice = invoiceFixtures.get(invoiceId);
        if (!invoice) {
          throw new Error(`Missing invoice fixture ${invoiceId}`);
        }
        return invoice;
      },
    );
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.subscriptions.resume.mockResolvedValue(makeSubscription({
      latestInvoice: makeInvoice({
        status: "draft",
      }),
      status: "active",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.update.mockImplementation(
      async (_subscriptionId: string, params: Stripe.SubscriptionUpdateParams) =>
        params.trial_end === "now"
          ? makeSubscription({
            defaultPaymentMethod:
              typeof params.default_payment_method === "string"
                ? params.default_payment_method
                : null,
            defaultSource:
              typeof params.default_source === "string"
                ? params.default_source
                : null,
            latestInvoice: makeInvoice({ status: "draft" }),
            status: "active",
            trialEnd: null,
          })
          : makeSubscription({
            defaultPaymentMethod:
              typeof params.default_payment_method === "string"
                ? params.default_payment_method
                : null,
            defaultSource:
              typeof params.default_source === "string"
                ? params.default_source
                : null,
            latestInvoice: null,
            status: "paused",
            trialEnd: null,
          }),
    );
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
      expand: ["customer", "items.data.price", "latest_invoice"],
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_123",
        expand: ["items.data.price", "latest_invoice"],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
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

  test("does not project paid access when canonical financial reconciliation blocks it", async () => {
    const paidInvoice = makeInvoice({
      id: "in_paid_but_reversed",
      status: "paid",
    });
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      latestInvoice: paidInvoice,
      status: "active",
      trialEnd: null,
    }));
    mocks.applyStripeRecurringFinancialState.mockResolvedValueOnce({
      blockActiveProjection: true,
      state: "blocked",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_FINANCIAL_STATE_BLOCKED",
      httpStatus: 409,
    });

    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("does not treat an old paid invoice as the active trial-end attempt", async () => {
    const oldPaidInvoice = makeInvoice({
      id: "in_old_paid_trial",
      status: "paid",
    });
    const trialingSubscription = makeSubscription({
      latestInvoice: oldPaidInvoice,
    });
    const newInvoice = makeInvoice({
      id: "in_new_trial_end",
      status: "draft",
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(trialingSubscription)
      .mockResolvedValueOnce(trialingSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      latestInvoice: newInvoice,
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

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalledWith(
      oldPaidInvoice,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("keeps an ambiguous unchanged trial with an old paid invoice unconfirmed", async () => {
    const oldPaidInvoice = makeInvoice({
      id: "in_old_paid_ambiguous",
      status: "paid",
    });
    const trialingSubscription = makeSubscription({
      latestInvoice: oldPaidInvoice,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(trialingSubscription);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_ambiguous_old_invoice",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      retryable: true,
    });

    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("revalidates Stripe ownership under the member lock before mutating", async () => {
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        stripeSubscriptionId: "sub_replaced",
      }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STATE_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  test("preserves an intentional subscription payment-method override", async () => {
    const subscriptionOverride = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_default",
        defaultSource: null,
      }),
      defaultPaymentMethod: "pm_subscription_override",
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(subscriptionOverride)
      .mockResolvedValueOnce(subscriptionOverride);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        default_payment_method: "pm_subscription_override",
      }),
      expect.any(Object),
    );
  });

  test("uses the customer payment method only after exact Portal recovery confirmation", async () => {
    const refreshedTenderSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_current",
        defaultSource: null,
      }),
      defaultPaymentMethod: "pm_subscription_old",
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(refreshedTenderSubscription)
      .mockResolvedValueOnce(refreshedTenderSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      paymentMethodRecoveryConfirmed: true,
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        default_payment_method: "pm_customer_current",
      }),
      expect.any(Object),
    );
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
      expand: ["customer", "items.data.price", "latest_invoice"],
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
  });

  test("collects a default payment method and returns the chat continuation to its exact action", async () => {
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValueOnce(
      "bpc_payment_recovery",
    );
    const noCardSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(noCardSubscription)
      .mockResolvedValueOnce(noCardSubscription);

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
      configuration: "bpc_payment_recovery",
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
    expect(mocks.resolveHostedStripePortalConfigurationId).toHaveBeenCalledWith(
      "payment_recovery",
    );
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
      code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.requireHostedStripeBillingPlanConfig).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).not.toHaveBeenCalled();
  });

  test("resumes when the local Pulse trial is active but Stripe has just paused it", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "trial",
    }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(continueHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
  });

  test("routes no-card trials through Stripe payment-method setup before ending the trial", async () => {
    const noCardSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(noCardSubscription)
      .mockResolvedValueOnce(noCardSubscription);

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

  test("returns conversational no-card starts through the signed exact-action bridge", async () => {
    const noCardSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(noCardSubscription)
      .mockResolvedValueOnce(noCardSubscription);

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
    const noCardSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(noCardSubscription)
      .mockResolvedValueOnce(noCardSubscription);
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

  test("fails retryably when Stripe portal creation omits the session URL", async () => {
    const noCardSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(noCardSubscription)
      .mockResolvedValueOnce(noCardSubscription);
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

  test("returns an explicit retryable error when an ambiguous update has no exact provider outcome", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    const firstKey = mocks.stripe.subscriptions.update.mock.calls[0]?.[2]?.idempotencyKey;
    expect(firstKey).toMatch(
      /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
    );
    expect(mocks.stripe.subscriptions.update.mock.calls[0]?.[1]).toEqual({
      default_payment_method: "pm_123",
      expand: ["items.data.price", "latest_invoice"],
      metadata: { murphTrialExtensionTargetTrialEnd: "" },
      payment_behavior: "allow_incomplete",
      trial_end: "now",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("reconciles when the member-lock transaction fails after Stripe succeeds", async () => {
    const updatedSubscription = makeSubscription({
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(paidSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(paidSubscription);
    mocks.applyStripeInvoicePaid
      .mockRejectedValueOnce(new Error("Synthetic local invoice reconciliation failure."))
      .mockResolvedValueOnce(undefined);
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
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
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_PROVIDER_REJECTED",
      details: {
        operationName: "subscription.update.trial-end-now",
        requestIdPresent: true,
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("rejects terminal reconciliation state after an ambiguous Stripe update failure", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("treats timeout-shaped Stripe update failures without an HTTP status as unconfirmed", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("keeps an ambiguous legacy-trial failure retryable without claiming collection is pending", async () => {
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
      .mockResolvedValueOnce(preMutationTrial)
      .mockResolvedValueOnce(preMutationTrial)
      .mockResolvedValueOnce(preMutationTrial);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_123",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update.mock.calls[0]?.[1]).toEqual({
      default_payment_method: "pm_123",
      expand: ["items.data.price", "latest_invoice"],
      items: [{
        deleted: true,
        id: "si_price_pulse_usage",
      }],
      metadata: { murphTrialExtensionTargetTrialEnd: "" },
      payment_behavior: "allow_incomplete",
      trial_end: "now",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("does not send a second update when reconciliation retrieval finds a conversion invoice", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(reconciledSubscription);
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
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
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
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
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
        currentBillingPhase: null,
      }))
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription)
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      canonicalInvoice,
      expect.objectContaining({
        sourceEventId: "stripe.invoice.paid:in_123",
        sourceType: "stripe.invoice.paid",
      }),
      mocks.prismaClient,
      HostedBillingStatus.active,
      canonicalSubscription,
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
        currentBillingPhase: null,
      }))
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
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
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(paidSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(paidSubscription);
    mocks.applyStripeInvoicePaid
      .mockRejectedValueOnce(new Error("Synthetic local invoice reconciliation failure."))
      .mockResolvedValueOnce(undefined);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledTimes(2);
  });

  test("holds paused cleanup and resume mutations behind one shared member lock", async () => {
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
    const pausedLegacySubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
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
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedLegacySubscription)
      .mockResolvedValueOnce(pausedLegacySubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: null,
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);
    mocks.withHostedMemberStripeMutationLock.mockImplementationOnce(
      async (input: { run: () => Promise<unknown> }) => {
        signalFirstLock?.();
        await firstLockRelease;
        return input.run();
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
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_customer_123",
        expand: ["items.data.price", "latest_invoice"],
        items: [{
          deleted: true,
          id: "si_price_pulse_usage",
        }],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
        proration_behavior: "none",
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
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
      defaultPaymentMethod: null,
      metadata: {
        murphTrialExtensionDays: "7",
        murphTrialExtensionOperation: "a".repeat(43),
        murphTrialExtensionTargetTrialEnd: "1779024000",
      },
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(preparedPausedSubscription)
      .mockResolvedValueOnce(preparedPausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: null,
      metadata: {
        murphTrialExtensionDays: "7",
        murphTrialExtensionOperation: "a".repeat(43),
      },
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

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
        default_payment_method: "pm_customer_123",
        expand: ["items.data.price", "latest_invoice"],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("reuses the same cleanup and resume keys while canonical provider state is unchanged", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef({
      currentBillingPhase: null,
    }));
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: makeInvoice({ status: "paid" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(pausedSubscription);
    mocks.stripe.subscriptions.update.mockResolvedValue(makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      status: "paused",
      trialEnd: null,
    }));
    mocks.stripe.subscriptions.resume.mockResolvedValue(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      retryable: true,
    });
    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      retryable: true,
    });

    const firstCleanupKey =
      mocks.stripe.subscriptions.update.mock.calls[0]?.[2]?.idempotencyKey;
    const secondCleanupKey =
      mocks.stripe.subscriptions.update.mock.calls[1]?.[2]?.idempotencyKey;
    expect(firstCleanupKey).toMatch(
      /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
    );
    expect(secondCleanupKey).toBe(firstCleanupKey);
    expect(mocks.stripe.subscriptions.resume.mock.calls[0]?.[2]?.idempotencyKey)
      .toBe(mocks.stripe.subscriptions.resume.mock.calls[1]?.[2]?.idempotencyKey);
  });

  test("canonical-reconciles an ambiguous paused cleanup before resuming once", async () => {
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
    const pausedLegacySubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
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
      status: "paused",
      trialEnd: null,
    });
    const cleanedPausedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: null,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: makeInvoice({ status: "draft" }),
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedLegacySubscription)
      .mockResolvedValueOnce(pausedLegacySubscription)
      .mockResolvedValueOnce(cleanedPausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_paused_cleanup",
      statusCode: 500,
      type: "StripeAPIError",
    });
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
  });

  test("does not resume or claim pending when ambiguous paused cleanup changed nothing", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef({
      currentBillingPhase: null,
    }));
    const pausedLegacySubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
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
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      pausedLegacySubscription,
    );
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_paused_cleanup",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).not.toHaveBeenCalled();
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
    const pausedLegacySubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
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
      status: "paused",
      trialEnd: null,
    });
    const cleanedPausedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedLegacySubscription)
      .mockResolvedValueOnce(pausedLegacySubscription);
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(cleanedPausedSubscription);
    mocks.stripe.subscriptions.resume.mockRejectedValueOnce({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_PROVIDER_REJECTED",
      details: {
        operationName: "subscription.resume.paused-trial",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
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
    mocks.stripe.subscriptions.resume.mockRejectedValueOnce({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_PROVIDER_REJECTED",
      details: {
        operationName: "subscription.resume.paused-trial",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("lets Stripe collect the exact resumption invoice automatically", async () => {
    const invoice = makeInvoice({
      id: "in_resume_draft",
      status: "draft",
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);
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
      status: "billing_pending",
    });

    expect(mocks.stripe.invoices.retrieve).toHaveBeenCalledWith(
      "in_resume_draft",
    );
  });

  test("projects an invoice-free Resume without paying or granting from the old invoice", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.paused,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef({
      currentBillingPhase: null,
    }));
    const oldInvoice = makeInvoice({
      id: "in_old_void_invoice_free",
      status: "void",
    });
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      latestInvoice: oldInvoice,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: oldInvoice,
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_RESUMED_WITHOUT_INVOICE",
      httpStatus: 409,
    });

    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub_123",
        latest_invoice: oldInvoice,
        status: "active",
      }),
      expect.objectContaining({
        sourceType:
          "stripe.customer.subscription.updated.inline-invoice-free-resume",
      }),
      mocks.prismaClient,
    );
    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          kind: "member",
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
        subscription: expect.objectContaining({
          id: "sub_123",
          status: "active",
        }),
        tx: mocks.prismaClient,
      }),
    );
  });

  test("fails explicitly when Stripe already left trialing without exact invoice proof", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_MISSING",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  test("classifies an active subscription with a voided attempt as expired", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({ status: "void" }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ATTEMPT_EXPIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("does not leave an exact processing invoice pending past its deadline", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        created: 1_777_000_000,
        status: "draft",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_TIMED_OUT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
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

  test("fails explicitly when ambiguous reconciliation is active without an invoice", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_INVOICE_MISSING",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("keeps an unchanged ambiguous trial retryable without claiming collection is pending", async () => {
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
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
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_OUTCOME_UNCONFIRMED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  test("resumes a paused no-card Pulse trial after payment method setup", async () => {
    const invoice = makeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.test/in_resume",
      paymentIntentStatus: "requires_action",
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: invoice,
      status: "past_due",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_resume",
      status: "payment_required",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        default_payment_method: "pm_customer_123",
        expand: ["items.data.price", "latest_invoice"],
        metadata: { murphTrialExtensionTargetTrialEnd: "" },
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledWith(
      "sub_123",
      {
        billing_cycle_anchor: "now",
        expand: ["items.data.price", "latest_invoice"],
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(
      mocks.stripe.subscriptions.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.subscriptions.resume.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("attaches a legacy Stripe Source before resuming", async () => {
    const invoice = makeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.test/in_legacy_resume",
      id: "in_legacy_resume",
      paymentIntentStatus: "requires_action",
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: "card_customer_123",
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: null,
      defaultSource: "card_customer_123",
      latestInvoice: invoice,
      status: "past_due",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_legacy_resume",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        default_source: "card_customer_123",
      }),
      expect.any(Object),
    );
    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledWith(
      "sub_123",
      {
        billing_cycle_anchor: "now",
        expand: ["items.data.price", "latest_invoice"],
      },
      expect.any(Object),
    );
  });

  test("does not let a voided prior resume invoice trap a fresh scoped resume", async () => {
    const oldInvoice = makeInvoice({
      id: "in_old_void",
      status: "void",
    });
    const freshInvoice = makeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.test/in_fresh_resume",
      id: "in_fresh_resume",
      paymentIntentStatus: "requires_action",
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      latestInvoice: oldInvoice,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: freshInvoice,
      status: "past_due",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_fresh_resume",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.invoices.retrieve).toHaveBeenCalledWith(
      "in_fresh_resume",
    );
  });

  test("ignores a paid zero-dollar trial invoice and classifies only the new resume invoice", async () => {
    const initialTrialInvoice = makeInvoice({
      id: "in_initial_trial_paid",
      status: "paid",
    });
    const resumeInvoice = makeInvoice({
      hostedInvoiceUrl: "https://invoice.stripe.test/in_new_resume",
      id: "in_new_resume",
      paymentIntentStatus: "requires_action",
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      latestInvoice: initialTrialInvoice,
      status: "paused",
      trialEnd: null,
    });
    const resumedSubscription = makeSubscription({
      defaultPaymentMethod: "pm_customer_123",
      latestInvoice: resumeInvoice,
      status: "past_due",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(resumedSubscription);
    mocks.stripe.subscriptions.resume.mockResolvedValueOnce(resumedSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_new_resume",
      status: "payment_required",
    });

    expect(mocks.stripe.invoices.retrieve).toHaveBeenCalledWith(
      "in_new_resume",
    );
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalledWith(
      initialTrialInvoice,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);

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

  test("returns paused no-card conversational continuations through the signed exact-action bridge", async () => {
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
    const pausedSubscription = makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
      status: "paused",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(pausedSubscription)
      .mockResolvedValueOnce(pausedSubscription);

    await expect(continueHostedPulseTrialPaidPlan({
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
                /^https:\/\/join\.example\.test\/api\/settings\/billing\/pulse-trial-continuation\?action=continue_pulse&expires=[0-9]+&signature=[A-Za-z0-9_-]{43}$/u,
              ),
            },
            type: "redirect",
          },
        }),
      }),
    );
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
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("does not replay an old paid invoice after the local trial phase has ended", async () => {
    const paidInvoice = makeInvoice({ status: "paid" });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "paid",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: paidInvoice,
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
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

  test("drops legacy metered usage items when ending the trial", async () => {
    const legacyTrialSubscription = makeSubscription({
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
      .mockResolvedValueOnce(legacyTrialSubscription)
      .mockResolvedValueOnce(legacyTrialSubscription);

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        items: [
          {
            deleted: true,
            id: "si_price_pulse_usage",
          },
        ],
      }),
      expect.any(Object),
    );
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
  stripeSubscriptionId?: string;
} = {}) {
  return {
    currentBillingPhase: input.currentBillingPhase === undefined ? "trial" : input.currentBillingPhase,
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentTrialEndsAt: new Date("2026-05-13T00:00:00.000Z"),
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: input.stripeSubscriptionId ?? "sub_123",
  };
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
  } as Stripe.Subscription;
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
  } as Stripe.Customer;
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
      metadata: input.priceId === "price_pulse_usage"
        ? {
            [HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY]:
              HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
          }
        : {},
      object: "price",
      recurring: {
        interval: "month",
        usage_type: input.usageType,
      },
    },
    quantity: input.quantity,
  } as Stripe.SubscriptionItem;
}

function makeInvoice(input: {
  created?: number;
  customer?: string;
  hostedInvoiceUrl?: string | null;
  id?: string;
  paymentIntentStatus?: Stripe.PaymentIntent.Status | null;
  status: Stripe.Invoice.Status;
}): Stripe.Invoice {
  const invoiceId = input.id ?? "in_123";
  const invoice: Partial<Stripe.Invoice> = {
    amount_remaining: input.status === "open" ? 800 : 0,
    attempted: input.status === "open",
    billing_reason: "subscription_cycle",
    created: input.created ?? 1_778_000_000,
    customer: input.customer ?? "cus_123",
    hosted_invoice_url: input.hostedInvoiceUrl === undefined
      ? "https://invoice.stripe.test/in_123"
      : input.hostedInvoiceUrl,
    id: invoiceId,
    object: "invoice",
    parent: {
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: "sub_123",
      },
      type: "subscription_details",
    },
    status: input.status,
    status_transitions: {
      finalized_at: input.status === "draft" ? null : 1_800_000_000,
      marked_uncollectible_at: input.status === "uncollectible"
        ? 1_800_000_100
        : null,
      paid_at: input.status === "paid" ? 1_800_000_100 : null,
      voided_at: input.status === "void" ? 1_800_000_100 : null,
    },
  };
  const stripeInvoice = invoice as Stripe.Invoice;
  invoiceFixtures.set(invoiceId, stripeInvoice);
  invoicePaymentFixtures.set(
    invoiceId,
    input.paymentIntentStatus
      ? [
          {
            id: `inpay_${invoiceId}`,
            invoice: invoiceId,
            is_default: true,
            object: "invoice_payment",
            payment: {
              payment_intent: {
                id: `pi_${invoiceId}`,
                object: "payment_intent",
                status: input.paymentIntentStatus,
              } as Stripe.PaymentIntent,
              type: "payment_intent",
            },
            status: input.paymentIntentStatus === "succeeded" ? "paid" : "open",
          } as Stripe.InvoicePayment,
        ]
      : [],
  );
  return stripeInvoice;
}
