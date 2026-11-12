import type { Prisma } from "@prisma/client";

import {
  lockHostedUsageCreditBeneficiaryTx,
  type LockedHostedUsageCreditBeneficiary,
} from "../hosted-execution/usage-credit-ledger";
import { lockHostedMemberRow } from "./shared";

export type HostedUsageCreditMemberLockOrder =
  | "beneficiary_first"
  | "payer_first";

export function readHostedUsageCreditTargetMemberLockOrder(
  targetKind: "family" | "group" | "personal",
): HostedUsageCreditMemberLockOrder {
  return targetKind === "family" ? "payer_first" : "beneficiary_first";
}

export async function readHostedUsageCreditPurchaseMemberLockOrder(input: {
  beneficiaryMemberId: string;
  payerMemberId: string;
  prisma: Pick<Prisma.TransactionClient, "hostedThreadContainer">;
}): Promise<HostedUsageCreditMemberLockOrder> {
  if (input.beneficiaryMemberId === input.payerMemberId) return "beneficiary_first";
  // Family recipients are people; group recipients are canonical thread
  // containers. Redirect URLs are presentation and cannot choose lock order.
  const container = await input.prisma.hostedThreadContainer.findUnique({
    where: { memberId: input.beneficiaryMemberId },
    select: { memberId: true },
  });
  return container ? "beneficiary_first" : "payer_first";
}

export async function lockHostedUsageCreditPurchaseReservationOwnersTx(input: {
  beneficiaryMemberId: string;
  memberLockOrder: HostedUsageCreditMemberLockOrder;
  payerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditBeneficiary> {
  if (
    input.memberLockOrder === "payer_first"
    && input.payerMemberId !== input.beneficiaryMemberId
  ) {
    await lockHostedMemberRow(input.tx, input.payerMemberId);
  }
  const beneficiary = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  if (
    input.memberLockOrder === "beneficiary_first"
    && input.payerMemberId !== input.beneficiaryMemberId
  ) {
    await lockHostedMemberRow(input.tx, input.payerMemberId);
  }
  return beneficiary;
}
