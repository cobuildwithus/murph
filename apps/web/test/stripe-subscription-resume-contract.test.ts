import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  requireStripeContractTestSecretKey,
  verifyStripeSubscriptionResumeContract,
} from "@/scripts/verify-stripe-subscription-resume-contract";

type ResumeMethod = (
  ...args: Parameters<Stripe["subscriptions"]["resume"]>
) => Promise<unknown>;

describe("Stripe subscription resume contract probe", () => {
  it("accepts only dedicated test-mode secret keys", () => {
    expect(requireStripeContractTestSecretKey("sk_test_example")).toBe(
      "sk_test_example",
    );
    expect(() => requireStripeContractTestSecretKey(undefined)).toThrow(
      /is required/u,
    );
    expect(() => requireStripeContractTestSecretKey("sk_live_example")).toThrow(
      /test-mode secret key/u,
    );
    expect(() => requireStripeContractTestSecretKey("rk_test_example")).toThrow(
      /test-mode secret key/u,
    );
  });

  it("passes only when Stripe accepts the params and reaches resource lookup", async () => {
    const resume = vi.fn<ResumeMethod>().mockRejectedValue({
      code: "resource_missing",
      param: "id",
      type: "invalid_request_error",
    });

    await expect(
      verifyStripeSubscriptionResumeContract({ resume }),
    ).resolves.toBeUndefined();
    expect(resume).toHaveBeenCalledWith(
      "sub_murph_contract_probe_missing",
      {
        billing_cycle_anchor: "now",
        expand: [
          "items.data.price",
          "latest_invoice",
          "latest_invoice.payment_intent",
        ],
      } satisfies Stripe.SubscriptionResumeParams,
    );
  });

  it("fails on Stripe parameter drift", async () => {
    const resume = vi.fn<ResumeMethod>().mockRejectedValue({
      code: "parameter_unknown",
      param: "default_payment_method",
      type: "invalid_request_error",
    });

    await expect(
      verifyStripeSubscriptionResumeContract({ resume }),
    ).rejects.toThrow(
      "code=parameter_unknown, type=invalid_request_error, param=default_payment_method",
    );
  });

  it("fails if the synthetic subscription unexpectedly resolves", async () => {
    const resume = vi.fn<ResumeMethod>().mockResolvedValue({});
    await expect(
      verifyStripeSubscriptionResumeContract({ resume }),
    ).rejects.toThrow(/unexpectedly found/u);
  });
});
