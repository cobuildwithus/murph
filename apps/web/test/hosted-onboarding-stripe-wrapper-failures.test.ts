import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelHostedFamilySponsoredCheckoutSubscription,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import {
  cancelHostedPulseTrialLoserSubscription,
  retrieveHostedPulseTrialCleanupTarget,
} from "@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup";
import {
  buildHostedUsageCreditStripeUnavailableError,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-stripe";

const STRIPE_FAILURE_CASES = [
  {
    expected: {
      httpStatus: 500,
      retryable: false,
    },
    label: "invalid request",
    stripeError: {
      code: "parameter_unknown",
      rawType: "invalid_request_error",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    },
  },
  {
    expected: {
      httpStatus: 502,
      retryable: true,
    },
    label: "connection failure",
    stripeError: {
      code: "api_connection_error",
      statusCode: 503,
      type: "StripeConnectionError",
    },
  },
] as const;

describe("hosted Stripe wrapper failure classification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(STRIPE_FAILURE_CASES)(
    "classifies Family sponsored-checkout cleanup $label",
    async ({ expected, stripeError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const cancel = vi.fn().mockRejectedValue(
        Object.assign(new Error("Stripe subscription cancel failed."), stripeError),
      );

      await expect(cancelHostedFamilySponsoredCheckoutSubscription({
        stripe: {
          subscriptions: {
            cancel,
          },
        } as never,
        subscriptionId: "sub_family_loser",
      })).rejects.toMatchObject({
        code: "HOSTED_FAMILY_SPONSORED_CHECKOUT_CLEANUP_FAILED",
        ...expected,
      });
    },
  );

  it.each(STRIPE_FAILURE_CASES)(
    "classifies Pulse trial loser lookup $label",
    async ({ expected, stripeError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const retrieve = vi.fn().mockRejectedValue(
        Object.assign(new Error("Stripe subscription lookup failed."), stripeError),
      );

      await expect(retrieveHostedPulseTrialCleanupTarget({
        memberId: "member_123",
        priceId: "price_launch",
        stripe: {
          subscriptions: {
            retrieve,
          },
        } as never,
        subscriptionId: "sub_trial_loser",
      })).rejects.toMatchObject({
        code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
        ...expected,
      });
    },
  );

  it.each(STRIPE_FAILURE_CASES)(
    "classifies Pulse trial loser cancellation $label",
    async ({ expected, stripeError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const cancel = vi.fn().mockRejectedValue(
        Object.assign(new Error("Stripe subscription cancel failed."), stripeError),
      );

      await expect(cancelHostedPulseTrialLoserSubscription({
        stripe: {
          subscriptions: {
            cancel,
          },
        } as never,
        subscriptionId: "sub_trial_loser",
      })).rejects.toMatchObject({
        code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
        ...expected,
      });
    },
  );

  it.each(STRIPE_FAILURE_CASES)(
    "classifies the shared usage-credit Stripe wrapper $label",
    ({ expected, stripeError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const error = buildHostedUsageCreditStripeUnavailableError(
        Object.assign(new Error("Stripe usage-credit call failed."), stripeError),
        "checkout.sessions.retrieve",
      );

      expect(error).toMatchObject({
        code: expected.retryable
          ? "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE"
          : "HOSTED_USAGE_CREDIT_STRIPE_REJECTED",
        ...expected,
      });
    },
  );

  it.each([
    [
      "Family sponsored-checkout cleanup",
      () => cancelHostedFamilySponsoredCheckoutSubscription({
        stripe: {
          subscriptions: {
            cancel: vi.fn().mockRejectedValue({ code: "resource_missing" }),
          },
        } as never,
        subscriptionId: "sub_family_loser",
      }),
      undefined,
    ],
    [
      "Pulse trial lookup",
      () => retrieveHostedPulseTrialCleanupTarget({
        memberId: "member_123",
        priceId: "price_launch",
        stripe: {
          subscriptions: {
            retrieve: vi.fn().mockRejectedValue({ code: "resource_missing" }),
          },
        } as never,
        subscriptionId: "sub_trial_loser",
      }),
      null,
    ],
    [
      "Pulse trial cancellation",
      () => cancelHostedPulseTrialLoserSubscription({
        stripe: {
          subscriptions: {
            cancel: vi.fn().mockRejectedValue({ code: "resource_missing" }),
          },
        } as never,
        subscriptionId: "sub_trial_loser",
      }),
      undefined,
    ],
  ])("preserves resource_missing semantics for %s", async (
    _label,
    run,
    expected,
  ) => {
    await expect(run()).resolves.toBe(expected);
  });
});
