import type { Prisma, PrismaClient } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";

type HostedUsageCreditReadClient = PrismaClient | Prisma.TransactionClient;

export interface HostedUsageCreditProjection {
  balanceUsdMicros: bigint;
  ledgerVersion: bigint;
}

export interface LockedHostedUsageCreditBeneficiary
  extends HostedUsageCreditProjection {
  beneficiaryMemberId: string;
}

export interface HostedUsageCreditGrantResult
  extends HostedUsageCreditProjection {
  entryId: string;
  granted: boolean;
}

export interface HostedUsageCreditSettlementResult
  extends HostedUsageCreditProjection {
  absorbedUsdMicros: bigint;
  debitedUsdMicros: bigint;
}

export interface HostedUsageCreditNetReversalResult
  extends HostedUsageCreditProjection {
  entryId: string | null;
  netReversedUsdMicros: bigint;
  reversedNowUsdMicros: bigint;
  restoredNowUsdMicros: bigint;
  unmetTargetUsdMicros: bigint;
}

interface LockedHostedUsageCreditPurchase {
  beneficiaryMemberId: string;
  grantUsdMicros: bigint;
  id: string;
  paidAt: Date | null;
  remainingCreditUsdMicros: bigint;
  status: string;
}

interface LockedHostedUsageCreditGrant {
  entryId: string;
  purchaseId: string;
  remainingCreditUsdMicros: bigint;
}

interface LockedHostedUsageCreditReversiblePurchase {
  grantEntryId: string;
  projection: LockedHostedUsageCreditBeneficiary;
  purchase: LockedHostedUsageCreditPurchase;
}

type HostedUsageCreditAdjustmentKind =
  | "dispute_adjustment"
  | "refund_adjustment";

const PURCHASE_GRANT_SEMANTIC_SOURCE_VERSION = "v1";
const USAGE_DEBIT_SEMANTIC_SOURCE_VERSION = "v1";

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

export async function grantHostedUsageCreditForPurchaseTx(input: {
  paidAt: Date;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditGrantResult> {
  assertHostedUsageCreditDate(input.paidAt);

  // This first read discovers the lock owner only. Every mutable purchase fact
  // is re-read after the beneficiary row has been locked.
  const discoveredPurchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    where: {
      id: input.purchaseId,
    },
    select: {
      beneficiaryMemberId: true,
    },
  });

  if (!discoveredPurchase) {
    throw new TypeError("Hosted usage-credit purchase does not exist.");
  }

  let projection = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: discoveredPurchase.beneficiaryMemberId,
    tx: input.tx,
  });
  const purchase = await lockHostedUsageCreditPurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });

  if (purchase.beneficiaryMemberId !== projection.beneficiaryMemberId) {
    throw new TypeError("Hosted usage-credit purchase beneficiary changed during fulfillment.");
  }
  if (purchase.grantUsdMicros <= 0n) {
    throw new TypeError("Hosted usage-credit purchase grant must be positive.");
  }

  const semanticSourceKey = buildHostedUsageCreditPurchaseGrantSemanticSourceKey(
    purchase.id,
  );
  const existingGrant = await input.tx.hostedUsageCreditEntry.findFirst({
    where: {
      kind: "purchase_grant",
      purchaseId: purchase.id,
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      id: true,
      semanticSourceKey: true,
    },
  });

  if (existingGrant) {
    if (
      existingGrant.amountUsdMicros !== purchase.grantUsdMicros
      || existingGrant.beneficiaryMemberId !== purchase.beneficiaryMemberId
      || existingGrant.semanticSourceKey !== semanticSourceKey
      || purchase.status !== "fulfilled"
      || purchase.paidAt === null
      || purchase.paidAt.getTime() !== input.paidAt.getTime()
    ) {
      throw new TypeError("Hosted usage-credit purchase grant invariant failed.");
    }

    return {
      balanceUsdMicros: projection.balanceUsdMicros,
      entryId: existingGrant.id,
      granted: false,
      ledgerVersion: projection.ledgerVersion,
    };
  }

  if (purchase.status === "fulfilled") {
    throw new TypeError("Hosted usage-credit fulfilled purchase is missing its grant.");
  }
  if (purchase.remainingCreditUsdMicros !== 0n) {
    throw new TypeError("Hosted usage-credit unfulfilled purchase has remaining credit.");
  }
  if (
    purchase.paidAt !== null
    && purchase.paidAt.getTime() !== input.paidAt.getTime()
  ) {
    throw new TypeError("Hosted usage-credit purchase paid timestamp changed.");
  }

  projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: purchase.grantUsdMicros,
    locked: projection,
    tx: input.tx,
  });
  const entryId = generateHostedRandomPrefixedId("huce");

  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: purchase.grantUsdMicros,
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.paidAt,
      id: entryId,
      kind: "purchase_grant",
      purchaseId: purchase.id,
      semanticSourceKey,
    },
  });

  const fulfilled = await input.tx.hostedUsageCreditPurchase.updateMany({
    where: {
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      id: purchase.id,
      remainingCreditUsdMicros: 0n,
    },
    data: {
      paidAt: input.paidAt,
      remainingCreditUsdMicros: purchase.grantUsdMicros,
      status: "fulfilled",
      terminalAt: input.paidAt,
    },
  });

  if (fulfilled.count !== 1) {
    throw new TypeError("Hosted usage-credit purchase fulfillment lost its locked row.");
  }

  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: purchase.beneficiaryMemberId,
    effectiveAt: input.paidAt,
    tx: input.tx,
  });

  return {
    balanceUsdMicros: projection.balanceUsdMicros,
    entryId,
    granted: true,
    ledgerVersion: projection.ledgerVersion,
  };
}

