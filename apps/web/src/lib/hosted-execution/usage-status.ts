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
} from "../hosted-onboarding/billing-plans";
import { hasHostedMemberOwnActiveBilling } from "../hosted-onboarding/entitlement";
import { readHostedMemberStripeBillingRef } from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
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

  if (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded") {
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
    : decision.allowanceSource === "family_sponsored_pulse"
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

export function formatHostedPersonalAiUsageStatusForConversation(
  status: HostedPlanUsageStatus,
): string {
  if (status.status === "unavailable") {
    const base = status.reason === "trial_conversion_pending"
      ? "Your Pulse Trial has ended, so hosted replies are paused."
      : status.reason === "group_not_supported"
        ? "Personal plan usage is not available in a group conversation."
        : "Hosted AI access is inactive right now.";
    return appendHostedPlanUsageRecommendedAction(base, status.recommendedAction);
  }

  const periodEnd = formatHostedPlanUsageConversationDate(status.periodEnd);
  const periodTiming = status.periodKind === "trial"
    ? `The trial period ends on ${periodEnd}.`
    : `The included allowance resets on ${periodEnd}.`;
  const forecast = status.forecast
    ? ` At the recent pace, it may run out in about ${status.forecast.estimatedDaysRemaining} ${
        status.forecast.estimatedDaysRemaining === 1 ? "day" : "days"
      }.`
    : "";
  const base = `You've used approximately ${status.usedPercent}% of the included ${
    status.planName
  } AI usage, with ${status.remainingPercent}% remaining. ${periodTiming}${forecast}`;
  return appendHostedPlanUsageRecommendedAction(base, status.recommendedAction);
}

function appendHostedPlanUsageRecommendedAction(
  message: string,
  action: HostedPlanUsageRecommendedAction | null,
): string {
  return action
    ? `${message} ${action.label}: ${action.url}`
    : message;
}

function formatHostedPlanUsageConversationDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
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

  const [member, billingRef] = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  ]);
  if (!member || !billingRef) {
    return null;
  }

  if (input.accessKind === "trial") {
    return canStartHostedPulseTrialPaidPlan({
      billingStatus: member.billingStatus,
      currentBillingPhase: billingRef.currentBillingPhase,
      currentBillingPlanCode: billingRef.currentBillingPlanCode,
      currentCheckoutOffer: billingRef.currentCheckoutOffer,
      stripeCustomerId: billingRef.stripeCustomerId,
      stripeSubscriptionId: billingRef.stripeSubscriptionId,
      suspendedAt: member.suspendedAt,
    })
      ? buildRecommendedAction("start_pulse", input.actionUrl)
      : null;
  }

  if (
    hasHostedMemberOwnActiveBilling(member)
    && canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: billingRef.currentBillingPhase,
      currentBillingPlanCode: billingRef.currentBillingPlanCode,
      currentCheckoutOffer: billingRef.currentCheckoutOffer,
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
  return kind === "start_pulse"
    ? {
        kind,
        label: "Start Pulse",
        url: actionUrl,
      }
    : {
        kind,
        label: "Upgrade to Edge",
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
