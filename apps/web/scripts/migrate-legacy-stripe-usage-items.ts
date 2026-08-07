import {
  HOSTED_BILLING_PLAN_CODES,
  getHostedBillingPlanDefinition,
} from "../src/lib/hosted-onboarding/billing-plans";
import {
  projectHostedStripeLegacyUsageMigrationSubscription,
  runHostedStripeLegacyUsageMigration,
  type HostedStripeLegacyUsageMigrationClient,
} from "../src/lib/hosted-onboarding/legacy-usage-price-migration";
import { requireHostedStripeApi } from "../src/lib/hosted-onboarding/runtime";

interface MigrationOptions {
  apply: boolean;
  expectedCandidateSubscriptions?: number;
  stripeMode: "live" | "test";
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  assertStripeModeMatchesKey(options.stripeMode, stripeSecretKey);

  const stripe = requireHostedStripeApi();
  const knownPlanPriceIds = HOSTED_BILLING_PLAN_CODES.map((planCode) => {
    const definition = getHostedBillingPlanDefinition(planCode);
    const priceId = process.env[definition.priceIdEnvKey]?.trim();
    if (!priceId) {
      throw new Error(
        "Legacy usage migration requires every current direct plan price to be configured.",
      );
    }
    return priceId;
  });
  const client: HostedStripeLegacyUsageMigrationClient = {
    async deleteLegacyItem(input) {
      await stripe.subscriptionItems.del(input.itemId, {
        clear_usage: true,
        proration_behavior: "none",
      }, {
        idempotencyKey: input.idempotencyKey,
      });
    },
    async *listSubscriptionsByPrice(priceId) {
      const subscriptions = stripe.subscriptions.list({
        expand: ["data.items.data.price"],
        limit: 100,
        price: priceId,
        status: "all",
      });
      for await (const subscription of subscriptions) {
        yield projectHostedStripeLegacyUsageMigrationSubscription(subscription);
      }
    },
    async retrieveSubscription(subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
      return projectHostedStripeLegacyUsageMigrationSubscription(subscription);
    },
  };

  const summary = await runHostedStripeLegacyUsageMigration({
    apply: options.apply,
    client,
    expectedCandidateSubscriptions: options.expectedCandidateSubscriptions,
    knownPlanPriceIds,
  });
  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    stripeMode: options.stripeMode,
    summary,
  }, null, 2)}\n`);
}

function parseOptions(args: readonly string[]): MigrationOptions {
  let apply = false;
  let expectedCandidateSubscriptions: number | undefined;
  let stripeMode: MigrationOptions["stripeMode"] | undefined;

  for (const argument of args) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument.startsWith("--expected-candidates=")) {
      expectedCandidateSubscriptions = parseNonNegativeInteger(
        argument.slice("--expected-candidates=".length),
      );
      continue;
    }
    if (argument === "--stripe-mode=live") {
      stripeMode = "live";
      continue;
    }
    if (argument === "--stripe-mode=test") {
      stripeMode = "test";
      continue;
    }
    throw new Error(
      "Usage: migrate-legacy-stripe-usage-items --stripe-mode=<test|live> [--apply --expected-candidates=<count>]",
    );
  }

  if (!stripeMode) {
    throw new Error("Legacy usage migration requires --stripe-mode=<test|live>.");
  }
  if (!apply && expectedCandidateSubscriptions !== undefined) {
    throw new Error("Dry-run mode does not accept --expected-candidates.");
  }

  return {
    apply,
    expectedCandidateSubscriptions,
    stripeMode,
  };
}

function parseNonNegativeInteger(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error("Expected candidate count must be a non-negative integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Expected candidate count is outside the supported range.");
  }
  return parsed;
}

function assertStripeModeMatchesKey(
  stripeMode: MigrationOptions["stripeMode"],
  stripeSecretKey: string,
): void {
  const keyMode = stripeSecretKey.startsWith("sk_live_")
      || stripeSecretKey.startsWith("rk_live_")
    ? "live"
    : stripeSecretKey.startsWith("sk_test_")
        || stripeSecretKey.startsWith("rk_test_")
      ? "test"
      : null;
  if (!keyMode || keyMode !== stripeMode) {
    throw new Error(
      "Configured Stripe credential mode does not match the explicit migration mode.",
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "Legacy usage migration failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
