import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { coerceStripeObjectId } from "./billing";
import { parseHostedBillingPlanCode } from "./billing-plans";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { requireHostedStripeApi } from "./runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  applyStripeSubscriptionUpdated,
  resolveHostedStripeSubscriptionBillingPlanCode,
} from "./stripe-billing-events";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";

export interface HostedBillingSnapshotBackfillSummary {
  apply: boolean;
  customerMismatch: number;
  failed: number;
  limit: number;
  missingSubscriptionRef: number;
  scanned: number;
  stripeRetrieveFailed: number;
  unresolvedPlan: number;
  updated: number;
  wouldUpdate: number;
}

export async function backfillHostedBillingSnapshots(input?: {
  apply?: boolean;
  limit?: number;
  now?: Date;
  prisma?: PrismaClient;
  stripe?: Stripe;
}): Promise<HostedBillingSnapshotBackfillSummary> {
  const apply = input?.apply === true;
  const limit = normalizeHostedBillingSnapshotBackfillLimit(input?.limit);
  const now = input?.now ?? new Date();
  const prisma = input?.prisma ?? getPrisma();
  const stripe = input?.stripe ?? requireHostedStripeApi();
  const summary: HostedBillingSnapshotBackfillSummary = {
    apply,
    customerMismatch: 0,
    failed: 0,
    limit,
    missingSubscriptionRef: 0,
    scanned: 0,
    stripeRetrieveFailed: 0,
    unresolvedPlan: 0,
    updated: 0,
    wouldUpdate: 0,
  };

  const candidates = await prisma.hostedMemberBillingRef.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      memberId: true,
    },
    take: limit,
    where: {
      OR: [
        { currentBillingPhase: null },
        { currentBillingPlanCode: null },
        { currentCheckoutOffer: null },
        { currentPeriodEnd: null },
        { currentPeriodStart: null },
      ],
      stripeSubscriptionIdEncrypted: {
        not: null,
      },
    },
  });

  summary.scanned = candidates.length;

  for (const candidate of candidates) {
    const billingRef = await readHostedMemberStripeBillingRef({
      memberId: candidate.memberId,
      prisma,
    });
    const stripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;

    if (!billingRef || !stripeSubscriptionId) {
      summary.missingSubscriptionRef += 1;
      continue;
    }

    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ["items.data.price"],
      });
    } catch {
      summary.stripeRetrieveFailed += 1;
      continue;
    }

    if (!hostedBillingSnapshotBackfillCustomerMatches({
      stripeCustomerId: billingRef.stripeCustomerId,
      subscription,
    })) {
      summary.customerMismatch += 1;
      continue;
    }

    const resolvedPlanCode = resolveHostedStripeSubscriptionBillingPlanCode(subscription);
    if (!resolvedPlanCode) {
      summary.unresolvedPlan += 1;
      continue;
    }

    if (!apply) {
      summary.wouldUpdate += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await applyStripeSubscriptionUpdated(
          subscription,
          buildHostedBillingSnapshotBackfillDispatchContext({
            eventCreatedAt: billingRef.lastStripeEventCreatedAt ?? now,
            stripeSubscriptionId,
          }),
          tx,
        );
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

      const updatedRef = await readHostedMemberStripeBillingRef({
        memberId: candidate.memberId,
        prisma,
      });

      if (hostedBillingSnapshotBackfillSucceeded({
        resolvedPlanCode,
        updatedRef,
      })) {
        summary.updated += 1;
      } else {
        summary.failed += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

function hostedBillingSnapshotBackfillCustomerMatches(input: {
  stripeCustomerId: string | null;
  subscription: Stripe.Subscription;
}): boolean {
  if (!input.stripeCustomerId) {
    return true;
  }

  return coerceStripeObjectId(input.subscription.customer) === input.stripeCustomerId;
}

function hostedBillingSnapshotBackfillSucceeded(input: {
  resolvedPlanCode: ReturnType<typeof parseHostedBillingPlanCode>;
  updatedRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
}): boolean {
  const currentPeriodStart = input.updatedRef?.currentPeriodStart ?? null;
  const currentPeriodEnd = input.updatedRef?.currentPeriodEnd ?? null;
  const updatedPlanCode = parseHostedBillingPlanCode(
    input.updatedRef?.currentBillingPlanCode,
  );

  return updatedPlanCode === input.resolvedPlanCode &&
    Boolean(input.updatedRef?.currentBillingPhase) &&
    Boolean(input.updatedRef?.currentCheckoutOffer) &&
    currentPeriodStart instanceof Date &&
    currentPeriodEnd instanceof Date &&
    currentPeriodStart.getTime() < currentPeriodEnd.getTime();
}

function buildHostedBillingSnapshotBackfillDispatchContext(input: {
  eventCreatedAt: Date;
  stripeSubscriptionId: string;
}): HostedStripeDispatchContext {
  return {
    eventCreatedAt: input.eventCreatedAt,
    occurredAt: input.eventCreatedAt.toISOString(),
    sourceEventId: `stripe-subscription-snapshot-backfill:${sha256Hex(
      input.stripeSubscriptionId,
    ).slice(0, 32)}`,
    sourceType: "stripe.customer.subscription.updated.snapshot-backfill",
  };
}

function normalizeHostedBillingSnapshotBackfillLimit(value: number | undefined): number {
  if (value === undefined) {
    return 100;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error("--limit must be an integer between 1 and 1000.");
  }

  return value;
}
