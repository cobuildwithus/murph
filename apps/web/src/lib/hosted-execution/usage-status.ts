import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedPlanUsageAvailableStatus,
  HostedPlanUsageRecommendedAction,
  HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import { getPrisma } from "../prisma";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import {
  canStartHostedPulseTrialPaidPlan,
  canUpgradeHostedBillingPlanToEdge,
  getHostedBillingPlanDefinition,
} from "../hosted-onboarding/billing-plans";
import { hasHostedMemberOwnActiveBilling } from "../hosted-onboarding/entitlement";
import { readHostedMemberBillingEligibilityState } from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { sanitizeHostedOnboardingStructuredLogDetails } from "../hosted-onboarding/logging";
import {
  readHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "./usage-allowance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const USAGE_ACTION_THRESHOLD_PERCENT = 80;

type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;

export async function readHostedPersonalAiUsageStatus(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
}): Promise<HostedPlanUsageStatus> {
  const now = normalizeUsageStatusDate(input.now ?? new Date());
  const prisma = input.prisma ?? getPrisma();
  const decision = await readHostedAiUsageGate({
    memberId: input.memberId,
    now,
    prisma,
  });

  return projectHostedPersonalAiUsageStatus({
    decision,
    memberId: input.memberId,
    now,
    prisma,
    publicBaseUrl: input.publicBaseUrl,
  });
}

export async function projectHostedPersonalAiUsageStatus(input: {
  decision: HostedAiUsageGateDecisionWithSource;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
}): Promise<HostedPlanUsageStatus> {
  const now = normalizeUsageStatusDate(input.now ?? new Date());
  const prisma = input.prisma ?? getPrisma();
  const generatedAt = now.toISOString();
  const decision = input.decision;
  const actionUrl = buildUsageActionUrl(
    input.publicBaseUrl === undefined
      ? resolveHostedPublicBaseUrl()
      : input.publicBaseUrl,
  );

  if (decision.allowanceSource === "thread_container") {
    return {
      generatedAt,
      reason: "group_not_supported",
      recommendedAction: null,
      status: "unavailable",
    };
  }

  if (!decision.allowed) {
    const trialConversionPending =
      decision.reason === "trial_expired_pending_billing";
    return {
      generatedAt,
      reason: trialConversionPending
        ? "trial_conversion_pending"
        : "hosted_access_inactive",
      recommendedAction: trialConversionPending
        ? await resolveRecommendedAction({
            accessKind: "trial",
            actionUrl,
            memberId: input.memberId,
            planCode: decision.billingPlanCode,
            prisma,
          })
        : null,
      status: "unavailable",
    };
  }

  if (decision.limitUsdMicros <= 0n) {
    return {
      generatedAt,
      reason: "hosted_access_inactive",
      recommendedAction: null,
      status: "unavailable",
    };
  }

  const exhausted = decision.spentUsdMicros >= decision.limitUsdMicros;
  const usedPercent = calculateUsedPercent({
    exhausted,
    limit: decision.limitUsdMicros,
    spent: decision.spentUsdMicros,
  });
  const forecast = exhausted || decision.spentUsdMicros <= 0n
    ? null
    : await buildUsageForecast({
        memberId: input.memberId,
        limit: decision.limitUsdMicros,
        now,
        periodEnd: decision.periodEnd,
        periodStart: decision.periodStart,
        prisma,
        spent: decision.spentUsdMicros,
      });
  const accessKind = decision.allowanceSource === "direct_trial"
    ? "trial"
    : decision.allowanceSource === "family_sponsored_plan"
      ? "family_sponsored"
      : "paid";
  const planName = accessKind === "family_sponsored"
    ? "Family"
    : accessKind === "trial"
      ? "Pulse Trial"
    : decision.billingPlanCode === "launch_edge_monthly"
      ? "Edge"
      : "Pulse";
  const shouldRecommendAction = exhausted
    || forecast !== null
    || usedPercent >= USAGE_ACTION_THRESHOLD_PERCENT;

  return {
    accessKind,
    forecast,
    generatedAt,
    periodEnd: decision.periodEnd.toISOString(),
    periodKind: accessKind === "trial" ? "trial" : "monthly",
    periodStart: decision.periodStart.toISOString(),
    planCode: decision.billingPlanCode,
    planName,
    recommendedAction: shouldRecommendAction
      ? await resolveRecommendedAction({
          accessKind,
          actionUrl,
          memberId: input.memberId,
          planCode: decision.billingPlanCode,
          prisma,
        })
      : null,
    remainingPercent: 100 - usedPercent,
    status: exhausted ? "exhausted" : "active",
    usedPercent,
  } satisfies HostedPlanUsageAvailableStatus;
}

function calculateUsedPercent(input: {
  exhausted: boolean;
  limit: bigint;
  spent: bigint;
}): number {
  if (input.exhausted) {
    return 100;
  }
  if (input.spent <= 0n) {
    return 0;
  }

  const floored = Number((input.spent * 100n) / input.limit);
  return Math.min(99, Math.max(1, floored));
}

