import "server-only";
import type { Prisma } from "@prisma/client";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow, lockHostedMemberSponsoredAccessRows } from "../hosted-onboarding/shared";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";

export async function requirePersonalMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await lockHostedMemberRow(tx, memberId);
  await lockHostedMemberSponsoredAccessRows(tx, memberId);
  await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
  const group = await tx.hostedThreadContainer.findUnique({ where: { memberId }, select: { memberId: true } });
  if (group) throw new TypeError("Companion access requires a private member conversation.");
  await assertHostedHistoricalLaunchConsentGranted({ memberId, prisma: tx });
}

