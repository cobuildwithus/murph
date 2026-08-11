import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export interface HostedStripeBillingWorkflowIssue {
  code: string;
  message: string;
}

export interface HostedStripeBillingProviderBoundarySources {
  browserDriver: string;
  checkoutFixture: string;
  matrix: string;
  sandbox: string;
}

const REQUIRED_MATRIX_MARKERS = [
  "proveStarterUsageStartsPaidPulseThroughCheckout",
  "provePaidPulseUpgradesToEdgeThroughPortal",
  "proveEdgeSchedulesPulseAtRenewal",
  "proveIndividualStartsFamilyThroughCheckout",
  "proveFamilyInviteActivation",
  "provePaidIndividualConvertsToFamilyInPlace",
] as const;

export function inspectHostedStripeBillingWorkflow(
  source: string,
): HostedStripeBillingWorkflowIssue[] {
  const issues: HostedStripeBillingWorkflowIssue[] = [];
  const requireText = (code: string, needle: string, message: string): void => {
    if (!source.includes(needle)) {
      issues.push({ code, message });
    }
  };

  requireText("missing-pull-request", "  pull_request:\n", "Workflow must run on pull_request.");
  requireText(
    "missing-main-push-trigger",
    "  push:\n    branches:\n      - main\n",
    "Workflow must run the live lane on pushes to main.",
  );
  if (source.includes("pull_request_target")) {
    issues.push({
      code: "unsafe-pull-request-target",
      message: "Workflow must never execute PR code through pull_request_target.",
    });
  }
  if (source.includes("workflow_dispatch")) {
    issues.push({
      code: "unsafe-workflow-dispatch",
      message: "Writable Stripe authority must not execute an arbitrarily selected manual ref.",
    });
  }
  requireText(
    "missing-hermetic-job",
    "billing-hermetic:",
    "Every pull request requires a hermetic billing job.",
  );
  requireText(
    "missing-starter-checkout-proof",
    "apps/web/test/hosted-onboarding-billing-checkout-route.test.ts",
    "Hermetic proof must retain Starter-to-paid Checkout coverage.",
  );
  requireText(
    "missing-starter-migration-proof",
    "apps/web/test/hosted-starter-usage-migration.test.ts",
    "Hermetic proof must retain the legacy trial-to-Starter migration contract.",
  );
  requireText(
    "missing-config-proof",
    "test/stripe-billing-live-config.test.ts",
    "Hermetic proof must retain sandbox authority partition tests.",
  );
  requireText(
    "missing-support-proof",
    "apps/web/test/hosted-billing-live-support.test.ts",
    "Hermetic proof must retain browser and provider-boundary support tests.",
  );
  requireText(
    "missing-web-test-client-setup",
    "pnpm --dir apps/web prisma:generate",
    "Hermetic web billing proof must generate Prisma Client in a fresh checkout.",
  );
  if (source.includes("HOSTED_STRIPE_BILLING_LIVE_CONFIGURED")) {
    issues.push({
      code: "silent-live-config-skip",
      message: "Main merges must fail preflight when sandbox configuration is absent, not skip behind a marker.",
    });
  }
  requireText(
    "missing-live-if",
    "if: ${{ github.event_name == 'push' }}",
    "The secret-bearing live job must run only on trusted push events, never on pull request code.",
  );
  requireText(
    "missing-dedicated-environment",
    "environment: hosted-stripe-billing-sandbox",
    "Live job must use the dedicated GitHub Environment.",
  );
  requireText(
    "missing-sandbox-secret",
    "secrets.HOSTED_STRIPE_BILLING_SANDBOX_SECRET_KEY",
    "Live steps must use only the dedicated sandbox secret.",
  );
  requireText(
    "missing-privy-client-config",
    "vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID",
    "The browser lane must render with the existing public Privy client configuration.",
  );
  requireText(
    "missing-live-command",
    "pnpm hosted-local e2e stripe-billing-browser-matrix",
    "Workflow and harness scenario must stay aligned.",
  );
  requireText(
    "missing-pinned-cli-install",
    "pnpm stripe:cli:setup",
    "Live job must install the pinned Stripe CLI.",
  );
  requireText(
    "missing-pinned-codex-path",
    'echo "$GITHUB_WORKSPACE/packages/assistant-engine/node_modules/.bin" >> "$GITHUB_PATH"',
    "Live hosted-local startup must expose the existing pinned workspace Codex CLI.",
  );
  requireText(
    "missing-always-cleanup",
    "- name: Clean up owned Stripe sandbox resources\n        if: always()",
    "Owned sandbox resources must be cleaned up even after failures.",
  );
  requireText(
    "missing-redacted-artifact",
    "path: apps/web/playwright-report/hosted-stripe-billing/redacted.json",
    "Only the redacted browser diagnostic file may be uploaded.",
  );
  requireText(
    "missing-serial-live-lane",
    "group: hosted-stripe-billing-sandbox\n      cancel-in-progress: false",
    "Live sandbox runs must be serialized and must not be canceled mid-cleanup.",
  );
  requireText(
    "missing-required-boundary-job",
    "name: Required hosted Stripe billing boundary",
    "Branch protection needs one always-present billing boundary check.",
  );
  requireText(
    "missing-required-boundary-always",
    "  billing-required:\n    name: Required hosted Stripe billing boundary\n    needs:\n      - billing-hermetic\n      - live-stripe-browser\n    if: ${{ always() }}",
    "The required billing boundary must always inspect hermetic and live results.",
  );
  requireText(
    "missing-required-live-result",
    "LIVE_RESULT: ${{ needs.live-stripe-browser.result }}",
    "The required billing boundary must consume the live job result.",
  );
  requireText(
    "missing-fail-closed-live-gate",
    'case "$EVENT_NAME" in\n            push)\n              if [[ "$LIVE_RESULT" != "success" ]]',
    "Main merges must fail when the live lane is missing, skipped, or unsuccessful.",
  );
  requireText(
    "missing-pr-live-exclusion",
    'pull_request)\n              if [[ "$LIVE_RESULT" != "skipped" ]]',
    "Pull requests must fail closed if the secret-bearing live job ever starts.",
  );
  const workflowConcurrency = source.match(
    /^concurrency:\n  group: .+\n  cancel-in-progress: (true|false)$/mu,
  );
  if (workflowConcurrency?.[1] !== "false") {
    issues.push({
      code: "unsafe-workflow-cancellation",
      message: "Workflow-level concurrency must not cancel a live run before cleanup.",
    });
  }

  const liveJobIndex = source.indexOf("  live-stripe-browser:");
  if (liveJobIndex < 0) {
    issues.push({ code: "missing-live-job", message: "Live Stripe browser job is missing." });
  } else {
    const beforeLiveJob = source.slice(0, liveJobIndex);
    if (beforeLiveJob.includes("HOSTED_STRIPE_BILLING_SANDBOX_SECRET_KEY")) {
      issues.push({
        code: "secret-before-live-job",
        message: "Writable Stripe authority must not enter eligibility or hermetic jobs.",
      });
    }
  }
  if (source.includes("STRIPE_API_KEY:") || source.includes("--api-key")) {
    issues.push({
      code: "unsafe-cli-key-plumbing",
      message: "Workflow must not interpolate or globally expose the Stripe CLI key.",
    });
  }
  if (/path:\s+apps\/web\/playwright-report\s*$/mu.test(source)) {
    issues.push({
      code: "broad-playwright-artifact",
      message: "Workflow must not upload the full Playwright report directory.",
    });
  }
  return issues;
}

