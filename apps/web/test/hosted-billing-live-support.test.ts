import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  buildSanitizedBrowserEnvironmentForTest,
  HostedBillingBrowserDriver,
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

  it.each([
    ["different path", "https://app.example.test/home", "goto"],
    ["same path", "https://app.example.test/settings", "reload"],
  ] as const)("waits for a complete settings document from a %s", async (
    _label,
    currentUrl,
    expectedNavigation,
  ) => {
    const navigation = createNavigationResponse({ ok: true, status: 200 });
    const subscriptionWaitFor = vi.fn(async () => undefined);
    const page = createSettingsPageDouble({
      currentUrl,
      navigation,
      subscriptionWaitFor,
    });
    const driver = new HostedBillingBrowserDriver({
      diagnosticsPath: "/tmp/hosted-billing-browser-diagnostics.json",
      runId: "billing-navigation-proof",
      webBaseUrl: "https://app.example.test",
    });

    await driver.openSettings({
      context: {} as never,
      page: page as never,
      close: vi.fn(),
    });

    expect(page[expectedNavigation]).toHaveBeenCalledWith(
      ...(expectedNavigation === "goto"
        ? ["https://app.example.test/settings#subscription", {
            waitUntil: "domcontentloaded",
          }]
        : [{ waitUntil: "domcontentloaded" }]),
    );
    expect(subscriptionWaitFor).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", null],
    ["unsuccessful", createNavigationResponse({ ok: false, status: 503 })],
  ] as const)("rejects a %s settings response before reading billing projections", async (
    _label,
    navigation,
  ) => {
    const subscriptionWaitFor = vi.fn(async () => undefined);
    const page = createSettingsPageDouble({
      currentUrl: "https://app.example.test/home",
      navigation,
      subscriptionWaitFor,
    });
    const driver = new HostedBillingBrowserDriver({
      diagnosticsPath: "/tmp/hosted-billing-browser-diagnostics.json",
      runId: "billing-navigation-failure-proof",
      webBaseUrl: "https://app.example.test",
    });

    await expect(driver.openSettings({
      context: {} as never,
      page: page as never,
      close: vi.fn(),
    })).rejects.toThrow(/Murph settings navigation/u);
    expect(subscriptionWaitFor).not.toHaveBeenCalled();
  });

  it("waits for the enrolled Home tree to commit before opening settings", async () => {
    const enrollmentResponse = createApiResponse({
      method: "POST",
      ok: true,
      pathname: "/api/hosted-onboarding/starter/enroll",
      status: 200,
    });
    const navigation = createNavigationResponse({ ok: true, status: 200 });
    const waitForURL = vi.fn(async (
      predicate: (url: URL) => boolean,
    ) => {
      expect(predicate(new URL("https://app.example.test/home"))).toBe(true);
    });
    let releaseHomeCommit!: () => void;
    const homeCommitted = new Promise<void>((resolve) => {
      releaseHomeCommit = resolve;
    });
    const homeHeadingWaitFor = vi.fn(async () => undefined);
    const homeHeaderGetByRole = vi.fn((role: string, options: unknown) => {
      expect(role).toBe("heading");
      expect(options).toEqual({ exact: true, name: "Welcome to Murph" });
      return { waitFor: homeHeadingWaitFor };
    });
    const homeEyebrowLocator = vi.fn((selector: string) => {
      expect(selector).toBe("xpath=parent::div");
      return { getByRole: homeHeaderGetByRole };
    });
    const homeWaitFor = vi.fn(() => homeCommitted);
    const getByText = vi.fn((text: string, options: unknown) => {
      expect(text).toBe("Live Well");
      expect(options).toEqual({ exact: true });
      return { locator: homeEyebrowLocator, waitFor: homeWaitFor };
    });
    const page = {
      getByText,
      goto: vi.fn(async () => navigation),
      waitForResponse: vi.fn(async (
        predicate: (response: ReturnType<typeof createApiResponse>) => boolean,
      ) => {
        expect(predicate(enrollmentResponse)).toBe(true);
        return enrollmentResponse;
      }),
      waitForURL,
    };
    const driver = new HostedBillingBrowserDriver({
      diagnosticsPath: "/tmp/hosted-billing-browser-diagnostics.json",
      runId: "billing-enrollment-navigation-proof",
      webBaseUrl: "https://app.example.test",
    });

    let activationSettled = false;
    const activation = driver.activateStarterUsage({
      context: {} as never,
      page: page as never,
      close: vi.fn(),
    }, "starter-invite").finally(() => {
      activationSettled = true;
    });

    await vi.waitFor(() => {
      expect(homeWaitFor).toHaveBeenCalledOnce();
    });
    expect(homeHeadingWaitFor).not.toHaveBeenCalled();
    expect(activationSettled).toBe(false);
    releaseHomeCommit();
    await activation;

    expect(page.goto).toHaveBeenCalledWith(
      "https://app.example.test/join/starter-invite",
      { waitUntil: "commit" },
    );
    expect(waitForURL).toHaveBeenCalledOnce();
    expect(homeHeadingWaitFor).toHaveBeenCalledOnce();
    expect(homeWaitFor.mock.invocationCallOrder[0]).toBeGreaterThan(
      waitForURL.mock.invocationCallOrder[0] ?? 0,
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

function createNavigationResponse(input: { ok: boolean; status: number }) {
  return {
    ok: vi.fn(() => input.ok),
    status: vi.fn(() => input.status),
  };
}

function createApiResponse(input: {
  method: string;
  ok: boolean;
  pathname: string;
  status: number;
}) {
  return {
    ok: vi.fn(() => input.ok),
    request: vi.fn(() => ({ method: vi.fn(() => input.method) })),
    status: vi.fn(() => input.status),
    url: vi.fn(() => `https://app.example.test${input.pathname}`),
  };
}

function createSettingsPageDouble(input: {
  currentUrl: string;
  navigation: ReturnType<typeof createNavigationResponse> | null;
  subscriptionWaitFor: ReturnType<typeof vi.fn>;
}) {
  return {
    getByText: vi.fn(() => ({
      first: vi.fn(() => ({ waitFor: input.subscriptionWaitFor })),
    })),
    goto: vi.fn(async () => input.navigation),
    reload: vi.fn(async () => input.navigation),
    url: vi.fn(() => input.currentUrl),
  };
}
