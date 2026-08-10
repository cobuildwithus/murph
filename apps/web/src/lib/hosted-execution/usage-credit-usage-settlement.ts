import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS as MAX_ACTIVE_SPENDABLE_GRANTS,
} from "./usage-credit-grant-capacity";
import {
  assertHostedUsageCreditDate,
  lockHostedUsageCreditBeneficiaryTx,
  type HostedUsageCreditProjection,
  type LockedHostedUsageCreditBeneficiary,
} from "./usage-credit-ledger";

export interface HostedUsageCreditSettlementResult
  extends HostedUsageCreditProjection {
  absorbedUsdMicros: bigint;
  debitedUsdMicros: bigint;
}

interface HostedUsageCreditSettlementMutationRow {
  allocationCount: number;
  balanceUsdMicros: bigint | null;
  beneficiaryMemberId: string | null;
  debitedUsdMicros: bigint;
  eligibleGrantCount: number;
  eligibleGrantTotalUsdMicros: bigint;
  grantInvariantFailureCount: number;
  grantUpdatedCount: number;
  insertedDebitUsdMicros: bigint;
  ledgerEntryInsertedCount: number;
  ledgerVersion: bigint | null;
  memberUpdatedCount: number;
  purchaseAllocationCount: number;
  purchaseProjectionMismatchCount: number;
  purchaseUpdatedCount: number;
}

const ACTIVE_SPENDABLE_GRANT_INSPECTION_LIMIT =
  MAX_ACTIVE_SPENDABLE_GRANTS + 1;
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

  const projection = await lockHostedUsageCreditBeneficiaryTx({
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
    take: ACTIVE_SPENDABLE_GRANT_INSPECTION_LIMIT,
  });

  if (existingDebits.length > MAX_ACTIVE_SPENDABLE_GRANTS) {
    throw new TypeError(
      "Hosted usage-credit replay exceeds the temporary active grant limit.",
    );
  }
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

  if (input.debitUsdMicros === 0n) {
    return {
      absorbedUsdMicros: input.debitUsdMicros,
      balanceUsdMicros: projection.balanceUsdMicros,
      debitedUsdMicros: 0n,
      ledgerVersion: projection.ledgerVersion,
    };
  }

  const rows = await settleHostedUsageCreditAvailableGrantsTx({
    debitUsdMicros: input.debitUsdMicros,
    effectiveAt: input.effectiveAt,
    locked: projection,
    sourceUsageId: input.sourceUsageId,
    tx: input.tx,
  });
  const row = rows[0];

  if (!row || rows.length !== 1 || !hasValidSettlementMutationRow(row)) {
    throw new TypeError("Hosted usage-credit set-wise settlement returned invalid counts.");
  }
  if (
    row.eligibleGrantCount > ACTIVE_SPENDABLE_GRANT_INSPECTION_LIMIT
  ) {
    throw new TypeError("Hosted usage-credit grant inspection exceeded its bound.");
  }
  if (row.eligibleGrantCount > MAX_ACTIVE_SPENDABLE_GRANTS) {
    throw new TypeError(
      "Hosted usage-credit settlement exceeds the temporary active grant limit.",
    );
  }
  if (row.grantInvariantFailureCount !== 0) {
    throw new TypeError("Hosted usage-credit eligible grant invariant failed.");
  }
  if (row.purchaseProjectionMismatchCount !== 0) {
    throw new TypeError("Hosted usage-credit purchase projection diverged from its grant.");
  }
  if (
    row.eligibleGrantTotalUsdMicros < 0n
    || row.eligibleGrantTotalUsdMicros !== projection.balanceUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit member and grant projections diverged.");
  }
  const expectedDebitUsdMicros =
    input.debitUsdMicros < projection.balanceUsdMicros
      ? input.debitUsdMicros
      : projection.balanceUsdMicros;
  if (expectedDebitUsdMicros === 0n) {
    if (
      row.allocationCount !== 0
      || row.debitedUsdMicros !== 0n
      || row.grantUpdatedCount !== 0
      || row.purchaseAllocationCount !== 0
      || row.purchaseUpdatedCount !== 0
      || row.memberUpdatedCount !== 0
      || row.beneficiaryMemberId !== null
      || row.balanceUsdMicros !== null
      || row.ledgerVersion !== null
      || row.ledgerEntryInsertedCount !== 0
      || row.insertedDebitUsdMicros !== 0n
    ) {
      throw new TypeError("Hosted usage-credit zero-balance settlement mutated state.");
    }

    return {
      absorbedUsdMicros: input.debitUsdMicros,
      balanceUsdMicros: projection.balanceUsdMicros,
      debitedUsdMicros: 0n,
      ledgerVersion: projection.ledgerVersion,
    };
  }
  if (
    row.allocationCount === 0
    || row.allocationCount > row.eligibleGrantCount
    || row.allocationCount > MAX_ACTIVE_SPENDABLE_GRANTS
    || row.debitedUsdMicros !== expectedDebitUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit FIFO allocation invariant failed.");
  }
  if (row.grantUpdatedCount !== row.allocationCount) {
    throw new TypeError("Hosted usage-credit debit lost a locked grant projection.");
  }
  if (
    row.purchaseAllocationCount > row.allocationCount
    || row.purchaseUpdatedCount !== row.purchaseAllocationCount
  ) {
    throw new TypeError("Hosted usage-credit debit lost a purchase projection.");
  }

  const expectedBalanceUsdMicros =
    projection.balanceUsdMicros - row.debitedUsdMicros;
  const expectedLedgerVersion =
    projection.ledgerVersion + BigInt(row.allocationCount);
  if (
    row.memberUpdatedCount !== 1
    || row.beneficiaryMemberId !== input.beneficiaryMemberId
    || row.balanceUsdMicros !== expectedBalanceUsdMicros
    || row.ledgerVersion !== expectedLedgerVersion
  ) {
    throw new TypeError("Hosted usage-credit beneficiary projection update invariant failed.");
  }
  if (
    row.ledgerEntryInsertedCount !== row.allocationCount
    || row.insertedDebitUsdMicros !== row.debitedUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit usage-debit ledger insert invariant failed.");
  }

  return {
    absorbedUsdMicros: input.debitUsdMicros - row.debitedUsdMicros,
    balanceUsdMicros: row.balanceUsdMicros,
    debitedUsdMicros: row.debitedUsdMicros,
    ledgerVersion: row.ledgerVersion,
  };
}

