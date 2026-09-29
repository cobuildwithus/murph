import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES, clinicalRawManifestSchema, clinicalRawPathSchema, type ClinicalRawManifest } from "@murphai/clinical-records";
import type { EventImportDecision, EventRecord } from "@murphai/contracts";
import { findEventsByExternalRefs, resolveVaultPathOnDisk } from "@murphai/core";

const parserReasons = new Set([
  "laboratory observation result is not importable",
  "laboratory observation component result is not importable",
  "observation code is not importable",
  "vital quantity unit is not importable",
]);
type Upsert = Extract<EventImportDecision, { action: "upsert" }>;

/** Called under the canonical lock; historical parser holds need explicit correction. */
export async function retainUnchangedClinicalParserHolds(input: {
  vaultRoot: string;
  decisions: EventImportDecision[];
  manifest: ClinicalRawManifest;
  pages: ReadonlyMap<string, string>;
}) {
  const candidates = input.decisions.filter((decision): decision is Upsert =>
    decision.action === "upsert" && decision.payload.externalRef?.resourceType === "observation"
    && (decision.payload.kind === "test" || decision.payload.kind === "note"));
  const existing = await findEventsByExternalRefs({ vaultRoot: input.vaultRoot,
    refs: candidates.map((decision) => ({ ...decision.payload.externalRef!, includeDeleted: true })) });
  const replacements = new Map<EventImportDecision, EventImportDecision>();
  const sourcePages = new Map<string, Promise<unknown>>();
  let retainedLabCount = 0;
  for (const [index, decision] of candidates.entries()) {
    const held = existing[index];
    if (!isMatchingDeletedObservation(held, decision)) continue;
    const evidence = matchingSourceEvidence(held, decision);
    if (!evidence) continue;
    const { rawRef, oldRawRef, resourceId } = evidence;
    const current = input.pages.get(rawRef);
    if (!current) continue;
    let oldPage = sourcePages.get(oldRawRef);
    if (!oldPage) {
      oldPage = readAttestedObservationPage(input.vaultRoot, oldRawRef, input.manifest);
      sourcePages.set(oldRawRef, oldPage);
    }
    const original = uniqueObservation(await oldPage, resourceId);
    const incoming = uniqueObservation(JSON.parse(current), resourceId);
    if (!original || !incoming || !isDeepStrictEqual(original, incoming)) continue;
    const reason = historicalParserReason(held, decision, original);
    if (!reason) continue;
    replacements.set(decision, { action: "retract", externalRef: held.externalRef!, reason, evidence: held.evidence });
    if (decision.payload.kind === "test" && decision.payload.testCategory === "laboratory") retainedLabCount++;
  }
  return { decisions: input.decisions.map((decision) => replacements.get(decision) ?? decision),
    retainedCount: replacements.size, retainedLabCount };
}

function isMatchingDeletedObservation(record: EventRecord | null | undefined, decision: Upsert): record is EventRecord & { externalRef: NonNullable<EventRecord["externalRef"]> & { version: string } } {
  return record?.lifecycle?.state === "deleted"
    && typeof record.externalRef?.version === "string" && isDeepStrictEqual(record.externalRef, decision.payload.externalRef);
}

