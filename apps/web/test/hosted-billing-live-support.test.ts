import { readFile } from "node:fs/promises";

import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  buildSanitizedBrowserEnvironmentForTest,
  HostedBillingBrowserDriver,
  readStripeSurfaceForTest,
  redactHostedBillingBrowserErrorForTest,
} from "./support/hosted-billing-browser-driver";
import {
  provisionHostedBillingActivationProofForTest,
  seedHostedBillingMemberForTest,
} from "./support/hosted-billing-live-testkit";
import {
  buildHostedStripeRunCorrelationToken,
  buildStripeFixtureChildEnvironmentForTest,
  HOSTED_STRIPE_BILLING_RUN_METADATA_KEY,
  HostedStripeBillingSandbox,
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
      previouslyActivated: false,
    })).rejects.toThrow(/requires a member id/u);
  });

  it("leaves a never-activated Starter seed without activation-proof roots", async () => {
    const provision = vi.fn();
    await provisionHostedBillingActivationProofForTest({
      memberId: "member_starter_seed",
      previouslyActivated: false,
      provision,
      tx: { kind: "fixture-transaction" },
    });

    expect(provision).not.toHaveBeenCalled();
  });

  it("adds activation-proof roots when the seed has prior activation", async () => {
    const provision = vi.fn();
    const tx = { kind: "fixture-transaction" };
    await provisionHostedBillingActivationProofForTest({
      memberId: "member_paid_seed",
      previouslyActivated: true,
      provision,
      tx,
    });

    expect(provision).toHaveBeenCalledWith({
      reason: "hosted-billing-live.test-seed",
      tx,
      userId: "member_paid_seed",
    });
  });
});