export async function settleHostedUsageCreditForUsageTx(input: {
  beneficiaryMemberId: string;
  debitUsdMicros: bigint;
  effectiveAt: Date;
  sourceUsageId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditSettlementResult> {
  assertHostedUsageCreditDate(input.effectiveAt);
  if (input.debitUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit debit cannot be negative.");
  }
  if (!input.sourceUsageId) {
    throw new TypeError("Hosted usage-credit debit requires a source usage id.");
  }

  let projection = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });

  const existingDebits = await input.tx.hostedUsageCreditEntry.findMany({
    where: {
      kind: "usage_debit",
      sourceUsageId: input.sourceUsageId,
    },
    orderBy: {
      beneficiarySequence: "asc",
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      parentGrantEntryId: true,
    },
  });

  if (existingDebits.length > 0) {
    let debitedUsdMicros = 0n;
    for (const entry of existingDebits) {
      if (
        entry.beneficiaryMemberId !== input.beneficiaryMemberId
        || entry.parentGrantEntryId === null
        || entry.amountUsdMicros >= 0n
      ) {
        throw new TypeError("Hosted usage-credit usage debit invariant failed.");
      }
      debitedUsdMicros -= entry.amountUsdMicros;
    }
    if (debitedUsdMicros > input.debitUsdMicros) {
      throw new TypeError("Hosted usage-credit replay debit exceeds its requested amount.");
    }

    return {
      absorbedUsdMicros: input.debitUsdMicros - debitedUsdMicros,
      balanceUsdMicros: projection.balanceUsdMicros,
      debitedUsdMicros,
      ledgerVersion: projection.ledgerVersion,
    };
  }

  if (
    input.debitUsdMicros === 0n
    || projection.balanceUsdMicros === 0n
  ) {
    return {
      absorbedUsdMicros: input.debitUsdMicros,
      balanceUsdMicros: projection.balanceUsdMicros,
      debitedUsdMicros: 0n,
      ledgerVersion: projection.ledgerVersion,
    };
  }

  const grants = await lockHostedUsageCreditAvailableGrantsTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  let remainingDebitUsdMicros = input.debitUsdMicros;
  let debitedUsdMicros = 0n;

  for (const grant of grants) {
    if (remainingDebitUsdMicros === 0n || projection.balanceUsdMicros === 0n) {
      break;
    }
    if (
      grant.remainingCreditUsdMicros <= 0n
    ) {
      throw new TypeError("Hosted usage-credit eligible grant invariant failed.");
    }

    const allocationUsdMicros = minBigInt(
      remainingDebitUsdMicros,
      grant.remainingCreditUsdMicros,
      projection.balanceUsdMicros,
    );
    if (allocationUsdMicros <= 0n) {
      continue;
    }

    const purchaseUpdated = await input.tx.hostedUsageCreditPurchase.updateMany({
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        id: grant.purchaseId,
        remainingCreditUsdMicros: grant.remainingCreditUsdMicros,
      },
      data: {
        remainingCreditUsdMicros:
          grant.remainingCreditUsdMicros - allocationUsdMicros,
      },
    });
    if (purchaseUpdated.count !== 1) {
      throw new TypeError("Hosted usage-credit debit lost its locked purchase.");
    }

    projection = await applyHostedUsageCreditProjectionDeltaTx({
      deltaUsdMicros: -allocationUsdMicros,
      locked: projection,
      tx: input.tx,
    });
    await input.tx.hostedUsageCreditEntry.create({
      data: {
        amountUsdMicros: -allocationUsdMicros,
        beneficiaryMemberId: input.beneficiaryMemberId,
        beneficiarySequence: projection.ledgerVersion,
        effectiveAt: input.effectiveAt,
        id: generateHostedRandomPrefixedId("huce"),
        kind: "usage_debit",
        parentGrantEntryId: grant.entryId,
        purchaseId: grant.purchaseId,
        semanticSourceKey: buildHostedUsageCreditUsageDebitSemanticSourceKey({
          grantEntryId: grant.entryId,
          sourceUsageId: input.sourceUsageId,
        }),
        sourceUsageId: input.sourceUsageId,
      },
    });

    debitedUsdMicros += allocationUsdMicros;
    remainingDebitUsdMicros -= allocationUsdMicros;
  }

  return {
    absorbedUsdMicros: input.debitUsdMicros - debitedUsdMicros,
    balanceUsdMicros: projection.balanceUsdMicros,
    debitedUsdMicros,
    ledgerVersion: projection.ledgerVersion,
  };
}

