import type { Prisma, PrismaClient } from "@prisma/client";

type HostedUsageCreditReadClient = PrismaClient | Prisma.TransactionClient;

export interface HostedUsageCreditProjection {
  balanceUsdMicros: bigint;
  ledgerVersion: bigint;
}

export interface LockedHostedUsageCreditBeneficiary
  extends HostedUsageCreditProjection {
  beneficiaryMemberId: string;
}

export interface LockedHostedUsageCreditPurchase {
  beneficiaryMemberId: string;
  grantSlotReleasedAt: Date | null;
  grantUsdMicros: bigint;
  id: string;
  paidAt: Date | null;
  remainingCreditUsdMicros: bigint;
  status: string;
}

export async function readHostedUsageCreditProjection(input: {
  beneficiaryMemberId: string;
  prisma: HostedUsageCreditReadClient;
}): Promise<HostedUsageCreditProjection> {
  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.beneficiaryMemberId,
    },
    select: {
      usageCreditBalanceUsdMicros: true,
      usageCreditLedgerVersion: true,
    },
  });

  if (!member) {
    throw new TypeError("Hosted usage-credit beneficiary does not exist.");
  }

  return normalizeHostedUsageCreditProjection({
    balanceUsdMicros: member.usageCreditBalanceUsdMicros,
    ledgerVersion: member.usageCreditLedgerVersion,
  });
}

export async function lockHostedUsageCreditBeneficiaryTx(input: {
  beneficiaryMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditBeneficiary> {
  const rows = await input.tx.$queryRaw<
    Array<{
      balanceUsdMicros: bigint | null;
      beneficiaryMemberId: string;
      ledgerVersion: bigint | null;
    }>
  >`
    SELECT
      "id" AS "beneficiaryMemberId",
      COALESCE("usage_credit_balance_usd_micros", 0) AS "balanceUsdMicros",
      COALESCE("usage_credit_ledger_version", 0) AS "ledgerVersion"
    FROM "hosted_member"
    WHERE "id" = ${input.beneficiaryMemberId}
    FOR UPDATE
  `;
  const row = rows[0];

  if (!row) {
    throw new TypeError("Hosted usage-credit beneficiary does not exist.");
  }

  return {
    beneficiaryMemberId: row.beneficiaryMemberId,
    ...normalizeHostedUsageCreditProjection(row),
  };
}

export async function lockHostedUsageCreditPurchaseTx(input: {
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditPurchase> {
  const rows = await input.tx.$queryRaw<LockedHostedUsageCreditPurchase[]>`
    SELECT
      "id",
      "beneficiary_member_id" AS "beneficiaryMemberId",
      "grant_slot_released_at" AS "grantSlotReleasedAt",
      "grant_usd_micros" AS "grantUsdMicros",
      "remaining_credit_usd_micros" AS "remainingCreditUsdMicros",
      "status"::text AS "status",
      "paid_at" AS "paidAt"
    FROM "hosted_usage_credit_purchase"
    WHERE "id" = ${input.purchaseId}
    FOR UPDATE
  `;
  const purchase = rows[0];

  if (!purchase) {
    throw new TypeError("Hosted usage-credit purchase does not exist.");
  }

  return purchase;
}

export async function applyHostedUsageCreditProjectionDeltaTx(input: {
  deltaUsdMicros: bigint;
  locked: LockedHostedUsageCreditBeneficiary;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditBeneficiary> {
  if (input.deltaUsdMicros === 0n) {
    throw new TypeError("Hosted usage-credit ledger entry amount cannot be zero.");
  }
  const nextBalanceUsdMicros =
    input.locked.balanceUsdMicros + input.deltaUsdMicros;
  if (nextBalanceUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit balance cannot become negative.");
  }
  const nextLedgerVersion = input.locked.ledgerVersion + 1n;
  const rows = await input.tx.$queryRaw<
    Array<{
      balanceUsdMicros: bigint;
      beneficiaryMemberId: string;
      ledgerVersion: bigint;
    }>
  >`
    UPDATE "hosted_member"
    SET
      "usage_credit_balance_usd_micros" = ${nextBalanceUsdMicros},
      "usage_credit_ledger_version" = ${nextLedgerVersion},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.locked.beneficiaryMemberId}
      AND COALESCE("usage_credit_balance_usd_micros", 0) = ${input.locked.balanceUsdMicros}
      AND COALESCE("usage_credit_ledger_version", 0) = ${input.locked.ledgerVersion}
    RETURNING
      "id" AS "beneficiaryMemberId",
      "usage_credit_balance_usd_micros" AS "balanceUsdMicros",
      "usage_credit_ledger_version" AS "ledgerVersion"
  `;
  const updated = rows[0];

  if (
    !updated
    || updated.beneficiaryMemberId !== input.locked.beneficiaryMemberId
    || updated.balanceUsdMicros !== nextBalanceUsdMicros
    || updated.ledgerVersion !== nextLedgerVersion
  ) {
    throw new TypeError("Hosted usage-credit projection changed outside its beneficiary lock.");
  }

  return updated;
}

export async function reconcileHostedUsageCreditCurrentPeriodBlockTx(input: {
  balanceUsdMicros: bigint;
  beneficiaryMemberId: string;
  effectiveAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    UPDATE "hosted_ai_usage_period"
    SET
      "blocked_at" = CASE
        WHEN "spent_usd_micros" >= "limit_usd_micros"
          AND ${input.balanceUsdMicros} <= 0
        THEN COALESCE("blocked_at", ${input.effectiveAt})
        ELSE NULL
      END,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "member_id" = ${input.beneficiaryMemberId}
      AND "period_start" <= ${input.effectiveAt}
      AND "period_end" > ${input.effectiveAt}
  `;
}

function normalizeHostedUsageCreditProjection(input: {
  balanceUsdMicros: bigint | null;
  ledgerVersion: bigint | null;
}): HostedUsageCreditProjection {
  const balanceUsdMicros = input.balanceUsdMicros ?? 0n;
  const ledgerVersion = input.ledgerVersion ?? 0n;

  if (balanceUsdMicros < 0n || ledgerVersion < 0n) {
    throw new TypeError("Hosted usage-credit projection cannot be negative.");
  }

  return {
    balanceUsdMicros,
    ledgerVersion,
  };
}

export function assertHostedUsageCreditDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Hosted usage-credit timestamp is invalid.");
  }
}

export function minHostedUsageCreditBigInt(
  ...values: [bigint, bigint, bigint]
): bigint {
  let minimum = values[0];
  for (const value of values.slice(1)) {
    if (value < minimum) {
      minimum = value;
    }
  }
  return minimum;
}
