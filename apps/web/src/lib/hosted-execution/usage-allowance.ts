import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  AssistantUsageCredentialSource,
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  normalizeHostedAiUsageAllowancePricedModelId,
  type HostedAiUsageAllowancePricedModel,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedDefaultBillingPlanCode,
  parseHostedBillingPlanCode,
  parseHostedBillingPhase,
  parseHostedBillingCheckoutOffer,
  requireHostedPulseTrialPolicy,
  type HostedBillingPlanCode,
} from "../hosted-onboarding/billing-plans";
import { getPrisma } from "../prisma";

type HostedAiUsageAllowanceClient = PrismaClient | Prisma.TransactionClient;

export type HostedAiUsageGateDeniedReason =
  | "ai_usage_limit_exceeded"
  | "hosted_access_inactive"
  | "trial_expired_pending_billing";

export type HostedAiUsageGateNoticeCode =
  | "edge_usage_limit_reached"
  | "pulse_upgrade_edge"
  | "trial_usage_limit_reached"
  | "trial_conversion_pending";

export type HostedAiUsageGateDecision =
  | {
    allowed: true;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    remainingUsdMicros: bigint;
    spentUsdMicros: bigint;
  }
  | {
    allowed: false;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    reason: HostedAiUsageGateDeniedReason;
    remainingUsdMicros: bigint;
    retryAfter: Date;
    spentUsdMicros: bigint;
    userNotice: HostedAiUsageGateUserNotice | null;
  };

export interface HostedAiUsageGateUserNotice {
  code: HostedAiUsageGateNoticeCode;
  message: string;
}

export interface HostedAiUsageAllowancePricingResult {
  costUsdMicros: bigint;
  counted: boolean;
  pricingSnapshot: Prisma.InputJsonObject;
  pricingVersion: string;
}

type HostedAiUsageAllowancePricingModelSource =
  | "requested"
  | "served";

interface HostedAiUsageAllowancePricingModelResolution {
  model: HostedAiUsageAllowancePricedModel | null;
  requestedModel: string | null;
  servedModel: string | null;
  source: HostedAiUsageAllowancePricingModelSource | null;
}

interface HostedAiUsageAllowancePeriod {
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
}

type HostedAiUsageAllowancePeriodResult =
  | ({ kind: "period" } & HostedAiUsageAllowancePeriod)
  | ({
    kind: "denied";
    spentUsdMicros: bigint;
  } & Extract<HostedAiUsageAllowancePeriodResolution, { kind: "denied" }>);

type HostedAiUsageAllowancePeriodResolution =
  | ({
    kind: "period";
    source: "billing" | "calendar" | "trial";
  } & Omit<HostedAiUsageAllowancePeriod, "spentUsdMicros">)
  | {
    billingPlanCode: HostedBillingPlanCode;
    kind: "denied";
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    reason: "trial_expired_pending_billing";
    retryAfter: Date;
    userNotice: HostedAiUsageGateUserNotice;
  };

interface HostedAiUsageAllowanceBillingRef {
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  pulseTrialPolicyVersion: string | null;
  pulseTrialRedeemedAt: Date | null;
}

const HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION = "openai-api-pricing-2026-05-05-standard";
const HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE =
  "https://openai.com/api/pricing/";
const HOSTED_AI_USAGE_HOME_URL = "https://withmurph.ai/home";
const TOKENS_PER_PRICING_UNIT = 1_000_000n;

const HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES = {
  "gpt-5.4-mini": {
    cachedInputUsdMicrosPerMillionTokens: 75_000n,
    inputUsdMicrosPerMillionTokens: 750_000n,
    outputUsdMicrosPerMillionTokens: 4_500_000n,
  },
  "gpt-5.5": {
    cachedInputUsdMicrosPerMillionTokens: 500_000n,
    inputUsdMicrosPerMillionTokens: 5_000_000n,
    outputUsdMicrosPerMillionTokens: 30_000_000n,
  },
} as const satisfies Record<
  HostedAiUsageAllowancePricedModel,
  {
    cachedInputUsdMicrosPerMillionTokens: bigint;
    inputUsdMicrosPerMillionTokens: bigint;
    outputUsdMicrosPerMillionTokens: bigint;
  }
>;

