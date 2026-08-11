import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  evaluateHostedLocalStripeCheckoutEnv,
  HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS,
  writeHostedLocalStripeCheckoutDiagnostics,
} from "../../src/dev-hosted-local/stripe.ts";

class CapturingWritable extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("evaluateHostedLocalStripeCheckoutEnv", () => {
  it("keeps every direct plan and fixed usage-credit Price under local Stripe authority", () => {
    expect(HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS).toEqual(expect.arrayContaining([
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD",
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD",
    ]));
  });

  it("treats placeholder values as missing checkout configuration", () => {
    expect(
      evaluateHostedLocalStripeCheckoutEnv({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY:
          "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY:
          "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY: "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_replace_me",
        STRIPE_SECRET_KEY: "sk_test_replace_me",
      }),
    ).toEqual({
      configuredPlanLabels: [],
      missingFlatPriceKeys: [
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
      ],
      secretMode: "placeholder",
    });
  });
});

describe("writeHostedLocalStripeCheckoutDiagnostics", () => {
  it("prints readiness without leaking configured Stripe values", () => {
    const stderrTarget = new CapturingWritable();

    const diagnostics = writeHostedLocalStripeCheckoutDiagnostics({
      env: {
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_edge_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY:
          "price_family_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY:
          "price_family_edge_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY:
          "price_family_max_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY: "price_max_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_monthly_secretish",
        STRIPE_SECRET_KEY: "sk_test_secretish",
      },
      stderrTarget,
      stripeListenerWillCaptureSecret: true,
    });

    expect(diagnostics.configuredPlanLabels).toEqual([
      "monthly",
      "edge",
      "max",
      "family-pulse",
      "family-edge",
      "family-max",
    ]);
    expect(stderrTarget.text()).toContain("Stripe test checkout env ready");
    expect(stderrTarget.text()).toContain("Stripe webhook signing secret will be injected");
    expect(stderrTarget.text()).not.toContain("sk_test_secretish");
    expect(stderrTarget.text()).not.toContain("price_monthly_secretish");
    expect(stderrTarget.text()).not.toContain("price_edge_secretish");
    expect(stderrTarget.text()).not.toContain("price_max_secretish");
    expect(stderrTarget.text()).not.toContain("price_family_secretish");
    expect(stderrTarget.text()).not.toContain("price_family_edge_secretish");
    expect(stderrTarget.text()).not.toContain("price_family_max_secretish");
  });

  it("blocks live Stripe keys by default", () => {
    expect(() =>
      writeHostedLocalStripeCheckoutDiagnostics({
        env: {
          STRIPE_SECRET_KEY: "sk_live_not_allowed_locally",
        },
        stderrTarget: new CapturingWritable(),
        stripeListenerWillCaptureSecret: true,
      })
    ).toThrow("refuses to start with a live Stripe secret key");
  });
});
