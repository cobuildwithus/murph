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
  canScheduleHostedBillingPlanChange,
  canUpgradeHostedBillingPlan,
  getHostedBillingPlanDefinition,
} from "../hosted-onboarding/billing-plans";
import {
  hasConfirmedHostedGroupMembership,
  resolveHostedTrialContinuationOffer,
} from "../hosted-onboarding/billing-plan-eligibility";
import {
  buildHostedBillingPlanQuoteState,
  createHostedBillingPlanQuote,
} from "../hosted-onboarding/billing-plan-quote";
import { hasHostedMemberOwnActiveBilling } from "../hosted-onboarding/entitlement";
import {
  readHostedMemberBillingEligibilityState,
} from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { sanitizeHostedOnboardingStructuredLogDetails } from "../hosted-onboarding/logging";
import { readHostedPersonalUsageCreditOfferCodes } from "../hosted-onboarding/personal-usage-credit-eligibility";
import { getHostedOnboardingEnvironment } from "../hosted-onboarding/runtime";
import {
  readHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "./usage-allowance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const USAGE_ACTION_THRESHOLD_PERCENT = 80;

type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;

export async function readHostedPersonalAiUsageStatus(input: {
  includeSubscriptionActionQuote?: boolean;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
  subscriptionActionTargetPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly";
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
    subscriptionActionTargetPlanCode:
      input.subscriptionActionTargetPlanCode,
  });
}

