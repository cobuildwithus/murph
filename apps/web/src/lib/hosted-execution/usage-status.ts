import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HOSTED_ADD_USAGE_SETTINGS_URL,
  type HostedPlanUsageAvailableStatus,
  type HostedPlanUsageRecommendedAction,
  type HostedPlanUsageStatus,
  type HostedPlanUsageSubscriptionActionQuote,
} from "@murphai/hosted-execution/plan-usage";

import { getPrisma } from "../prisma";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import {
  canStartHostedPulseTrialPaidPlan,
  canUpgradeHostedBillingPlanToEdge,
  getHostedBillingPlanDefinition,
} from "../hosted-onboarding/billing-plans";
import { hasHostedMemberOwnActiveBilling } from "../hosted-onboarding/entitlement";
import {
  type HostedMemberBillingEligibilityState,
  readHostedMemberBillingEligibilityState,
} from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { sanitizeHostedOnboardingStructuredLogDetails } from "../hosted-onboarding/logging";
import { getHostedOnboardingEnvironment } from "../hosted-onboarding/runtime";
import { HOSTED_USAGE_CREDIT_OFFER_CODES } from "../hosted-onboarding/usage-credit-offers";
import {
  readHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "./usage-allowance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const USAGE_ACTION_THRESHOLD_PERCENT = 80;

type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;

interface HostedPlanUsageActionResolution {
  canAddUsage: boolean;
  subscriptionActionQuote: HostedPlanUsageSubscriptionActionQuote | null;
}

export async function readHostedPersonalAiUsageStatus(input: {
  includeSubscriptionActionQuote?: boolean;
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
    includeSubscriptionActionQuote:
      input.includeSubscriptionActionQuote === true,
    memberId: input.memberId,
    now,
    prisma,
    publicBaseUrl: input.publicBaseUrl,
  });
}

export async function projectHostedPersonalAiUsageStatus(input: {
  decision: HostedAiUsageGateDecisionWithSource;
  includeSubscriptionActionQuote?: boolean;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
}): Promise<HostedPlanUsageStatus> {
  const now = normalizeUsageStatusDate(input.now ?? new Date());
  const prisma = input.prisma ?? getPrisma();
  const generatedAt = now.toISOString();
  const decision = input.decision;
  const includeSubscriptionActionQuote =
    input.includeSubscriptionActionQuote === true;
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
      ...projectSubscriptionActionQuoteExpansion({
        include: includeSubscriptionActionQuote,
        quote: null,
      }),
      status: "unavailable",
    };
  }

  const usageLimitExceeded = !decision.allowed
    && decision.reason === "ai_usage_limit_exceeded";

  if (!decision.allowed && !usageLimitExceeded) {
    const trialConversionPending =
      decision.reason === "trial_expired_pending_billing";
    const shouldResolveAvailableAction = trialConversionPending
      && (includeSubscriptionActionQuote || actionUrl !== null);
    const availableAction = shouldResolveAvailableAction
      ? (await resolveAvailablePlanUsageActions({
          accessKind: "trial",
          memberId: input.memberId,
          planCode: decision.billingPlanCode,
          prisma,
          usageCreditOfferConfigured: false,
        })).subscriptionActionQuote
      : null;
    return {
      generatedAt,
      reason: trialConversionPending
        ? "trial_conversion_pending"
        : "hosted_access_inactive",
      recommendedAction: trialConversionPending
        ? buildRecommendedAction({ action: availableAction, actionUrl })
        : null,
      ...projectSubscriptionActionQuoteExpansion({
        include: includeSubscriptionActionQuote,
        quote: availableAction,
      }),
      status: "unavailable",
    };
  }

  if (decision.limitUsdMicros <= 0n) {
    return {
      generatedAt,
      reason: "hosted_access_inactive",
      recommendedAction: null,
      ...projectSubscriptionActionQuoteExpansion({
        include: includeSubscriptionActionQuote,
        quote: null,
      }),
      status: "unavailable",
    };
  }

  const includedUsageExhausted =
    decision.spentUsdMicros >= decision.limitUsdMicros;
  const exhausted = usageLimitExceeded;
  const usedPercent = calculateUsedPercent({
    exhausted: includedUsageExhausted,
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
  const usageCreditOfferConfigured = accessKind === "paid"
    && shouldRecommendAction
    && hasConfiguredHostedUsageCreditOffer();
  const shouldResolveAvailableActions = includeSubscriptionActionQuote
    || (
      shouldRecommendAction
      && accessKind !== "family_sponsored"
      && (
        accessKind === "paid"
          ? usageCreditOfferConfigured
          : actionUrl !== null
      )
    );
  const availableActions = shouldResolveAvailableActions
    ? await resolveAvailablePlanUsageActions({
        accessKind,
        memberId: input.memberId,
        planCode: decision.billingPlanCode,
        prisma,
        usageCreditOfferConfigured,
      })
    : null;
  const availableSubscriptionAction =
    availableActions?.subscriptionActionQuote ?? null;

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
      ? accessKind === "paid"
        ? availableActions?.canAddUsage === true
          ? buildAddUsageRecommendedAction()
          : null
        : buildRecommendedAction({
            action: availableSubscriptionAction,
            actionUrl,
          })
      : null,
    ...projectSubscriptionActionQuoteExpansion({
      include: includeSubscriptionActionQuote,
      quote: availableSubscriptionAction,
    }),
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

async function resolveAvailablePlanUsageActions(input: {
  accessKind: HostedPlanUsageAvailableStatus["accessKind"];
  memberId: string;
  planCode: HostedPlanUsageAvailableStatus["planCode"];
  prisma: HostedPlanUsageClient;
  usageCreditOfferConfigured: boolean;
}): Promise<HostedPlanUsageActionResolution> {
  if (input.accessKind === "family_sponsored") {
    return {
      canAddUsage: false,
      subscriptionActionQuote: null,
    };
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
    return {
      canAddUsage: false,
      subscriptionActionQuote: null,
    };
  }

  const [member, billingState] = actionState;
  if (!member || !billingState) {
    return {
      canAddUsage: false,
      subscriptionActionQuote: null,
    };
  }

  if (input.accessKind === "trial") {
    return {
      canAddUsage: false,
      subscriptionActionQuote: canStartHostedPulseTrialPaidPlan({
        billingStatus: member.billingStatus,
        currentBillingPhase: billingState.currentBillingPhase,
        currentBillingPlanCode: billingState.currentBillingPlanCode,
        currentCheckoutOffer: billingState.currentCheckoutOffer,
        hasStripeCustomerId: billingState.hasStripeCustomerId,
        hasStripeSubscriptionId: billingState.hasStripeSubscriptionId,
        suspendedAt: member.suspendedAt,
      })
        ? buildSubscriptionActionQuote("start_pulse_now")
        : null,
    };
  }

  const hasOwnActiveBilling = hasHostedMemberOwnActiveBilling(member);
  const canAddUsage = input.usageCreditOfferConfigured
    && hasOwnActiveBilling
    && hasMatchingPaidBillingState({
      billingState,
      planCode: input.planCode,
    });
  const canUpgradeToEdge = input.planCode === "launch_monthly"
    && hasOwnActiveBilling
    && billingState.hasStripeCustomerId
    && billingState.hasStripeSubscriptionId
    && canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
    });

  return {
    canAddUsage,
    subscriptionActionQuote: canUpgradeToEdge
      ? buildSubscriptionActionQuote("upgrade_edge")
      : null,
  };
}

