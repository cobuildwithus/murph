import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clinicalRawManifestSchema, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { importEventBatch, initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

import { applyClinicalEnrichmentProposals, blockClinicalEnrichment, deferClinicalEnrichment, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, readClinicalEnrichmentStatus, readNextClinicalEnrichment } from "../src/clinical-enrichment.js";

const roots: string[] = [];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const occurredAt = "2020-03-12T12:00:00.000Z";
const measurement = (time = occurredAt) => ({ kind: "measurement" as const, occurredAt: time, title: "Synthetic heart rate", note: null, measurements: [{ metric: "heart-rate" as const, value: 70, unit: "bpm" }] });

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(twoDocuments = false) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-enrichment-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, createdAt: "2026-07-10T12:00:00.000Z", timezone: "UTC" });
  const bytes = Buffer.from("%PDF-1.7 synthetic clinical evidence");
  const sha256 = digest(bytes);
  const manifestPath = "raw/clinical/fhir/synthetic-connection/synthetic-batch/manifest.json";
  const rawRef = `${path.posix.dirname(manifestPath)}/attachments/${sha256}.bin`;
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval",
    sourceSystem: "epic-fhir", connectionId: "synthetic-connection", retrievalJobId: "synthetic-batch",
    fhirBaseUrlHash: "a".repeat(64), patientIdHash: "b".repeat(64), fetchedAt: "2026-07-10T12:00:00.000Z",
    requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", coverage: "whole-family", queryFingerprint: "c".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    resourceFiles: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", relativePath: "documentreference/whole/DocumentReference/page-0001.json", count: 1, sha256: "d".repeat(64) }],
    documentAttachments: [{ parentPageSha256: "d".repeat(64), resourceType: "DocumentReference", resourceId: "synthetic-document", attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, mediaType: "application/pdf", sha256, byteLength: bytes.length }],
  });
  await mkdir(path.dirname(path.join(vaultRoot, rawRef)), { recursive: true });
  await writeFile(path.join(vaultRoot, rawRef), bytes);
  if (twoDocuments && "documentAttachments" in manifest && manifest.documentAttachments?.[0]) manifest.documentAttachments.push({ ...manifest.documentAttachments[0], resourceId: "synthetic-second-document" });
  const content = JSON.stringify(clinicalRawManifestSchema.parse(manifest));
  await writeFile(path.join(vaultRoot, manifestPath), content);
  const input = { vaultRoot, manifestPath, manifestSha256: digest(content) };
  const { jobId } = await enqueueClinicalEnrichment(input);
  return { ...input, jobId, sha256, rawRef };
}

async function prepare(input: Awaited<ReturnType<typeof fixture>>, options: { page?: number; totalPages?: number; outputs?: { labs: ClinicalDocumentExtractionOutput; measurements: ClinicalDocumentExtractionOutput; history: ClinicalDocumentExtractionOutput } } = {}) {
  const work = await readNextClinicalEnrichment(input);
  expect(work?.status).toBe("extract");
  await persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: options.page ?? 1, totalPages: options.totalPages ?? 1, outputs: options.outputs ?? { labs: empty, measurements: { status: "complete", records: [{ payload: measurement() }] }, history: empty } });
}

