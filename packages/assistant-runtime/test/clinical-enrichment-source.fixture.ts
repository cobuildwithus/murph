import { createHash } from "node:crypto";
import path from "node:path";

import { externalRefForFhir, hashClinicalFhirBaseUrl, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { enqueueClinicalEnrichment } from "@murphai/vault-usecases/clinical-enrichment";
import { importClinicalFhirSnapshot } from "@murphai/vault-usecases/clinical-records";

import { admitHostedClinicalEnrichmentWake } from "../src/hosted-runtime/clinical-enrichment-wake.ts";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const OCCURRED_AT = "2020-03-12T12:00:00.000Z";
export const SOURCE_TEXT = "Synthetic laboratory report. Collected 2020-03-12T12:00:00Z. Serum glucose 90 mg/dL. Reference 70-99 mg/dL.";

/** Imports one synthetic FHIR document, then enqueues its enrichment job and durable wake. */
export async function importClinicalEnrichmentSource(vaultRoot: string, parent: { resourceType: "DocumentReference" | "DiagnosticReport"; status: string; revision?: string; omitClinicalDate?: boolean; resourceId?: string } = { resourceType: "DocumentReference", status: "current" }, document = { bytes: Buffer.from(SOURCE_TEXT), mediaType: "text/plain" }) {
  const now = parent.revision ?? new Date().toISOString();
  const fetchedAt = new Date(now).toISOString();
  const bytes = document.bytes;
  const sha256 = digest(bytes);
  const resourceId = parent.resourceId ?? "synthetic-lab-document";
  const resource = {
    resourceType: parent.resourceType, id: resourceId, status: parent.status,
    subject: { reference: "Patient/synthetic-patient" }, meta: { lastUpdated: now },
    ...(!parent.omitClinicalDate ? { date: OCCURRED_AT } : {}), type: { text: "Synthetic lab report" },
    ...(parent.resourceType === "DocumentReference"
      ? { content: [{ attachment: { contentType: document.mediaType, url: `Binary/${resourceId}` } }] }
      : { code: { text: "Synthetic lab report" }, ...(!parent.omitClinicalDate ? { effectiveDateTime: OCCURRED_AT } : {}), presentedForm: [{ contentType: document.mediaType, url: `Binary/${resourceId}` }] }),
  };
  const content = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource }] });
  const retrievalJobId = `synthetic-retrieval-${digest(now).slice(0, 12)}`;
  const imported = await importClinicalFhirSnapshot({
    vaultRoot, connectionId: "synthetic-connection", retrievalJobId,
    retrievalProtocol: "query-slices-v2", sourceSystem: "epic-fhir", fetchedAt,
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: [`patient/${parent.resourceType}.read`], grantedScopes: [`patient/${parent.resourceType}.read`],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: parent.resourceType, coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    pages: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: parent.resourceType, content }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType: parent.resourceType, resourceId: resource.id, attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: bytes.length, mediaType: document.mediaType }],
    attachments: [{ relativePath: `attachments/${sha256}.bin`, contentBase64: bytes.toString("base64") }],
  });
  const job = await enqueueClinicalEnrichment({ vaultRoot, manifestPath: imported.manifestPath, manifestSha256: imported.manifestSha256 });
  await admitHostedClinicalEnrichmentWake({ vaultRoot, jobId: job.jobId, userId: "synthetic-member", occurredAt: fetchedAt });
  const parentExternalRef = externalRefForFhir({ fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"),
    patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), sourceSystem: "epic-fhir",
    resourceType: parent.resourceType, resourceId: resource.id, version: now });
  return { ...job, fetchedAt, retrievalJobId, manifestPath: imported.manifestPath, manifestSha256: imported.manifestSha256, parentExternalRef, rawRef: path.posix.join(path.posix.dirname(imported.manifestPath), `attachments/${sha256}.bin`), sha256 };
}
