import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HOSTED_ADD_USAGE_SETTINGS_URL,
  HOSTED_PLAN_USAGE_TOP_UP_HISTORY_MAX_ROWS,
  type HostedPlanUsageAvailableStatus,
  type HostedPlanUsageRecommendedAction,
  type HostedPlanUsageStatus,
  type HostedPlanUsageSubscriptionActionQuote,
  type HostedPlanUsageTopUpHistory,
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
  readHostedMemberBillingEligibilityState,
} from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { sanitizeHostedOnboardingStructuredLogDetails } from "../hosted-onboarding/logging";
import { readHostedPersonalUsageCreditOfferCodes } from "../hosted-onboarding/personal-usage-credit-eligibility";
import {
  readHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "./usage-allowance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const USAGE_ACTION_THRESHOLD_PERCENT = 80;
const USD_MICROS_PER_USD = 1_000_000n;

type HostedPlanUsageClient = PrismaClient | Prisma.TransactionClient;

export async function readHostedPersonalAiUsageStatus(input: {
  includeSubscriptionActionQuote?: boolean;
  includeTopUpHistory?: boolean;
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

  const status = await projectHostedPersonalAiUsageStatus({
    decision,
    includeSubscriptionActionQuote:
      input.includeSubscriptionActionQuote === true,
    memberId: input.memberId,
    now,
    prisma,
    publicBaseUrl: input.publicBaseUrl,
  });
  if (
    input.includeTopUpHistory !== true
    || (
      status.status === "unavailable"
      && status.reason === "group_not_supported"
    )
  ) {
    return status;
  }

  return {
    ...status,
    topUpHistory: await readHostedPlanUsageTopUpHistory({
      memberId: input.memberId,
      prisma,
    }),
  };
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
      ? await resolveAvailableSubscriptionAction({
          accessKind: "trial",
          memberId: input.memberId,
          planCode: decision.billingPlanCode,
          prisma,
        })
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

  const exhausted = usageLimitExceeded;
  // The bar follows the same effective-capacity boundary as admission: usage
  // already spent plus every unit of included allowance or generic usage credit
  // still available.
  const totalCapacityUsdMicros =
    decision.spentUsdMicros + decision.remainingUsdMicros;
  const usedPercent = calculateUsedPercent({
    capacity: totalCapacityUsdMicros,
    exhausted,
    spent: decision.spentUsdMicros,
  });
  const forecast = exhausted || decision.spentUsdMicros <= 0n
    ? null
    : await buildUsageForecast({
        capacity: totalCapacityUsdMicros,
        memberId: input.memberId,
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
  const shouldResolveSubscriptionAction =
    includeSubscriptionActionQuote
    || (
      shouldRecommendAction
      && accessKind === "trial"
      && actionUrl !== null
    );
  const shouldResolvePersonalUsageCreditOffers =
    shouldRecommendAction && accessKind === "paid";
  // Referral snapshots also project this status inside an interactive
  // transaction, whose adapter permits one query at a time.
  const availableSubscriptionAction = shouldResolveSubscriptionAction
    ? await resolveAvailableSubscriptionAction({
        accessKind,
        memberId: input.memberId,
        planCode: decision.billingPlanCode,
        prisma,
      })
    : null;
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
    forecast,
    generatedAt,
    periodEnd: decision.periodEnd.toISOString(),
    periodKind: accessKind === "trial" ? "trial" : "monthly",
    periodStart: decision.periodStart.toISOString(),
    planCode: decision.billingPlanCode,
    planName,
    recommendedAction: shouldRecommendAction
      ? accessKind === "paid"
        ? personalUsageCreditOfferCodes.length > 0
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

async function readHostedPlanUsageTopUpHistory(input: {
  memberId: string;
  prisma: HostedPlanUsageClient;
}): Promise<HostedPlanUsageTopUpHistory> {
  const where = {
    beneficiaryMemberId: input.memberId,
    kind: "purchase_grant" as const,
  };
  const entries = await input.prisma.hostedUsageCreditEntry.findMany({
    orderBy: [
      { beneficiarySequence: "desc" },
      { id: "desc" },
    ],
    select: {
      amountUsdMicros: true,
      effectiveAt: true,
      grant: {
        select: {
          remainingUsdMicros: true,
        },
      },
      id: true,
      purchase: {
        select: {
          payerMemberId: true,
        },
      },
    },
    take: HOSTED_PLAN_USAGE_TOP_UP_HISTORY_MAX_ROWS,
    where,
  });
  const totalCount = await input.prisma.hostedUsageCreditEntry.count({ where });
  const entryIds = entries.map((entry) => entry.id);
  const debitRows = entryIds.length > 0
    ? await input.prisma.hostedUsageCreditEntry.groupBy({
        _sum: {
          amountUsdMicros: true,
        },
        by: ["parentGrantEntryId"],
        where: {
          kind: "usage_debit",
          parentGrantEntryId: {
            in: entryIds,
          },
        },
      })
    : [];
  const usedByGrantEntryId = new Map<string, bigint>();
  for (const debitRow of debitRows) {
    if (debitRow.parentGrantEntryId === null) {
      throw new TypeError("Hosted top-up usage debit is missing its grant.");
    }
    const signedAmountUsdMicros = debitRow._sum.amountUsdMicros ?? 0n;
    if (signedAmountUsdMicros > 0n) {
      throw new TypeError("Hosted top-up usage debit has an invalid amount.");
    }
    usedByGrantEntryId.set(
      debitRow.parentGrantEntryId,
      -signedAmountUsdMicros,
    );
  }

  return {
    hasMore: totalCount > entries.length,
    topUps: entries.map((entry) => {
      if (!entry.grant || !entry.purchase) {
        throw new TypeError("Hosted purchase grant projection is incomplete.");
      }
      const usedUsdMicros = usedByGrantEntryId.get(entry.id) ?? 0n;
      const adjustedUsdMicros =
        entry.amountUsdMicros
        - entry.grant.remainingUsdMicros
        - usedUsdMicros;
      if (
        entry.amountUsdMicros <= 0n
        || entry.grant.remainingUsdMicros < 0n
        || usedUsdMicros < 0n
        || adjustedUsdMicros < 0n
      ) {
        throw new TypeError("Hosted purchase grant amounts are inconsistent.");
      }

      return {
        addedUsd: formatHostedPlanUsageUsdMicros(entry.amountUsdMicros),
        adjustedUsd: formatHostedPlanUsageUsdMicros(adjustedUsdMicros),
        creditedAt: entry.effectiveAt.toISOString(),
        remainingUsd: formatHostedPlanUsageUsdMicros(
          entry.grant.remainingUsdMicros,
        ),
        source: entry.purchase.payerMemberId === input.memberId
          ? "purchased_by_you" as const
          : "added_for_you" as const,
        usedUsd: formatHostedPlanUsageUsdMicros(usedUsdMicros),
      };
    }),
    totalCount,
  };
}

function formatHostedPlanUsageUsdMicros(value: bigint): string {
  if (value < 0n) {
    throw new TypeError("Hosted plan usage USD amount cannot be negative.");
  }
  const dollars = value / USD_MICROS_PER_USD;
  const micros = value % USD_MICROS_PER_USD;
  return `${dollars}.${micros.toString().padStart(6, "0")}`;
}

async function buildUsageForecast(input: {
  capacity: bigint;
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

async function resolveAvailableSubscriptionAction(input: {
  accessKind: HostedPlanUsageAvailableStatus["accessKind"];
  memberId: string;
  planCode: HostedPlanUsageAvailableStatus["planCode"];
  prisma: HostedPlanUsageClient;
}): Promise<HostedPlanUsageSubscriptionActionQuote | null> {
  if (input.accessKind === "family_sponsored") {
    return null;
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
      ? buildSubscriptionActionQuote("start_pulse_now")
      : null;
  }

  const hasOwnActiveBilling = hasHostedMemberOwnActiveBilling(member);
  const canUpgradeToEdge = input.planCode === "launch_monthly"
    && hasOwnActiveBilling
    && billingState.hasStripeCustomerId
    && billingState.hasStripeSubscriptionId
    && canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: billingState.currentBillingPhase,
      currentBillingPlanCode: billingState.currentBillingPlanCode,
      currentCheckoutOffer: billingState.currentCheckoutOffer,
    });

  return canUpgradeToEdge
    ? buildSubscriptionActionQuote("upgrade_edge")
    : null;
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