describe("clinical document enrichment durable application", () => {
  it("freezes accepted output, verifies canonical writes, and resumes the next page without resampling", async () => {
    const input = await fixture();
    await prepare(input, { totalPages: 2 });
    expect(await readNextClinicalEnrichment(input)).toEqual({ status: "apply", jobId: input.jobId });
    await persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: 1, totalPages: 2, outputs: { labs: empty, measurements: empty, history: empty } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 1, pages: 1, documents: 0 });
    expect(result.readback.verifiedCount).toBe(1);
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract", page: 2 });
    await prepare(input, { page: 2, totalPages: 2, outputs: { labs: empty, measurements: empty, history: empty } });
    await applyClinicalEnrichmentProposals(input);
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "advance" });
    expect(await readNextClinicalEnrichment(input)).toBeNull();
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "complete", counts: { pages: 2, documents: 1 } });
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attributes).toMatchObject({ source: "import", rawRefs: [input.rawRef], externalRef: { system: "clinical-document-extraction", version: "1970-01-01T00:00:00.000Z" }, evidence: [{ rawRef: input.rawRef, page: 1 }] });
  });

  it("replays immutable accepted proposals after canonical commit without duplicating or overwriting", async () => {
    const input = await fixture();
    await prepare(input);
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const accepted = await readFile(statePath, "utf8");
    await applyClinicalEnrichmentProposals(input);
    // Simulate a process loss after canonical publication but before its state receipt.
    await writeFile(statePath, accepted);
    const replay = await applyClinicalEnrichmentProposals(input);
    expect(replay.canonical).toBeNull();
    expect(replay.counts).toMatchObject({ created: 0, existing: 1 });
    expect(replay.readback.verifiedCount).toBe(1);
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);
  });

  it("skips a proven structured duplicate but preserves a different time on the same day", async () => {
    const input = await fixture();
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, payloads: [{ ...measurement(), source: "import", externalRef: { system: "epic-fhir-synthetic", resourceType: "observation", resourceId: "heart-rate" } }] });
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ payload: measurement() }, { payload: measurement("2020-03-12T16:00:00.000Z") }] } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 1, existing: 1, held: 0 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(2);
  });

  it("keeps partial model blockage explicit after applying supported records", async () => {
    const input = await fixture();
    await prepare(input, { outputs: { labs: { status: "blocked", reason: "Synthetic table is illegible.", records: [] }, measurements: { status: "complete", records: [{ payload: measurement() }] }, history: empty } });
    expect((await applyClinicalEnrichmentProposals(input)).counts).toMatchObject({ created: 1, held: 1 });
    await readNextClinicalEnrichment(input);
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked" });
  });

  it("rejects forged provenance and altered source bytes before any canonical write", async () => {
    const input = await fixture();
    await readNextClinicalEnrichment(input);
    const invalid = { status: "complete" as const, records: [{ payload: { ...measurement(), source: "manual" } }] };
    await expect(persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: 1, totalPages: 1, outputs: { labs: empty, history: empty, measurements: invalid } })).rejects.toThrow();
    await prepare(input);
    await writeFile(path.join(input.vaultRoot, input.rawRef), "altered");
    await expect(applyClinicalEnrichmentProposals(input)).rejects.toThrow("size mismatch");
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", limit: 10 })).toHaveLength(0);
  });

  it("defers recoverable work durably and preserves exact job selection", async () => {
    const input = await fixture();
    await deferClinicalEnrichment({ ...input, reason: "provider_retry", nextAttemptAt: "2026-07-11T12:00:00.000Z" });
    expect(await readNextClinicalEnrichment({ ...input, now: new Date("2026-07-11T11:00:00.000Z") })).toEqual({ status: "deferred", jobId: input.jobId, nextAttemptAt: "2026-07-11T12:00:00.000Z" });
    expect(await readNextClinicalEnrichment({ ...input, jobId: "f".repeat(64) })).toBeNull();
    expect(await readNextClinicalEnrichment({ ...input, now: new Date("2026-07-11T13:00:00.000Z") })).toMatchObject({ status: "extract", page: 1 });
  });

  it("holds an unreadable document while leaving the remaining batch available", async () => {
    const input = await fixture(true);
    await readNextClinicalEnrichment(input);
    await blockClinicalEnrichment({ ...input, reason: "unsupported_document" });
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract", page: 1 });
    await prepare(input);
    expect((await applyClinicalEnrichmentProposals(input)).counts).toMatchObject({ created: 1, held: 1 });
    await readNextClinicalEnrichment(input);
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked", holdReasons: ["unsupported_document"] });
  });

  it("caps failed provider attempts and retains a review hold instead of retrying forever", async () => {
    const input = await fixture();
    await readNextClinicalEnrichment(input);
    const retry = { ...input, reason: "provider_retry", nextAttemptAt: "2026-07-11T12:00:00.000Z" };
    await deferClinicalEnrichment(retry);
    await deferClinicalEnrichment(retry);
    expect(await deferClinicalEnrichment(retry)).toEqual({ status: "pending", nextAttemptAt: undefined });
    await readNextClinicalEnrichment(input);
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked", counts: { held: 1 }, holdReasons: ["Clinical extraction exceeded three provider attempts."] });
  });

  it("records unavailable source bytes before extraction as a durable hold", async () => {
    const input = await fixture();
    await rm(path.join(input.vaultRoot, input.rawRef));
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "advance" });
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked", counts: { held: 1 }, holdReasons: ["Clinical document bytes are missing or failed integrity validation."] });
    expect(await readNextClinicalEnrichment(input)).toBeNull();
  });

  it("deduplicates known lab aliases but holds label-only ambiguity", async () => {
    const input = await fixture();
    const result = { analyte: "Hemoglobin", biomarkerSlug: "hemoglobin", value: 14, unit: "g/dL" };
    const payload = { kind: "test" as const, occurredAt, title: "Synthetic lab", note: null, testName: "Synthetic panel", resultStatus: "normal" as const, specimenType: "blood", results: [result] };
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, payloads: [{ ...payload, source: "import", externalRef: { system: "epic-fhir-synthetic", resourceType: "observation", resourceId: "hemoglobin" } }] });
    await prepare(input, { outputs: { measurements: empty, history: empty, labs: { status: "complete", records: [
      { payload: { ...payload, results: [{ ...result, analyte: "Hgb" }] } },
      { payload: { ...payload, results: [{ analyte: "Hemoglobin", value: 14, unit: "g/dL" }] } },
    ] } } });
    expect((await applyClinicalEnrichmentProposals(input)).counts).toMatchObject({ created: 0, existing: 1, held: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toHaveLength(1);
  });
});
