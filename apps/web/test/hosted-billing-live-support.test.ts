import { ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";

import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

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

  it("waits for the enrolled Settings tree to commit before another navigation", async () => {
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
      expect(predicate(new URL("https://app.example.test/settings"))).toBe(true);
    });
    let releaseSettingsCommit!: () => void;
    const settingsCommitted = new Promise<void>((resolve) => {
      releaseSettingsCommit = resolve;
    });
    const settingsHeadingWaitFor = vi.fn(() => settingsCommitted);
    const getByRole = vi.fn((role: string, options: unknown) => {
      expect(role).toBe("heading");
      expect(options).toEqual({ exact: true, name: "Your account" });
      return { waitFor: settingsHeadingWaitFor };
    });
    const page = {
      getByRole,
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
      expect(settingsHeadingWaitFor).toHaveBeenCalledOnce();
    });
    expect(activationSettled).toBe(false);
    releaseSettingsCommit();
    await activation;

    expect(page.goto).toHaveBeenCalledWith(
      "https://app.example.test/join/starter-invite",
      { waitUntil: "commit" },
    );
    expect(waitForURL).toHaveBeenCalledOnce();
    expect(settingsHeadingWaitFor).toHaveBeenCalledOnce();
    expect(settingsHeadingWaitFor.mock.invocationCallOrder[0]).toBeGreaterThan(
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

describe("official Stripe Checkout fixture diagnostics", () => {
  const privateOutput = "sk_test_private https://example.invalid/private cs_test_private private@example.invalid";
  const parameterErrorBody = JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "parameter_invalid_integer",
      param: "expected_amount",
    },
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(spawn).mockReset();
    vi.useRealTimers();
  });

  it.each(["payment_page", "payment_method", "payment_page_confirm"])(
    "preserves split rejection evidence for %s through the sanitizer",
    async (step) => {
      vi.useFakeTimers();
      const run = await startFixture();
      run.child.stdout.write("Running fixture for: payment_page\n");
      run.child.stderr.write("Request fai");
      run.child.stderr.write("led, status=4");
      const body = JSON.stringify({
        error: {
          type: "card_error",
          code: "card_declined",
          param: "payment_method",
          message: `${privateOutput}\nRequest failed, status=599, body=private\nRunning fixture for: payment_page_confirm\n`,
        },
      });
      run.child.stderr.write(`02, body=${body.slice(0, 30)}`);
      run.child.emit("exit", 17, null);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(run.child.kill).not.toHaveBeenCalled();
      // Pipes can deliver their final chunks after exit, in either stream order.
      run.child.stdout.write("Running fix");
      run.child.stdout.write(`ture for: ${step}\n`);
      run.child.stderr.write(`${body.slice(30)}\n`);
      run.close(17);

      const failure = await run.result;
      expect(String(failure)).toBe(
        `HostedStripeBillingLiveError: Official Stripe Checkout fixture failed (step=${step}, response=http_rejection, http_status=402, error_type=card_error, error_code=card_declined, error_param=payment_method, process=exit, exit_code=17, stdout=complete, stderr=complete).`,
      );
      expect(failure).not.toHaveProperty("cause");
      expect(run.retrieve).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["amount type", 400, "invalid_request_error", "parameter_invalid_integer", "expected_amount"],
    ["missing amount", 400, "invalid_request_error", "parameter_missing", "expected_amount"],
    ["unknown parameter", 400, "invalid_request_error", "parameter_unknown", "payment_method"],
    ["missing payment method", 404, "invalid_request_error", "resource_missing", "payment_method"],
    ["payment decline", 402, "card_error", "card_declined", "payment_method"],
    ["payment authentication", 402, "card_error", "authentication_required", "payment_method"],
    ["payment state", 400, "invalid_request_error", "payment_intent_unexpected_state", undefined],
    ["API failure", 500, "api_error", undefined, undefined],
    ["idempotency mismatch", 400, "idempotency_error", undefined, undefined],
  ] as const)("distinguishes %s through the sanitizer", async (
    _label, status, type, code, param,
  ) => {
    const run = await startFixture();
    const body = JSON.stringify({
      error: {
        type, code, param,
        message: privateOutput,
        request_log_url: "https://example.invalid/private",
        payment_intent: { id: "pi_private", client_secret: privateOutput },
      },
    });
    run.child.stderr.write(`Request failed, status=${status}, body=${body}\n`);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: `Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=${status}, error_type=${type}, error_code=${code ?? "unknown"}, error_param=${param ?? "unknown"}, process=exit, exit_code=1, stdout=empty, stderr=complete).`,
    });
    expect(run.retrieve).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown strings", { type: privateOutput, code: privateOutput, param: privateOutput }],
    ["missing fields", {}],
    ["null fields", { type: null, code: null, param: null }],
    ["wrong field types", { type: ["card_error"], code: 402, param: { name: "payment_method" } }],
    ["suffixes", { type: "card_error_private", code: "card_declined_private", param: "payment_method[card]" }],
    ["case and whitespace", { type: "CARD_ERROR", code: " card_declined", param: "payment_method\n" }],
    ["nested fields", { raw: { type: "card_error", code: "card_declined", param: "payment_method" } }],
  ] as const)("keeps %s private", async (_label, fields) => {
    const run = await startFixture();
    const body = JSON.stringify({
      error: {
        ...fields,
        message: privateOutput,
        doc_url: "https://example.invalid/private",
        payment_intent: {
          id: "pi_private",
          client_secret: privateOutput,
          last_payment_error: { type: "card_error", code: "card_declined", param: "payment_method" },
        },
      },
    });
    run.child.stderr.write(`Request failed, status=400, body=${body}\n`);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: "Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=400, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=complete).",
    });
  });

  it.each([
    ["missing body", ""],
    ["malformed JSON", parameterErrorBody.slice(0, -1)],
    ["private non-JSON", privateOutput],
    ["null root", "null"],
    ["string root", JSON.stringify(privateOutput)],
    ["number root", "400"],
    ["boolean root", "true"],
    ["array root", `[${parameterErrorBody}]`],
    ["missing error", "{}"],
    ["null error", '{"error":null}'],
    ["string error", JSON.stringify({ error: privateOutput })],
    ["number error", '{"error":400}'],
    ["boolean error", '{"error":true}'],
    ["array error", '{"error":[{"type":"card_error","code":"card_declined","param":"payment_method"}]}'],
    ["message lookalike", JSON.stringify({ message: parameterErrorBody })],
    ["appended private text", `${parameterErrorBody}${privateOutput}`],
    ["appended JSON", `${parameterErrorBody}${parameterErrorBody}`],
    ["request suffix lookalike", `${parameterErrorBody}\nRequest failed, status=402, body=${parameterErrorBody}`],
    ["progress suffix lookalike", `${parameterErrorBody}\nRunning fixture for: payment_method`],
  ])("fails closed for %s", async (_label, body) => {
    const run = await startFixture();
    run.child.stderr.write(`Request failed, status=400, body=${body}\n`);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: "Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=400, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=complete).",
    });
  });

  it("does not parse valid JSON from a partial stderr line", async () => {
    const run = await startFixture();
    run.child.stderr.write(`Request failed, status=400, body=${parameterErrorBody}`);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: "Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=400, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=partial).",
    });
  });

  it.each([false, true])("requires complete stderr at the 8 KiB bound (truncated=%s)", async (truncated) => {
    const run = await startFixture();
    const response = `Request failed, status=400, body=${parameterErrorBody}`;
    run.child.stderr.write(response);
    run.child.stderr.write(Buffer.alloc(8_191 - Buffer.byteLength(response), " "));
    run.child.stderr.write("\n");
    if (truncated) run.child.stderr.write("x");
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: `Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=400, error_type=${truncated ? "unknown" : "invalid_request_error"}, error_code=${truncated ? "unknown" : "parameter_invalid_integer"}, error_param=${truncated ? "unknown" : "expected_amount"}, process=exit, exit_code=1, stdout=empty, stderr=${truncated ? "truncated" : "complete"}).`,
    });
  });

  it("keeps zero-exit success and verifies completion through the sandbox", async () => {
    const run = await startFixture();
    run.child.stdout.write(`${privateOutput}\n`);
    run.child.stderr.write(`Request failed, status=400, body=${parameterErrorBody}\n`);
    run.finish(0);

    await expect(run.result).resolves.toMatchObject({ status: "complete" });
    expect(run.retrieve).toHaveBeenCalledTimes(3);
    expect(run.update).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      "stripe",
      ["fixtures", expect.stringMatching(/complete-checkout-session\.json$/u)],
      {
        env: buildStripeFixtureChildEnvironmentForTest({
          expectedAmount: 800,
          runId: "billing_clock_fixture",
          scenario: "checkout",
          secretKey: "sk_test_clock_fixture",
          sessionId: "cs_test_fixture",
          sourceEnv: process.env,
        }),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  });

  it.each([
    ["empty", "", "", "unknown", "empty", "empty"],
    ["unknown step", "Running fixture for: payment_page\nRunning fixture for: private\n", "private\n", "unknown", "complete", "complete"],
    ["malformed step", "Running fixture for: payment_page\nRunning fixture for:payment_method\n", "private\n", "unknown", "complete", "complete"],
    ["partial", "Running fixture for: payment_page", "Request failed, status=40", "unknown", "partial", "partial"],
    ["body lookalikes", "Running fixture for: payment_method\n", `private\nRequest failed, status=402, body=${parameterErrorBody}\n`, "payment_method", "complete", "complete"],
    ["prefix lookalike", "", ` Request failed, status=400, body=${parameterErrorBody}\n`, "unknown", "empty", "complete"],
    ["stdout JSON", `Request failed, status=400, body=${parameterErrorBody}\n`, "", "unknown", "complete", "empty"],
  ])("reports missing evidence for %s output", async (
    _label, stdout, stderr, step, stdoutState, stderrState,
  ) => {
    const run = await startFixture();
    run.child.stdout.write(stdout);
    run.child.stderr.write(stderr);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: `Official Stripe Checkout fixture failed (step=${step}, response=not_observed, http_status=unknown, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=${stdoutState}, stderr=${stderrState}).`,
    });
  });

  it.each(["200", "299", "600", "4020", "0402", "private"])(
    "does not accept malformed or out-of-range rejection status %s",
    async (status) => {
      const run = await startFixture();
      run.child.stderr.write(`Request failed, status=${status}, body=${parameterErrorBody}\n`);
      run.finish(1);
      await expect(run.result).resolves.toMatchObject({
        message: "Official Stripe Checkout fixture failed (step=unknown, response=not_observed, http_status=unknown, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=complete).",
      });
    },
  );

  it.each([300, 599])("retains bounded rejection status %i", async (status) => {
    const run = await startFixture();
    run.child.stderr.write(`Request failed, status=${status}, body=private\n`);
    run.finish(1);
    await expect(run.result).resolves.toMatchObject({
      message: `Official Stripe Checkout fixture failed (step=unknown, response=http_rejection, http_status=${status}, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=complete).`,
    });
  });

  it.each(["stdout", "stderr"] as const)("bounds and drains oversized %s", async (stream) => {
    const run = await startFixture();
    run.child.stdout.write("Running fixture for: payment_method\n");
    run.child.stderr.write(`Request failed, status=429, body=${parameterErrorBody}\n`);
    run.child[stream].write(Buffer.alloc(64 * 1_024, "x"));
    run.child[stream].write("\nRunning fixture for: payment_page_confirm\n");
    run.child[stream].write("Request failed, status=599, body=private\n");
    expect(run.child.stdout.readableLength).toBe(0);
    expect(run.child.stderr.readableLength).toBe(0);
    run.finish(1);

    await expect(run.result).resolves.toMatchObject({
      message: `Official Stripe Checkout fixture failed (step=${stream === "stdout" ? "unknown" : "payment_method"}, response=http_rejection, http_status=429, error_type=${stream === "stderr" ? "unknown" : "invalid_request_error"}, error_code=${stream === "stderr" ? "unknown" : "parameter_invalid_integer"}, error_param=${stream === "stderr" ? "unknown" : "expected_amount"}, process=exit, exit_code=1, stdout=${stream === "stdout" ? "truncated" : "complete"}, stderr=${stream === "stderr" ? "truncated" : "complete"}).`,
    });
  });

  it("does not infer a response from a discarded suffix", async () => {
    const run = await startFixture();
    run.child.stderr.write(Buffer.alloc(64 * 1_024, "x"));
    run.child.stderr.write("\nRequest failed, status=402, body=private\n");
    run.finish(1);
    await expect(run.result).resolves.toMatchObject({
      message: "Official Stripe Checkout fixture failed (step=unknown, response=not_observed, http_status=unknown, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=1, stdout=empty, stderr=truncated).",
    });
  });

  it.each([false, true])("sanitizes startup failure (synchronous=%s)", async (synchronous) => {
    vi.useFakeTimers();
    const run = await startFixture(synchronous);
    if (!synchronous) {
      run.child.emit("error", Object.assign(new Error(privateOutput), { code: privateOutput }));
      run.close(-2);
    }
    const failure = await run.result;
    expect(failure).toMatchObject({
      message: "Official Stripe Checkout fixture could not start (process=startup_error).",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(vi.getTimerCount()).toBe(0);
    expect(run.retrieve).toHaveBeenCalledOnce();
  });

  it("retains only the signal category and bounded exit codes", async () => {
    for (const [code, signal, processState] of [
      [null, "SIGKILL", "signal"],
      [null, null, "unknown"],
      [256, null, "exit"],
    ] as const) {
      const run = await startFixture();
      run.finish(code, signal);
      await expect(run.result).resolves.toMatchObject({
        message: `Official Stripe Checkout fixture failed (step=unknown, response=not_observed, http_status=unknown, error_type=unknown, error_code=unknown, error_param=unknown, process=${processState}, exit_code=unknown, stdout=empty, stderr=empty).`,
      });
    }
  });

  it("keeps the 120-second SIGTERM timeout even if the child then exits zero", async () => {
    vi.useFakeTimers();
    const run = await startFixture();
    run.child.stdout.write("Running fixture for: payment_method\n");
    await vi.advanceTimersByTimeAsync(119_999);
    expect(run.child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    run.finish(0);

    await expect(run.result).resolves.toMatchObject({
      message: "Official Stripe Checkout fixture timed out (step=payment_method, response=not_observed, http_status=unknown, error_type=unknown, error_code=unknown, error_param=unknown, process=exit, exit_code=0, stdout=complete, stderr=empty).",
    });
    expect(run.retrieve).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  async function startFixture(throwOnSpawn = false) {
    const sandbox = createClockSandbox();
    const metadata: Stripe.Metadata = { memberId: "member_fixture" };
    const session = {
      id: "cs_test_fixture",
      amount_total: 800,
      customer: null,
      livemode: false,
      metadata,
      mode: "subscription",
      status: "open",
      subscription: null,
    } as Stripe.Response<Stripe.Checkout.Session>;
    const retrieve = vi.spyOn(sandbox.stripe.checkout.sessions, "retrieve")
      .mockResolvedValueOnce(session)
      .mockResolvedValue({ ...session, status: "complete" });
    const update = vi.spyOn(sandbox.stripe.checkout.sessions, "update")
      .mockResolvedValue(session);
    const child = Object.assign(new ChildProcess(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    vi.spyOn(child, "kill").mockReturnValue(true);
    let markSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => { markSpawned = resolve; });
    vi.mocked(spawn).mockImplementationOnce(() => {
      markSpawned();
      if (throwOnSpawn) throw new Error(privateOutput);
      return child;
    });
    const result = sandbox.completeCheckoutSessionWithOfficialFixture({
      expectedAmount: 800,
      ownership: { memberId: "member_fixture", scenario: "checkout" },
      sessionId: session.id,
    }).catch((error: unknown) => {
      const sanitized = sanitizeHostedStripeBillingLiveFailure(error, "checkout");
      expect(sanitized).toBe(error);
      expect(sanitized).not.toHaveProperty("cause");
      return sanitized;
    });
    await spawned;
    const close = (code: number | null, signal: NodeJS.Signals | null = null) => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", code, signal);
    };
    return {
      child, close, result, retrieve, update,
      finish(code: number | null, signal: NodeJS.Signals | null = null) {
        child.emit("exit", code, signal);
        close(code, signal);
      },
    };
  }
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
