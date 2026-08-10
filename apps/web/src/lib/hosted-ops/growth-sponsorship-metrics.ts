import "server-only";

import { getPrisma } from "@/src/lib/prisma";

export type HostedGrowthSponsorshipQueryClient = Pick<
  ReturnType<typeof getPrisma>,
  "$queryRaw"
>;

export type HostedGrowthSponsorshipMetrics =
  | {
      activeMonthlyCapUsdCents: number;
      activeMonthlySponsorships: number;
      available: true;
      monthlyPaidPurchasesThisMonth: number;
      monthlyPaidThisMonthUsdCents: number;
      oneTimePaidPurchasesThisMonth: number;
      oneTimePaidThisMonthUsdCents: number;
      paidPurchasesThisMonth: number;
      paidThisMonthUsdCents: number;
      remainingUsageUsdMicros: number;
      usageConsumedThisMonthUsdMicros: number;
    }
  | {
      available: false;
    };

interface HostedGrowthSponsorshipQueryRow {
  activeMonthlyCapUsdCents: bigint;
  activeMonthlySponsorships: bigint;
  monthlyPaidPurchasesThisMonth: bigint;
  monthlyPaidThisMonthUsdCents: bigint;
  oneTimePaidPurchasesThisMonth: bigint;
  oneTimePaidThisMonthUsdCents: bigint;
  paidPurchasesThisMonth: bigint;
  paidThisMonthUsdCents: bigint;
  remainingUsageUsdMicros: bigint;
  usageConsumedThisMonthUsdMicros: bigint;
}

const unavailableHostedGrowthSponsorshipMetrics = {
  available: false,
} as const;

