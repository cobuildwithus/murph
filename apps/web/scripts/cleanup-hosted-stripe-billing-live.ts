import {
  resolveHostedStripeBillingLiveConfig,
} from "@murphai/hosted-local-harness/stripe-billing-live-config";

import {
  cleanupHostedStripeBillingRun,
  sanitizeHostedStripeBillingLiveFailure,
} from "../test/support/hosted-stripe-billing-live";

async function main(): Promise<void> {
  const resolution = resolveHostedStripeBillingLiveConfig(process.env);
  if (!resolution.configured) {
    throw new Error(
      "Hosted Stripe billing cleanup requires the enabled contract and an opaque run id.",
    );
  }

  try {
    const summary = await cleanupHostedStripeBillingRun({
      runId: resolution.config.runId,
      secretKey: resolution.config.secretKey,
    });
    console.log("Hosted Stripe billing cleanup completed.", summary);
  } catch (error) {
    throw sanitizeHostedStripeBillingLiveFailure(error, "bounded-cleanup");
  }
}

void main().catch((error: unknown) => {
  const sanitized = sanitizeHostedStripeBillingLiveFailure(error, "bounded-cleanup");
  console.error(sanitized.message);
  process.exitCode = 1;
});
