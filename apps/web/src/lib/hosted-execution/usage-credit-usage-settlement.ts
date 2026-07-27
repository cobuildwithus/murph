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
  purchaseId: string | null;
  referralId: string | null;
  remainingUsdMicros: bigint;
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
      grant.remainingUsdMicros <= 0n
      || (grant.purchaseId === null) === (grant.referralId === null)
    ) {
      throw new TypeError("Hosted usage-credit eligible grant invariant failed.");
    }

    const allocationUsdMicros = minHostedUsageCreditBigInt(
      remainingDebitUsdMicros,
      grant.remainingUsdMicros,
      projection.balanceUsdMicros,
    );
    if (allocationUsdMicros <= 0n) {
      continue;
    }

    const nextRemainingUsdMicros =
      grant.remainingUsdMicros - allocationUsdMicros;
    const grantUpdated = await input.tx.hostedUsageCreditGrant.updateMany({
      where: {
        entryId: grant.entryId,
        remainingUsdMicros: grant.remainingUsdMicros,
      },
      data: {
        remainingUsdMicros: nextRemainingUsdMicros,
      },
    });
    if (grantUpdated.count !== 1) {
      throw new TypeError("Hosted usage-credit debit lost its locked grant.");
    }

    if (grant.purchaseId) {
      const purchaseUpdated =
        await input.tx.hostedUsageCreditPurchase.updateMany({
          where: {
            beneficiaryMemberId: input.beneficiaryMemberId,
            id: grant.purchaseId,
            remainingCreditUsdMicros: grant.remainingUsdMicros,
          },
          data: {
            remainingCreditUsdMicros: nextRemainingUsdMicros,
          },
        });
      if (purchaseUpdated.count !== 1) {
        throw new TypeError("Hosted usage-credit debit lost its purchase projection.");
      }
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
        ...(grant.purchaseId !== null
          ? { purchaseId: grant.purchaseId }
          : grant.referralId !== null
            ? { referralId: grant.referralId }
            : {}),
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
      entry."purchase_id" AS "purchaseId",
      entry."referral_id" AS "referralId",
      grant_projection."remaining_usd_micros" AS "remainingUsdMicros"
    FROM "hosted_usage_credit_entry" AS entry
    INNER JOIN "hosted_usage_credit_grant" AS grant_projection
      ON grant_projection."entry_id" = entry."id"
    WHERE entry."beneficiary_member_id" = ${input.beneficiaryMemberId}
      AND entry."kind" IN ('purchase_grant', 'referral_grant')
      AND grant_projection."remaining_usd_micros" > 0
    ORDER BY entry."beneficiary_sequence" ASC
    FOR UPDATE OF entry, grant_projection
  `;
}

function buildHostedUsageCreditUsageDebitSemanticSourceKey(input: {
  grantEntryId: string;
  sourceUsageId: string;
}): string {
  return `hosted-usage-credit:usage:${input.sourceUsageId}:grant:${input.grantEntryId}:debit:${USAGE_DEBIT_SEMANTIC_SOURCE_VERSION}`;
}
