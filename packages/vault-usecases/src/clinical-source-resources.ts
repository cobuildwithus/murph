import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES, clinicalFhirResourceText, clinicalRawManifestSchema, clinicalRawPathSchema,
  indexClinicalFhirResources, type ClinicalRawManifest,
} from "@murphai/clinical-records";
import { compareIsoTimestampsAscending, isWritableIsoDateTime, type EventImportDecision, type EventRecord } from "@murphai/contracts";
import { findEventsByExternalRefs, resolveVaultPathOnDisk } from "@murphai/core";

type SourceBinding = Pick<ClinicalRawManifest, "sourceSystem" | "fhirBaseUrlHash" | "patientIdHash">;
type Evidence = NonNullable<EventRecord["evidence"]>[number];
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

async function readBounded(vaultRoot: string, rawRef: string, maxBytes: number, label: string) {
  const file = await resolveVaultPathOnDisk(vaultRoot, clinicalRawPathSchema.parse(rawRef));
  const info = await stat(file.absolutePath);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`Clinical ${label} evidence exceeds its bound.`);
  const bytes = await readFile(file.absolutePath);
  if (bytes.length > maxBytes) throw new Error(`Clinical ${label} evidence exceeds its bound.`);
  return bytes;
}

/** Read one immutable raw page, checked against its own manifest and the current source binding. */
export async function readAttestedClinicalPage(vaultRoot: string, rawRef: string, binding: SourceBinding, resourceType: string, label = "source") {
  const parts = clinicalRawPathSchema.parse(rawRef).split("/");
  const manifestPath = `${parts.slice(0, 5).join("/")}/manifest.json`;
  const manifest = clinicalRawManifestSchema.parse(JSON.parse((await readBounded(vaultRoot, manifestPath, 4 * 1024 * 1024, label)).toString("utf8")));
  if (parts[3] !== manifest.connectionId || parts[4] !== manifest.retrievalJobId
    || manifest.sourceSystem !== binding.sourceSystem || manifest.fhirBaseUrlHash !== binding.fhirBaseUrlHash
    || manifest.patientIdHash !== binding.patientIdHash) throw new Error(`Clinical ${label} source binding is invalid.`);
  const files = manifest.resourceFiles.filter((file) => file.resourceType === resourceType
    && path.posix.join(path.posix.dirname(manifestPath), file.relativePath) === rawRef);
  if (files.length !== 1) throw new Error(`Clinical ${label} page is not manifest-bound.`);
  const page = await readBounded(vaultRoot, rawRef, CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES, label);
  if (sha256(page) !== files[0]!.sha256) throw new Error(`Clinical ${label} page integrity mismatch.`);
  return page;
}

/** Everything in a source resource except `meta`, which carries no clinical content. */
export function clinicalSourceDigest(resource: Record<string, unknown>): string {
  const { meta: _meta, ...content } = resource;
  return sha256(clinicalFhirResourceText(content));
}

/** Digests of the resources a record's evidence names. Unattested or ambiguous sources have none. */
export function createClinicalSourceDigests(vaultRoot: string, binding: SourceBinding) {
  const pages = new Map<string, Promise<ReturnType<typeof indexClinicalFhirResources> | null>>();
  return async (evidence: Evidence): Promise<string | undefined> => {
    const [resourceType] = evidence.sourceLabel?.split("/") ?? [];
    if (!evidence.rawRef || !resourceType) return undefined;
    const key = `${resourceType}\n${evidence.rawRef}`;
    if (!pages.has(key)) {
      pages.set(key, readAttestedClinicalPage(vaultRoot, evidence.rawRef, binding, resourceType)
        .then((page) => indexClinicalFhirResources(page.toString("utf8")), () => null));
    }
    const resource = (await pages.get(key))?.get(evidence.sourceLabel ?? "");
    return resource ? clinicalSourceDigest(resource) : undefined;
  };
}

type Upsert = Extract<EventImportDecision, { action: "upsert" }>;
const decisionRef = (decision: EventImportDecision) => decision.action === "upsert" ? decision.payload.externalRef : decision.externalRef;
const decisionEvidence = (decision: EventImportDecision) => (decision.action === "upsert" ? decision.payload.evidence : decision.evidence) ?? [];
// Source notes whose whole text renders the provider resource. Documents also
// depend on attachment bytes, so their parents never take this path.
const isSourceNote = (noteType: string | undefined) => noteType?.startsWith("fhir_") === true
  && !["fhir_document_reference", "fhir_diagnostic_report"].includes(noteType);