export async function reconcileHostedUsageCreditRefundNetReversalTx(input: {
  effectiveAt: Date;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  return reconcileHostedUsageCreditNetReversalTx({
    effectiveAt: input.effectiveAt,
    kind: "refund_adjustment",
    purchaseId: input.purchaseId,
    sourceReferenceLookupKey: input.sourceReferenceLookupKey,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    tx: input.tx,
  });
}

export async function reconcileHostedUsageCreditDisputeNetReversalTx(input: {
  effectiveAt: Date;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  sourceReferenceLookupKeyCandidates: readonly string[];
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  return reconcileHostedUsageCreditNetReversalTx({
    effectiveAt: input.effectiveAt,
    kind: "dispute_adjustment",
    purchaseId: input.purchaseId,
    sourceReferenceLookupKey: input.sourceReferenceLookupKey,
    sourceReferenceLookupKeyCandidates:
      input.sourceReferenceLookupKeyCandidates,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    tx: input.tx,
  });
}

async function reconcileHostedUsageCreditNetReversalTx(input: {
  effectiveAt: Date;
  kind: HostedUsageCreditAdjustmentKind;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  sourceReferenceLookupKeyCandidates?: readonly string[];
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  assertHostedUsageCreditDate(input.effectiveAt);
  const sourceReferenceLookupKeys = normalizeHostedUsageCreditSourceLookupKeys({
    current: input.sourceReferenceLookupKey,
    readableCandidates: input.sourceReferenceLookupKeyCandidates ?? [],
  });
  if (input.targetNetReversalUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit net reversal target cannot be negative.");
  }

  const locked = await lockHostedUsageCreditReversiblePurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });
  const adjustmentWhere: Prisma.HostedUsageCreditEntryWhereInput = {
    kind: input.kind,
    purchaseId: input.purchaseId,
    ...(input.kind === "dispute_adjustment"
      ? {
          sourceReferenceLookupKey: {
            in: sourceReferenceLookupKeys,
          },
        }
      : {}),
  };
  const adjustmentEntries = await input.tx.hostedUsageCreditEntry.findMany({
    where: adjustmentWhere,
    orderBy: {
      beneficiarySequence: "asc",
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      beneficiarySequence: true,
      parentGrantEntryId: true,
      sourceReferenceLookupKey: true,
    },
  });
  const canonicalSourceReferenceLookupKey = input.kind === "dispute_adjustment"
    ? resolveHostedUsageCreditCanonicalSourceLookupKey({
        current: input.sourceReferenceLookupKey,
        entries: adjustmentEntries,
      })
    : input.sourceReferenceLookupKey;
  const currentNetReversedUsdMicros = sumHostedUsageCreditAdjustmentEntries({
    beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
    entries: adjustmentEntries,
    grantEntryId: locked.grantEntryId,
  });

  if (currentNetReversedUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit adjustment restored more than it reversed.");
  }
  if (
    locked.projection.balanceUsdMicros
    < locked.purchase.remainingCreditUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit purchase remaining exceeds its beneficiary balance.");
  }

  if (input.targetNetReversalUsdMicros === currentNetReversedUsdMicros) {
    return buildHostedUsageCreditNetReversalResult({
      entryId: null,
      netReversedUsdMicros: currentNetReversedUsdMicros,
      projection: locked.projection,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    });
  }

  const increasing =
    input.targetNetReversalUsdMicros > currentNetReversedUsdMicros;
  const desiredDeltaUsdMicros = increasing
    ? input.targetNetReversalUsdMicros - currentNetReversedUsdMicros
    : currentNetReversedUsdMicros - input.targetNetReversalUsdMicros;
  const appliedDeltaUsdMicros = increasing
    ? minBigInt(
        desiredDeltaUsdMicros,
        locked.purchase.remainingCreditUsdMicros,
        locked.projection.balanceUsdMicros,
      )
    : desiredDeltaUsdMicros;

  if (appliedDeltaUsdMicros === 0n) {
    return buildHostedUsageCreditNetReversalResult({
      entryId: null,
      netReversedUsdMicros: currentNetReversedUsdMicros,
      projection: locked.projection,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    });
  }

  const nextRemainingCreditUsdMicros = increasing
    ? locked.purchase.remainingCreditUsdMicros - appliedDeltaUsdMicros
    : locked.purchase.remainingCreditUsdMicros + appliedDeltaUsdMicros;
  if (nextRemainingCreditUsdMicros > locked.purchase.grantUsdMicros) {
    throw new TypeError("Hosted usage-credit restoration exceeds its purchase grant.");
  }

  const purchaseUpdated = await input.tx.hostedUsageCreditPurchase.updateMany({
    where: {
      beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
      id: locked.purchase.id,
      remainingCreditUsdMicros: locked.purchase.remainingCreditUsdMicros,
      status: "fulfilled",
    },
    data: {
      remainingCreditUsdMicros: nextRemainingCreditUsdMicros,
    },
  });
  if (purchaseUpdated.count !== 1) {
    throw new TypeError("Hosted usage-credit net reversal lost its locked purchase.");
  }

  const projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: increasing
      ? -appliedDeltaUsdMicros
      : appliedDeltaUsdMicros,
    locked: locked.projection,
    tx: input.tx,
  });
  const nextNetReversedUsdMicros = increasing
    ? currentNetReversedUsdMicros + appliedDeltaUsdMicros
    : currentNetReversedUsdMicros - appliedDeltaUsdMicros;
  const entryId = generateHostedRandomPrefixedId("huce");
  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: increasing
        ? -appliedDeltaUsdMicros
        : appliedDeltaUsdMicros,
      beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.effectiveAt,
      id: entryId,
      kind: input.kind,
      parentGrantEntryId: locked.grantEntryId,
      purchaseId: locked.purchase.id,
      semanticSourceKey: buildHostedUsageCreditNetReversalSemanticSourceKey({
        beforeNetReversedUsdMicros: currentNetReversedUsdMicros,
        kind: input.kind,
        ledgerVersion: projection.ledgerVersion,
        nextNetReversedUsdMicros,
        purchaseId: input.purchaseId,
        sourceReferenceLookupKey: canonicalSourceReferenceLookupKey,
      }),
      sourceReferenceLookupKey: canonicalSourceReferenceLookupKey,
    },
  });
  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
    effectiveAt: input.effectiveAt,
    tx: input.tx,
  });

  return buildHostedUsageCreditNetReversalResult({
    entryId,
    netReversedUsdMicros: nextNetReversedUsdMicros,
    projection,
    reversedNowUsdMicros: increasing ? appliedDeltaUsdMicros : 0n,
    restoredNowUsdMicros: increasing ? 0n : appliedDeltaUsdMicros,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
  });
}

