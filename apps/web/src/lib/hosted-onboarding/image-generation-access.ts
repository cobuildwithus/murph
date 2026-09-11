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
  // The canonical allowance owner already checks active billing, sponsorship,
  // suspension, and remaining usage. A saved payment method grants no access.
  if (gate.allowanceSource === "direct_starter") {
    return { allowed: false, reason: "subscription_required" };
  }
  return { allowed: true, reason: "allowed" };
}
