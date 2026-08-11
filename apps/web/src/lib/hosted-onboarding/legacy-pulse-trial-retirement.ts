import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { HOSTED_PULSE_TRIAL_OFFER } from "./billing-plans";
import {
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import {
  isHostedLegacyPulseTrialRetirableStatus,
  retireHostedLegacyPulseTrialToStarter,
  retrieveHostedPulseTrialCleanupTarget,
} from "./pulse-trial-subscription-cleanup";

export type HostedLegacyPulseTrialRetirementStripeMode = "live" | "test";

export interface HostedLegacyPulseTrialRetirementReport {
  alreadyRetiredCount: number;
  candidateCount: number;
  missingProviderCount: number;
  mode: "apply" | "dry-run";
  retiredCount: number;
  stripeMode: HostedLegacyPulseTrialRetirementStripeMode;
  subscriptionStatusCounts: Record<string, number>;
}

export class HostedLegacyPulseTrialRetirementBlockedError extends Error {
  constructor(
    message =
      "At least one legacy trial candidate has ambiguous or potentially paid billing state. No provider objects were changed.",
  ) {
    super(message);
    this.name = "HostedLegacyPulseTrialRetirementBlockedError";
  }
}

export class HostedLegacyPulseTrialCandidateCountChangedError extends Error {
  constructor(
    readonly expectedCandidates: number,
    readonly observedCandidates: number,
  ) {
    super(
      `Expected ${expectedCandidates} legacy trial candidates but found ${observedCandidates}. Run a fresh dry-run before applying.`,
    );
    this.name = "HostedLegacyPulseTrialCandidateCountChangedError";
  }
}

/**
 * Canonical one-time drain for obsolete Pulse trial bindings. Every candidate
 * is provider-validated before apply begins, then revalidated under the
 * existing per-member billing lock before its Stripe and Starter state change.
 * Reports are aggregate-only so operator output cannot expose member identity.
 */
export async function runHostedLegacyPulseTrialRetirement(input: {
  apply: boolean;
  expectedCandidates?: number;
  priceId: string;
  prisma: PrismaClient;
  stripe: Pick<Stripe, "subscriptions">;
  stripeMode: HostedLegacyPulseTrialRetirementStripeMode;
}): Promise<HostedLegacyPulseTrialRetirementReport> {
  let applyExpectedCandidates: number | null = null;
  if (input.apply) {
    if (
      input.expectedCandidates === undefined
      || !Number.isSafeInteger(input.expectedCandidates)
      || input.expectedCandidates < 0
    ) {
      throw new TypeError(
        "Apply requires a non-negative expected candidate count from a dry-run.",
      );
    }
    applyExpectedCandidates = input.expectedCandidates;
  } else if (input.expectedCandidates !== undefined) {
    throw new TypeError("Dry-run does not accept an expected candidate count.");
  }

  const queriedRows = await input.prisma.hostedMemberBillingRef.findMany({
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

  if (
    applyExpectedCandidates !== null
    && applyExpectedCandidates !== rows.length
  ) {
    throw new HostedLegacyPulseTrialCandidateCountChangedError(
      applyExpectedCandidates,
      rows.length,
    );
  }

  const candidates: string[] = [];
  const statusCounts = new Map<string, number>();
  let missingProviderCount = 0;

  for (const row of rows) {
    const billingRef = await readHostedMemberStripeBillingRef({
      memberId: row.memberId,
      prisma: input.prisma,
    });
    const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;
    if (!stripeSubscriptionId) {
      throw new HostedLegacyPulseTrialRetirementBlockedError(
        "At least one legacy trial candidate has an unreadable Stripe subscription identity. No provider objects were changed.",
      );
    }
    const subscription = await retrieveHostedPulseTrialCleanupTarget({
      expectedCustomerId: billingRef?.stripeCustomerId ?? undefined,
      memberId: row.memberId,
      priceId: input.priceId,
      stripe: input.stripe,
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
        throw new HostedLegacyPulseTrialRetirementBlockedError();
      }
    }

    candidates.push(row.memberId);
  }

  let retiredCount = 0;
  let alreadyRetiredCount = 0;
  if (input.apply) {
    for (const memberId of candidates) {
      const retired = await retireHostedLegacyPulseTrialToStarter({
        memberId,
        priceId: input.priceId,
        prisma: input.prisma,
        stripe: input.stripe,
      });
      if (retired) {
        retiredCount += 1;
      } else {
        alreadyRetiredCount += 1;
      }
    }
  }

  return {
    alreadyRetiredCount,
    candidateCount: candidates.length,
    missingProviderCount,
    mode: input.apply ? "apply" : "dry-run",
    retiredCount,
    stripeMode: input.stripeMode,
    subscriptionStatusCounts: Object.fromEntries(
      [...statusCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    ),
  };
}
