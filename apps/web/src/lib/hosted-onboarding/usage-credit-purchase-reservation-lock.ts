import type { Prisma } from "@prisma/client";

import { lockHostedUsageCreditBeneficiaryTx } from "../hosted-execution/usage-credit-ledger";
import { lockHostedMemberRow } from "./shared";

export async function lockHostedUsageCreditPurchaseReservationOwnersTx(input: {
  beneficiaryMemberId: string;
  payerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  if (input.payerMemberId !== input.beneficiaryMemberId) {
    await lockHostedMemberRow(input.tx, input.payerMemberId);
  }
}
