import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clinicalRawManifestSchema, hashClinicalFhirBaseUrl, hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { findEventByExternalRef, importEventBatch, initializeVault } from "@murphai/core";
import { buildClinicalImportPlanFromSnapshot, clinicalPlanToEventImportDecisions } from "@murphai/importers/clinical-records";
import { listCanonicalEntities } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, readNextClinicalEnrichment } from "../src/clinical-enrichment.ts";
import { readClinicalEnrichmentParentEligibility } from "../src/clinical-enrichment-parent.ts";

const roots: string[] = [];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(options: {
  resourceType?: "DocumentReference" | "DiagnosticReport"; status?: string; docStatus?: string; duplicate?: boolean; subject?: string; revision?: unknown;
  /** Reuse an initialized vault so a later batch can supersede an earlier one. */
  vaultRoot?: string; batch?: string; fetchedAt?: string;
} = {}) {
  const vaultRoot = options.vaultRoot ?? await mkdtemp(path.join(tmpdir(), "clinical-enrichment-parent-"));
  if (!options.vaultRoot) {
    roots.push(vaultRoot);
    await initializeVault({ vaultRoot, timezone: "UTC", createdAt: "2026-07-10T12:00:00Z" });
  }
  const batch = options.batch ?? "synthetic-batch";
  const resourceType = options.resourceType ?? "DocumentReference";
  const attachment = { contentType: "application/pdf", url: "Binary/synthetic-document" };
  const parent = { resourceType, id: "synthetic-document", status: options.status ?? "current",
    ...(options.docStatus ? { docStatus: options.docStatus } : {}),
    meta: { lastUpdated: "revision" in options ? options.revision : "2026-07-10T12:00:00Z" }, subject: { reference: options.subject ?? "Patient/synthetic-patient" },
    ...(resourceType === "DocumentReference" ? { content: [{ attachment }] } : { presentedForm: [attachment] }),
  };
  const content = JSON.stringify({ resourceType: "Bundle", entry: (options.duplicate ? [parent, parent] : [parent]).map((resource) => ({ resource })) });
  const manifestPath = `raw/clinical/fhir/synthetic-connection/${batch}/manifest.json`;
  const relativePath = `documents/whole/${resourceType}/page-0001.json`;
  const document = "%PDF-1.7 synthetic scanned evidence";
  const sha256 = digest(document);
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval", sourceSystem: "epic-fhir",
    connectionId: "synthetic-connection", retrievalJobId: batch, fetchedAt: options.fetchedAt ?? "2026-07-10T12:00:00Z",
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: [`patient/${resourceType}.read`], grantedScopes: [`patient/${resourceType}.read`],
    retrievalSlices: [{ queryScopeId: "documents", sliceId: "whole", resourceType, coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documents", sliceId: "whole" }],
    resourceFiles: [{ queryScopeId: "documents", sliceId: "whole", resourceType, relativePath, count: options.duplicate ? 2 : 1, sha256: digest(content) }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType, resourceId: parent.id, attachmentIndex: 0,
      status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: Buffer.byteLength(document), mediaType: "application/pdf" }],
  });
  const parentPagePath = path.join(vaultRoot, path.dirname(manifestPath), relativePath);
  await mkdir(path.dirname(parentPagePath), { recursive: true });
  await writeFile(parentPagePath, content);
  const downloaded = manifest.documentAttachments?.[0];
  if (downloaded?.status !== "downloaded") throw new Error("Missing synthetic attachment.");
  const rawRef = path.posix.join(path.posix.dirname(manifestPath), downloaded.relativePath);
  await mkdir(path.dirname(path.join(vaultRoot, rawRef)), { recursive: true });
  await writeFile(path.join(vaultRoot, rawRef), document);
  const manifestContent = JSON.stringify(manifest);
  await writeFile(path.join(vaultRoot, manifestPath), manifestContent);
  return { vaultRoot, manifestPath, manifestSha256: digest(manifestContent), manifest, attachment: downloaded, parentPagePath, rawRef };
}