function hasConfiguredHostedUsageCreditOffer(): boolean {
  const priceIdsByOffer =
    getHostedOnboardingEnvironment().stripeUsageCreditPriceIdsByOffer;

  return HOSTED_USAGE_CREDIT_OFFER_CODES.some((offerCode) =>
    Boolean(priceIdsByOffer[offerCode])
  );
}

function hasMatchingPaidBillingState(input: {
  billingState: HostedMemberBillingEligibilityState;
  planCode: HostedPlanUsageAvailableStatus["planCode"];
}): boolean {
  return input.billingState.currentBillingPhase === "paid"
    && input.billingState.currentBillingPlanCode === input.planCode
    && input.billingState.hasStripeCustomerId
    && input.billingState.hasStripeSubscriptionId;
}

function buildSubscriptionActionQuote(
  action: HostedPlanUsageSubscriptionActionQuote["action"],
): HostedPlanUsageSubscriptionActionQuote {
  const billingPlan = getHostedBillingPlanDefinition(
    action === "start_pulse_now" ? "launch_monthly" : "launch_edge_monthly",
  );
  const recurringAmount = `$${billingPlan.recurringAmountUsdCents / 100}`;
  return {
    action,
    label: action === "start_pulse_now"
      ? `Start Pulse now (${recurringAmount}/month)`
      : `Upgrade to Edge (${recurringAmount}/month)`,
  };
}

function buildRecommendedAction(input: {
  action: HostedPlanUsageSubscriptionActionQuote | null;
  actionUrl: string | null;
}): HostedPlanUsageRecommendedAction | null {
  if (!input.action || !input.actionUrl) {
    return null;
  }
  return {
    kind: input.action.action === "start_pulse_now"
      ? "start_pulse"
      : "upgrade_edge",
    label: input.action.label,
    url: input.actionUrl,
  };
}

function buildAddUsageRecommendedAction(): HostedPlanUsageRecommendedAction {
  return {
    kind: "add_usage",
    label: "Add usage",
    url: HOSTED_ADD_USAGE_SETTINGS_URL,
  };
}

function projectSubscriptionActionQuoteExpansion(input: {
  include: boolean;
  quote: HostedPlanUsageSubscriptionActionQuote | null;
}): {
  subscriptionActionQuote?: HostedPlanUsageSubscriptionActionQuote | null;
} {
  return input.include
    ? { subscriptionActionQuote: input.quote }
    : {};
}

function buildUsageActionUrl(
  publicBaseUrl: string | null,
): string | null {
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
