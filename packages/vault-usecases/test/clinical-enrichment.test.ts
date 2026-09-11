import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clinicalRawManifestSchema, externalRefForFhir, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { importEventBatch, initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

import { applyClinicalEnrichmentProposals, blockClinicalEnrichment, deferClinicalEnrichment, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, readClinicalEnrichmentStatus, readNextClinicalEnrichment } from "../src/clinical-enrichment.js";

const roots: string[] = [];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const occurredAt = "2020-03-12T12:00:00.000Z";
const measurement = (time = occurredAt) => ({ kind: "measurement" as const, occurredAt: time, title: "Synthetic heart rate", note: null, measurements: [{ metric: "heart-rate" as const, value: 70, unit: "bpm" }] });
const parentRevision = "2026-07-10T12:00:00.000Z";
const parentExternalRef = externalRefForFhir({ sourceSystem: "epic-fhir", fhirBaseUrlHash: "a".repeat(64), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), resourceType: "DocumentReference", resourceId: "synthetic-document", version: parentRevision });

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(twoDocuments = false, timezone = "UTC") {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-enrichment-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, createdAt: "2026-07-10T12:00:00.000Z", timezone });
  const bytes = Buffer.from("%PDF-1.7 synthetic clinical evidence");
  const sha256 = digest(bytes);
  const manifestPath = "raw/clinical/fhir/synthetic-connection/synthetic-batch/manifest.json";
  const rawRef = `${path.posix.dirname(manifestPath)}/attachments/${sha256}.bin`;
  const parentIds = twoDocuments ? ["synthetic-document", "synthetic-second-document"] : ["synthetic-document"];
  const parentPage = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: parentIds.map((id) => ({ resource: {
    resourceType: "DocumentReference", id, status: "current", docStatus: "final",
    meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    subject: { reference: "Patient/synthetic-patient" },
    content: [{ attachment: { contentType: "application/pdf", url: `Binary/${id}` } }],
  } })) });
  const parentPagePath = "documentreference/whole/DocumentReference/page-0001.json";
  const parentPageSha256 = digest(parentPage);
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval",
    sourceSystem: "epic-fhir", connectionId: "synthetic-connection", retrievalJobId: "synthetic-batch",
    fhirBaseUrlHash: "a".repeat(64), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), fetchedAt: "2026-07-10T12:00:00.000Z",
    requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", coverage: "whole-family", queryFingerprint: "c".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    resourceFiles: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", relativePath: parentPagePath, count: parentIds.length, sha256: parentPageSha256 }],
    documentAttachments: parentIds.map((resourceId) => ({ parentPageSha256, resourceType: "DocumentReference", resourceId, attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, mediaType: "application/pdf", sha256, byteLength: bytes.length })),
  });
  await mkdir(path.dirname(path.join(vaultRoot, rawRef)), { recursive: true });
  await writeFile(path.join(vaultRoot, rawRef), bytes);
  const rawPagePath = path.join(vaultRoot, path.posix.dirname(manifestPath), parentPagePath);
  await mkdir(path.dirname(rawPagePath), { recursive: true });
  await writeFile(rawPagePath, parentPage);
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
    expect(rows[0]?.attributes).toMatchObject({ source: "import", rawRefs: [input.rawRef], externalRef: { ...parentExternalRef, facet: expect.stringMatching(/^document-extraction-[a-f0-9]{64}$/u) }, evidence: [{ rawRef: input.rawRef, page: 1 }] });
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

  it.each(["withdrawn", "newer-active"] as const)("holds prepared extraction when its parent becomes %s", async (state) => {
    const input = await fixture();
    await prepare(input);
    const externalRef = { ...parentExternalRef, version: "2026-07-11T12:00:00.000Z" };
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, decisions: state === "withdrawn"
      ? [{ action: "retract", externalRef, reason: "Synthetic parent withdrawal", retractFacetPrefixes: ["document-extraction"] }]
      : [{ action: "upsert", payload: { kind: "note", occurredAt, title: "Synthetic newer parent", note: "Updated synthetic source note", source: "import", externalRef } }],
    });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result).toMatchObject({ canonical: null, counts: { created: 0, held: 1 }, readback: { verifiedCount: 0 } });
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "pending", holdReasons: ["Clinical document parent was withdrawn or replaced by a newer revision."] });
    await readNextClinicalEnrichment(input);
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked" });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(0);
  });

  it("retracts applied derived facts with their parent and rejects accepted-page replay", async () => {
    const input = await fixture();
    await prepare(input);
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const accepted = await readFile(statePath, "utf8");
    await applyClinicalEnrichmentProposals(input);
    const result = await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, decisions: [{ action: "retract", externalRef: { ...parentExternalRef, version: "2026-07-11T12:00:00.000Z" }, reason: "Synthetic parent withdrawal", retractFacetPrefixes: ["document-extraction"] }] });
    expect(result.retractedCount).toBeGreaterThanOrEqual(1);
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(0);
    await writeFile(statePath, accepted);
    expect(await applyClinicalEnrichmentProposals(input)).toMatchObject({ canonical: null, counts: { held: 1 }, readback: { verifiedCount: 0 } });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(0);
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
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked", counts: { held: 1 }, holdReasons: ["Clinical document or parent evidence failed integrity validation."] });
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

  it.each([
    { timezone: "America/New_York", timestamp: "2020-03-12T00:30:00.000Z", dayKey: "2020-03-11" },
    { timezone: "Asia/Tokyo", timestamp: "2020-03-12T20:30:00.000Z", dayKey: "2020-03-13" },
  ])("reads back and replays the canonical local date in $timezone", async ({ timezone, timestamp, dayKey }) => {
    const input = await fixture(false, timezone);
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ payload: measurement(timestamp) }] } } });
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const accepted = await readFile(statePath, "utf8");
    const nextManifestPath = input.manifestPath.replace("synthetic-batch", "synthetic-next-batch");
    const nextRawRef = input.rawRef.replace("synthetic-batch", "synthetic-next-batch");
    const original = clinicalRawManifestSchema.parse(JSON.parse(await readFile(path.join(input.vaultRoot, input.manifestPath), "utf8")));
    const nextContent = JSON.stringify({ ...original, retrievalJobId: "synthetic-next-batch" });
    await mkdir(path.dirname(path.join(input.vaultRoot, nextRawRef)), { recursive: true });
    await writeFile(path.join(input.vaultRoot, nextRawRef), await readFile(path.join(input.vaultRoot, input.rawRef)));
    for (const resourceFile of original.resourceFiles) {
      const nextPagePath = path.join(input.vaultRoot, path.posix.dirname(nextManifestPath), resourceFile.relativePath);
      await mkdir(path.dirname(nextPagePath), { recursive: true });
      await writeFile(nextPagePath, await readFile(path.join(input.vaultRoot, path.posix.dirname(input.manifestPath), resourceFile.relativePath)));
    }
    await writeFile(path.join(input.vaultRoot, nextManifestPath), nextContent);
    const next = await enqueueClinicalEnrichment({ vaultRoot: input.vaultRoot, manifestPath: nextManifestPath, manifestSha256: digest(nextContent) });

    const applied = await applyClinicalEnrichmentProposals(input);
    expect(applied.counts).toMatchObject({ created: 1, pages: 1, documents: 1 });
    expect(applied.readback.verifiedCount).toBe(1);
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], from: dayKey, to: dayKey, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attributes).toMatchObject({ dayKey });

    // Canonical publication can precede the receipt, including at a date boundary.
    await writeFile(statePath, accepted);
    const replay = await applyClinicalEnrichmentProposals(input);
    expect(replay.canonical).toBeNull();
    expect(replay.readback.verifiedCount).toBe(1);
    expect(replay.counts).toMatchObject({ existing: 1, pages: 1, documents: 1 });
    await readNextClinicalEnrichment(input);
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "complete" });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);

    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot })).toMatchObject({ status: "extract", jobId: next.jobId });
  });

  it("finds existing structured facts across the UTC and vault-date boundary", async () => {
    const input = await fixture(false, "America/New_York");
    const payload = measurement("2020-03-12T00:30:00.000Z");
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, payloads: [{ ...payload, source: "import", externalRef: { system: "epic-fhir-synthetic", resourceType: "observation", resourceId: "local-day-heart-rate" } }] });
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ payload }] } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.canonical).toBeNull();
    expect(result.counts).toMatchObject({ created: 0, existing: 1, held: 0, pages: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);
  });
});
