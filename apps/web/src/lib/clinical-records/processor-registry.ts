import "server-only";
import { clinicalRecordRecipients } from "@murphai/hosted-execution/clinical-records";
import type { Prisma } from "@prisma/client";
import { clinicalRecordsError } from "./errors";

/** One notice and one ledger scope per named company, independent of launch consent. */
export const clinicalProcessors = clinicalRecordRecipients.filter(row => row.kind === "named");

export const clinicalAlsoUsed = clinicalRecordRecipients
  .filter(row => row.kind === "member-directed" && "name" in row)
  .map(({ id, name, reason }) => ({ id, name, purpose: reason }));

export type ClinicalProcessor = (typeof clinicalProcessors)[number];

export function clinicalProcessorScope(processor: ClinicalProcessor) {
  return `clinical.processor.${processor.id}` as const;
}

type GrantReader = Pick<Prisma.TransactionClient, "hostedConsentGrant">;

export async function readClinicalProcessorApprovals(memberId: string, prisma: GrantReader) {
  const grants = await prisma.hostedConsentGrant.findMany({
    where: { memberId, scope: { in: clinicalProcessors.map(clinicalProcessorScope) }, status: "granted" },
    select: { scope: true, documentVersionsJson: true },
  });
  return clinicalProcessors.map(processor => {
    const versions = grants.find(grant => grant.scope === clinicalProcessorScope(processor))?.documentVersionsJson;
    const approved = Boolean(versions && typeof versions === "object" && !Array.isArray(versions)
      && versions[processor.id] === processor.version);
    const { id, name, purpose, version } = processor;
    return { id, name, purpose, version, approved };
  });
}

export async function hasClinicalProcessorApprovals(memberId: string, prisma: GrantReader) {
  return (await readClinicalProcessorApprovals(memberId, prisma)).every(row => row.approved);
}

export async function assertClinicalProcessorAdmission(memberId: string, prisma: GrantReader) {
  if (!await hasClinicalProcessorApprovals(memberId, prisma)) {
    throw clinicalRecordsError({ code: "CLINICAL_RECORD_PROCESSOR_APPROVAL_REQUIRED", httpStatus: 403,
      message: "Review the companies that process your medical records in the app." });
  }
}
