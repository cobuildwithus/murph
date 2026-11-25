import "server-only";

import type { ClinicalRecordMessageMode } from "@prisma/client";
import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted, generateHostedConsentEventId } from "../legal/consent";
import { getPrisma } from "../prisma";
import { clinicalRecordsError } from "./errors";

export async function setClinicalRecordMessageMode(auth: HostedNativeMemberAuth, mode: ClinicalRecordMessageMode) {
  const memberId = auth.member.id;
  return getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    if (mode !== "off") {
      await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
      await assertHostedLaunchRequiredConsentGranted({ memberId, prisma: tx });
    }
    const where = { id: memberId };
    const member = await tx.hostedMember.findUniqueOrThrow({ where, select: { clinicalRecordMessageMode: true } });
    if (member.clinicalRecordMessageMode === mode) return { messageMode: mode };
    if (member.clinicalRecordMessageMode === "off" && mode === "detail") {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_NOTICE_REQUIRED",
        httpStatus: 409,
        message: "Turn on notices before enabling details.",
      });
    }
    const updated = await tx.hostedMember.update({
      where,
      data: { clinicalRecordMessageMode: mode, clinicalRecordMessageRevision: { increment: 1 } },
      select: { clinicalRecordMessageRevision: true },
    });
    if (mode === "detail") {
      await tx.hostedConsentEvent.create({ data: {
        id: generateHostedConsentEventId(), memberId, source: "clinical-records.companion",
        scope: "feature.clinical-record-message-detail", action: "accepted", documentVersionsJson: {},
        metadataJson: { revision: updated.clinicalRecordMessageRevision },
      } });
    }
    return { messageMode: mode };
  });
}
