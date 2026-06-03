import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  evaluateHostedLocalStripeCheckoutEnv,
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
  it("treats placeholder values as missing checkout configuration", () => {
    expect(
      evaluateHostedLocalStripeCheckoutEnv({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_replace_me",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_replace_me",
        STRIPE_SECRET_KEY: "sk_test_replace_me",
      }),
    ).toEqual({
      configuredPlanLabels: [],
      missingFlatPriceKeys: [
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
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
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_monthly_secretish",
        STRIPE_SECRET_KEY: "sk_test_secretish",
      },
      stderrTarget,
      stripeListenerWillCaptureSecret: true,
    });

    expect(diagnostics.configuredPlanLabels).toEqual(["monthly", "edge"]);
    expect(stderrTarget.text()).toContain("Stripe test checkout env ready");
    expect(stderrTarget.text()).toContain("Stripe webhook signing secret will be injected");
    expect(stderrTarget.text()).not.toContain("sk_test_secretish");
    expect(stderrTarget.text()).not.toContain("price_monthly_secretish");
    expect(stderrTarget.text()).not.toContain("price_edge_secretish");
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