export function inspectHostedStripeBillingProviderBoundary(
  sources: HostedStripeBillingProviderBoundarySources,
): HostedStripeBillingWorkflowIssue[] {
  const issues: HostedStripeBillingWorkflowIssue[] = [];
  const requireSourceText = (
    source: string,
    code: string,
    needle: string,
    message: string,
  ): void => {
    if (!source.includes(needle)) {
      issues.push({ code, message });
    }
  };

  for (const [source, marker, label] of [
    [sources.matrix, "assertStripeCheckoutReady", "real Checkout surface"],
    [sources.matrix, "openPaidPulseEdgeConfirmation", "paid Portal confirmation"],
    [sources.matrix, "assertHostedStripeListenerAlive", "live stripe listen ownership"],
    [sources.sandbox, "completeCheckoutSessionWithOfficialFixture", "exact Checkout completion"],
    [sources.sandbox, "this.stripe.subscriptions.update", "Portal-equivalent mutation"],
  ] as const) {
    requireSourceText(
      source,
      `provider-boundary-missing:${marker}`,
      marker,
      `Live billing provider boundary is missing ${label}.`,
    );
  }

  for (const method of [
    "completeStripeCheckout",
    "completeStripeHostedInvoice",
    "completeStripePortalConfirmation",
    "completeStripeThreeDSIfPresent",
    "fillStripeHostedPaymentForm",
  ] as const) {
    if (sources.matrix.includes(method) || sources.browserDriver.includes(method)) {
      issues.push({
        code: `protected-provider-submit:${method}`,
        message: `Protected Stripe UI completion method ${method} must not exist.`,
      });
    }
  }

  for (const [method, endMarker] of [
    ["assertStripeCheckoutReady", "async openPaidPulseEdgeConfirmation("],
    ["openPaidPulseEdgeConfirmation", "async schedulePulseAtRenewal("],
  ] as const) {
    const segment = readSourceSegment(
      sources.browserDriver,
      `async ${method}(`,
      endMarker,
    );
    if (
      segment === null
      || /\.(?:check|click|fill|press)\s*\(/u.test(segment)
    ) {
      issues.push({
        code: `protected-provider-interaction:${method}`,
        message: `${method} must observe provider state without submitting a protected Stripe control.`,
      });
    }
  }

  if (/\b(?:page|context)\.route\s*\(/u.test(sources.browserDriver)) {
    issues.push({
      code: "provider-request-interception",
      message: "The browser driver must not intercept Stripe-hosted requests.",
    });
  }
  if (
    /\.(?:screenshot|startTracing|stopTracing)\s*\(|recordVideo/iu.test(
      `${sources.browserDriver}\n${sources.matrix}`,
    )
  ) {
    issues.push({
      code: "private-browser-artifact-capture",
      message: "Live billing proof must not capture screenshots, traces, or video.",
    });
  }
  for (const marker of [
    '"<HOME_DIR>"',
    '"[redacted-url]"',
    '"[redacted-stripe-id]"',
  ] as const) {
    requireSourceText(
      sources.browserDriver,
      `browser-redaction-missing:${marker}`,
      marker,
      `Browser diagnostics must retain redaction marker ${marker}.`,
    );
  }

  let fixture: unknown;
  try {
    fixture = JSON.parse(sources.checkoutFixture);
  } catch {
    issues.push({
      code: "invalid-checkout-fixture-json",
      message: "Stripe Checkout completion fixture must remain valid JSON.",
    });
  }
  if (
    !fixture
    || !sources.checkoutFixture.includes(
      '"path": "/v1/payment_pages/${.env:MURPH_HOSTED_STRIPE_FIXTURE_SESSION_ID}"',
    )
    || !sources.checkoutFixture.includes(
      '"path": "/v1/payment_pages/${.env:MURPH_HOSTED_STRIPE_FIXTURE_SESSION_ID}/confirm"',
    )
    || !sources.checkoutFixture.includes('"token": "tok_visa"')
    || !sources.checkoutFixture.includes(
      '"murphHostedLocalRun": "${.env:MURPH_HOSTED_STRIPE_FIXTURE_RUN_ID}"',
    )
    || !sources.checkoutFixture.includes(
      '"payment_method": "${payment_method:id}"',
    )
    || !sources.checkoutFixture.includes(
      '"expected_amount": "${.env:MURPH_HOSTED_STRIPE_FIXTURE_EXPECTED_AMOUNT}"',
    )
  ) {
    issues.push({
      code: "unsupported-checkout-fixture-boundary",
      message: "Checkout completion must retain the exact official Stripe CLI payment-page sequence.",
    });
  }
  if (/localhost|127\.0\.0\.1|hosted-onboarding\/stripe\/webhook/iu.test(
    sources.checkoutFixture,
  )) {
    issues.push({
      code: "direct-local-checkout-completion",
      message: "Checkout completion must call Stripe rather than a local webhook.",
    });
  }
  for (const requirement of [
    'spawn("stripe", ["fixtures", CHECKOUT_FIXTURE_PATH]',
    "shell: false",
    "STRIPE_API_KEY: input.secretKey",
    "MURPH_HOSTED_STRIPE_FIXTURE_RUN_ID: input.runId",
    "input.stripe.paymentMethods.list",
    "input.stripe.paymentMethods.detach",
  ] as const) {
    requireSourceText(
      sources.sandbox,
      `real-stripe-boundary-missing:${requirement}`,
      requirement,
      `Stripe provider boundary is missing ${requirement}.`,
    );
  }
  const combined = `${sources.browserDriver}\n${sources.matrix}\n${sources.sandbox}`;
  if (/vi\.mock\s*\(\s*["']stripe["']|mockStripe|stripeMock/iu.test(combined)) {
    issues.push({
      code: "mocked-stripe-sdk-boundary",
      message: "The live provider boundary must use the real Stripe SDK and CLI.",
    });
  }
  if (/hosted-onboarding\/stripe\/webhook/iu.test(`${sources.matrix}\n${sources.sandbox}`)) {
    issues.push({
      code: "direct-local-webhook-completion",
      message: "Provider events must traverse the harness-owned stripe listen process.",
    });
  }
  return issues;
}

function readSourceSegment(
  source: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    return null;
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? null : source.slice(start, end + endMarker.length);
}

export async function inspectHostedStripeBillingRepository(
  repoRoot = process.cwd(),
): Promise<HostedStripeBillingWorkflowIssue[]> {
  const read = (path: string) => readFile(`${repoRoot}/${path}`, "utf8");
  const [
    workflow,
    registry,
    matrix,
    browserDriver,
    sandbox,
    checkoutFixture,
    rootPackage,
    repoHygiene,
  ] = await Promise.all([
    read(".github/workflows/hosted-stripe-billing.yml"),
    read("packages/hosted-local-harness/src/e2e.ts"),
    read("apps/cloudflare/test/hosted-local-stripe-billing-browser-e2e.test.ts"),
    read("apps/web/test/support/hosted-billing-browser-driver.ts"),
    read("apps/web/test/support/hosted-stripe-billing-live.ts"),
    read("apps/web/test/fixtures/stripe/complete-checkout-session.json"),
    read("package.json"),
    read(".github/workflows/repo-hygiene.yml"),
  ]);
  const issues = inspectHostedStripeBillingWorkflow(workflow);
  issues.push(...inspectHostedStripeBillingProviderBoundary({
    browserDriver,
    checkoutFixture,
    matrix,
    sandbox,
  }));
  if (!registry.includes('"stripe-billing-browser-matrix"')) {
    issues.push({
      code: "scenario-not-registered",
      message: "Hosted-local scenario registry does not include the live billing matrix.",
    });
  }
  if (!registry.includes("hosted-local-stripe-billing-browser-e2e.test.ts")) {
    issues.push({
      code: "scenario-file-drift",
      message: "Hosted-local scenario registry no longer points at the matrix file.",
    });
  }
  for (const marker of REQUIRED_MATRIX_MARKERS) {
    if (!matrix.includes(marker)) {
      issues.push({
        code: `matrix-case-missing:${marker}`,
        message: `Live billing matrix is missing ${marker}.`,
      });
    }
  }
  if (!rootPackage.includes('"hosted-billing:ci-guard"')) {
    issues.push({
      code: "guard-command-missing",
      message: "Root package scripts must expose the billing CI guard.",
    });
  }
  if (!repoHygiene.includes("pnpm hosted-billing:ci-guard")) {
    issues.push({
      code: "guard-not-required",
      message: "Repo Hygiene must run the billing workflow guard.",
    });
  }
  return issues;
}

async function main(): Promise<void> {
  const issues = await inspectHostedStripeBillingRepository();
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`[${issue.code}] ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Hosted Stripe billing CI contract passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