export async function projectHostedPersonalAiUsageStatus(input: {
  decision: HostedAiUsageGateDecisionWithSource;
  includeSubscriptionActionQuote?: boolean;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
  subscriptionActionTargetPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly";
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
    const availableOffer = shouldResolveAvailableAction
      ? await resolveAvailableSubscriptionOffer({
          accessKind: "trial",
          memberId: input.memberId,
          now,
          planCode: decision.billingPlanCode,
          prisma,
          requestedTargetPlanCode:
            input.subscriptionActionTargetPlanCode,
          trialTiming: "now",
        })
      : EMPTY_SUBSCRIPTION_OFFER;
    return {
      ...projectSubscriptionOffer(availableOffer),
      generatedAt,
      reason: trialConversionPending
        ? "trial_conversion_pending"
        : "hosted_access_inactive",
      recommendedAction: trialConversionPending
        ? buildRecommendedAction({
            action: availableOffer.quote,
            actionUrl,
          })
        : null,
      ...projectSubscriptionActionQuoteExpansion({
        include: includeSubscriptionActionQuote,
        quote: availableOffer.quote,
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
        : decision.billingPlanCode === "launch_group_monthly"
          ? "Group"
          : "Pulse";
  const shouldRecommendAction = exhausted
    || forecast !== null
    || usedPercent >= USAGE_ACTION_THRESHOLD_PERCENT;
  const shouldResolveSubscriptionAction =
    includeSubscriptionActionQuote
    || (
      shouldRecommendAction
      && (
        accessKind === "trial"
        || (
          accessKind === "paid"
          && decision.billingPlanCode === "launch_group_monthly"
        )
      )
      && actionUrl !== null
    );
  const shouldResolvePersonalUsageCreditOffers =
    shouldRecommendAction
    && accessKind === "paid"
    && decision.billingPlanCode !== "launch_group_monthly";
  const [availableSubscriptionOffer, personalUsageCreditOfferCodes] =
    await Promise.all([
      shouldResolveSubscriptionAction
        ? resolveAvailableSubscriptionOffer({
            accessKind,
            memberId: input.memberId,
            now,
            planCode: decision.billingPlanCode,
            prisma,
            requestedTargetPlanCode:
              input.subscriptionActionTargetPlanCode,
            trialTiming: exhausted ? "now" : "at_trial_end",
          })
        : Promise.resolve(EMPTY_SUBSCRIPTION_OFFER),
      shouldResolvePersonalUsageCreditOffers
        ? readHostedPersonalUsageCreditOfferCodes({
            memberId: input.memberId,
            prisma,
          }).catch((error: unknown) => {
            console.warn(
              "Hosted personal usage-credit eligibility resolution failed.",
              sanitizeHostedOnboardingStructuredLogDetails({
                errorName: error instanceof Error ? error.name : "UnknownError",
                planCode: decision.billingPlanCode,
              }),
            );
            return [];
          })
        : Promise.resolve([]),
    ]);

  return {
    accessKind,
    ...projectSubscriptionOffer(availableSubscriptionOffer),
    forecast,
    generatedAt,
    periodEnd: decision.periodEnd.toISOString(),
    periodKind: accessKind === "trial" ? "trial" : "monthly",
    periodStart: decision.periodStart.toISOString(),
    planCode: decision.billingPlanCode,
    planName,
    recommendedAction: shouldRecommendAction
      ? accessKind === "trial"
        ? buildRecommendedAction({
            action: availableSubscriptionOffer.quote,
            actionUrl,
          })
        : decision.billingPlanCode === "launch_group_monthly"
          ? buildRecommendedAction({
              action: availableSubscriptionOffer.quote,
              actionUrl,
            })
          : personalUsageCreditOfferCodes.length > 0
            ? buildAddUsageRecommendedAction()
            : null
      : null,
    ...projectSubscriptionActionQuoteExpansion({
      include: includeSubscriptionActionQuote,
      quote: availableSubscriptionOffer.quote,
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

interface HostedResolvedSubscriptionOffer {
  availablePlans?: HostedPlanUsageAvailableStatus["availablePlans"];
  quote: HostedPlanUsageSubscriptionActionQuote | null;
  recommendedPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly";
}

const EMPTY_SUBSCRIPTION_OFFER: HostedResolvedSubscriptionOffer = {
  quote: null,
};

async function resolveAvailableSubscriptionOffer(input: {
  accessKind: HostedPlanUsageAvailableStatus["accessKind"];
  memberId: string;
  now: Date;
  planCode: HostedPlanUsageAvailableStatus["planCode"];
  prisma: HostedPlanUsageClient;
  requestedTargetPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly";
  trialTiming?: "at_trial_end" | "now";
}): Promise<HostedResolvedSubscriptionOffer> {
  if (input.accessKind === "family_sponsored") {
    return EMPTY_SUBSCRIPTION_OFFER;
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
    return EMPTY_SUBSCRIPTION_OFFER;
  }

  const [member, billingState] = actionState;
  if (!member || !billingState) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }

  if (input.accessKind === "trial") {
    if (!canStartHostedPulseTrialPaidPlan({
        billingStatus: member.billingStatus,
        currentBillingPhase: billingState.currentBillingPhase,
        currentBillingPlanCode: billingState.currentBillingPlanCode,
        currentCheckoutOffer: billingState.currentCheckoutOffer,
        hasStripeCustomerId: billingState.hasStripeCustomerId,
        hasStripeSubscriptionId: billingState.hasStripeSubscriptionId,
        suspendedAt: member.suspendedAt,
    })) {
      return EMPTY_SUBSCRIPTION_OFFER;
    }
    const hasConfirmedGroupMembership =
      await hasConfirmedHostedGroupMembership({
        memberId: input.memberId,
        prisma: input.prisma,
      });
    const trialOffer = resolveHostedTrialContinuationOffer({
      groupPlanConfigured:
        getHostedOnboardingEnvironment()
          .stripePriceIdsByPlan.launch_group_monthly !== null,
      hasConfirmedGroupMembership,
    });
    const targetPlanCode =
      input.requestedTargetPlanCode
      ?? trialOffer.recommendedPlanCode;
    if (
      targetPlanCode !== "launch_group_monthly"
      && targetPlanCode !== "launch_monthly"
    ) {
      return EMPTY_SUBSCRIPTION_OFFER;
    }
    if (!trialOffer.availablePlanCodes.includes(targetPlanCode)) {
      return EMPTY_SUBSCRIPTION_OFFER;
    }
    return {
      availablePlans: trialOffer.availablePlanCodes.map((planCode) => {
        const definition = getHostedBillingPlanDefinition(planCode);
        return {
          code: planCode,
          displayName:
            planCode === "launch_group_monthly" ? "Group" : "Pulse",
          monthlyPriceUsdCents: definition.recurringAmountUsdCents,
          selectable: true as const,
        };
      }),
      quote: buildSubscriptionActionQuote({
        memberId: input.memberId,
        now: input.now,
        state: buildHostedBillingPlanQuoteState({
          billingState,
          billingStatus: member.billingStatus,
        }),
        targetPlanCode,
        timing: input.trialTiming ?? "now",
      }),
      recommendedPlanCode: trialOffer.recommendedPlanCode,
    };
  }

  const hasOwnActiveBilling = hasHostedMemberOwnActiveBilling(member);
  const targetPlanCode = input.requestedTargetPlanCode
    ?? (
      input.planCode === "launch_group_monthly"
        ? "launch_monthly"
        : input.planCode === "launch_monthly"
          ? "launch_edge_monthly"
          : null
    );
  if (!targetPlanCode || targetPlanCode === input.planCode) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }
  if (
    targetPlanCode === "launch_group_monthly"
    && !(await hasConfirmedHostedGroupMembership({
      memberId: input.memberId,
      prisma: input.prisma,
    }))
  ) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }
  const canUpgrade = hasOwnActiveBilling
    && billingState.hasStripeCustomerId
    && billingState.hasStripeSubscriptionId
    && canUpgradeHostedBillingPlan({
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
      targetPlanCode,
    });
  const canSchedule = hasOwnActiveBilling
    && billingState.hasStripeCustomerId
    && billingState.hasStripeSubscriptionId
    && canScheduleHostedBillingPlanChange({
      billingStatus: member.billingStatus,
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
      stripeCustomerId: billingState.hasStripeCustomerId
        ? "configured"
        : null,
      stripeSubscriptionId: billingState.hasStripeSubscriptionId
        ? "configured"
        : null,
      suspendedAt: member.suspendedAt,
      targetPlanCode,
    });
  const timing = canUpgrade
    ? "immediate" as const
    : canSchedule
      ? "period_end" as const
      : null;
  return {
    quote: timing
      ? buildSubscriptionActionQuote({
        memberId: input.memberId,
        now: input.now,
        state: buildHostedBillingPlanQuoteState({
          billingState,
          billingStatus: member.billingStatus,
        }),
        targetPlanCode,
        timing,
      })
      : null,
  };
}

function buildSubscriptionActionQuote(input: {
  memberId: string;
  now: Date;
  state: ReturnType<typeof buildHostedBillingPlanQuoteState>;
  targetPlanCode:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly";
  timing: "at_trial_end" | "immediate" | "now" | "period_end";
}): HostedPlanUsageSubscriptionActionQuote {
  return createHostedBillingPlanQuote(input);
}

function buildRecommendedAction(input: {
  action: HostedPlanUsageSubscriptionActionQuote | null;
  actionUrl: string | null;
}): HostedPlanUsageRecommendedAction | null {
  if (!input.action || !input.actionUrl) {
    return null;
  }
  return {
    kind: "change_plan",
    label: input.action.label,
    targetPlanCode: input.action.targetPlanCode,
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

function projectSubscriptionOffer(
  offer: HostedResolvedSubscriptionOffer,
): Pick<
  HostedPlanUsageAvailableStatus,
  "availablePlans" | "recommendedPlanCode"
> {
  return {
    ...(offer.availablePlans
      ? { availablePlans: offer.availablePlans }
      : {}),
    ...(offer.recommendedPlanCode
      ? { recommendedPlanCode: offer.recommendedPlanCode }
      : {}),
  };
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