async function lockHostedUsageCreditReversiblePurchaseTx(input: {
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditReversiblePurchase> {
  const discoveredPurchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    where: {
      id: input.purchaseId,
    },
    select: {
      beneficiaryMemberId: true,
    },
  });
  if (!discoveredPurchase) {
    throw new TypeError("Hosted usage-credit purchase does not exist.");
  }

  const projection = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: discoveredPurchase.beneficiaryMemberId,
    tx: input.tx,
  });
  const purchase = await lockHostedUsageCreditPurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });
  if (
    purchase.beneficiaryMemberId !== projection.beneficiaryMemberId
    || purchase.status !== "fulfilled"
    || purchase.paidAt === null
  ) {
    throw new TypeError("Hosted usage-credit reversal requires a fulfilled purchase.");
  }
  if (
    purchase.remainingCreditUsdMicros < 0n
    || purchase.remainingCreditUsdMicros > purchase.grantUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit purchase remaining invariant failed.");
  }

  const grant = await input.tx.hostedUsageCreditEntry.findFirst({
    where: {
      kind: "purchase_grant",
      purchaseId: input.purchaseId,
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      id: true,
    },
  });
  if (
    !grant
    || grant.amountUsdMicros !== purchase.grantUsdMicros
    || grant.beneficiaryMemberId !== purchase.beneficiaryMemberId
  ) {
    throw new TypeError("Hosted usage-credit fulfilled purchase grant invariant failed.");
  }

  return {
    grantEntryId: grant.id,
    projection,
    purchase,
  };
}

