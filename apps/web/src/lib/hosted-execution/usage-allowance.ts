import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  AssistantUsageCredentialSource,
  AssistantUsageRecord,
} from "@murphai/runtime-state/node/assistant-usage";

import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedDefaultBillingPlanCode,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "../hosted-onboarding/billing-plans";
import { getPrisma } from "../prisma";

type HostedAiUsageAllowanceClient = PrismaClient | Prisma.TransactionClient;

export type HostedAiUsageGateDeniedReason =
  | "ai_usage_limit_exceeded"
  | "hosted_access_inactive";

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
  };

export interface HostedAiUsageAllowancePricingResult {
  costUsdMicros: bigint;
  counted: boolean;
  pricingSnapshot: Prisma.InputJsonObject;
  pricingVersion: string;
}

interface HostedAiUsageAllowancePeriod {
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
}

const HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION = "openai-api-pricing-2026-05-05-standard";
const HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE =
  "https://openai.com/api/pricing/";
const TOKENS_PER_PRICING_UNIT = 1_000_000n;

const HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES = {
  "gpt-5.4": {
    cachedInputUsdMicrosPerMillionTokens: 250_000n,
    inputUsdMicrosPerMillionTokens: 2_500_000n,
    outputUsdMicrosPerMillionTokens: 15_000_000n,
  },
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
} as const;

type HostedAiUsageAllowancePricedModel =
  keyof typeof HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES;

export function priceHostedAiUsageForAllowance(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingResult {
  const credentialSource = normalizeAssistantUsageCredentialSource(record.credentialSource);
  const counted = credentialSource !== "member";
  const model = normalizeHostedAiUsageAllowanceModel(
    record.servedModel ?? record.requestedModel ?? null,
  );
  const tokenSnapshot = buildHostedAiUsageAllowanceTokenSnapshot(record);

  if (!counted) {
    return {
      costUsdMicros: 0n,
      counted: false,
      pricingSnapshot: {
        credentialSource,
        model,
        pricingSource: HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        tokens: tokenSnapshot,
      },
      pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
    };
  }

  if (!model || !isHostedAiUsageAllowancePricedModel(model)) {
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
      model,
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

export async function resolveHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecision> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());

  return runHostedAiUsageAllowanceTransaction(prisma, async (tx) => {
    const period = await ensureHostedAiUsageAllowancePeriodTx({
      at: now,
      memberId: input.memberId,
      now,
      tx,
    });
    const active = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingStatus: true,
        suspendedAt: true,
      },
    });
    const remainingUsdMicros = period.limitUsdMicros > period.spentUsdMicros
      ? period.limitUsdMicros - period.spentUsdMicros
      : 0n;

    if (
      !active
      || active.billingStatus !== HostedBillingStatus.active
      || active.suspendedAt !== null
    ) {
      return {
        allowed: false,
        billingPlanCode: period.billingPlanCode,
        limitUsdMicros: period.limitUsdMicros,
        memberId: input.memberId,
        periodEnd: period.periodEnd,
        periodStart: period.periodStart,
        reason: "hosted_access_inactive",
        remainingUsdMicros,
        retryAfter: period.periodEnd,
        spentUsdMicros: period.spentUsdMicros,
      };
    }

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
  });
}

async function ensureHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowancePeriod> {
  const member = await input.tx.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      billingRef: {
        select: {
          currentBillingPlanCode: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
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
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  if (current.limitUsdMicros >= resolved.limitUsdMicros) {
    return {
      billingPlanCode: parseHostedBillingPlanCode(current.billingPlanCode)
        ?? resolved.billingPlanCode,
      limitUsdMicros: current.limitUsdMicros,
      periodEnd: current.periodEnd,
      periodStart: current.periodStart,
      spentUsdMicros: current.spentUsdMicros,
    };
  }

  const upgraded = await input.tx.hostedAiUsagePeriod.update({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    data: {
      billingPlanCode: resolved.billingPlanCode,
      blockedAt: current.spentUsdMicros < resolved.limitUsdMicros ? null : undefined,
      limitUsdMicros: resolved.limitUsdMicros,
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
    billingPlanCode: parseHostedBillingPlanCode(upgraded.billingPlanCode)
      ?? resolved.billingPlanCode,
    limitUsdMicros: upgraded.limitUsdMicros,
    periodEnd: upgraded.periodEnd,
    periodStart: upgraded.periodStart,
    spentUsdMicros: upgraded.spentUsdMicros,
  };
}

function resolveHostedAiUsageAllowancePeriod(input: {
  at: Date;
  billingRef: {
    currentBillingPlanCode: string | null;
    currentPeriodEnd: Date | null;
    currentPeriodStart: Date | null;
  } | null;
}): {
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  periodEnd: Date;
  periodStart: Date;
  source: "billing" | "calendar";
} {
  const billingPlanCode =
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode)
    ?? getHostedDefaultBillingPlanCode();
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
    limitUsdMicros: getHostedAiUsageMonthlyAllowanceUsdMicros(billingPlanCode),
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    source: period.source,
  };
}

async function carryOverHostedAiUsageFallbackPeriodTx(input: {
  memberId: string;
  now: Date;
  resolved: {
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    source: "billing" | "calendar";
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
  await input.tx.$executeRaw`
    UPDATE "hosted_ai_usage_period"
    SET
      "spent_usd_micros" = "spent_usd_micros" + ${input.deltaUsdMicros},
      "blocked_at" = CASE
        WHEN "spent_usd_micros" + ${input.deltaUsdMicros} >= "limit_usd_micros"
          AND "blocked_at" IS NULL
        THEN ${input.now}
        ELSE "blocked_at"
      END,
      "last_usage_at" = ${input.usageAt},
      "updated_at" = ${input.now}
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.periodStart}
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

function normalizeHostedAiUsageAllowanceModel(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isHostedAiUsageAllowancePricedModel(
  value: string,
): value is HostedAiUsageAllowancePricedModel {
  return Object.prototype.hasOwnProperty.call(
    HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES,
    value,
  );
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
