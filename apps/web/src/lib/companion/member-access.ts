import "server-only";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type { Prisma } from "@prisma/client";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow, lockHostedMemberSponsoredAccessRows } from "../hosted-onboarding/shared";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";

export async function requirePersonalMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await lockHostedMemberRow(tx, memberId);
  await lockHostedMemberSponsoredAccessRows(tx, memberId);
  await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
  const group = await tx.hostedThreadContainer.findUnique({ where: { memberId }, select: { memberId: true } });
  if (group) throw hostedOnboardingError({ code: "INVALID_REQUEST", httpStatus: 400, message: "Companion access requires a private member conversation." });
  await assertHostedHistoricalLaunchConsentGranted({ memberId, prisma: tx });
}

