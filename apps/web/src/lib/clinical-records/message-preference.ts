import "server-only";

import type { ClinicalRecordMessageMode } from "@prisma/client";
import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";

export async function setClinicalRecordMessageMode(auth: HostedNativeMemberAuth, mode: ClinicalRecordMessageMode) {
  const memberId = auth.member.id;
  return getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    if (mode !== "off") {
      await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
      await assertHostedLaunchRequiredConsentGranted({ memberId, prisma: tx });
    }
    await tx.hostedMember.updateMany({
      where: { id: memberId, clinicalRecordMessageMode: { not: mode } },
      data: { clinicalRecordMessageMode: mode, clinicalRecordMessageRevision: { increment: 1 } },
    });
    return { messageMode: mode };
  });
}
