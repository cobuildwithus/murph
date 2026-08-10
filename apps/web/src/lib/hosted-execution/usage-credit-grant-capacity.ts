import type { Prisma } from "@prisma/client";

import type { LockedHostedUsageCreditBeneficiary } from "./usage-credit-ledger";

export const HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS = 32;

export type HostedUsageCreditGrantCapacityState =
  | "available"
  | "at_capacity"
  | "overflow";

/**
 * Reads one bounded occupied-slot count. The caller already holds the
 * beneficiary row lock that serializes every usage-credit ledger mutation.
 */
export async function readHostedUsageCreditGrantCapacityTx(input: {
  lockedBeneficiary: LockedHostedUsageCreditBeneficiary;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditGrantCapacityState> {
  const inspectionLimit =
    HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS + 1;
  const rows = await input.tx.$queryRaw<
    Array<{ occupiedGrantSlotCount: number }>
  >`
    SELECT COUNT(*)::integer AS "occupiedGrantSlotCount"
    FROM (
      SELECT 1
      FROM "hosted_usage_credit_grant" AS grant_projection
      INNER JOIN "hosted_usage_credit_entry" AS entry
        ON entry."id" = grant_projection."entry_id"
      WHERE entry."beneficiary_member_id" = ${input.lockedBeneficiary.beneficiaryMemberId}
        AND grant_projection."remaining_usd_micros" > 0
      LIMIT ${inspectionLimit}
    ) AS bounded_active_grants
  `;
  const row = rows[0];

  if (
    !row
    || rows.length !== 1
    || !Number.isSafeInteger(row.occupiedGrantSlotCount)
    || row.occupiedGrantSlotCount < 0
    || row.occupiedGrantSlotCount > inspectionLimit
  ) {
    throw new TypeError(
      "Hosted usage-credit grant capacity read returned an invalid count.",
    );
  }

  if (
    row.occupiedGrantSlotCount
      > HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS
  ) {
    return "overflow";
  }
  if (
    row.occupiedGrantSlotCount
      === HOSTED_USAGE_CREDIT_MAX_OCCUPIED_GRANT_SLOTS
  ) {
    return "at_capacity";
  }
  return "available";
}