export async function readHostedGrowthSponsorshipMetrics(
  now: Date,
  prisma: HostedGrowthSponsorshipQueryClient = getPrisma(),
): Promise<HostedGrowthSponsorshipMetrics> {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("Hosted growth sponsorship metrics require a valid date.");
  }

  // Keep the existing ops dashboard usable with partial test clients and during
  // a transient telemetry failure. The UI renders an explicit unavailable state
  // rather than turning a missing read into misleading zeroes.
  if (typeof prisma.$queryRaw !== "function") {
    return unavailableHostedGrowthSponsorshipMetrics;
  }

  const monthStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
  ));

  try {
    const rows = await prisma.$queryRaw<HostedGrowthSponsorshipQueryRow[]>`
      WITH bounds AS (
        SELECT
          (${monthStart}::timestamptz AT TIME ZONE 'UTC') AS month_start,
          (${now}::timestamptz AT TIME ZONE 'UTC') AS captured_at
      ),
      sponsorship_purchases AS (
        SELECT
          purchase."id",
          purchase."cash_amount_minor",
          purchase."group_sponsorship_authorization_id",
          purchase."group_sponsorship_charge_ordinal",
          purchase."paid_at",
          purchase."remaining_credit_usd_micros"
        FROM "hosted_usage_credit_purchase" AS purchase
        CROSS JOIN bounds
        WHERE purchase."cash_currency" = 'usd'
          AND purchase."status" = 'fulfilled'
          AND purchase."stripe_live_mode" = TRUE
          AND purchase."paid_at" < bounds.captured_at
          AND EXISTS (
            SELECT 1
            FROM "hosted_thread_container" AS container
            WHERE container."member_id" = purchase."beneficiary_member_id"
          )
      ),
      active_monthly_sponsorships AS (
        SELECT
          COUNT(*)::bigint AS "activeMonthlySponsorships",
          COALESCE(SUM(
            CASE
              WHEN sponsorship_authorization."period_ends_at" <= bounds.captured_at
                AND sponsorship_authorization."pending_monthly_cap_minor" IS NOT NULL
                THEN sponsorship_authorization."pending_monthly_cap_minor"
              ELSE sponsorship_authorization."monthly_cap_minor"
            END
          ), 0)::bigint AS "activeMonthlyCapUsdCents"
        FROM "hosted_group_sponsorship_authorization" AS sponsorship_authorization
        CROSS JOIN bounds
        WHERE sponsorship_authorization."status" = 'active'
          AND EXISTS (
            SELECT 1
            FROM sponsorship_purchases AS activation_purchase
            WHERE activation_purchase."group_sponsorship_authorization_id" =
              sponsorship_authorization."id"
              AND activation_purchase."group_sponsorship_charge_ordinal" = 0
          )
      ),
      payments_this_month AS (
        SELECT sponsorship_purchase.*
        FROM sponsorship_purchases AS sponsorship_purchase
        CROSS JOIN bounds
        WHERE sponsorship_purchase."paid_at" >= bounds.month_start
          AND sponsorship_purchase."paid_at" < bounds.captured_at
      ),
      usage_this_month AS (
        SELECT COALESCE(
          SUM(-usage_entry."amount_usd_micros"),
          0
        )::bigint AS "usageConsumedThisMonthUsdMicros"
        FROM "hosted_usage_credit_entry" AS usage_entry
        INNER JOIN sponsorship_purchases AS sponsorship_purchase
          ON sponsorship_purchase."id" = usage_entry."purchase_id"
        CROSS JOIN bounds
        WHERE usage_entry."kind" = 'usage_debit'
          AND usage_entry."effective_at" >= bounds.month_start
          AND usage_entry."effective_at" < bounds.captured_at
      )
      SELECT
        active_monthly_sponsorships."activeMonthlyCapUsdCents",
        active_monthly_sponsorships."activeMonthlySponsorships",
        (
          SELECT COUNT(*)::bigint
          FROM payments_this_month
          WHERE "group_sponsorship_authorization_id" IS NOT NULL
        ) AS "monthlyPaidPurchasesThisMonth",
        (
          SELECT COALESCE(SUM("cash_amount_minor"), 0)::bigint
          FROM payments_this_month
          WHERE "group_sponsorship_authorization_id" IS NOT NULL
        ) AS "monthlyPaidThisMonthUsdCents",
        (
          SELECT COUNT(*)::bigint
          FROM payments_this_month
          WHERE "group_sponsorship_authorization_id" IS NULL
        ) AS "oneTimePaidPurchasesThisMonth",
        (
          SELECT COALESCE(SUM("cash_amount_minor"), 0)::bigint
          FROM payments_this_month
          WHERE "group_sponsorship_authorization_id" IS NULL
        ) AS "oneTimePaidThisMonthUsdCents",
        (
          SELECT COUNT(*)::bigint
          FROM payments_this_month
        ) AS "paidPurchasesThisMonth",
        (
          SELECT COALESCE(SUM("cash_amount_minor"), 0)::bigint
          FROM payments_this_month
        ) AS "paidThisMonthUsdCents",
        (
          SELECT COALESCE(SUM("remaining_credit_usd_micros"), 0)::bigint
          FROM sponsorship_purchases
        ) AS "remainingUsageUsdMicros",
        usage_this_month."usageConsumedThisMonthUsdMicros"
      FROM usage_this_month
      CROSS JOIN active_monthly_sponsorships
    `;
    const row = rows[0];
    if (!row) {
      throw new TypeError("Hosted growth sponsorship metrics returned no row.");
    }

    return {
      activeMonthlyCapUsdCents: toSafeNonNegativeNumber(
        row.activeMonthlyCapUsdCents,
        "activeMonthlyCapUsdCents",
      ),
      activeMonthlySponsorships: toSafeNonNegativeNumber(
        row.activeMonthlySponsorships,
        "activeMonthlySponsorships",
      ),
      available: true,
      monthlyPaidPurchasesThisMonth: toSafeNonNegativeNumber(
        row.monthlyPaidPurchasesThisMonth,
        "monthlyPaidPurchasesThisMonth",
      ),
      monthlyPaidThisMonthUsdCents: toSafeNonNegativeNumber(
        row.monthlyPaidThisMonthUsdCents,
        "monthlyPaidThisMonthUsdCents",
      ),
      oneTimePaidPurchasesThisMonth: toSafeNonNegativeNumber(
        row.oneTimePaidPurchasesThisMonth,
        "oneTimePaidPurchasesThisMonth",
      ),
      oneTimePaidThisMonthUsdCents: toSafeNonNegativeNumber(
        row.oneTimePaidThisMonthUsdCents,
        "oneTimePaidThisMonthUsdCents",
      ),
      paidPurchasesThisMonth: toSafeNonNegativeNumber(
        row.paidPurchasesThisMonth,
        "paidPurchasesThisMonth",
      ),
      paidThisMonthUsdCents: toSafeNonNegativeNumber(
        row.paidThisMonthUsdCents,
        "paidThisMonthUsdCents",
      ),
      remainingUsageUsdMicros: toSafeNonNegativeNumber(
        row.remainingUsageUsdMicros,
        "remainingUsageUsdMicros",
      ),
      usageConsumedThisMonthUsdMicros: toSafeNonNegativeNumber(
        row.usageConsumedThisMonthUsdMicros,
        "usageConsumedThisMonthUsdMicros",
      ),
    };
  } catch (error) {
    console.error("Failed to read hosted growth sponsorship metrics.", error);
    return unavailableHostedGrowthSponsorshipMetrics;
  }
}

function toSafeNonNegativeNumber(value: bigint, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(
      `Hosted growth sponsorship metric ${field} is outside the safe range.`,
    );
  }
  return parsed;
}