describe("hosted Stripe billing test clocks", () => {
  it("waits for the provider to reach the requested second before returning its time", async () => {
    const sandbox = createClockSandbox();
    const clock = buildClockResponse();
    const frozenTime = clock.frozen_time + 3_600;
    const create = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "create")
      .mockResolvedValue(clock);
    const retrieve = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockResolvedValueOnce(clock)
      .mockResolvedValueOnce(buildClockResponse({ status: "advancing" }))
      .mockResolvedValueOnce(buildClockResponse({ frozen_time: frozenTime }));
    const advance = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "advance")
      .mockResolvedValue(buildClockResponse({ status: "advancing" }));

    await sandbox.createTestClock("renewal");
    await expect(sandbox.advanceTestClock({
      frozenTime: new Date(frozenTime * 1_000),
      testClockId: clock.id,
    })).resolves.toEqual(new Date(frozenTime * 1_000));
    expect(create).toHaveBeenCalledWith({
      frozen_time: expect.any(Number),
      name: clock.name,
    });
    expect(advance).toHaveBeenCalledExactlyOnceWith(clock.id, { frozen_time: frozenTime });
    expect(retrieve).toHaveBeenCalledTimes(3);
  });

  it.each([
    { livemode: true },
    { name: "murph-another-run-renewal" },
    { status: "advancing" as const },
  ])("rejects a changed clock boundary before mutation: %j", async (change) => {
    const sandbox = createClockSandbox();
    const clock = buildClockResponse();
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "create").mockResolvedValue(clock);
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockResolvedValue(buildClockResponse(change));
    const advance = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "advance")
      .mockRejectedValue(new Error("Unexpected provider mutation."));
    await sandbox.createTestClock("renewal");

    await expect(sandbox.advanceTestClock({
      frozenTime: new Date((clock.frozen_time + 3_600) * 1_000),
      testClockId: clock.id,
    })).rejects.toThrow(/owned|ready/u);
    expect(advance).not.toHaveBeenCalled();
  });

  it("rejects an untracked clock without making a provider request", async () => {
    const sandbox = createClockSandbox();
    const retrieve = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockRejectedValue(new Error("Unexpected provider request."));
    await expect(sandbox.advanceTestClock({
      frozenTime: new Date("2026-09-11T12:00:00.000Z"),
      testClockId: "clock_untracked",
    })).rejects.toThrow(/owned clock/u);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["provider failure", { status: "internal_failure" as const }, /internal_failure/u],
    ["unchanged ready clock", {}, /unexpected frozen time/u],
  ] as const)("does not report successful advancement for %s", async (_label, change, error) => {
    const sandbox = createClockSandbox();
    const clock = buildClockResponse();
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "create").mockResolvedValue(clock);
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockResolvedValueOnce(clock)
      .mockResolvedValueOnce(buildClockResponse(change));
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "advance")
      .mockResolvedValue(buildClockResponse({ status: "advancing" }));
    await sandbox.createTestClock("renewal");

    await expect(sandbox.advanceTestClock({
      frozenTime: new Date((clock.frozen_time + 3_600) * 1_000),
      testClockId: clock.id,
    })).rejects.toThrow(error);
  });

  it("waits for an interrupted advancement before deleting its owned clock", async () => {
    const sandbox = createClockSandbox();
    const clock = buildClockResponse();
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "create").mockResolvedValue(clock);
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockResolvedValueOnce(buildClockResponse({ status: "advancing" }))
      .mockResolvedValue(clock);
    vi.spyOn(sandbox.stripe.paymentMethods, "list").mockResolvedValue({
      data: [], has_more: false, object: "list", url: "/v1/payment_methods",
      lastResponse: clock.lastResponse,
    });
    const remove = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "del")
      .mockResolvedValue({
        deleted: true, id: clock.id, object: "test_helpers.test_clock",
        lastResponse: clock.lastResponse,
      });
    await sandbox.createTestClock("renewal");

    await expect(sandbox.cleanup()).resolves.toMatchObject({ testClocksDeleted: 1 });
    expect(remove).toHaveBeenCalledExactlyOnceWith(clock.id);
  });

  it("fails cleanup when its clock failed instead of silently retaining the resource", async () => {
    const sandbox = createClockSandbox();
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "create")
      .mockResolvedValue(buildClockResponse());
    vi.spyOn(sandbox.stripe.testHelpers.testClocks, "retrieve")
      .mockResolvedValue(buildClockResponse({ status: "internal_failure" }));
    const remove = vi.spyOn(sandbox.stripe.testHelpers.testClocks, "del")
      .mockRejectedValue(new Error("Unexpected provider deletion."));
    const list = vi.spyOn(sandbox.stripe.paymentMethods, "list")
      .mockRejectedValue(new Error("Unexpected provider request."));
    await sandbox.createTestClock("renewal");

    await expect(sandbox.cleanup()).rejects.toThrow(/internal_failure/u);
    expect(remove).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

function createClockSandbox(): HostedStripeBillingSandbox {
  return new HostedStripeBillingSandbox({
    accountId: "acct_clock_fixture",
    portalConfigurationId: "bpc_clock_fixture",
    priceIds: {
      edge: "price_edge", familyEdge: "price_family_edge", familyMax: "price_family_max",
      familyPulse: "price_family_pulse", pulse: "price_pulse",
    },
    privyAppId: "privy_clock_fixture",
    runId: "billing_clock_fixture",
    secretKey: "sk_test_clock_fixture",
  });
}

function buildClockResponse(
  change: Partial<Stripe.TestHelpers.TestClock> = {},
): Stripe.Response<Stripe.TestHelpers.TestClock> {
  return {
    created: 1_789_041_600,
    deletes_after: 1_791_633_600,
    frozen_time: 1_789_041_600,
    id: "clock_fixture",
    livemode: false,
    name: `murph-${buildHostedStripeRunCorrelationToken("billing_clock_fixture")}-renewal`,
    object: "test_helpers.test_clock",
    status: "ready",
    status_details: {},
    ...change,
    lastResponse: { headers: {}, requestId: "req_clock_fixture", statusCode: 200 },
  };
}

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
