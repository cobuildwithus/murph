import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  evaluateHostedLocalStripeCheckoutEnv,
  writeHostedLocalStripeCheckoutDiagnostics,
} from "./stripe.ts";

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
  it("treats placeholder values as missing checkout configuration", () => {
    expect(
      evaluateHostedLocalStripeCheckoutEnv({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL: "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_replace_me",
        STRIPE_SECRET_KEY: "sk_test_replace_me",
      }),
    ).toEqual({
      configuredPlanLabels: [],
      missingFlatPriceKeys: [
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL",
      ],
      missingUsagePriceKeys: [],
      secretMode: "placeholder",
    });
  });

  it("requires usage price ids only when the local usage-meter fallback is enabled", () => {
    expect(
      evaluateHostedLocalStripeCheckoutEnv({
        HOSTED_AI_USAGE_BILLING_MODE: "stripe_meter",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_monthly",
        HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY: "price_meter_replace_me",
        STRIPE_SECRET_KEY: "rk_test_checkout",
      }),
    ).toEqual({
      configuredPlanLabels: [],
      missingFlatPriceKeys: ["HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL"],
      missingUsagePriceKeys: ["HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY"],
      secretMode: "test",
    });
  });
});

describe("writeHostedLocalStripeCheckoutDiagnostics", () => {
  it("prints readiness without leaking configured Stripe values", () => {
    const stderrTarget = new CapturingWritable();

    const diagnostics = writeHostedLocalStripeCheckoutDiagnostics({
      env: {
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL: "price_annual_secretish",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_monthly_secretish",
        STRIPE_SECRET_KEY: "sk_test_secretish",
      },
      stderrTarget,
      stripeListenerWillCaptureSecret: true,
    });

    expect(diagnostics.configuredPlanLabels).toEqual(["monthly", "annual"]);
    expect(stderrTarget.text()).toContain("Stripe test checkout env ready");
    expect(stderrTarget.text()).toContain("Stripe webhook signing secret will be injected");
    expect(stderrTarget.text()).not.toContain("sk_test_secretish");
    expect(stderrTarget.text()).not.toContain("price_monthly_secretish");
    expect(stderrTarget.text()).not.toContain("price_annual_secretish");
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
