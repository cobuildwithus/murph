import "server-only";
import type { Prisma } from "@prisma/client";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";

export async function requirePersonalMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await requireHostedRuntimeActiveAccessForUpdateTx(memberId, { prisma: tx });
  const group = await tx.hostedThreadContainer.findUnique({ where: { memberId }, select: { memberId: true } });
  if (group) throw new TypeError("Companion access requires a private member conversation.");
  await assertHostedHistoricalLaunchConsentGranted({ memberId, prisma: tx });
}

