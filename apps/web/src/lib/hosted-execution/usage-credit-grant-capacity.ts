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
      occupiedSlotCount: number;
    }>
  >`
    WITH bounded_occupied_slots AS MATERIALIZED (
      SELECT NULL::text AS "reservedPurchaseId"
      FROM "hosted_usage_credit_grant" AS grant_projection
      INNER JOIN "hosted_usage_credit_entry" AS entry
        ON entry."id" = grant_projection."entry_id"
      WHERE entry."beneficiary_member_id" = ${input.lockedBeneficiary.beneficiaryMemberId}
        AND grant_projection."remaining_usd_micros" > 0

      UNION ALL

      SELECT purchase_reservation."id" AS "reservedPurchaseId"
      FROM "hosted_usage_credit_purchase" AS purchase_reservation
      WHERE purchase_reservation."beneficiary_member_id" = ${input.lockedBeneficiary.beneficiaryMemberId}
        AND purchase_reservation."status" <> 'fulfilled'
        AND purchase_reservation."grant_slot_released_at" IS NULL

      LIMIT ${inspectionLimit}
    )
    SELECT
      COUNT(*)::integer AS "occupiedSlotCount",
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
    || !Number.isSafeInteger(row.occupiedSlotCount)
    || row.occupiedSlotCount < 0
    || row.occupiedSlotCount > inspectionLimit
  ) {
    throw new TypeError(
      "Hosted usage-credit grant capacity read returned an invalid count.",
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
