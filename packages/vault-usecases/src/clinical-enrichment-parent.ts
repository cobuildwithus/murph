import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  clinicalDocumentAttachmentKey,
  clinicalDocumentParentEligibility,
  clinicalIsoDateTimeSchema,
  clinicalRawManifestSchema,
  decodeClinicalDocumentBase64,
  externalRefForFhir,
  hashClinicalDocumentBytes,
  hashClinicalFhirPatientId,
  listClinicalFhirAttachments,
  normalizeClinicalFhirPatientReference,
  rawRefForClinicalManifestFile,
  type ClinicalDocumentAttachment,
  type ClinicalRawManifest,
} from "@murphai/clinical-records";
import { resolveVaultPathOnDisk } from "@murphai/core";

const MAX_PARENT_PAGE_BYTES = 5 * 1024 * 1024;
type DownloadedAttachment = Extract<ClinicalDocumentAttachment, { status: "downloaded" }>;
const invalidParent = () => new Error("Clinical enrichment parent failed source attestation.");

/** Resolve one immutable manifest-bound parent without requiring successful source-note extraction. */
export async function readClinicalEnrichmentParentEligibility(input: {
  vaultRoot: string;
  manifestPath: string;
  manifest: ClinicalRawManifest;
  attachment: DownloadedAttachment;
}) {
  const manifest = clinicalRawManifestSchema.parse(input.manifest);
  const attachment = manifest.documentAttachments?.find((candidate) =>
    clinicalDocumentAttachmentKey(candidate) === clinicalDocumentAttachmentKey(input.attachment));
  if (attachment?.status !== "downloaded" || attachment.sha256 !== input.attachment.sha256
    || attachment.relativePath !== input.attachment.relativePath || attachment.mediaType !== input.attachment.mediaType
    || attachment.byteLength !== input.attachment.byteLength) throw invalidParent();
  const parent = await readAttestedParent({ ...input, manifest, attachment });
  validateParentPatient(parent, manifest);
  validateParentAttachment(parent, attachment);
  const revision = clinicalIsoDateTimeSchema.safeParse(isRecord(parent.meta) ? parent.meta.lastUpdated : undefined);
  if (!revision.success) throw invalidParent();
  const parentExternalRef = externalRefForFhir({ fhirBaseUrlHash: manifest.fhirBaseUrlHash,
    patientIdHash: manifest.patientIdHash, sourceSystem: manifest.sourceSystem,
    resourceType: attachment.resourceType, resourceId: attachment.resourceId, version: revision.data });
  const eligibility = clinicalDocumentParentEligibility({ resourceType: attachment.resourceType,
    status: parent.status, docStatus: parent.docStatus });
  return { eligible: eligibility.action === "eligible", ...("reason" in eligibility ? { reason: eligibility.reason } : {}),
    parentExternalRef, parentRevision: revision.data };
}

async function readAttestedParent(input: {
  vaultRoot: string; manifestPath: string; manifest: ClinicalRawManifest; attachment: DownloadedAttachment;
}) {
  const files = input.manifest.resourceFiles.filter((file) => file.sha256 === input.attachment.parentPageSha256
    && file.resourceType === input.attachment.resourceType);
  if (files.length !== 1) throw invalidParent();
  const parentPageRawRef = rawRefForClinicalManifestFile({ manifestPath: input.manifestPath, resourceFile: files[0]! });
  const resolved = await resolveVaultPathOnDisk(input.vaultRoot, parentPageRawRef);
  const metadata = await stat(resolved.absolutePath);
  if (!metadata.isFile() || metadata.size > MAX_PARENT_PAGE_BYTES) throw invalidParent();
  const bytes = await readFile(resolved.absolutePath);
  if (bytes.length > MAX_PARENT_PAGE_BYTES || createHash("sha256").update(bytes).digest("hex") !== input.attachment.parentPageSha256) throw invalidParent();
  const bundle: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(bundle) || bundle.resourceType !== "Bundle" || !Array.isArray(bundle.entry)
    || bundle.entry.length > CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE) throw invalidParent();
  const parents = bundle.entry.flatMap((entry: unknown) => isRecord(entry) && isRecord(entry.resource)
    && entry.resource.resourceType === input.attachment.resourceType && entry.resource.id === input.attachment.resourceId ? [entry.resource] : []);
  if (parents.length !== 1) throw invalidParent();
  return parents[0]!;
}

function validateParentPatient(parent: Record<string, unknown>, manifest: ClinicalRawManifest): void {
  const reference = isRecord(parent.subject) ? parent.subject.reference : undefined;
  const patientId = typeof reference === "string" ? normalizeClinicalFhirPatientReference({
    fhirBaseUrlHash: manifest.fhirBaseUrlHash, reference,
  }) : null;
  if (!patientId || hashClinicalFhirPatientId(patientId) !== manifest.patientIdHash) throw invalidParent();
}

function validateParentAttachment(parent: Record<string, unknown>, attachment: DownloadedAttachment): void {
  const source = listClinicalFhirAttachments(parent)[attachment.attachmentIndex];
  if (!source || (!source.data && !source.url)) throw invalidParent();
  if (source.data) {
    const bytes = decodeClinicalDocumentBase64(source.data);
    if (!bytes || hashClinicalDocumentBytes(bytes) !== attachment.sha256) throw invalidParent();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