export function priceHostedAiUsageForAllowance(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingResult {
  const credentialSource = normalizeAssistantUsageCredentialSource(record.credentialSource);
  const counted = credentialSource !== "member";
  const modelResolution = resolveHostedAiUsageAllowancePricingModel(record);
  const tokenSnapshot = buildHostedAiUsageAllowanceTokenSnapshot(record);

  if (!counted) {
    return {
      costUsdMicros: 0n,
      counted: false,
      pricingSnapshot: {
        credentialSource,
        ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution),
        pricingSource: HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        tokens: tokenSnapshot,
      },
      pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
    };
  }

  const model = modelResolution.model;
  if (!model) {
    throw new TypeError("Hosted AI usage allowance pricing is missing for the model.");
  }

  const prices = HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES[model];
  const cachedInputTokens = normalizeTokenCount(record.cachedInputTokens);
  const inputTokens = normalizeTokenCount(record.inputTokens);
  const outputTokens = normalizeTokenCount(record.outputTokens);
  const billableInputTokens = inputTokens > cachedInputTokens
    ? inputTokens - cachedInputTokens
    : 0n;
  const costUsdMicros =
    priceTokenBucketUsdMicros(
      billableInputTokens,
      prices.inputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      cachedInputTokens,
      prices.cachedInputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      outputTokens,
      prices.outputUsdMicrosPerMillionTokens,
    );

  return {
    costUsdMicros,
    counted: true,
    pricingSnapshot: {
      credentialSource,
      ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution),
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
      ratesUsdMicrosPerMillionTokens: {
        cachedInput: prices.cachedInputUsdMicrosPerMillionTokens.toString(),
        input: prices.inputUsdMicrosPerMillionTokens.toString(),
        output: prices.outputUsdMicrosPerMillionTokens.toString(),
      },
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      tokens: {
        ...tokenSnapshot,
        billableInput: billableInputTokens.toString(),
      },
    },
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
  };
}

export async function accountHostedAiUsageForAllowanceTx(input: {
  memberId: string;
  now?: Date;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const now = input.now ?? new Date();
  const period = await ensureHostedAiUsageAllowancePeriodTx({
    at: normalizeHostedAiUsageAllowanceDate(input.record.occurredAt),
    memberId: input.memberId,
    now,
    tx: input.tx,
  });
  if (period.kind === "denied") {
    await markHostedAiUsageAllowanceDeniedTx({
      memberId: input.memberId,
      now,
      period,
      record: input.record,
      tx: input.tx,
    });
    return;
  }

  const priced = priceHostedAiUsageForAllowance(input.record);

  const accounted = await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: now,
      allowanceCostUsdMicros: priced.costUsdMicros,
      allowanceCounted: priced.counted,
      allowancePeriodEnd: period.periodEnd,
      allowancePeriodStart: period.periodStart,
      allowancePricingSnapshotJson: priced.pricingSnapshot,
      allowancePricingVersion: priced.pricingVersion,
    },
  });

  if (accounted.count !== 1 || !priced.counted) {
    return;
  }

  await incrementHostedAiUsageAllowancePeriodSpendTx({
    deltaUsdMicros: priced.costUsdMicros,
    memberId: input.memberId,
    now,
    periodStart: period.periodStart,
    usageAt: normalizeHostedAiUsageAllowanceDate(input.record.occurredAt),
    tx: input.tx,
  });
}

async function markHostedAiUsageAllowanceDeniedTx(input: {
  memberId: string;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "denied" }>;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: input.now,
      allowanceCostUsdMicros: 0n,
      allowanceCounted: false,
      allowancePeriodEnd: input.period.periodEnd,
      allowancePeriodStart: input.period.periodStart,
      allowancePricingSnapshotJson: {
        credentialSource: normalizeAssistantUsageCredentialSource(input.record.credentialSource),
        reason: input.period.reason,
        requestedModel: input.record.requestedModel ?? null,
        schema: "murph.hosted-ai-usage-allowance-denied.v1",
        servedModel: input.record.servedModel ?? null,
      },
      allowancePricingVersion: "hosted-ai-usage-allowance-denied-2026-05-05",
    },
  });
}

