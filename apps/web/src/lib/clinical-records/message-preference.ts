import "server-only";

import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";

export async function setClinicalRecordMessageMode(auth: HostedNativeMemberAuth, mode: "notice" | "off") {
  const memberId = auth.member.id;
  return getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    if (mode !== "off") {
      await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
      await assertHostedLaunchRequiredConsentGranted({ memberId, prisma: tx });
    }
    const where = { id: memberId };
    await tx.hostedMember.updateMany({
      where: { ...where, clinicalRecordMessageMode: { not: mode } },
      data: { clinicalRecordMessageMode: mode, clinicalRecordMessageRevision: { increment: 1 } },
    });
    return { messageMode: mode };
  });
}
