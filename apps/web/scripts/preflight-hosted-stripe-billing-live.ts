import {
  resolveHostedStripeBillingLiveConfig,
} from "@murphai/hosted-local-harness/stripe-billing-live-config";

import { HostedStripeBillingSandbox } from "../test/support/hosted-stripe-billing-live";

async function main(): Promise<void> {
  const resolution = resolveHostedStripeBillingLiveConfig(process.env);
  if (!resolution.configured) {
    throw new Error("Dedicated hosted Stripe billing sandbox configuration is not enabled.");
  }

  const sandbox = new HostedStripeBillingSandbox({
    ...resolution.config,
    runId: resolution.config.runId,
  });
  await sandbox.assertCatalogContract();
  console.log("Hosted Stripe billing sandbox catalog preflight passed.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Hosted Stripe billing preflight failed.");
  process.exitCode = 1;
});
