import "server-only";

import type { PrismaClient } from "@prisma/client";
import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { getPrisma } from "../prisma";

export async function readHostedImageGenerationAccess(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<{ allowed: boolean; reason: "allowed" | "subscription_required" | "usage_unavailable" }> {
  const prisma = input.prisma ?? getPrisma();
  const gate = await readHostedAiUsageGate({ memberId: input.memberId, prisma });
  if (!gate.allowed) return { allowed: false, reason: "usage_unavailable" };
  // Available usage alone does not prove paid funding: Starter and groups can
  // use house-funded capacity. A saved payment method grants no access.
  if (gate.allowanceSource === "direct_starter") {
    return { allowed: false, reason: "subscription_required" };
  }
  if (gate.allowanceSource === "thread_container") {
    // Sponsorship activation follows verified payment. Otherwise use the
    // purchase projection maintained by fulfillment, settlement, and reversals;
    // the aggregate credit balance also includes non-purchased grants.
    const sponsorship = await prisma.hostedGroupSponsorshipAuthorization.findFirst({
      select: { id: true },
      where: { beneficiaryMemberId: input.memberId, status: "active" },
    });
    if (sponsorship) return { allowed: true, reason: "allowed" };
    const purchase = await prisma.hostedUsageCreditPurchase.findFirst({
      select: { id: true },
      where: {
        beneficiaryMemberId: input.memberId,
        status: "fulfilled",
        paidAt: { not: null },
        remainingCreditUsdMicros: { gt: 0n },
      },
    });
    if (!purchase) return { allowed: false, reason: "subscription_required" };
  }
  return { allowed: true, reason: "allowed" };
}