function historicalParserReason(held: EventRecord, decision: Upsert, resource: Record<string, unknown>): string | undefined {
  if (held.kind === "note" && held.noteType === "event_import_retraction_marker") {
    return parserReasons.has(held.note ?? "") ? held.note : undefined;
  }
  // Retraction of an existing event preserves its payload, not the parser reason.
  // These source notes were unconditionally held before this importer change.
  if (decision.payload.kind === "note" && decision.payload.noteType === "fhir_observation_source") {
    return "unchanged historical observation parser hold";
  }
  if (decision.payload.kind !== "test" || decision.payload.testCategory !== "laboratory") return undefined;
  const hasQualitativeBounds = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    if (item.valueQuantity !== undefined || !["valueString", "valueInteger", "valueBoolean", "valueCodeableConcept"].some((key) => item[key] !== undefined)) return false;
    return Array.isArray(item.referenceRange) && item.referenceRange.some((range: unknown) =>
      range !== null && typeof range === "object" && ("low" in range || "high" in range));
  };
  // Current mapping has already validated each result. Numeric bounds on a
  // qualitative result are precisely the range shape the old mapper rejected.
  if (Array.isArray(resource.component) && resource.component.some(hasQualitativeBounds)) {
    return "laboratory observation component result is not importable";
  }
  return hasQualitativeBounds(resource) ? "laboratory observation result is not importable" : undefined;
}

function matchingSourceEvidence(held: EventRecord, decision: Upsert) {
  const oldEvidence = held.evidence?.[0];
  const evidence = decision.payload.evidence?.[0];
  const resourceId = decision.payload.externalRef!.resourceId;
  if (held.evidence?.length !== 1 || decision.payload.evidence?.length !== 1
    || !oldEvidence?.rawRef || !evidence?.rawRef || oldEvidence.sourceLabel !== evidence.sourceLabel
    || evidence.sourceLabel !== `Observation/${resourceId}`) return undefined;
  return { rawRef: evidence.rawRef, oldRawRef: oldEvidence.rawRef, resourceId };
}

async function readBoundedJson(vaultRoot: string, rawRef: string, maxBytes: number) {
  const file = await resolveVaultPathOnDisk(vaultRoot, clinicalRawPathSchema.parse(rawRef));
  const info = await stat(file.absolutePath);
  if (!info.isFile() || info.size > maxBytes) throw new Error("Clinical hold evidence exceeds its bound.");
  const bytes = await readFile(file.absolutePath);
  if (bytes.length > maxBytes) throw new Error("Clinical hold evidence exceeds its bound.");
  return { bytes, value: JSON.parse(bytes.toString("utf8")) as unknown };
}

async function readAttestedObservationPage(vaultRoot: string, rawRef: string, current: ClinicalRawManifest) {
  const parts = clinicalRawPathSchema.parse(rawRef).split("/");
  const manifestPath = `${parts.slice(0, 5).join("/")}/manifest.json`;
  const manifest = clinicalRawManifestSchema.parse((await readBoundedJson(vaultRoot, manifestPath, 4 * 1024 * 1024)).value);
  if (parts[3] !== manifest.connectionId || parts[4] !== manifest.retrievalJobId
    || manifest.sourceSystem !== current.sourceSystem || manifest.fhirBaseUrlHash !== current.fhirBaseUrlHash
    || manifest.patientIdHash !== current.patientIdHash) throw new Error("Clinical hold source binding is invalid.");
  const files = manifest.resourceFiles.filter((file) => file.resourceType === "Observation"
    && path.posix.join(path.posix.dirname(manifestPath), file.relativePath) === rawRef);
  if (files.length !== 1) throw new Error("Clinical hold page is not manifest-bound.");
  const page = await readBoundedJson(vaultRoot, rawRef, CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES);
  if (createHash("sha256").update(page.bytes).digest("hex") !== files[0]!.sha256) throw new Error("Clinical hold page integrity mismatch.");
  return page.value;
}

function uniqueObservation(value: unknown, resourceId: string): Record<string, unknown> | undefined {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const resources = Array.isArray(value) ? value : record(value) && value.resourceType === "Bundle" && Array.isArray(value.entry)
    ? value.entry.map((entry: unknown) => record(entry) ? entry.resource : undefined) : [value];
  const matches = resources.filter((resource): resource is Record<string, unknown> => record(resource)
    && resource.resourceType === "Observation" && resource.id === resourceId);
  return matches.length > 0 && matches.every((resource) => isDeepStrictEqual(resource, matches[0])) ? matches[0] : undefined;
}