async function buildUsageForecast(input: {
  limit: bigint;
  memberId: string;
  now: Date;
  periodEnd: Date;
  periodStart: Date;
  prisma: HostedPlanUsageClient;
  spent: bigint;
}): Promise<HostedPlanUsageAvailableStatus["forecast"]> {
  const firstCountedUsage = await input.prisma.hostedAiUsage.findFirst({
    orderBy: {
      occurredAt: "asc",
    },
    select: {
      occurredAt: true,
    },
    where: {
      allowanceCostUsdMicros: {
        gt: 0n,
      },
      allowanceCounted: true,
      allowancePeriodStart: input.periodStart,
      memberId: input.memberId,
    },
  });
  const observedFrom = firstCountedUsage?.occurredAt ?? null;
  if (!observedFrom) {
    return null;
  }

  const elapsedMs = input.now.getTime() - observedFrom.getTime();
  if (elapsedMs < DAY_MS) {
    return null;
  }

  const projectedDurationMs = (BigInt(elapsedMs) * input.limit) / input.spent;
  if (projectedDurationMs > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  const estimatedExhaustionAt = new Date(
    observedFrom.getTime() + Number(projectedDurationMs),
  );
  if (!Number.isFinite(estimatedExhaustionAt.getTime())) {
    return null;
  }
  if (
    estimatedExhaustionAt.getTime() <= input.now.getTime()
    || estimatedExhaustionAt.getTime() >= input.periodEnd.getTime()
  ) {
    return null;
  }

  return {
    estimatedDaysRemaining: Math.max(
      1,
      Math.ceil(
        (estimatedExhaustionAt.getTime() - input.now.getTime()) / DAY_MS,
      ),
    ),
    estimatedExhaustionAt: estimatedExhaustionAt.toISOString(),
  };
}

async function resolveRecommendedAction(input: {
  accessKind: HostedPlanUsageAvailableStatus["accessKind"];
  actionUrl: string | null;
  memberId: string;
  planCode: HostedPlanUsageAvailableStatus["planCode"];
  prisma: HostedPlanUsageClient;
}): Promise<HostedPlanUsageRecommendedAction | null> {
  if (
    !input.actionUrl
    || input.accessKind === "family_sponsored"
    || input.planCode === "launch_edge_monthly"
  ) {
    return null;
  }

  const actionState = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    readHostedMemberBillingEligibilityState({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  ]).catch((error: unknown) => {
    console.warn(
      "Hosted plan usage action resolution failed.",
      sanitizeHostedOnboardingStructuredLogDetails({
        accessKind: input.accessKind,
        errorName: error instanceof Error ? error.name : "UnknownError",
        planCode: input.planCode,
      }),
    );
    return null;
  });
  if (!actionState) {
    return null;
  }

  const [member, billingState] = actionState;
  if (!member || !billingState) {
    return null;
  }

  if (input.accessKind === "trial") {
    return canStartHostedPulseTrialPaidPlan({
      billingStatus: member.billingStatus,
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
      hasStripeCustomerId: billingState.hasStripeCustomerId,
      hasStripeSubscriptionId: billingState.hasStripeSubscriptionId,
      suspendedAt: member.suspendedAt,
    })
      ? buildRecommendedAction("start_pulse", input.actionUrl)
      : null;
  }

  if (
    hasHostedMemberOwnActiveBilling(member)
    && billingState.hasStripeCustomerId
    && billingState.hasStripeSubscriptionId
    && canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
    })
  ) {
    return buildRecommendedAction("upgrade_edge", input.actionUrl);
  }
  return null;
}

function buildRecommendedAction(
  kind: HostedPlanUsageRecommendedAction["kind"],
  actionUrl: string | null,
): HostedPlanUsageRecommendedAction | null {
  if (!actionUrl) {
    return null;
  }
  const billingPlan = getHostedBillingPlanDefinition(
    kind === "start_pulse" ? "launch_monthly" : "launch_edge_monthly",
  );
  const recurringAmount = `$${billingPlan.recurringAmountUsdCents / 100}`;
  return kind === "start_pulse"
    ? {
        kind,
        label: `Start Pulse now (${recurringAmount}/month)`,
        url: actionUrl,
      }
    : {
        kind,
        label: `Upgrade to Edge (${recurringAmount}/month)`,
        url: actionUrl,
      };
}

function buildUsageActionUrl(publicBaseUrl: string | null): string | null {
  if (!publicBaseUrl) {
    return null;
  }
  try {
    const url = new URL("/settings", `${publicBaseUrl}/`);
    url.hash = "subscription";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeUsageStatusDate(value: Date | string): Date {
  const normalized = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    throw new TypeError("Hosted plan usage status date is invalid.");
  }
  return normalized;
}