describe("clinical enrichment attested parent eligibility", () => {
  it.each([
    { resourceType: "DocumentReference" as const, status: "current", eligible: true },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "final", eligible: true },
    { resourceType: "DocumentReference" as const, status: "entered-in-error", eligible: false },
    { resourceType: "DocumentReference" as const, status: "superseded", eligible: false },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "entered-in-error", eligible: false },
    { resourceType: "DocumentReference" as const, status: "current", docStatus: "preliminary", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "final", eligible: true },
    { resourceType: "DiagnosticReport" as const, status: "corrected", eligible: true },
    { resourceType: "DiagnosticReport" as const, status: "cancelled", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "entered-in-error", eligible: false },
    { resourceType: "DiagnosticReport" as const, status: "preliminary", eligible: false },
  ])("uses shared parent policy for $resourceType $status $docStatus without requiring a readable canonical note", async (options) => {
    const input = await fixture(options);
    expect(await readClinicalEnrichmentParentEligibility(input)).toMatchObject({ eligible: options.eligible });
  });

  it.each([
    { resourceType: "DocumentReference" as const, status: "current", revision: "2026-07-10T12:00:00.123456Z" },
    { resourceType: "DocumentReference" as const, status: "current", revision: "2026-07-10T12:00:00.123456789Z" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2026-07-10T08:00:00.123456-04:00" },
    { resourceType: "DiagnosticReport" as const, status: "final", revision: "2026-07-10T12:00:00.123456789Z" },
  ])("preserves the exact writable revision for $resourceType $revision", async (options) => {
    const parent = await readClinicalEnrichmentParentEligibility(await fixture(options));
    expect(parent).toMatchObject({ eligible: true, parentRevision: options.revision, parentExternalRef: { version: options.revision } });
  });

  it.each(["not-a-timestamp", "2026-07-10", "2026-02-30T12:00:00.123456789Z"])("rejects non-comparable parent revisions: %s", async (revision) => {
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ revision }))).rejects.toThrow("source attestation");
  });

  it("binds a parent without meta.lastUpdated to the retrieval fetchedAt, matching the importer", async () => {
    const parent = await readClinicalEnrichmentParentEligibility(await fixture({ revision: undefined, fetchedAt: "2026-07-11T09:30:00Z" }));
    expect(parent).toMatchObject({ eligible: true, parentRevision: "2026-07-11T09:30:00Z", parentExternalRef: { version: "2026-07-11T09:30:00Z" } });
  });

  it("holds already prepared proposals for a withdrawn origin without altering raw evidence or publishing facts", async () => {
    const input = await fixture({ status: "entered-in-error" });
    const { jobId } = await enqueueClinicalEnrichment(input);
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${jobId}.json`);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const empty = { status: "complete", records: [] };
    // Restore an accepted proposal checkpoint produced before origin eligibility was enforced.
    await writeFile(statePath, JSON.stringify({ ...state, status: "prepared",
      source: { rawRef: input.rawRef, sha256: input.attachment.sha256, byteLength: input.attachment.byteLength, mediaType: input.attachment.mediaType },
      prepared: { page: 1, totalPages: 1, outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ payload: {
        kind: "measurement", occurredAt: "2026-07-10T12:00:00Z", title: "Synthetic heart rate", note: null,
        measurements: [{ metric: "heart-rate", value: 70, unit: "bpm" }],
      } }] } } },
    }));
    const rawBefore = await readFile(path.join(input.vaultRoot, input.rawRef));
    expect(await applyClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({
      canonical: null, counts: { created: 0, held: 1 }, readback: { verifiedCount: 0 },
    });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toEqual([]);
    expect(await readFile(path.join(input.vaultRoot, input.rawRef))).toEqual(rawBefore);
    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ status: "advance" });
    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toBeNull();
  });

  it("rebuilds document extraction at the retrieval revision after an undated reconnect supersedes a dated parent", async () => {
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const importParent = async (input: Fixture) => {
      const file = input.manifest.resourceFiles[0]!;
      const plan = buildClinicalImportPlanFromSnapshot({ manifestPath: input.manifestPath, manifest: input.manifest,
        pages: [{ relativePath: file.relativePath, content: await readFile(input.parentPagePath, "utf8") }],
        attachments: [{ relativePath: input.attachment.relativePath, contentBase64: (await readFile(path.join(input.vaultRoot, input.rawRef))).toString("base64") }] });
      return importEventBatch({ vaultRoot: input.vaultRoot, decisions: clinicalPlanToEventImportDecisions(plan), apply: true });
    };
    const extracted = { payload: { kind: "measurement", occurredAt: "2026-07-10T12:00:00Z", title: "Synthetic heart rate", note: null,
      measurements: [{ metric: "heart-rate", value: 70, unit: "bpm" }] } };
    const enrich = async (input: Fixture) => {
      const { jobId } = await enqueueClinicalEnrichment(input);
      // The attested parent is accepted for extraction instead of being held.
      expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot, jobId })).toMatchObject({ status: "extract" });
      const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${jobId}.json`);
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const empty = { status: "complete", records: [] };
      await writeFile(statePath, JSON.stringify({ ...state, status: "prepared",
        source: { rawRef: input.rawRef, sha256: input.attachment.sha256, byteLength: input.attachment.byteLength, mediaType: input.attachment.mediaType },
        prepared: { page: 1, totalPages: 1, outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [extracted] } } } }));
      return applyClinicalEnrichmentProposals({ vaultRoot: input.vaultRoot, jobId });
    };
    const liveMeasurements = (vaultRoot: string) => listCanonicalEntities(vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    const parentLookup = (input: Fixture) => ({ vaultRoot: input.vaultRoot, resourceType: "document-reference", resourceId: "synthetic-document",
      system: `epic-fhir-${input.manifest.fhirBaseUrlHash}-${input.manifest.patientIdHash}` });

    const dated = await fixture({ fetchedAt: "2026-07-10T12:00:00Z" });
    expect(await importParent(dated)).toMatchObject({ createdCount: 1 });
    expect(await enrich(dated)).toMatchObject({ counts: { created: 1, held: 0 } });
    expect(await liveMeasurements(dated.vaultRoot)).toHaveLength(1);

    // The same document returns on a later retrieval that omits meta.lastUpdated.
    const reconnect = await fixture({ vaultRoot: dated.vaultRoot, batch: "synthetic-batch-2", fetchedAt: "2026-07-12T08:00:00Z", revision: undefined });
    const superseded = await importParent(reconnect);
    expect(superseded.createdCount).toBe(0);
    expect(superseded.supersededCount).toBeGreaterThanOrEqual(1);
    expect(await findEventByExternalRef(parentLookup(reconnect)))
      .toEqual(expect.objectContaining({ externalRef: expect.objectContaining({ version: "2026-07-12T08:00:00Z" }) }));
    expect(await liveMeasurements(dated.vaultRoot)).toEqual([]);
    // Enrichment binds to the same retrieval revision the importer assigned, so the withdrawn fact is rebuilt.
    expect(await enrich(reconnect)).toMatchObject({ counts: { created: 1, held: 0 } });
    expect(await liveMeasurements(dated.vaultRoot)).toHaveLength(1);
  });

  it("rejects mutated parent bytes, ambiguous resource identity and contradictory patient binding", async () => {
    const altered = await fixture();
    await writeFile(altered.parentPagePath, "{}");
    await expect(readClinicalEnrichmentParentEligibility(altered)).rejects.toThrow("source attestation");
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ duplicate: true }))).rejects.toThrow("source attestation");
    await expect(readClinicalEnrichmentParentEligibility(await fixture({ subject: "Patient/other" }))).rejects.toThrow("source attestation");
  });

  it("rejects a forged attachment slot or a manifest with no matching parent page", async () => {
    const input = await fixture();
    await expect(readClinicalEnrichmentParentEligibility({ ...input, attachment: { ...input.attachment, attachmentIndex: 1 } })).rejects.toThrow("source attestation");
    input.manifest.resourceFiles[0]!.sha256 = "c".repeat(64);
    await expect(readClinicalEnrichmentParentEligibility(input)).rejects.toThrow("source attestation");
  });
});
