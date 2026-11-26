import "server-only";

import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted, recordHostedConsentDecisionTx } from "../legal/consent";
import { getPrisma } from "../prisma";
import { readClinicalProcessorApprovals, clinicalProcessorScope, type ClinicalProcessor } from "./processor-registry";

export function setClinicalProcessorApproval(auth: HostedNativeMemberAuth, processor: ClinicalProcessor,
  version: string, approved: boolean) {
  const memberId = auth.member.id;
  return getPrisma().$transaction(async tx => {
    await lockHostedMemberRow(tx, memberId);
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    if (approved) {
      await assertActiveHostedMemberAccessAllowed({ memberId, prisma: tx });
      await assertHostedLaunchRequiredConsentGranted({ memberId, prisma: tx });
    }
    if (!approved && await tx.hostedConsentGrant.findFirst({ where: { memberId, scope: clinicalProcessorScope(processor),
      status: "granted" }, select: { memberId: true } })) {
      // Re-approval starts a new policy epoch. Outstanding replies cannot regain authority.
      await tx.hostedMember.update({ where: { id: memberId }, data: { clinicalRecordMessageRevision: { increment: 1 } } });
    }
    await recordHostedConsentDecisionTx({ tx, memberId, scope: clinicalProcessorScope(processor),
      decision: approved ? "allow" : "deny", source: "clinical-records.companion", now: new Date(), metadata: null,
      expectedDocumentVersions: { [processor.id]: processor.version }, acceptedDocumentVersions: { [processor.id]: version } });
    return { processors: await readClinicalProcessorApprovals(memberId, tx) };
  });
}
