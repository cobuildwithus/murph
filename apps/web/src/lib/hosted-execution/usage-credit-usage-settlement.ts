import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  applyHostedUsageCreditProjectionDeltaTx,
  assertHostedUsageCreditDate,
  lockHostedUsageCreditBeneficiaryTx,
  minHostedUsageCreditBigInt,
  type HostedUsageCreditProjection,
} from "./usage-credit-ledger";

export interface HostedUsageCreditSettlementResult
  extends HostedUsageCreditProjection {
  absorbedUsdMicros: bigint;
  debitedUsdMicros: bigint;
}

interface LockedHostedUsageCreditGrant {
  entryId: string;
  purchaseId: string;
  remainingCreditUsdMicros: bigint;
}

const USAGE_DEBIT_SEMANTIC_SOURCE_VERSION = "v1";

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

    const allocationUsdMicros = minHostedUsageCreditBigInt(
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

function buildHostedUsageCreditUsageDebitSemanticSourceKey(input: {
  grantEntryId: string;
  sourceUsageId: string;
}): string {
  return `hosted-usage-credit:usage:${input.sourceUsageId}:grant:${input.grantEntryId}:debit:${USAGE_DEBIT_SEMANTIC_SOURCE_VERSION}`;
}
