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

export function readHostedUsageCreditPurchaseMemberLockOrder(input: {
  beneficiaryMemberId: string;
  checkoutSuccessUrl: string;
  payerMemberId: string;
}): HostedUsageCreditMemberLockOrder {
  if (input.beneficiaryMemberId === input.payerMemberId) {
    return "beneficiary_first";
  }
  try {
    const successUrl = new URL(input.checkoutSuccessUrl);
    return successUrl.pathname === "/settings"
        && successUrl.searchParams.has("usageFamily")
        && successUrl.searchParams.get("usageMember") === input.beneficiaryMemberId
      ? "payer_first"
      : "beneficiary_first";
  } catch {
    return "beneficiary_first";
  }
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
