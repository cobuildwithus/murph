import { getPrisma } from "../src/lib/prisma";
import {
  getHostedBillingPlanDefinition,
  HOSTED_PULSE_TRIAL_OFFER,
} from "../src/lib/hosted-onboarding/billing-plans";
import {
  readHostedMemberStripeBillingRef,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  isHostedLegacyPulseTrialRetirableStatus,
  retireHostedLegacyPulseTrialToStarter,
  retrieveHostedPulseTrialCleanupTarget,
} from "../src/lib/hosted-onboarding/pulse-trial-subscription-cleanup";
import { requireHostedStripeApi } from "../src/lib/hosted-onboarding/runtime";

interface RetirementOptions {
  apply: boolean;
  expectedCandidates?: number;
  stripeMode: "live" | "test";
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  assertStripeModeMatchesKey(options.stripeMode, stripeSecretKey);

  const prisma = getPrisma();
  try {
    const stripe = requireHostedStripeApi();
    const pulsePriceId = process.env[
      getHostedBillingPlanDefinition("launch_monthly").priceIdEnvKey
    ]?.trim();
    if (!pulsePriceId) {
      throw new Error(
        "Legacy trial retirement requires the current Pulse Stripe price.",
      );
    }

    const queriedRows = await prisma.hostedMemberBillingRef.findMany({
      orderBy: { memberId: "asc" },
      select: {
        currentBillingPhase: true,
        memberId: true,
      },
      where: {
        OR: [
          { currentBillingPhase: "trial" },
          { currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER },
        ],
        stripeSubscriptionLookupKey: { not: null },
      },
    });
    const rows = queriedRows.filter(
      (row) => row.currentBillingPhase !== "paid",
    );

    if (options.apply && options.expectedCandidates !== rows.length) {
      throw new Error(
        `Expected ${options.expectedCandidates ?? "an explicit"} legacy trial candidates but found ${rows.length}.`,
      );
    }

    const candidates: string[] = [];
    const statusCounts = new Map<string, number>();
    let missingProviderCount = 0;

    for (const row of rows) {
      const billingRef = await readHostedMemberStripeBillingRef({
        memberId: row.memberId,
        prisma,
      });
      const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;
      if (!stripeSubscriptionId) {
        throw new Error(
          "A legacy trial candidate has an unreadable Stripe subscription identity.",
        );
      }
      const subscription = await retrieveHostedPulseTrialCleanupTarget({
        expectedCustomerId: billingRef?.stripeCustomerId ?? undefined,
        memberId: row.memberId,
        priceId: pulsePriceId,
        stripe,
        subscriptionId: stripeSubscriptionId,
      });
      if (!subscription) {
        missingProviderCount += 1;
      } else {
        statusCounts.set(
          subscription.status,
          (statusCounts.get(subscription.status) ?? 0) + 1,
        );
        if (!isHostedLegacyPulseTrialRetirableStatus(subscription.status)) {
          throw new Error(
            "At least one legacy trial candidate now represents potentially paid Stripe service. No provider objects were changed.",
          );
        }
      }

      candidates.push(row.memberId);
    }

    let retiredCount = 0;
    let alreadyRetiredCount = 0;
    if (options.apply) {
      for (const memberId of candidates) {
        const retired = await retireHostedLegacyPulseTrialToStarter({
          memberId,
          priceId: pulsePriceId,
          prisma,
          stripe,
        });
        if (retired) {
          retiredCount += 1;
        } else {
          alreadyRetiredCount += 1;
        }
      }
    }

    process.stdout.write(`${JSON.stringify({
      alreadyRetiredCount,
      candidateCount: candidates.length,
      missingProviderCount,
      mode: options.apply ? "apply" : "dry-run",
      retiredCount,
      stripeMode: options.stripeMode,
      subscriptionStatusCounts: Object.fromEntries(
        [...statusCounts.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ),
    }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

function parseOptions(args: readonly string[]): RetirementOptions {
  let apply = false;
  let expectedCandidates: number | undefined;
  let stripeMode: RetirementOptions["stripeMode"] | undefined;

  for (const argument of args) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument.startsWith("--expected-candidates=")) {
      expectedCandidates = parseNonNegativeInteger(
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
      "Usage: retire-legacy-pulse-trials --stripe-mode=<test|live> [--apply --expected-candidates=<count>]",
    );
  }

  if (!stripeMode) {
    throw new Error(
      "Legacy trial retirement requires --stripe-mode=<test|live>.",
    );
  }
  if (apply && expectedCandidates === undefined) {
    throw new Error(
      "Apply mode requires --expected-candidates=<count> from the dry-run.",
    );
  }
  if (!apply && expectedCandidates !== undefined) {
    throw new Error("Dry-run mode does not accept --expected-candidates.");
  }

  return { apply, expectedCandidates, stripeMode };
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
  stripeMode: RetirementOptions["stripeMode"],
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
      "Configured Stripe credential mode does not match the explicit retirement mode.",
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "Legacy trial retirement failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
