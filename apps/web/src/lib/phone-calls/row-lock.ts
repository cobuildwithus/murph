import type { Prisma } from "@prisma/client";

import { lockHostedMemberRow } from "../hosted-onboarding/shared";

// Deletion and notification append serialize behind the existing member owner.
// Acquire it before touching the phone row, matching call reservation order.
export async function lockExistingHostedPhoneCallTx(
  tx: Prisma.TransactionClient,
  call: { id: string; memberId: string },
): Promise<boolean> {
  await lockHostedMemberRow(tx, call.memberId);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM hosted_phone_call
    WHERE id = ${call.id} AND member_id = ${call.memberId}
  `;
  return rows.length === 1;
}