export async function resolveHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecision> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());

  return runHostedAiUsageAllowanceTransaction(prisma, async (tx) => {
    const memberState = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
            currentCheckoutOffer: true,
            currentPeriodEnd: true,
            currentPeriodStart: true,
            currentTrialEndsAt: true,
            currentTrialStartedAt: true,
            pulseTrialPolicyVersion: true,
            pulseTrialRedeemedAt: true,
          },
        },
        billingStatus: true,
        suspendedAt: true,
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }

    if (
      memberState.billingStatus !== HostedBillingStatus.active ||
      memberState.suspendedAt !== null
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: memberState.billingRef,
        memberId: input.memberId,
      });
    }

    const period = await ensureHostedAiUsageAllowancePeriodTx({
      at: now,
      memberId: input.memberId,
      now,
      tx,
    });
    if (period.kind === "denied") {
      return buildHostedAiUsageGateDecision({
        memberId: input.memberId,
        period,
      });
    }

    return buildHostedAiUsageGateDecision({
      memberId: input.memberId,
      period,
    });
  });
}

export async function readHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecision> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());

  return runHostedAiUsageAllowanceTransaction(prisma, async (tx) => {
    const memberState = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
            currentCheckoutOffer: true,
            currentPeriodEnd: true,
            currentPeriodStart: true,
            currentTrialEndsAt: true,
            currentTrialStartedAt: true,
            pulseTrialPolicyVersion: true,
            pulseTrialRedeemedAt: true,
          },
        },
        billingStatus: true,
        suspendedAt: true,
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }

    if (
      memberState.billingStatus !== HostedBillingStatus.active ||
      memberState.suspendedAt !== null
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: memberState.billingRef,
        memberId: input.memberId,
      });
    }

    const period = await readHostedAiUsageAllowancePeriodTx({
      at: now,
      billingRef: memberState.billingRef,
      memberId: input.memberId,
      tx,
    });

    return buildHostedAiUsageGateDecision({
      memberId: input.memberId,
      period,
    });
  });
}

// Read-first gate for hot-path checks: serve allow decisions from the
// write-free read gate and only run the mutating period-bookkeeping
// transaction when the read decision would block AI work, so steady-state
// gate checks stay off the usage-period upsert/lock path. Denials are always
// confirmed by the mutating gate before callers act on them. The read path
// includes write-free billing carryover spend, but it still cannot materialize
// period rows or plan-change limit updates. The guaranteed mutating resolve on
// the reply path is turn admission (runtime reconciliation facts); spend
// accounting also ensure-creates the period inside the spend transaction as
// the backstop.
export async function checkHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecision> {
  const decision = await readHostedAiUsageGate(input);
  if (decision.allowed) {
    return decision;
  }

  return resolveHostedAiUsageGate(input);
}

export async function claimHostedAiUsageLimitNotice(input: {
  memberId: string;
  periodStart: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
  sentAt?: Date | string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const periodStart = normalizeHostedAiUsageAllowanceDate(input.periodStart);
  const sentAt = normalizeHostedAiUsageAllowanceDate(input.sentAt ?? new Date());

  const claimed = await prisma.hostedAiUsagePeriod.updateMany({
    where: {
      limitNoticeSentAt: null,
      memberId: input.memberId,
      periodStart,
    },
    data: {
      limitNoticeSentAt: sentAt,
    },
  });

  return claimed.count === 1;
}

function resolveHostedAiUsageInactiveGateDecision(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
}): HostedAiUsageGateDecision {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
  });
  const period = resolved.kind === "denied"
    ? resolved
    : {
        billingPlanCode: resolved.billingPlanCode,
        limitUsdMicros: resolved.limitUsdMicros,
        periodEnd: resolved.periodEnd,
        periodStart: resolved.periodStart,
      };
  const retryAfter = period.periodEnd.getTime() > input.at.getTime()
    ? period.periodEnd
    : new Date(input.at.getTime() + 15 * 60_000);

  return {
    allowed: false,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    reason: "hosted_access_inactive",
    remainingUsdMicros: period.limitUsdMicros,
    retryAfter,
    spentUsdMicros: 0n,
    userNotice: null,
  };
}

function buildHostedAiUsageGateDecision(input: {
  memberId: string;
  period: HostedAiUsageAllowancePeriodResult;
}): HostedAiUsageGateDecision {
  const period = input.period;
  if (period.kind === "denied") {
    return {
      allowed: false,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      reason: period.reason,
      remainingUsdMicros: 0n,
      retryAfter: period.retryAfter,
      spentUsdMicros: period.spentUsdMicros,
      userNotice: period.userNotice,
    };
  }

  const remainingUsdMicros = period.limitUsdMicros > period.spentUsdMicros
    ? period.limitUsdMicros - period.spentUsdMicros
    : 0n;

  if (period.spentUsdMicros >= period.limitUsdMicros) {
    return {
      allowed: false,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros,
      retryAfter: period.periodEnd,
      spentUsdMicros: period.spentUsdMicros,
      userNotice: buildHostedAiUsageGateLimitNotice({
        billingPlanCode: period.billingPlanCode,
        limitUsdMicros: period.limitUsdMicros,
      }),
    };
  }

  return {
    allowed: true,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    remainingUsdMicros,
    spentUsdMicros: period.spentUsdMicros,
  };
}