/**
 * Called under the canonical lock, before core reconciles the batch. A later
 * read may leave the active record in place only when every resource it cites
 * equals the active record's stored resource, excluding `meta`: derived facts
 * read more of the resource than the canonical record shows. An unproven
 * retrieval-dated read therefore supersedes, which also invalidates its facts.
 * At the same revision, an unchanged source note whose rendering changed keeps
 * its stored note instead of conflicting; the next source revision renders it.
 */
export async function confirmUnchangedClinicalSources(input: {
  vaultRoot: string;
  decisions: EventImportDecision[];
  manifest: ClinicalRawManifest;
}): Promise<{ decisions: EventImportDecision[]; unchangedCount: number }> {
  const stored = await readStoredRecords(input.vaultRoot, input.decisions);
  const digest = createClinicalSourceDigests(input.vaultRoot, input.manifest);
  const sameSources = async (record: EventRecord, decision: EventImportDecision) => {
    const before = (record.evidence ?? []).filter((item) => item.sourceLabel?.includes("/"));
    const after = decisionEvidence(decision).filter((item) => item.sourceLabel?.includes("/"));
    if (!isDeepStrictEqual(before.map((item) => item.sourceLabel), after.map((item) => item.sourceLabel))) return false;
    for (const [index, item] of after.entries()) {
      const current = await digest(item);
      if (!current || current !== await digest(before[index]!)) return false;
    }
    return true;
  };

  let unchangedCount = 0;
  const decisions: EventImportDecision[] = [];
  for (const decision of input.decisions) {
    const record = stored.get(decision);
    const check = record ? sourceCheck(record, decision) : null;
    if (check === "later-read" && !await sameSources(record!, decision)) {
      const { retrievalRevision: _unproven, ...superseding } = decision;
      decisions.push(superseding);
    } else if (check === "same-revision-rendering" && await sameSources(record!, decision)) {
      unchangedCount++;
    } else {
      decisions.push(decision);
    }
  }
  return { decisions, unchangedCount };
}

/** The active record for each versioned, facet-free decision, read in one batched lookup. */
async function readStoredRecords(vaultRoot: string, decisions: readonly EventImportDecision[]) {
  const candidates = decisions.flatMap((decision) => {
    const ref = decisionRef(decision);
    return ref?.version && !ref.facet ? [{ decision, ref }] : [];
  });
  const records = await findEventsByExternalRefs({ vaultRoot, refs: candidates.map(({ ref }) =>
    ({ system: ref.system, resourceType: ref.resourceType, resourceId: ref.resourceId, facet: null, includeDeleted: true })) });
  const stored = new Map<EventImportDecision, EventRecord>();
  candidates.forEach(({ decision }, index) => { if (records[index]) stored.set(decision, records[index]); });
  return stored;
}

/** Which decisions need source equality before core sees them. */
function sourceCheck(record: EventRecord, decision: EventImportDecision): "later-read" | "same-revision-rendering" | null {
  const version = record.externalRef?.version;
  const ref = decisionRef(decision);
  if (!version || !ref?.version || !isWritableIsoDateTime(version)) return null;
  const order = compareIsoTimestampsAscending(ref.version, version);
  // Core uses the mark only to keep a live record, or an already withdrawn one.
  const withdrawn = record.lifecycle?.state === "deleted";
  if (order > 0 && decision.retrievalRevision && (decision.action === "upsert") !== withdrawn) return "later-read";
  return order === 0 && decision.action === "upsert" && rendersDifferently(record, decision) ? "same-revision-rendering" : null;
}

function rendersDifferently(record: EventRecord, decision: Upsert): boolean {
  const { payload } = decision;
  return record.lifecycle?.state !== "deleted" && record.kind === "note" && payload.kind === "note"
    && isSourceNote(record.noteType) && payload.noteType === record.noteType
    && !isDeepStrictEqual([payload.note, payload.sections], [record.note, record.sections]);
}
