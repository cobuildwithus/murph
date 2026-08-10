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
  isHostedBillingPlanChangePortalConfigured,
  parseHostedBillingPlanCode,
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
import {
  getHostedOnboardingEnvironment,
  isHostedBillingPlanSelectionAvailable,
} from "../hosted-onboarding/runtime";
import {
  readHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "./usage-allowance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const USAGE_ACTION_THRESHOLD_PERCENT = 80;

type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;

export async function readHostedPersonalAiUsageStatus(input: {
  includeScheduledPlan?: boolean;
  includeSubscriptionActionQuote?: boolean;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
  subscriptionActionTargetPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly"
    | "launch_max_monthly";
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
    includeScheduledPlan: input.includeScheduledPlan === true,
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
  includeScheduledPlan?: boolean;
  includeSubscriptionActionQuote?: boolean;
  memberId: string;
  now?: Date | string;
  prisma?: HostedPlanUsageClient;
  publicBaseUrl?: string | null;
  subscriptionActionTargetPlanCode?:
    | "launch_group_monthly"
    | "launch_monthly"
    | "launch_edge_monthly"
    | "launch_max_monthly";
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

  const scheduledPlan =
    input.includeScheduledPlan === true
      ? projectHostedScheduledPlan(
          await readHostedMemberBillingEligibilityState({
            memberId: input.memberId,
            prisma,
          }),
        )
      : null;
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
      ...projectHostedScheduledPlanExpansion(scheduledPlan),
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
      ...projectHostedScheduledPlanExpansion(scheduledPlan),
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

  const exhausted = usageLimitExceeded;
  const meterWindow = exhausted
    ? {
        resetAt: null,
        spentUsdMicros: decision.spentUsdMicros,
      }
    : await readHostedUsageMeterWindow({
        beneficiaryMemberId: input.memberId,
        ledgerVersion: decision.usageCreditLedgerVersion,
        now,
        periodStart: decision.periodStart,
        planResetAt: decision.planResetAt,
        periodSpentUsdMicros: decision.spentUsdMicros,
        prisma,
      });
  // Admission still follows all effective capacity. The display meter starts a
  // fresh window after the latest fulfilled purchase so newly added usage reads
  // as unused until the beneficiary spends against it.
  const totalCapacityUsdMicros =
    meterWindow.spentUsdMicros + decision.remainingUsdMicros;
  const usedPercent = calculateUsedPercent({
    capacity: totalCapacityUsdMicros,
    exhausted,
    spent: meterWindow.spentUsdMicros,
  });
  const forecast = exhausted || meterWindow.spentUsdMicros <= 0n
    ? null
    : await buildUsageForecast({
        capacity: totalCapacityUsdMicros,
        memberId: input.memberId,
        now,
        observedAfter: meterWindow.resetAt,
        periodEnd: decision.periodEnd,
        periodStart: decision.periodStart,
        prisma,
        spent: meterWindow.spentUsdMicros,
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
      : decision.billingPlanCode === "launch_max_monthly"
        ? "Max"
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
  // Referral snapshots also project this status inside an interactive
  // transaction, whose adapter permits one query at a time.
  const availableSubscriptionOffer = shouldResolveSubscriptionAction
    ? await resolveAvailableSubscriptionOffer({
        accessKind,
        memberId: input.memberId,
        now,
        planCode: decision.billingPlanCode,
        prisma,
        requestedTargetPlanCode:
          input.subscriptionActionTargetPlanCode,
        trialTiming: "at_trial_end",
      })
    : EMPTY_SUBSCRIPTION_OFFER;
  const personalUsageCreditOfferCodes = shouldResolvePersonalUsageCreditOffers
    ? await readHostedPersonalUsageCreditOfferCodes({
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
    : [];

  return {
    accessKind,
    ...projectSubscriptionOffer(availableSubscriptionOffer),
    ...projectHostedScheduledPlanExpansion(scheduledPlan),
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
  capacity: bigint;
  exhausted: boolean;
  spent: bigint;
}): number {
  if (input.exhausted) {
    return 100;
  }
  if (input.spent <= 0n) {
    return 0;
  }

  const floored = Number((input.spent * 100n) / input.capacity);
  return Math.min(99, Math.max(1, floored));
}

async function readHostedUsageMeterWindow(input: {
  beneficiaryMemberId: string;
  ledgerVersion: bigint;
  now: Date;
  periodStart: Date;
  planResetAt: Date | null;
  periodSpentUsdMicros: bigint;
  prisma: HostedPlanUsageClient;
}): Promise<{
  resetAt: Date | null;
  spentUsdMicros: bigint;
}> {
  if (input.ledgerVersion <= 0n || input.periodSpentUsdMicros <= 0n) {
    return {
      resetAt: input.planResetAt,
      spentUsdMicros: input.periodSpentUsdMicros,
    };
  }

  const latestPurchaseGrant =
    await input.prisma.hostedUsageCreditEntry.findFirst({
      orderBy: {
        beneficiarySequence: "desc",
      },
      select: {
        effectiveAt: true,
      },
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        beneficiarySequence: {
          lte: input.ledgerVersion,
        },
        effectiveAt: {
          gte: input.periodStart,
          lte: input.now,
        },
        kind: "purchase_grant",
      },
    });
  if (!latestPurchaseGrant) {
    return {
      resetAt: input.planResetAt,
      spentUsdMicros: input.periodSpentUsdMicros,
    };
  }

  const resetAt = input.planResetAt
      && input.planResetAt.getTime() > latestPurchaseGrant.effectiveAt.getTime()
    ? input.planResetAt
    : latestPurchaseGrant.effectiveAt;

  const usageSincePurchase = await input.prisma.hostedAiUsage.aggregate({
    _sum: {
      allowanceCostUsdMicros: true,
    },
    where: {
      allowanceCostUsdMicros: {
        gt: 0n,
      },
      allowanceCounted: true,
      allowancePeriodStart: input.periodStart,
      memberId: input.beneficiaryMemberId,
      occurredAt: {
        gt: resetAt,
        lte: input.now,
      },
    },
  });
  const observedSpend =
    usageSincePurchase._sum.allowanceCostUsdMicros ?? 0n;
  const boundedSpend = observedSpend < 0n
    ? 0n
    : observedSpend > input.periodSpentUsdMicros
      ? input.periodSpentUsdMicros
      : observedSpend;

  return {
    resetAt,
    spentUsdMicros: boundedSpend,
  };
}

async function buildUsageForecast(input: {
  capacity: bigint;
  memberId: string;
  now: Date;
  observedAfter: Date | null;
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
      ...(input.observedAfter
        ? {
            occurredAt: {
              gt: input.observedAfter,
            },
          }
        : {}),
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

  const projectedDurationMs =
    (BigInt(elapsedMs) * input.capacity) / input.spent;
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
    | "launch_edge_monthly"
    | "launch_max_monthly";
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
    | "launch_edge_monthly"
    | "launch_max_monthly";
  trialTiming?: "at_trial_end" | "now";
}): Promise<HostedResolvedSubscriptionOffer> {
  if (input.accessKind === "family_sponsored") {
    return EMPTY_SUBSCRIPTION_OFFER;
  }

  let actionState;
  try {
    const member = await readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    const billingState = await readHostedMemberBillingEligibilityState({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    actionState = [member, billingState] as const;
  } catch (error) {
    console.warn(
      "Hosted plan usage action resolution failed.",
      sanitizeHostedOnboardingStructuredLogDetails({
        accessKind: input.accessKind,
        errorName: error instanceof Error ? error.name : "UnknownError",
        planCode: input.planCode,
      }),
    );
    return EMPTY_SUBSCRIPTION_OFFER;
  }

  const [member, billingState] = actionState;
  if (!member || !billingState) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }

  if (
    parseHostedBillingPlanCode(billingState.scheduledBillingPlanCode) !== null
  ) {
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
    const groupPlanAvailable =
      hasConfirmedGroupMembership
      && getHostedOnboardingEnvironment()
        .stripePriceIdsByPlan.launch_group_monthly !== null
      && await isHostedBillingPlanSelectionAvailable({
        billingPlanCode: "launch_group_monthly",
      });
    const trialOffer = resolveHostedTrialContinuationOffer({
      groupPlanConfigured: groupPlanAvailable,
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
    if (
      targetPlanCode !== "launch_group_monthly"
      && !await isHostedBillingPlanSelectionAvailable({
        billingPlanCode: targetPlanCode,
      })
    ) {
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
      quote: createHostedBillingPlanQuote({
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
    targetPlanCode === "launch_max_monthly"
    && !isHostedBillingPlanChangePortalConfigured(targetPlanCode)
  ) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }
  if (
    targetPlanCode === "launch_group_monthly"
    && (
      !(await hasConfirmedHostedGroupMembership({
        memberId: input.memberId,
        prisma: input.prisma,
      }))
      || !await isHostedBillingPlanSelectionAvailable({
        billingPlanCode: targetPlanCode,
      })
    )
  ) {
    return EMPTY_SUBSCRIPTION_OFFER;
  }
  if (
    targetPlanCode !== "launch_group_monthly"
    && !await isHostedBillingPlanSelectionAvailable({
      billingPlanCode: targetPlanCode,
    })
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
      stripeCustomerId: "configured",
      stripeSubscriptionId: "configured",
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
      ? createHostedBillingPlanQuote({
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

type HostedProjectedScheduledPlan = NonNullable<
  HostedPlanUsageAvailableStatus["scheduledPlan"]
>;

function projectHostedScheduledPlan(
  billingState: Awaited<
    ReturnType<typeof readHostedMemberBillingEligibilityState>
  >,
): HostedProjectedScheduledPlan | null {
  const planCode = parseHostedBillingPlanCode(
    billingState?.scheduledBillingPlanCode,
  );
  if (!planCode) {
    return null;
  }

  return {
    code: planCode,
    displayName:
      planCode === "launch_group_monthly"
        ? "Group"
        : planCode === "launch_edge_monthly"
          ? "Edge"
          : planCode === "launch_max_monthly"
            ? "Max"
            : "Pulse",
    effectiveAt:
      billingState?.scheduledBillingEffectiveAt?.toISOString() ?? null,
  };
}

function projectHostedScheduledPlanExpansion(
  scheduledPlan: HostedProjectedScheduledPlan | null,
): { scheduledPlan?: HostedProjectedScheduledPlan } {
  return scheduledPlan ? { scheduledPlan } : {};
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
