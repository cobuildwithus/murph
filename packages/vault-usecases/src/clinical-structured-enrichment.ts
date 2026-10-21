import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES, clinicalFhirResourceText, clinicalFhirResourceExtractionText, clinicalRawPathSchema,
  externalRefForFhir, hashClinicalFhirPatientId, normalizeClinicalFhirPatientReference,
  resolveClinicalFhirSourceRevision, selectClinicalFhirResource, indexClinicalFhirResources,
  type ClinicalImportPlan, type ClinicalRawManifest,
} from "@murphai/clinical-records";
import { isWritableIsoDateTime } from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";
import { findEventByExternalRef, resolveVaultPathOnDisk } from "@murphai/core";

export const clinicalStructuredSourceSchema = z.object({
  rawRef: clinicalRawPathSchema,
  resourceType: z.string().min(1).max(100),
  resourceId: z.string().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type ClinicalStructuredSource = z.infer<typeof clinicalStructuredSourceSchema>;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Select only parser-owned source notes, never already structured facts or safety holds. */
export function clinicalStructuredSources(plan: ClinicalImportPlan, pages: ReadonlyMap<string, string>): ClinicalStructuredSource[] {
  const indexes = new Map<string, ReturnType<typeof indexClinicalFhirResources>>();
  return plan.decisions.flatMap((decision) => {
    if (decision.action !== "upsert" || decision.payload.kind !== "note"
      || !decision.payload.noteType?.startsWith("fhir_")) return [];
    const resourceType = decision.payload.evidence?.[0]?.sourceLabel?.split("/")[0];
    if (!resourceType || ["DocumentReference", "DiagnosticReport"].includes(resourceType)) return [];
    const rawRef = decision.payload.evidence?.[0]?.rawRef;
    const resourceId = decision.payload.externalRef?.resourceId;
    const content = rawRef ? pages.get(rawRef) : undefined;
    if (!rawRef || !resourceId || !content) return [];
    if (!indexes.has(rawRef)) indexes.set(rawRef, indexClinicalFhirResources(content));
    const resource = indexes.get(rawRef)!.get(`${resourceType}/${resourceId}`);
    if (!resource) return [];
    const text = clinicalFhirResourceText(resource);
    if (Buffer.byteLength(text) > 600_000) return [];
    return [{ rawRef, resourceType, resourceId, sha256: hash(text) }];
  });
}

/** Bind one model assignment to immutable source bytes and a still-active canonical source note. */
export async function attestClinicalStructuredSource(input: {
  vaultRoot: string; manifestPath: string; manifest: ClinicalRawManifest; source: ClinicalStructuredSource;
}) {
  const source = clinicalStructuredSourceSchema.parse(input.source);
  const files = input.manifest.resourceFiles.filter((file) => file.resourceType === source.resourceType
    && path.posix.join(path.posix.dirname(input.manifestPath), file.relativePath) === source.rawRef);
  if (files.length !== 1) throw new Error("Clinical structured source is not manifest-bound.");
  const resolved = await resolveVaultPathOnDisk(input.vaultRoot, source.rawRef);
  const info = await stat(resolved.absolutePath);
  if (!info.isFile() || info.size > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) throw new Error("Clinical structured page exceeds its bound.");
  const bytes = await readFile(resolved.absolutePath);
  if (bytes.length > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES || hash(bytes) !== files[0]!.sha256) throw new Error("Clinical structured page integrity mismatch.");
  const resource = selectClinicalFhirResource(bytes.toString("utf8"), source.resourceType, source.resourceId);
  const text = clinicalFhirResourceText(resource);
  if (Buffer.byteLength(text) > 600_000 || hash(text) !== source.sha256) throw new Error("Clinical structured resource integrity mismatch.");
  const subject = object(resource.subject) ? resource.subject : object(resource.patient) ? resource.patient : undefined;
  const patient = typeof subject?.reference === "string" ? normalizeClinicalFhirPatientReference({
    fhirBaseUrlHash: input.manifest.fhirBaseUrlHash, reference: subject.reference,
  }) : null;
  if (!patient || hashClinicalFhirPatientId(patient) !== input.manifest.patientIdHash) throw new Error("Clinical structured patient binding mismatch.");
  const revision = resolveClinicalFhirSourceRevision({ lastUpdated: object(resource.meta) ? resource.meta.lastUpdated : undefined, fetchedAt: input.manifest.fetchedAt });
  if (!revision) throw new Error("Clinical structured revision is unavailable.");
  const parentExternalRef = externalRefForFhir({ sourceSystem: input.manifest.sourceSystem,
    fhirBaseUrlHash: input.manifest.fhirBaseUrlHash, patientIdHash: input.manifest.patientIdHash,
    resourceType: source.resourceType, resourceId: source.resourceId, version: revision });
  const eligible = await hasActiveClinicalSourceParent(input.vaultRoot, source, parentExternalRef, revision);
  return { documentPath: resolved.absolutePath, extractedText: clinicalFhirResourceExtractionText(resource),
    source: { rawRef: source.rawRef, sha256: files[0]!.sha256, byteLength: bytes.length, mediaType: "application/fhir+json", resource: source },
    parent: { eligible, reason: eligible ? undefined : "Clinical structured source parent is withdrawn, changed or unavailable.",
      parentExternalRef, parentRevision: revision, retrievedAt: input.manifest.fetchedAt,
      clinicalOccurredAt: clinicalDate(resource) } };
}

async function hasActiveClinicalSourceParent(vaultRoot: string, source: ClinicalStructuredSource, parentExternalRef: ReturnType<typeof externalRefForFhir>, revision: string): Promise<boolean> {
  const parent = await findEventByExternalRef({ vaultRoot, ...parentExternalRef, facet: null, includeDeleted: true });
  return parent?.kind === "note" && parent.noteType?.startsWith("fhir_") === true
    && !["DocumentReference", "DiagnosticReport"].includes(source.resourceType)
    && parent.lifecycle?.state !== "deleted" && parent.externalRef?.version === revision
    && parent.evidence?.some((evidence) => evidence.sourceLabel === `${source.resourceType}/${source.resourceId}`) === true;
}

function clinicalDate(resource: Record<string, unknown>): string | undefined {
  const keys = resource.resourceType === "Observation" ? ["effectiveDateTime"]
    : ["recordedDate", "authoredOn", "dateAsserted", "whenHandedOver", "whenPrepared", "occurrenceDateTime", "performedDateTime", "effectiveDateTime", "date", "startDate", "recorded"];
  for (const key of keys) {
    const value = resource[key];
    if (typeof value === "string" && isWritableIsoDateTime(value)) return new Date(value).toISOString();
  }
  for (const key of ["period", "effectivePeriod", "performedPeriod", "occurrencePeriod"]) {
    const period = resource[key];
    if (object(period) && typeof period.start === "string" && isWritableIsoDateTime(period.start)) return new Date(period.start).toISOString();
  }
  return undefined;
}