async function ensureHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowancePeriodResult> {
  const member = await input.tx.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentBillingPlanCode: true,
          currentCheckoutOffer: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          currentTrialEndsAt: true,
          currentTrialStartedAt: true,
          pulseTrialPolicyVersion: true,
          pulseTrialRedeemedAt: true,
        },
      },
      id: true,
    },
  });

  if (!member) {
    throw new TypeError("Hosted AI usage allowance member does not exist.");
  }

  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: member.billingRef,
  });
  if (resolved.kind === "denied") {
    return {
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
      userNotice: resolved.userNotice,
    };
  }

  await input.tx.hostedAiUsagePeriod.upsert({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    create: {
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      spentUsdMicros: 0n,
    },
    update: {},
    select: {
      billingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });
  await lockHostedAiUsageAllowancePeriodTx({
    memberId: input.memberId,
    periodStart: resolved.periodStart,
    tx: input.tx,
  });
  await carryOverHostedAiUsageFallbackPeriodTx({
    memberId: input.memberId,
    now: input.now,
    resolved,
    tx: input.tx,
  });

  const current = await input.tx.hostedAiUsagePeriod.findUniqueOrThrow({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    select: {
      billingPlanCode: true,
      blockedAt: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
    ?? resolved.billingPlanCode;
  const periodMatches =
    currentBillingPlanCode === resolved.billingPlanCode &&
    current.limitUsdMicros === resolved.limitUsdMicros &&
    current.periodEnd.getTime() === resolved.periodEnd.getTime();

  if (periodMatches) {
    return {
      kind: "period",
      billingPlanCode: currentBillingPlanCode,
      limitUsdMicros: current.limitUsdMicros,
      periodEnd: current.periodEnd,
      periodStart: current.periodStart,
      spentUsdMicros: current.spentUsdMicros,
    };
  }

  const limitIncreased = current.limitUsdMicros < resolved.limitUsdMicros;
  const upgraded = await input.tx.hostedAiUsagePeriod.update({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    data: {
      billingPlanCode: resolved.billingPlanCode,
      blockedAt: current.spentUsdMicros >= resolved.limitUsdMicros
        ? current.blockedAt ?? input.now
        : null,
      limitUsdMicros: resolved.limitUsdMicros,
      ...(limitIncreased ? { limitNoticeSentAt: null } : {}),
      periodEnd: resolved.periodEnd,
      updatedAt: input.now,
    },
    select: {
      billingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  return {
    kind: "period",
    billingPlanCode: parseHostedBillingPlanCode(upgraded.billingPlanCode)
      ?? resolved.billingPlanCode,
    limitUsdMicros: upgraded.limitUsdMicros,
    periodEnd: upgraded.periodEnd,
    periodStart: upgraded.periodStart,
    spentUsdMicros: upgraded.spentUsdMicros,
  };
}

async function readHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowancePeriodResult> {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
  });
  if (resolved.kind === "denied") {
    return {
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
      userNotice: resolved.userNotice,
    };
  }

  const carryoverSpentUsdMicros =
    await readHostedAiUsageAllowanceCarryoverSpendTx({
      memberId: input.memberId,
      resolved,
      tx: input.tx,
    });

  const current = await input.tx.hostedAiUsagePeriod.findUnique({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    select: {
      billingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  if (current) {
    const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
      ?? resolved.billingPlanCode;
    const periodMatches =
      currentBillingPlanCode === resolved.billingPlanCode &&
      current.limitUsdMicros === resolved.limitUsdMicros &&
      current.periodEnd.getTime() === resolved.periodEnd.getTime();

    return {
      kind: "period",
      billingPlanCode: periodMatches ? currentBillingPlanCode : resolved.billingPlanCode,
      limitUsdMicros: periodMatches ? current.limitUsdMicros : resolved.limitUsdMicros,
      periodEnd: periodMatches ? current.periodEnd : resolved.periodEnd,
      periodStart: periodMatches ? current.periodStart : resolved.periodStart,
      spentUsdMicros: current.spentUsdMicros + carryoverSpentUsdMicros,
    };
  }

  const periodSpentUsdMicros = await readHostedAiUsageAllowancePeriodSpendTx({
    memberId: input.memberId,
    periodStart: resolved.periodStart,
    tx: input.tx,
  });

  return {
    kind: "period",
    billingPlanCode: resolved.billingPlanCode,
    limitUsdMicros: resolved.limitUsdMicros,
    periodEnd: resolved.periodEnd,
    periodStart: resolved.periodStart,
    spentUsdMicros: periodSpentUsdMicros + carryoverSpentUsdMicros,
  };
}

async function readHostedAiUsageAllowancePeriodSpendTx(input: {
  memberId: string;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<bigint> {
  const aggregate = await input.tx.hostedAiUsage.aggregate({
    _sum: {
      allowanceCostUsdMicros: true,
    },
    where: {
      allowanceAccountedAt: {
        not: null,
      },
      allowanceCounted: true,
      allowancePeriodStart: input.periodStart,
      memberId: input.memberId,
    },
  });

  return aggregate._sum.allowanceCostUsdMicros ?? 0n;
}

async function readHostedAiUsageAllowanceCarryoverSpendTx(input: {
  memberId: string;
  resolved: {
    periodEnd: Date;
    periodStart: Date;
    source: "billing" | "calendar" | "trial";
  };
  tx: Prisma.TransactionClient;
}): Promise<bigint> {
  if (input.resolved.source !== "billing") {
    return 0n;
  }

  const aggregate = await input.tx.hostedAiUsage.aggregate({
    _sum: {
      allowanceCostUsdMicros: true,
    },
    where: {
      allowanceAccountedAt: {
        not: null,
      },
      allowanceCounted: true,
      AND: [
        {
          allowancePeriodStart: {
            not: null,
          },
        },
        {
          allowancePeriodStart: {
            not: input.resolved.periodStart,
          },
        },
      ],
      memberId: input.memberId,
      occurredAt: {
        gte: input.resolved.periodStart,
        lt: input.resolved.periodEnd,
      },
    },
  });

  return aggregate._sum.allowanceCostUsdMicros ?? 0n;
}

function resolveHostedAiUsageAllowancePeriod(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
}): HostedAiUsageAllowancePeriodResolution {
  const billingPlanCode =
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode)
    ?? getHostedDefaultBillingPlanCode();
  const billingPhase = parseHostedBillingPhase(input.billingRef?.currentBillingPhase);
  const checkoutOffer = parseHostedBillingCheckoutOffer(input.billingRef?.currentCheckoutOffer);

  if (
    billingPhase !== "paid" &&
    (checkoutOffer === HOSTED_PULSE_TRIAL_OFFER || billingPhase === "trial")
  ) {
    return resolveHostedPulseTrialAllowancePeriod({
      at: input.at,
      billingPlanCode,
      billingRef: input.billingRef,
      billingPhase,
      checkoutOffer,
    });
  }

  if (input.billingRef && billingPhase !== "paid" && input.billingRef.pulseTrialRedeemedAt) {
    return buildHostedPulseTrialPendingBillingDeniedPeriod({
      at: input.at,
      billingPlanCode,
      periodEnd: input.billingRef.currentTrialEndsAt,
      periodStart: input.billingRef.currentTrialStartedAt,
    });
  }

  const currentPeriodStart = input.billingRef?.currentPeriodStart ?? null;
  const currentPeriodEnd = input.billingRef?.currentPeriodEnd ?? null;
  const period =
    currentPeriodStart
    && currentPeriodEnd
    && currentPeriodStart.getTime() < currentPeriodEnd.getTime()
    && input.at.getTime() >= currentPeriodStart.getTime()
    && input.at.getTime() < currentPeriodEnd.getTime()
      ? {
          periodEnd: currentPeriodEnd,
          periodStart: currentPeriodStart,
          source: "billing" as const,
        }
      : {
          ...buildUtcCalendarMonthPeriod(input.at),
          source: "calendar" as const,
        };

  return {
    billingPlanCode,
    kind: "period",
    limitUsdMicros: getHostedAiUsageMonthlyAllowanceUsdMicros(billingPlanCode),
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    source: period.source,
  };
}

function resolveHostedPulseTrialAllowancePeriod(input: {
  at: Date;
  billingPhase: ReturnType<typeof parseHostedBillingPhase>;
  billingPlanCode: HostedBillingPlanCode;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  checkoutOffer: ReturnType<typeof parseHostedBillingCheckoutOffer>;
}): HostedAiUsageAllowancePeriodResolution {
  const trialPolicy = requireHostedPulseTrialPolicy(input.billingRef?.pulseTrialPolicyVersion);
  const trialStart = input.billingRef?.currentTrialStartedAt ?? null;
  const trialEnd = input.billingRef?.currentTrialEndsAt ?? null;

  if (
    input.billingPhase !== "trial" ||
    input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    input.billingPlanCode !== "launch_monthly" ||
    !trialPolicy ||
    !trialStart ||
    !trialEnd ||
    trialStart.getTime() >= trialEnd.getTime() ||
    input.at.getTime() < trialStart.getTime() ||
    input.at.getTime() >= trialEnd.getTime()
  ) {
    return buildHostedPulseTrialPendingBillingDeniedPeriod({
      at: input.at,
      billingPlanCode: input.billingPlanCode,
      periodEnd: trialEnd,
      periodStart: trialStart,
      trialPolicy,
    });
  }

  return {
    billingPlanCode: "launch_monthly",
    kind: "period",
    limitUsdMicros: trialPolicy.usageLimitUsdMicros,
    periodEnd: trialEnd,
    periodStart: trialStart,
    source: "trial",
  };
}

function buildHostedPulseTrialPendingBillingDeniedPeriod(input: {
  at: Date;
  billingPlanCode: HostedBillingPlanCode;
  periodEnd: Date | null;
  periodStart: Date | null;
  trialPolicy?: ReturnType<typeof requireHostedPulseTrialPolicy>;
}): Extract<HostedAiUsageAllowancePeriodResolution, { kind: "denied" }> {
  const retryAfter = new Date(input.at.getTime() + 15 * 60_000);

  return {
    billingPlanCode: input.billingPlanCode,
    kind: "denied",
    limitUsdMicros: input.trialPolicy?.usageLimitUsdMicros ?? 0n,
    periodEnd: input.periodEnd ?? retryAfter,
    periodStart: input.periodStart ?? input.at,
    reason: "trial_expired_pending_billing",
    retryAfter,
    userNotice: {
      code: "trial_conversion_pending",
      message: "Your trial has ended and billing is being updated. Try again shortly.",
    },
  };
}

async function carryOverHostedAiUsageFallbackPeriodTx(input: {
  memberId: string;
  now: Date;
  resolved: {
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    source: "billing" | "calendar" | "trial";
  };
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (input.resolved.source !== "billing") {
    return;
  }

  const movedRows = await input.tx.$queryRaw<Array<{
    allowance_cost_usd_micros: bigint;
    allowance_counted: boolean;
    occurred_at: Date;
    old_period_start: Date;
  }>>`
    WITH "candidates" AS (
      SELECT
        "id",
        "allowance_cost_usd_micros",
        "allowance_counted",
        "allowance_period_start" AS "old_period_start",
        "occurred_at"
      FROM "hosted_ai_usage"
      WHERE "member_id" = ${input.memberId}
        AND "allowance_accounted_at" IS NOT NULL
        AND "allowance_period_start" IS NOT NULL
        AND "allowance_period_start" <> ${input.resolved.periodStart}
        AND "occurred_at" >= ${input.resolved.periodStart}
        AND "occurred_at" < ${input.resolved.periodEnd}
      FOR UPDATE
    ),
    "moved" AS (
      UPDATE "hosted_ai_usage" AS "usage"
      SET
        "allowance_period_start" = ${input.resolved.periodStart},
        "allowance_period_end" = ${input.resolved.periodEnd}
      FROM "candidates"
      WHERE "usage"."id" = "candidates"."id"
      RETURNING
        "candidates"."allowance_cost_usd_micros",
        "candidates"."allowance_counted",
        "candidates"."occurred_at",
        "candidates"."old_period_start"
    )
    SELECT
      "allowance_cost_usd_micros",
      "allowance_counted",
      "occurred_at",
      "old_period_start"
    FROM "moved"
  `;
  if (movedRows.length === 0) {
    return;
  }

  const countedRows = movedRows.filter((row) => row.allowance_counted);
  const spentUsdMicros = countedRows
    .reduce((total, row) => total + row.allowance_cost_usd_micros, 0n);
  const lastUsageAt = countedRows
    .map((row) => row.occurred_at)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  if (spentUsdMicros > 0n && lastUsageAt) {
    await input.tx.$executeRaw`
      UPDATE "hosted_ai_usage_period"
      SET
        "spent_usd_micros" = "spent_usd_micros" + ${spentUsdMicros},
        "blocked_at" = CASE
          WHEN "spent_usd_micros" + ${spentUsdMicros} >= "limit_usd_micros"
            AND "blocked_at" IS NULL
          THEN ${input.now}
          ELSE "blocked_at"
        END,
        "last_usage_at" = CASE
          WHEN "last_usage_at" IS NULL THEN ${lastUsageAt}
          WHEN ${lastUsageAt} > "last_usage_at" THEN ${lastUsageAt}
          ELSE "last_usage_at"
        END,
        "updated_at" = ${input.now}
      WHERE "member_id" = ${input.memberId}
        AND "period_start" = ${input.resolved.periodStart}
    `;
  }

  const oldPeriodStarts = [
    ...new Set(movedRows.map((row) => row.old_period_start.getTime())),
  ].map((time) => new Date(time));
  for (const oldPeriodStart of oldPeriodStarts) {
    await recomputeHostedAiUsageAllowancePeriodSpendTx({
      memberId: input.memberId,
      now: input.now,
      periodStart: oldPeriodStart,
      tx: input.tx,
    });
  }
}

async function recomputeHostedAiUsageAllowancePeriodSpendTx(input: {
  memberId: string;
  now: Date;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedAiUsageAllowancePeriodTx({
    memberId: input.memberId,
    periodStart: input.periodStart,
    tx: input.tx,
  });

  const period = await input.tx.hostedAiUsagePeriod.findUnique({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: input.periodStart,
      },
    },
    select: {
      blockedAt: true,
      limitUsdMicros: true,
    },
  });
  if (!period) {
    return;
  }

  const remaining = await input.tx.hostedAiUsage.aggregate({
    _max: {
      occurredAt: true,
    },
    _sum: {
      allowanceCostUsdMicros: true,
    },
    where: {
      allowanceAccountedAt: {
        not: null,
      },
      allowanceCounted: true,
      allowancePeriodStart: input.periodStart,
      memberId: input.memberId,
    },
  });
  const spentUsdMicros = remaining._sum.allowanceCostUsdMicros ?? 0n;
  if (spentUsdMicros === 0n) {
    await input.tx.hostedAiUsagePeriod.delete({
      where: {
        memberId_periodStart: {
          memberId: input.memberId,
          periodStart: input.periodStart,
        },
      },
    });
    return;
  }

  await input.tx.hostedAiUsagePeriod.update({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: input.periodStart,
      },
    },
    data: {
      blockedAt: spentUsdMicros >= period.limitUsdMicros
        ? period.blockedAt ?? input.now
        : null,
      lastUsageAt: remaining._max.occurredAt,
      spentUsdMicros,
      updatedAt: input.now,
    },
  });
}

async function incrementHostedAiUsageAllowancePeriodSpendTx(input: {
  deltaUsdMicros: bigint;
  memberId: string;
  now: Date;
  periodStart: Date;
  tx: Prisma.TransactionClient;
  usageAt: Date;
}): Promise<void> {
  const updated = await input.tx.$executeRaw`
    UPDATE "hosted_ai_usage_period"
    SET
      "spent_usd_micros" = "spent_usd_micros" + ${input.deltaUsdMicros},
      "blocked_at" = CASE
        WHEN "spent_usd_micros" + ${input.deltaUsdMicros} >= "limit_usd_micros"
          AND "blocked_at" IS NULL
        THEN ${input.now}
        ELSE "blocked_at"
      END,
      "last_usage_at" = CASE
        WHEN "last_usage_at" IS NULL THEN ${input.usageAt}
        WHEN ${input.usageAt} > "last_usage_at" THEN ${input.usageAt}
        ELSE "last_usage_at"
      END,
      "updated_at" = ${input.now}
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.periodStart}
  `;

  if (updated !== 1) {
    throw new Error("Hosted AI usage allowance period was missing during spend accounting.");
  }
}

async function lockHostedAiUsageAllowancePeriodTx(input: {
  memberId: string;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$queryRaw`
    SELECT 1
    FROM "hosted_ai_usage_period"
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.periodStart}
    FOR UPDATE
  `;
}

async function runHostedAiUsageAllowanceTransaction<T>(
  prisma: HostedAiUsageAllowanceClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maybeTransaction = prisma as {
    $transaction?: <R>(
      run: (tx: Prisma.TransactionClient) => Promise<R>,
    ) => Promise<R>;
  };

  if (typeof maybeTransaction.$transaction === "function") {
    return maybeTransaction.$transaction(run);
  }

  return run(prisma as Prisma.TransactionClient);
}

function priceTokenBucketUsdMicros(
  tokens: bigint,
  usdMicrosPerMillionTokens: bigint,
): bigint {
  if (tokens <= 0n || usdMicrosPerMillionTokens <= 0n) {
    return 0n;
  }

  return ((tokens * usdMicrosPerMillionTokens) + TOKENS_PER_PRICING_UNIT - 1n)
    / TOKENS_PER_PRICING_UNIT;
}

function buildHostedAiUsageAllowanceTokenSnapshot(
  record: AssistantUsageRecord,
): Prisma.InputJsonObject {
  return {
    cachedInput: normalizeTokenCount(record.cachedInputTokens).toString(),
    cacheWrite: normalizeTokenCount(record.cacheWriteTokens).toString(),
    input: normalizeTokenCount(record.inputTokens).toString(),
    output: normalizeTokenCount(record.outputTokens).toString(),
    reasoning: normalizeTokenCount(record.reasoningTokens).toString(),
    total: normalizeTokenCount(record.totalTokens).toString(),
  };
}

function normalizeAssistantUsageCredentialSource(
  value: AssistantUsageCredentialSource,
): AssistantUsageCredentialSource {
  return value === "member" || value === "platform" ? value : "unknown";
}

function normalizeHostedAiUsageAllowanceModel(
  value: string | null,
): HostedAiUsageAllowancePricedModel | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeHostedAiUsageAllowancePricedModelId(value);
}

function resolveHostedAiUsageAllowancePricingModel(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingModelResolution {
  const requestedModel = record.requestedModel ?? null;
  const servedModel = record.servedModel ?? null;
  const served = normalizeHostedAiUsageAllowanceModel(servedModel);
  if (served) {
    return {
      model: served,
      requestedModel,
      servedModel,
      source: "served",
    };
  }

  const requested = normalizeHostedAiUsageAllowanceModel(requestedModel);
  if (requested) {
    return {
      model: requested,
      requestedModel,
      servedModel,
      source: "requested",
    };
  }

  return {
    model: null,
    requestedModel,
    servedModel,
    source: null,
  };
}

function buildHostedAiUsageAllowanceModelSnapshot(
  resolution: HostedAiUsageAllowancePricingModelResolution,
): Prisma.InputJsonObject {
  return {
    model: resolution.model,
    modelSource: resolution.source,
    requestedModel: resolution.requestedModel,
    servedModel: resolution.servedModel,
  };
}

function buildHostedAiUsageGateLimitNotice(input: {
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
}): HostedAiUsageGateUserNotice {
  if (
    input.billingPlanCode === "launch_monthly" &&
    input.limitUsdMicros === HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS
  ) {
    return {
      code: "trial_usage_limit_reached",
      message:
        `You've reached the hosted AI usage included in your trial. Upgrade: ${HOSTED_AI_USAGE_HOME_URL}`,
    };
  }

  const base = "Hey, you've reached your usage limit for the month.";

  if (input.billingPlanCode === "launch_edge_monthly") {
    return {
      code: "edge_usage_limit_reached",
      message:
        `${base} Murph will resume when your included allowance resets: ${HOSTED_AI_USAGE_HOME_URL}`,
    };
  }

  return {
    code: "pulse_upgrade_edge",
    message: `${base} Upgrade to Edge: ${HOSTED_AI_USAGE_HOME_URL}`,
  };
}

function normalizeTokenCount(value: number | null | undefined): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return 0n;
  }

  return BigInt(value);
}

function normalizeHostedAiUsageAllowanceDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted AI usage allowance date is invalid.");
  }

  return parsed;
}

function buildUtcCalendarMonthPeriod(at: Date): {
  periodEnd: Date;
  periodStart: Date;
} {
  const periodStart = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  ));
  const periodEnd = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  ));

  return {
    periodEnd,
    periodStart,
  };
}
