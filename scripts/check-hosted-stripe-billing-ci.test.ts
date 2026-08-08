import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  inspectHostedStripeBillingProviderBoundary,
  inspectHostedStripeBillingWorkflow,
  type HostedStripeBillingProviderBoundarySources,
} from "./check-hosted-stripe-billing-ci.js";

const workflowPath = new URL(
  "../.github/workflows/hosted-stripe-billing.yml",
  import.meta.url,
);

async function readWorkflow(): Promise<string> {
  return readFile(workflowPath, "utf8");
}

function issueCodes(source: string): string[] {
  return inspectHostedStripeBillingWorkflow(source).map((issue) => issue.code);
}

async function readProviderSources(): Promise<HostedStripeBillingProviderBoundarySources> {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [browserDriver, checkoutFixture, matrix, sandbox] = await Promise.all([
    read("apps/web/test/support/hosted-billing-browser-driver.ts"),
    read("apps/web/test/fixtures/stripe/complete-checkout-session.json"),
    read("apps/cloudflare/test/hosted-local-stripe-billing-browser-e2e.test.ts"),
    read("apps/web/test/support/hosted-stripe-billing-live.ts"),
  ]);
  return { browserDriver, checkoutFixture, matrix, sandbox };
}

function providerIssueCodes(
  sources: HostedStripeBillingProviderBoundarySources,
): string[] {
  return inspectHostedStripeBillingProviderBoundary(sources).map((issue) => issue.code);
}

describe("hosted Stripe billing workflow guard", () => {
  it("accepts the checked-in fork-safe workflow", async () => {
    expect(issueCodes(await readWorkflow())).toEqual([]);
  });

  it("rejects pull_request_target", async () => {
    const source = (await readWorkflow()).replace(
      "  pull_request:\n",
      "  pull_request_target:\n",
    );
    expect(issueCodes(source)).toContain("unsafe-pull-request-target");
  });

  it("rejects manual dispatch of an arbitrarily selected ref", async () => {
    const source = (await readWorkflow()).replace(
      "  pull_request:\n",
      "  pull_request:\n  workflow_dispatch:\n",
    );
    expect(issueCodes(source)).toContain("unsafe-workflow-dispatch");
  });

  it("rejects removing the main-push live trigger", async () => {
    const source = (await readWorkflow()).replace(
      "  push:\n    branches:\n      - main\n",
      "",
    );
    expect(issueCodes(source)).toContain("missing-main-push-trigger");
  });

  it("rejects letting the live job start from pull request events", async () => {
    const source = (await readWorkflow()).replace(
      "if: ${{ github.event_name == 'push' }}",
      "if: ${{ always() }}",
    );
    expect(issueCodes(source)).toContain("missing-live-if");
  });

  it("rejects dropping the pull-request live exclusion from the boundary", async () => {
    const source = (await readWorkflow()).replace(
      'pull_request)\n              if [[ "$LIVE_RESULT" != "skipped" ]]',
      "pull_request)\n              if false",
    );
    expect(issueCodes(source)).toContain("missing-pr-live-exclusion");
  });

  it("rejects restoring a marker that silently skips live proof", async () => {
    const source = (await readWorkflow()).replace(
      "          HERMETIC_RESULT: ${{ needs.billing-hermetic.result }}\n",
      "          CONFIGURED: ${{ vars.HOSTED_STRIPE_BILLING_LIVE_CONFIGURED }}\n          HERMETIC_RESULT: ${{ needs.billing-hermetic.result }}\n",
    );
    expect(issueCodes(source)).toContain("silent-live-config-skip");
  });

  it("rejects removing the always-present required boundary", async () => {
    const source = (await readWorkflow()).replace(
      "  billing-required:\n    name: Required hosted Stripe billing boundary",
      "  billing-required:\n    name: Optional hosted Stripe billing boundary",
    );
    expect(issueCodes(source)).toEqual(expect.arrayContaining([
      "missing-required-boundary-job",
      "missing-required-boundary-always",
    ]));
  });

  it("rejects workflow-level cancellation that can interrupt cleanup", async () => {
    const source = (await readWorkflow()).replace(
      "concurrency:\n  group: ${{ github.workflow }}-${{ github.event.pull_request.number || 'main-push' }}\n  cancel-in-progress: false",
      "concurrency:\n  group: ${{ github.workflow }}-${{ github.event.pull_request.number || 'main-push' }}\n  cancel-in-progress: true",
    );
    expect(issueCodes(source)).toContain("unsafe-workflow-cancellation");
  });

  it("rejects exposing the secret before the live job", async () => {
    const source = (await readWorkflow()).replace(
      "  billing-hermetic:\n",
      "  billing-hermetic:\n    env:\n      LEAK: ${{ secrets.HOSTED_STRIPE_BILLING_SANDBOX_SECRET_KEY }}\n",
    );
    expect(issueCodes(source)).toContain("secret-before-live-job");
  });

  it("rejects removing fresh-checkout Prisma Client generation", async () => {
    const source = (await readWorkflow()).replace(
      "        run: pnpm --dir apps/web prisma:generate\n",
      "        run: echo skipped-web-test-client-generation\n",
    );
    expect(issueCodes(source)).toContain("missing-web-test-client-setup");
  });

  it("rejects hiding the pinned Codex CLI from hosted-local startup", async () => {
    const source = (await readWorkflow()).replace(
      '        run: echo "$GITHUB_WORKSPACE/packages/assistant-engine/node_modules/.bin" >> "$GITHUB_PATH"\n',
      "        run: echo skipped-pinned-codex-path\n",
    );
    expect(issueCodes(source)).toContain("missing-pinned-codex-path");
  });

  it("rejects removing the public Privy client configuration", async () => {
    const source = (await readWorkflow()).replaceAll(
      "vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID",
      "vars.REMOVED_PRIVY_APP_ID",
    );
    expect(issueCodes(source)).toContain("missing-privy-client-config");
  });

  it("rejects broad Playwright artifacts and missing cleanup", async () => {
    const source = (await readWorkflow())
      .replace(
        "path: apps/web/playwright-report/hosted-stripe-billing/redacted.json",
        "path: apps/web/playwright-report",
      )
      .replace("        if: always()\n", "        if: success()\n");
    expect(issueCodes(source)).toEqual(expect.arrayContaining([
      "broad-playwright-artifact",
      "missing-always-cleanup",
      "missing-redacted-artifact",
    ]));
  });
});

