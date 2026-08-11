import type { Prisma } from "@prisma/client";

import type { LockedHostedUsageCreditBeneficiary } from "./usage-credit-ledger";

export const HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS = 32;

export type HostedUsageCreditGrantCapacityState =
  | "available"
  | "at_capacity"
  | "overflow";

export interface HostedUsageCreditGrantCapacityResult {
  expectedPurchaseOwnsReservation: boolean;
  state: HostedUsageCreditGrantCapacityState;
}

/**
 * Reads one bounded combined occupied-slot count. The caller already holds the
 * beneficiary row lock that serializes every usage-credit ledger mutation.
 */
export async function readHostedUsageCreditGrantCapacityTx(input: {
  expectedPurchaseId?: string;
  lockedBeneficiary: LockedHostedUsageCreditBeneficiary;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditGrantCapacityResult> {
  const inspectionLimit =
    HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS + 1;
  const rows = await input.tx.$queryRaw<
    Array<{
      expectedPurchaseOwnsReservation: boolean;
      grantInvariantFailureCount: number;
      occupiedSlotCount: number;
    }>
  >`
    WITH
    bounded_active_grants AS MATERIALIZED (
      SELECT
        grant_projection."entry_id" AS "entryId",
        grant_projection."beneficiary_member_id" AS "beneficiaryMemberId",
        grant_projection."beneficiary_sequence" AS "beneficiarySequence"
      FROM "hosted_usage_credit_grant" AS grant_projection
      WHERE grant_projection."beneficiary_member_id"
          = ${input.lockedBeneficiary.beneficiaryMemberId}
        AND grant_projection."remaining_usd_micros" > 0
      ORDER BY grant_projection."beneficiary_sequence" ASC
      LIMIT ${inspectionLimit}
    ),
    validated_active_grants AS MATERIALIZED (
      SELECT
        NULL::text AS "reservedPurchaseId",
        (
          canonical_entry."id" IS NULL
          OR canonical_entry."beneficiary_member_id"
            IS DISTINCT FROM active_grant."beneficiaryMemberId"
          OR canonical_entry."beneficiary_sequence"
            IS DISTINCT FROM active_grant."beneficiarySequence"
        ) AS "grantInvariantFailed"
      FROM bounded_active_grants AS active_grant
      LEFT JOIN "hosted_usage_credit_entry" AS canonical_entry
        ON canonical_entry."id" = active_grant."entryId"
    ),
    bounded_purchase_reservations AS MATERIALIZED (
      SELECT purchase_reservation."id" AS "reservedPurchaseId"
      FROM "hosted_usage_credit_purchase" AS purchase_reservation
      WHERE purchase_reservation."beneficiary_member_id"
          = ${input.lockedBeneficiary.beneficiaryMemberId}
        AND purchase_reservation."status" <> 'fulfilled'
        AND purchase_reservation."grant_slot_released_at" IS NULL
      ORDER BY purchase_reservation."id" ASC
      LIMIT GREATEST(
        ${inspectionLimit} - (
          SELECT COUNT(*)::integer
          FROM bounded_active_grants
        ),
        0
      )
    ),
    bounded_occupied_slots AS MATERIALIZED (
      SELECT
        validated_active_grants."reservedPurchaseId",
        validated_active_grants."grantInvariantFailed"
      FROM validated_active_grants

      UNION ALL

      SELECT
        bounded_purchase_reservations."reservedPurchaseId",
        false AS "grantInvariantFailed"
      FROM bounded_purchase_reservations
    )
    SELECT
      COUNT(*)::integer AS "occupiedSlotCount",
      COUNT(*) FILTER (
        WHERE bounded_occupied_slots."grantInvariantFailed"
      )::integer AS "grantInvariantFailureCount",
      COALESCE(
        BOOL_OR(
          bounded_occupied_slots."reservedPurchaseId"
            = ${input.expectedPurchaseId ?? null}
        ),
        false
      ) AS "expectedPurchaseOwnsReservation"
    FROM bounded_occupied_slots
  `;
  const row = rows[0];

  if (
    !row
    || rows.length !== 1
    || typeof row.expectedPurchaseOwnsReservation !== "boolean"
    || !Number.isSafeInteger(row.grantInvariantFailureCount)
    || row.grantInvariantFailureCount < 0
    || row.grantInvariantFailureCount > inspectionLimit
    || !Number.isSafeInteger(row.occupiedSlotCount)
    || row.occupiedSlotCount < 0
    || row.occupiedSlotCount > inspectionLimit
  ) {
    throw new TypeError(
      "Hosted usage-credit grant capacity read returned invalid counts.",
    );
  }
  if (row.grantInvariantFailureCount !== 0) {
    throw new TypeError(
      "Hosted usage-credit active grant canonical identity diverged.",
    );
  }

  let state: HostedUsageCreditGrantCapacityState = "available";
  if (row.occupiedSlotCount > HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS) {
    state = "overflow";
  } else if (
    row.occupiedSlotCount
      === HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS
  ) {
    state = "at_capacity";
  }

  return {
    expectedPurchaseOwnsReservation: row.expectedPurchaseOwnsReservation,
    state,
  };
}