async function settleHostedUsageCreditAvailableGrantsTx(input: {
  debitUsdMicros: bigint;
  effectiveAt: Date;
  locked: LockedHostedUsageCreditBeneficiary;
  sourceUsageId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditSettlementMutationRow[]> {
  const preparedEntryIdsJson = JSON.stringify(Array.from(
    { length: MAX_ACTIVE_SPENDABLE_GRANTS },
    () => generateHostedRandomPrefixedId("huce"),
  ));

  return input.tx.$queryRaw<HostedUsageCreditSettlementMutationRow[]>`
    WITH
    settlement_input AS MATERIALIZED (
      SELECT
        ${input.locked.beneficiaryMemberId}::text AS "beneficiaryMemberId",
        ${input.debitUsdMicros}::bigint AS "requestedDebitUsdMicros",
        ${input.effectiveAt}::timestamp(3) AS "effectiveAt",
        ${input.sourceUsageId}::text AS "sourceUsageId",
        ${input.locked.balanceUsdMicros}::bigint AS "lockedBalanceUsdMicros",
        ${input.locked.ledgerVersion}::bigint AS "lockedLedgerVersion",
        ${preparedEntryIdsJson}::jsonb AS "preparedEntryIds"
    ),
    bounded_active_grants AS MATERIALIZED (
      SELECT grant_projection."entry_id" AS "entryId"
      FROM "hosted_usage_credit_grant" AS grant_projection
      CROSS JOIN settlement_input
      WHERE grant_projection."beneficiary_member_id"
          = settlement_input."beneficiaryMemberId"
        AND grant_projection."remaining_usd_micros" > 0
      ORDER BY grant_projection."beneficiary_sequence" ASC
      LIMIT ${ACTIVE_SPENDABLE_GRANT_INSPECTION_LIMIT}
    ),
    locked_grants AS MATERIALIZED (
      SELECT
        entry."id" AS "entryId",
        grant_projection."beneficiary_member_id" AS "beneficiaryMemberId",
        grant_projection."beneficiary_sequence" AS "beneficiarySequence",
        entry."beneficiary_member_id" AS "canonicalBeneficiaryMemberId",
        entry."beneficiary_sequence" AS "canonicalBeneficiarySequence",
        entry."amount_usd_micros" AS "grantAmountUsdMicros",
        entry."kind"::text AS "entryKind",
        entry."purchase_id" AS "purchaseId",
        entry."referral_id" AS "referralId",
        entry."source_reference_lookup_key" AS "sourceReferenceLookupKey",
        grant_projection."remaining_usd_micros" AS "remainingUsdMicros",
        purchase_projection."beneficiary_member_id" AS "purchaseBeneficiaryMemberId",
        purchase_projection."grant_usd_micros" AS "purchaseGrantUsdMicros",
        purchase_projection."remaining_credit_usd_micros" AS "purchaseRemainingUsdMicros",
        purchase_projection."status"::text AS "purchaseStatus"
      FROM bounded_active_grants AS active_grant
      INNER JOIN "hosted_usage_credit_grant" AS grant_projection
        ON grant_projection."entry_id" = active_grant."entryId"
      INNER JOIN "hosted_usage_credit_entry" AS entry
        ON entry."id" = grant_projection."entry_id"
      LEFT JOIN "hosted_usage_credit_purchase" AS purchase_projection
        ON purchase_projection."id" = entry."purchase_id"
      WHERE grant_projection."remaining_usd_micros" > 0
      ORDER BY grant_projection."beneficiary_sequence" ASC
      FOR UPDATE OF entry, grant_projection
    ),
    grant_capacity AS MATERIALIZED (
      SELECT
        COUNT(*)::integer AS "eligibleGrantCount",
        CASE
          WHEN COUNT(*) <= ${MAX_ACTIVE_SPENDABLE_GRANTS}
          THEN COALESCE(SUM("remainingUsdMicros"), 0)::bigint
          ELSE 0::bigint
        END AS "eligibleGrantTotalUsdMicros",
        COUNT(*) FILTER (
          WHERE NOT (
              (
                "entryKind" = 'purchase_grant'
                AND "purchaseId" IS NOT NULL
                AND "referralId" IS NULL
              )
              OR (
                "entryKind" = 'referral_grant'
                AND "purchaseId" IS NULL
                AND "referralId" IS NOT NULL
              )
              OR (
                "entryKind" = 'starter_grant'
                AND "purchaseId" IS NULL
                AND "referralId" IS NULL
                AND "sourceReferenceLookupKey" IS NOT NULL
              )
            )
            OR "canonicalBeneficiaryMemberId"
              IS DISTINCT FROM "beneficiaryMemberId"
            OR "canonicalBeneficiarySequence"
              IS DISTINCT FROM "beneficiarySequence"
            OR "grantAmountUsdMicros" <= 0
            OR "remainingUsdMicros" > "grantAmountUsdMicros"
        )::integer AS "grantInvariantFailureCount",
        COUNT(*) FILTER (
          WHERE "entryKind" = 'purchase_grant'
            AND (
              "purchaseBeneficiaryMemberId" IS DISTINCT FROM "beneficiaryMemberId"
              OR "purchaseGrantUsdMicros" IS DISTINCT FROM "grantAmountUsdMicros"
              OR "purchaseRemainingUsdMicros" IS DISTINCT FROM "remainingUsdMicros"
              OR "purchaseStatus" IS DISTINCT FROM 'fulfilled'
            )
        )::integer AS "purchaseProjectionMismatchCount"
      FROM locked_grants
    ),
    settlement_gate AS MATERIALIZED (
      SELECT
        settlement_input.*,
        grant_capacity.*,
        LEAST(
          settlement_input."requestedDebitUsdMicros",
          settlement_input."lockedBalanceUsdMicros"
        )::bigint AS "targetDebitUsdMicros",
        (
          grant_capacity."eligibleGrantCount" <= ${MAX_ACTIVE_SPENDABLE_GRANTS}
          AND grant_capacity."grantInvariantFailureCount" = 0
          AND grant_capacity."purchaseProjectionMismatchCount" = 0
          AND grant_capacity."eligibleGrantTotalUsdMicros"
            = settlement_input."lockedBalanceUsdMicros"
          AND LEAST(
            settlement_input."requestedDebitUsdMicros",
            settlement_input."lockedBalanceUsdMicros"
          ) > 0
        ) AS "settlementReady"
      FROM settlement_input
      CROSS JOIN grant_capacity
    ),
    ranked_grants AS MATERIALIZED (
      SELECT
        locked_grants.*,
        settlement_gate."targetDebitUsdMicros",
        COALESCE(
          SUM(locked_grants."remainingUsdMicros") OVER (
            ORDER BY locked_grants."beneficiarySequence" ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        )::bigint AS "priorGrantUsdMicros"
      FROM locked_grants
      CROSS JOIN settlement_gate
      WHERE settlement_gate."settlementReady"
    ),
    allocation_candidates AS MATERIALIZED (
      SELECT
        ranked_grants.*,
        LEAST(
          ranked_grants."remainingUsdMicros",
          GREATEST(
            ranked_grants."targetDebitUsdMicros"
              - ranked_grants."priorGrantUsdMicros",
            0::bigint
          )
        )::bigint AS "allocationUsdMicros"
      FROM ranked_grants
    ),
    allocations AS MATERIALIZED (
      SELECT
        allocation_candidates.*,
        ROW_NUMBER() OVER (
          ORDER BY allocation_candidates."beneficiarySequence" ASC
        ) AS "allocationOrdinal"
      FROM allocation_candidates
      WHERE allocation_candidates."allocationUsdMicros" > 0
    ),
    allocation_totals AS MATERIALIZED (
      SELECT
        COUNT(*)::integer AS "allocationCount",
        COALESCE(SUM("allocationUsdMicros"), 0)::bigint AS "debitedUsdMicros",
        COUNT(*) FILTER (
          WHERE "purchaseId" IS NOT NULL
        )::integer AS "purchaseAllocationCount"
      FROM allocations
    ),
    prepared_entry_ids AS MATERIALIZED (
      SELECT
        prepared."entryId",
        prepared."allocationOrdinal"
      FROM settlement_input
      CROSS JOIN LATERAL jsonb_array_elements_text(
        settlement_input."preparedEntryIds"
      ) WITH ORDINALITY AS prepared("entryId", "allocationOrdinal")
    ),
    updated_grants AS (
      UPDATE "hosted_usage_credit_grant" AS grant_projection
      SET
        "remaining_usd_micros" =
          allocation."remainingUsdMicros" - allocation."allocationUsdMicros",
        "updated_at" = CURRENT_TIMESTAMP
      FROM allocations AS allocation
      WHERE grant_projection."entry_id" = allocation."entryId"
        AND grant_projection."remaining_usd_micros"
          = allocation."remainingUsdMicros"
      RETURNING grant_projection."entry_id" AS "entryId"
    ),
    updated_purchases AS (
      UPDATE "hosted_usage_credit_purchase" AS purchase_projection
      SET
        "remaining_credit_usd_micros" =
          allocation."remainingUsdMicros" - allocation."allocationUsdMicros",
        "updated_at" = CURRENT_TIMESTAMP
      FROM allocations AS allocation
      CROSS JOIN settlement_input
      WHERE allocation."purchaseId" IS NOT NULL
        AND purchase_projection."id" = allocation."purchaseId"
        AND purchase_projection."beneficiary_member_id"
          = settlement_input."beneficiaryMemberId"
        AND purchase_projection."grant_usd_micros"
          = allocation."grantAmountUsdMicros"
        AND purchase_projection."remaining_credit_usd_micros"
          = allocation."remainingUsdMicros"
        AND purchase_projection."status" = 'fulfilled'
      RETURNING purchase_projection."id" AS "purchaseId"
    ),
    updated_member AS (
      UPDATE "hosted_member" AS beneficiary
      SET
        "usage_credit_balance_usd_micros" =
          settlement_gate."lockedBalanceUsdMicros"
            - allocation_totals."debitedUsdMicros",
        "usage_credit_ledger_version" =
          settlement_gate."lockedLedgerVersion"
            + allocation_totals."allocationCount",
        "updated_at" = CURRENT_TIMESTAMP
      FROM settlement_gate
      CROSS JOIN allocation_totals
      WHERE settlement_gate."settlementReady"
        AND allocation_totals."allocationCount" > 0
        AND beneficiary."id" = settlement_gate."beneficiaryMemberId"
        AND COALESCE(beneficiary."usage_credit_balance_usd_micros", 0)
          = settlement_gate."lockedBalanceUsdMicros"
        AND COALESCE(beneficiary."usage_credit_ledger_version", 0)
          = settlement_gate."lockedLedgerVersion"
      RETURNING
        beneficiary."id" AS "beneficiaryMemberId",
        beneficiary."usage_credit_balance_usd_micros" AS "balanceUsdMicros",
        beneficiary."usage_credit_ledger_version" AS "ledgerVersion"
    ),
    inserted_entries AS (
      INSERT INTO "hosted_usage_credit_entry" (
        "id",
        "beneficiary_member_id",
        "beneficiary_sequence",
        "kind",
        "amount_usd_micros",
        "effective_at",
        "semantic_source_key",
        "purchase_id",
        "referral_id",
        "parent_grant_entry_id",
        "source_usage_id"
      )
      SELECT
        prepared_entry_ids."entryId",
        settlement_gate."beneficiaryMemberId",
        settlement_gate."lockedLedgerVersion"
          + allocation."allocationOrdinal",
        'usage_debit',
        -allocation."allocationUsdMicros",
        settlement_gate."effectiveAt",
        'hosted-usage-credit:usage:'
          || settlement_gate."sourceUsageId"
          || ':grant:'
          || allocation."entryId"
          || ':debit:'
          || ${USAGE_DEBIT_SEMANTIC_SOURCE_VERSION},
        allocation."purchaseId",
        allocation."referralId",
        allocation."entryId",
        settlement_gate."sourceUsageId"
      FROM allocations AS allocation
      INNER JOIN prepared_entry_ids
        ON prepared_entry_ids."allocationOrdinal"
          = allocation."allocationOrdinal"
      CROSS JOIN settlement_gate
      ORDER BY allocation."allocationOrdinal" ASC
      RETURNING "amount_usd_micros" AS "amountUsdMicros"
    )
    SELECT
      settlement_gate."eligibleGrantCount",
      settlement_gate."eligibleGrantTotalUsdMicros",
      settlement_gate."grantInvariantFailureCount",
      settlement_gate."purchaseProjectionMismatchCount",
      allocation_totals."allocationCount",
      allocation_totals."debitedUsdMicros",
      allocation_totals."purchaseAllocationCount",
      (SELECT COUNT(*)::integer FROM updated_grants) AS "grantUpdatedCount",
      (SELECT COUNT(*)::integer FROM updated_purchases) AS "purchaseUpdatedCount",
      (SELECT COUNT(*)::integer FROM updated_member) AS "memberUpdatedCount",
      (
        SELECT updated_member."beneficiaryMemberId"
        FROM updated_member
      ) AS "beneficiaryMemberId",
      (
        SELECT updated_member."balanceUsdMicros"
        FROM updated_member
      ) AS "balanceUsdMicros",
      (
        SELECT updated_member."ledgerVersion"
        FROM updated_member
      ) AS "ledgerVersion",
      (SELECT COUNT(*)::integer FROM inserted_entries)
        AS "ledgerEntryInsertedCount",
      COALESCE(
        (SELECT SUM(-inserted_entries."amountUsdMicros") FROM inserted_entries),
        0
      )::bigint AS "insertedDebitUsdMicros"
    FROM settlement_gate
    CROSS JOIN allocation_totals
  `;
}

function hasValidSettlementMutationRow(
  row: HostedUsageCreditSettlementMutationRow,
): boolean {
  const countsAreValid = [
    row.allocationCount,
    row.eligibleGrantCount,
    row.grantInvariantFailureCount,
    row.grantUpdatedCount,
    row.ledgerEntryInsertedCount,
    row.memberUpdatedCount,
    row.purchaseAllocationCount,
    row.purchaseProjectionMismatchCount,
    row.purchaseUpdatedCount,
  ].every((value) => Number.isSafeInteger(value) && value >= 0);

  return countsAreValid
    && typeof row.debitedUsdMicros === "bigint"
    && row.debitedUsdMicros >= 0n
    && typeof row.eligibleGrantTotalUsdMicros === "bigint"
    && row.eligibleGrantTotalUsdMicros >= 0n
    && typeof row.insertedDebitUsdMicros === "bigint"
    && row.insertedDebitUsdMicros >= 0n
    && (
      row.balanceUsdMicros === null
      || (
        typeof row.balanceUsdMicros === "bigint"
        && row.balanceUsdMicros >= 0n
      )
    )
    && (
      row.ledgerVersion === null
      || (typeof row.ledgerVersion === "bigint" && row.ledgerVersion >= 0n)
    )
    && (
      row.beneficiaryMemberId === null
      || typeof row.beneficiaryMemberId === "string"
    );
}