describe("hosted Stripe provider boundary guard", () => {
  it("accepts the checked-in real provider boundary", async () => {
    expect(providerIssueCodes(await readProviderSources())).toEqual([]);
  });

  it("rejects protected Stripe UI submission", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      browserDriver: `${sources.browserDriver}\nasync function completeStripeCheckout() {}`,
    })).toContain("protected-provider-submit:completeStripeCheckout");
  });

  it("rejects a protected Invoice interaction hidden inside an observer", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      browserDriver: sources.browserDriver.replace(
        'assertStripeSurface(actor.page.url(), "invoice");',
        'assertStripeSurface(actor.page.url(), "invoice");\n      await actor.page.getByRole("button").click();',
      ),
    })).toContain(
      "protected-provider-interaction:assertStripeHostedInvoiceReady",
    );
  });

  it("rejects widening Trial Portal proof beyond its navigation link", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      browserDriver: sources.browserDriver.replace(
        "await navigation.click();",
        'await navigation.click();\n  await page.getByRole("button").click();',
      ),
    })).toContain("unsafe-portal-observer-navigation");
  });

  it("rejects private browser artifact capture", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      browserDriver: `${sources.browserDriver}\nvoid page.screenshot();`,
    })).toContain("private-browser-artifact-capture");
  });

  it("rejects replacing the exact Checkout confirmation endpoint", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      checkoutFixture: sources.checkoutFixture.replace(
        "/confirm",
        "/unsupported-complete",
      ),
    })).toContain("unsupported-checkout-fixture-boundary");
  });

  it("rejects replacing Stripe CLI execution with a no-op", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      sandbox: sources.sandbox.replace(
        'spawn("stripe", ["fixtures", CHECKOUT_FIXTURE_PATH]',
        'spawn("node", ["-e", "process.exit(0)"',
      ),
    })).toContain(
      'real-stripe-boundary-missing:spawn("stripe", ["fixtures", CHECKOUT_FIXTURE_PATH]',
    );
  });

  it("rejects dropping run-owned PaymentMethod cleanup", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      sandbox: sources.sandbox.replace(
        "await input.stripe.paymentMethods.detach(paymentMethod.id);",
        "await Promise.resolve(paymentMethod.id);",
      ),
    })).toContain(
      "real-stripe-boundary-missing:input.stripe.paymentMethods.detach",
    );
  });

  it("rejects losing the real webhook listener assertion", async () => {
    const sources = await readProviderSources();
    expect(providerIssueCodes({
      ...sources,
      matrix: sources.matrix.replaceAll(
        "assertHostedStripeListenerAlive",
        "assertListenerWasNotRequired",
      ),
    })).toContain(
      "provider-boundary-missing:assertHostedStripeListenerAlive",
    );
  });
});
