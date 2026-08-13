import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildSanitizedBrowserEnvironmentForTest,
  readStripeSurfaceForTest,
  redactHostedBillingBrowserErrorForTest,
} from "./support/hosted-billing-browser-driver";
import { seedHostedBillingMemberForTest } from "./support/hosted-billing-live-testkit";
import {
  buildHostedStripeRunCorrelationToken,
  buildStripeFixtureChildEnvironmentForTest,
  HOSTED_STRIPE_BILLING_RUN_METADATA_KEY,
  metadataCorrelatesHostedStripeRun,
  sanitizeHostedStripeBillingLiveFailure,
} from "./support/hosted-stripe-billing-live";

describe("hosted billing live browser support", () => {
  it("passes only browser process allowlisted environment values", () => {
    expect(buildSanitizedBrowserEnvironmentForTest({
      HOME: "/tmp/opaque-home",
      MURPH_HOSTED_STRIPE_BILLING_SECRET_KEY: "not-forwarded",
      NODE_ENV: "test",
      PATH: "/bin",
      USER: "local-user",
      STRIPE_API_KEY: "not-forwarded",
      STRIPE_SECRET_KEY: "not-forwarded",
    })).toEqual({
      HOME: "/tmp/opaque-home",
      NODE_ENV: "test",
      PATH: "/bin",
    });
  });

  it("recognizes only the Stripe-hosted surfaces used by the matrix", () => {
    expect(readStripeSurfaceForTest(new URL("https://checkout.stripe.com/c/pay/test")))
      .toBe("checkout");
    expect(readStripeSurfaceForTest(new URL("https://billing.stripe.com/p/session/test")))
      .toBe("portal");
    expect(readStripeSurfaceForTest(new URL("https://example.invalid/settings")))
      .toBeNull();
  });

  it("redacts provider navigation and payment values from browser failures", () => {
    const redacted = redactHostedBillingBrowserErrorForTest(
      'goto https://checkout.stripe.com/c/pay/cs_test_secret from /Users/local-user/project with 4242 4242 4242 4242 for opaque@example.invalid and "123"',
    );
    expect(redacted).not.toContain("checkout.stripe.com");
    expect(redacted).not.toContain("cs_test_secret");
    expect(redacted).not.toContain("opaque@example.invalid");
    expect(redacted).not.toContain("local-user");
    expect(redacted).not.toContain("4242");
    expect(redacted).toContain("[redacted-url]");
  });

  it("passes only the fixture contract and allowlisted process values to Stripe CLI", () => {
    expect(buildStripeFixtureChildEnvironmentForTest({
      expectedAmount: 800,
      runId: "billing_pr_123_run_456",
      scenario: "starter-pulse-checkout",
      secretKey: "sk_test_fixture",
      sessionId: "cs_test_fixture",
      sourceEnv: {
        HOME: "/tmp/opaque-home",
        MURPH_HOSTED_STRIPE_BILLING_SECRET_KEY: "not-forwarded",
        NODE_ENV: "test",
        PATH: "/bin",
        STRIPE_SECRET_KEY: "not-forwarded",
      },
    })).toEqual({
      HOME: "/tmp/opaque-home",
      MURPH_HOSTED_STRIPE_FIXTURE_EXPECTED_AMOUNT: "800",
      MURPH_HOSTED_STRIPE_FIXTURE_RUN_ID: "billing_pr_123_run_456",
      MURPH_HOSTED_STRIPE_FIXTURE_SCENARIO: "starter-pulse-checkout",
      MURPH_HOSTED_STRIPE_FIXTURE_SESSION_ID: "cs_test_fixture",
      NODE_ENV: "test",
      PATH: "/bin",
      STRIPE_API_KEY: "sk_test_fixture",
    });
  });

  it("never submits protected Stripe UI and completes the exact Session via the official fixture", async () => {
    const [driverSource, fixtureSource] = await Promise.all([
      readFile(new URL("./support/hosted-billing-browser-driver.ts", import.meta.url), "utf8"),
      readFile(new URL("./fixtures/stripe/complete-checkout-session.json", import.meta.url), "utf8"),
    ]);
    expect(driverSource).not.toContain("completeStripeCheckout");
    expect(driverSource).not.toContain("fillStripeHostedPaymentForm");
    expect(driverSource).not.toContain("STRIPE_TEST_CARD_NUMBER");
    expect(fixtureSource).toContain(
      "/v1/payment_pages/${.env:MURPH_HOSTED_STRIPE_FIXTURE_SESSION_ID}/confirm",
    );
    expect(fixtureSource).toContain(
      "${.env:MURPH_HOSTED_STRIPE_FIXTURE_EXPECTED_AMOUNT}",
    );
    expect(fixtureSource).toContain(
      "${.env:MURPH_HOSTED_STRIPE_FIXTURE_RUN_ID}",
    );
  });

  it("settles browser navigations before reading billing projections", async () => {
    const driverSource = await readFile(
      new URL("./support/hosted-billing-browser-driver.ts", import.meta.url),
      "utf8",
    );

    expect(driverSource).toContain(
      'await actor.page.waitForLoadState("domcontentloaded");',
    );
    expect(driverSource).toContain(
      'navigation = await actor.page.reload({ waitUntil: "domcontentloaded" });',
    );
    expect(driverSource).toContain(
      'assertSuccessfulNavigation(navigation, "Murph settings");',
    );
  });

  it("finds interrupted Checkout metadata through the opaque run correlation", () => {
    const runId = "billing_pr_123_run_456";
    const token = buildHostedStripeRunCorrelationToken(runId);
    expect(metadataCorrelatesHostedStripeRun({
      memberId: `member_hsb_${token}_checkout`,
    }, runId)).toBe(true);
    expect(metadataCorrelatesHostedStripeRun({
      [HOSTED_STRIPE_BILLING_RUN_METADATA_KEY]: runId,
    }, runId)).toBe(true);
    expect(metadataCorrelatesHostedStripeRun({ memberId: "unrelated" }, runId))
      .toBe(false);
  });

  it("formats provider failures without echoing provider messages", () => {
    const secret = "sk_test_never_echo";
    const error = Object.assign(new Error(`provider returned ${secret}`), {
      code: "parameter_unknown",
      param: "default_payment_method",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });
    const sanitized = sanitizeHostedStripeBillingLiveFailure(error, "cleanup");
    expect(sanitized.message).not.toContain(secret);
    expect(sanitized.message).toContain("code=parameter_unknown");
    expect(sanitized.message).toContain("status=400");
  });

  it("rejects an invalid member seed before loading database owners", async () => {
    await expect(seedHostedBillingMemberForTest({
      billingStatus: "not_started",
      memberId: " ",
    })).rejects.toThrow(/requires a member id/u);
  });
});
