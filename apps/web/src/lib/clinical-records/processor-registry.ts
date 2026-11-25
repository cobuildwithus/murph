import "server-only";
import type { Prisma } from "@prisma/client";
import { clinicalRecordsError } from "./errors";

/** One notice and one ledger scope per legal entity, independent of launch consent. */
export const clinicalProcessors = [
  { id: "openai", name: "OpenAI OpCo, LLC", purpose: "Reads your records to organize them and answer questions about them.",
    version: "2026-11-25", origin: "https://api.openai.com" },
  { id: "linq", name: "Linq App Inc.", purpose: "Delivers messages that can include details from your records.",
    version: "2026-11-25", origin: "https://api.linqapp.com" },
] as const;

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

async function hasClinicalProcessorApprovals(memberId: string, prisma: GrantReader) {
  return (await readClinicalProcessorApprovals(memberId, prisma)).every(row => row.approved);
}

// The current importer writes to the shared member vault. Its container has direct
// internet access and host-specific intercepts, and effects may relay to other services.
// There is no finite, enforced recipient set to authorize for this destination.
const clinicalWorkspaceRecipientOrigins = null;

export function registeredClinicalRecipients(origins: readonly string[] | null): boolean {
  return origins !== null && origins.length > 0 && origins.every(origin =>
    clinicalProcessors.some(processor => processor.origin === origin));
}

export async function clinicalProcessorAdmissionError(memberId: string, prisma: GrantReader) {
  if (!await hasClinicalProcessorApprovals(memberId, prisma)) return "CLINICAL_RECORD_PROCESSOR_APPROVAL_REQUIRED";
  if (!registeredClinicalRecipients(clinicalWorkspaceRecipientOrigins)) return "CLINICAL_RECORD_PROCESSOR_ROUTE_UNAVAILABLE";
  return null;
}

export async function assertClinicalProcessorAdmission(memberId: string, prisma: GrantReader) {
  const code = await clinicalProcessorAdmissionError(memberId, prisma);
  if (code === "CLINICAL_RECORD_PROCESSOR_ROUTE_UNAVAILABLE") {
    throw clinicalRecordsError({ code, httpStatus: 503, message: "This hospital connection is currently unavailable." });
  }
  if (code) {
    throw clinicalRecordsError({ code, httpStatus: 403,
      message: "Review the companies that process your medical records in the app." });
  }
}