async function lockHostedUsageCreditPurchaseTx(input: {
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditPurchase> {
  const rows = await input.tx.$queryRaw<LockedHostedUsageCreditPurchase[]>`
    SELECT
      "id",
      "beneficiary_member_id" AS "beneficiaryMemberId",
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

async function lockHostedUsageCreditAvailableGrantsTx(input: {
  beneficiaryMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditGrant[]> {
  return input.tx.$queryRaw<LockedHostedUsageCreditGrant[]>`
    SELECT
      entry."id" AS "entryId",
      purchase."id" AS "purchaseId",
      purchase."remaining_credit_usd_micros" AS "remainingCreditUsdMicros"
    FROM "hosted_usage_credit_entry" AS entry
    INNER JOIN "hosted_usage_credit_purchase" AS purchase
      ON purchase."id" = entry."purchase_id"
    WHERE entry."beneficiary_member_id" = ${input.beneficiaryMemberId}
      AND entry."kind" = 'purchase_grant'
      AND purchase."remaining_credit_usd_micros" > 0
    ORDER BY entry."beneficiary_sequence" ASC
    FOR UPDATE OF entry, purchase
  `;
}

async function applyHostedUsageCreditProjectionDeltaTx(input: {
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

async function reconcileHostedUsageCreditCurrentPeriodBlockTx(input: {
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

function buildHostedUsageCreditPurchaseGrantSemanticSourceKey(
  purchaseId: string,
): string {
  return `hosted-usage-credit:purchase:${purchaseId}:grant:${PURCHASE_GRANT_SEMANTIC_SOURCE_VERSION}`;
}

function buildHostedUsageCreditUsageDebitSemanticSourceKey(input: {
  grantEntryId: string;
  sourceUsageId: string;
}): string {
  return `hosted-usage-credit:usage:${input.sourceUsageId}:grant:${input.grantEntryId}:debit:${USAGE_DEBIT_SEMANTIC_SOURCE_VERSION}`;
}

function buildHostedUsageCreditNetReversalSemanticPrefix(input: {
  kind: HostedUsageCreditAdjustmentKind;
  purchaseId: string;
  sourceReferenceLookupKey: string;
}): string {
  if (input.kind === "refund_adjustment") {
    return `hosted-usage-credit:refund:purchase:${input.purchaseId}:`;
  }

  return `hosted-usage-credit:dispute:${input.sourceReferenceLookupKey}:`;
}

function buildHostedUsageCreditNetReversalSemanticSourceKey(input: {
  beforeNetReversedUsdMicros: bigint;
  kind: HostedUsageCreditAdjustmentKind;
  ledgerVersion: bigint;
  nextNetReversedUsdMicros: bigint;
  purchaseId: string;
  sourceReferenceLookupKey: string;
}): string {
  return `${buildHostedUsageCreditNetReversalSemanticPrefix(input)}net:${input.beforeNetReversedUsdMicros}:to:${input.nextNetReversedUsdMicros}:ledger:${input.ledgerVersion}:v2`;
}

function buildHostedUsageCreditNetReversalResult(input: {
  entryId: string | null;
  netReversedUsdMicros: bigint;
  projection: HostedUsageCreditProjection;
  reversedNowUsdMicros: bigint;
  restoredNowUsdMicros: bigint;
  targetNetReversalUsdMicros: bigint;
}): HostedUsageCreditNetReversalResult {
  return {
    balanceUsdMicros: input.projection.balanceUsdMicros,
    entryId: input.entryId,
    ledgerVersion: input.projection.ledgerVersion,
    netReversedUsdMicros: input.netReversedUsdMicros,
    reversedNowUsdMicros: input.reversedNowUsdMicros,
    restoredNowUsdMicros: input.restoredNowUsdMicros,
    unmetTargetUsdMicros:
      input.targetNetReversalUsdMicros - input.netReversedUsdMicros,
  };
}

function sumHostedUsageCreditAdjustmentEntries(input: {
  beneficiaryMemberId: string;
  entries: Array<{
    amountUsdMicros: bigint;
    beneficiaryMemberId: string;
    parentGrantEntryId: string | null;
  }>;
  grantEntryId: string;
}): bigint {
  let total = 0n;
  for (const entry of input.entries) {
    if (
      entry.beneficiaryMemberId !== input.beneficiaryMemberId
      || entry.parentGrantEntryId !== input.grantEntryId
      || entry.amountUsdMicros === 0n
    ) {
      throw new TypeError("Hosted usage-credit adjustment entry invariant failed.");
    }
    total += entry.amountUsdMicros;
  }
  return -total;
}

function normalizeHostedUsageCreditSourceLookupKeys(input: {
  current: string;
  readableCandidates: readonly string[];
}): string[] {
  const keys = [...new Set([input.current, ...input.readableCandidates])];
  if (keys.some((value) => !value.trim())) {
    throw new TypeError("Hosted usage-credit reversal requires source lookup keys.");
  }
  return keys;
}

function resolveHostedUsageCreditCanonicalSourceLookupKey(input: {
  current: string;
  entries: Array<{
    sourceReferenceLookupKey: string | null;
  }>;
}): string {
  const stored = input.entries[0]?.sourceReferenceLookupKey;
  if (stored === null || stored === undefined) {
    return input.current;
  }
  if (!stored.trim()) {
    throw new TypeError("Hosted usage-credit reversal stored an invalid source lookup key.");
  }
  return stored;
}

function assertHostedUsageCreditDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Hosted usage-credit timestamp is invalid.");
  }
}

function minBigInt(...values: [bigint, bigint, bigint]): bigint {
  let minimum = values[0];
  for (const value of values.slice(1)) {
    if (value < minimum) {
      minimum = value;
    }
  }
  return minimum;
}
