import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clinicalRawManifestSchema, externalRefForFhir, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { applyHostedCanonicalWriteReceipt, importEventBatch, initializeVault, withHostedCanonicalWritePort, type HostedCanonicalWritePersistenceInput } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

import { applyClinicalEnrichmentProposals, blockClinicalEnrichment, deferClinicalEnrichment, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, planClinicalExtractionUnits, readClinicalEnrichmentStatus, readNextClinicalEnrichment, saveClinicalExtraction } from "../src/clinical-enrichment.js";

const roots: string[] = [];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
const occurredAt = "2020-03-12T12:00:00.000Z";
const measurement = (time = occurredAt) => ({ kind: "measurement" as const, occurredAt: time, title: "Synthetic heart rate", note: null, measurements: [{ metric: "heart-rate" as const, value: 70, unit: "bpm" }] });
const parentRevision = "2026-07-10T12:00:00.000Z";
const parentExternalRef = externalRefForFhir({ sourceSystem: "epic-fhir", fhirBaseUrlHash: "a".repeat(64), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"), resourceType: "DocumentReference", resourceId: "synthetic-document", version: parentRevision });

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(twoDocuments = false, timezone = "UTC", clinicalDate?: string | (string | undefined)[], receiptRequired = false) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-enrichment-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, createdAt: "2026-07-10T12:00:00.000Z", timezone });
  const bytes = Buffer.from("%PDF-1.7 synthetic clinical evidence");
  const sha256 = digest(bytes);
  const manifestPath = "raw/clinical/fhir/synthetic-connection/synthetic-batch/manifest.json";
  const rawRef = `${path.posix.dirname(manifestPath)}/attachments/${sha256}.bin`;
  const parentIds = twoDocuments ? ["synthetic-document", "synthetic-second-document"] : ["synthetic-document"];
  const parentPage = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: parentIds.map((id, index) => ({ resource: {
    resourceType: "DocumentReference", id, status: "current", docStatus: "final",
    meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    date: Array.isArray(clinicalDate) ? clinicalDate[index] : clinicalDate,
    subject: { reference: "Patient/synthetic-patient" },
    content: [{ attachment: { contentType: "application/pdf", url: `Binary/${id}` } }],
  } })) });
  const parentPagePath = "documentreference/whole/DocumentReference/page-0001.json";
  const parentPageSha256 = digest(parentPage);
  const manifest = clinicalRawManifestSchema.parse({
    ...(receiptRequired ? { retrievalProtocol: "query-slices-receipts-v3" } : {}),
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
  await persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: options.page ?? 1, totalPages: options.totalPages ?? 1, outputs: options.outputs ?? { labs: empty, measurements: { status: "complete", records: [{ dateBasis: "document", dateEvidence: occurredAt, payload: measurement() }] }, history: empty } });
}

// Hosted durability: canonical writes reach the receipt log at once, while the
// rest of the vault reaches storage only with the next workspace snapshot.
async function captureCanonicalWrites<T>(run: () => Promise<T>) {
  const writes: HostedCanonicalWritePersistenceInput[] = [];
  const result = await withHostedCanonicalWritePort({ async persistCanonicalWrite(write) { writes.push(write); } }, run);
  return { result, writes };
}
async function snapshotVault(vaultRoot: string) {
  const snapshot = await mkdtemp(path.join(tmpdir(), "murph-clinical-enrichment-snapshot-"));
  roots.push(snapshot);
  await cp(vaultRoot, snapshot, { recursive: true });
  return snapshot;
}
async function replayCanonicalWrites(vaultRoot: string, writes: readonly HostedCanonicalWritePersistenceInput[]) {
  for (const write of writes) {
    const payloads = new Map(write.payloads.map((payload) => [payload.sha256, payload.bytes]));
    await applyHostedCanonicalWriteReceipt({ vaultRoot, receipt: write.receipt, readPayload: async (ref) => payloads.get(ref.sha256) ?? null });
  }
}
const measurementsPage = (time: string) => ({ labs: empty, history: empty, measurements: { status: "complete" as const, records: [{ dateBasis: "document" as const, dateEvidence: occurredAt, payload: measurement(time) }] } });
const pageTimes = ["2020-03-12T08:00:00.000Z", "2020-03-12T09:00:00.000Z", "2020-03-12T10:00:00.000Z"];

describe("clinical document enrichment crash recovery", () => {
  it("restores applied pages from the canonical write log without extracting them again", async () => {
    const input = await fixture();
    const snapshot = await snapshotVault(input.vaultRoot);
    const { result: applied, writes } = await captureCanonicalWrites(async () => {
      const results = [];
      for (const [index, time] of pageTimes.entries()) {
        await prepare(input, { page: index + 1, totalPages: pageTimes.length, outputs: measurementsPage(time) });
        results.push(await applyClinicalEnrichmentProposals(input));
      }
      return results;
    });
    // The container dies before its next snapshot; restore replays the log.
    const restored = { ...input, vaultRoot: snapshot };
    await replayCanonicalWrites(snapshot, writes);
    expect(await readNextClinicalEnrichment(restored)).toEqual({ status: "apply", jobId: input.jobId });
    const replay = await applyClinicalEnrichmentProposals(restored);
    expect(replay.receipt).toEqual(applied.at(-1)?.receipt);
    expect(replay.canonical).toBeNull();
    // The replayed page's fact already exists, so it counts as existing, not created.
    expect((await readClinicalEnrichmentStatus(restored)).counts).toMatchObject({ pages: 3, created: 2, existing: 1 });
    expect(await readNextClinicalEnrichment(restored)).not.toMatchObject({ status: "extract" });
    expect(await listCanonicalEntities(snapshot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(3);
    const jobFile = path.join(snapshot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    expect((await stat(jobFile)).mode & 0o077, "Replayed clinical job state stays owner-only").toBe(0);
  });

  it("commits the accepted job before the receipt that binds it, including held pages", async () => {
    const input = await fixture();
    await prepare(input);
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, decisions: [{ action: "retract", externalRef: { ...parentExternalRef, version: "2026-07-11T12:00:00.000Z" }, reason: "Synthetic parent withdrawal", retractFacetPrefixes: ["document-extraction"] }] });
    const { writes } = await captureCanonicalWrites(() => applyClinicalEnrichmentProposals(input));
    const targets = writes.flatMap((write) => write.receipt.actions.map((action) => action.targetRelativePath));
    const jobWrite = targets.indexOf(`.runtime/operations/clinical-records/enrichment/${input.jobId}.json`);
    const receiptWrite = targets.findIndex((target) => target.startsWith("ledger/clinical-change-receipts/"));
    expect(jobWrite).toBeGreaterThanOrEqual(0);
    expect(jobWrite).toBeLessThan(receiptWrite);
  });

  it("keeps a second replay of the same log idempotent", async () => {
    const input = await fixture();
    const { writes } = await captureCanonicalWrites(async () => {
      await prepare(input);
      return applyClinicalEnrichmentProposals(input);
    });
    const finished = await readClinicalEnrichmentStatus(input);
    await replayCanonicalWrites(input.vaultRoot, writes);
    expect(await readNextClinicalEnrichment(input)).toEqual({ status: "apply", jobId: input.jobId });
    expect((await applyClinicalEnrichmentProposals(input)).canonical).toBeNull();
    expect((await readClinicalEnrichmentStatus(input)).counts.pages).toBe(finished.counts.pages);
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);
  });
});

describe("clinical document enrichment durable application", () => {
  it("refuses restored prepared work whose protocol no longer matches its manifest", async () => {
    const input = await fixture(false, "UTC", occurredAt, true);
    await prepare(input);
    const file = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const original = await readFile(file, "utf8");
    const restored = JSON.parse(original);
    expect(restored.retrievalProtocol).toBe("query-slices-receipts-v3");
    delete restored.retrievalProtocol;
    await writeFile(file, JSON.stringify(restored));
    await expect(applyClinicalEnrichmentProposals(input)).rejects.toThrow("protocol mismatch");
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 1 })).toEqual([]);
    await writeFile(file, original);
    expect((await applyClinicalEnrichmentProposals(input)).counts.created).toBe(1);
  });

  it.each([undefined, "unknown"] as const)("holds a delayed fresh proposal without supported provenance: %s", async (dateBasis) => {
    const input = await fixture(false, "UTC", occurredAt);
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: {
      status: "complete", records: [{ dateBasis, payload: measurement("2026-07-11T00:00:00.000Z") }],
    } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 0, held: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toEqual([]);
  });

  it("holds a contradictory date while saving the supported sibling without a canonical parent", async () => {
    const input = await fixture(false, "UTC", occurredAt);
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: {
      status: "complete", records: [
        { dateBasis: "document", dateEvidence: "Exam date: March 12, 2020", payload: measurement("2026-07-10T00:00:00.000Z") },
        { dateBasis: "document", dateEvidence: "Exam date: March 12, 2020", payload: measurement() },
      ],
    } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 1, held: 1 });
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe(occurredAt);
    expect(rows[0]?.tags).toContain("clinical-date-document");
    expect(result.readback.verifiedCount).toBe(1);
  });

  it.each(["UTC", "America/New_York", "Asia/Tokyo"])("imports and replays frozen date-only records on their documented day in %s", async (timezone) => {
    const input = await fixture(false, timezone);
    const date = "2020-03-12";
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: {
      status: "complete", records: [{ dateBasis: "document", dateEvidence: "March 12, 2020", payload: measurement(date) }],
    } } });
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const frozen = await readFile(statePath, "utf8");
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 1, held: 0 });
    expect(result.readback.verifiedCount).toBe(1);
    await writeFile(statePath, frozen);
    const replay = await applyClinicalEnrichmentProposals(input);
    expect(replay.counts.existing).toBe(1);
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], from: date, to: date, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe(date);
  });

  it("resolves an explicitly source-dated fact against its attested historical parent", async () => {
    const input = await fixture(false, "America/New_York", occurredAt);
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: {
      status: "complete", records: [{ dateBasis: "source", payload: measurement("2026-07-10T00:00:00.000Z") }],
    } } });
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const frozen = await readFile(statePath, "utf8");
    await applyClinicalEnrichmentProposals(input);
    let rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe(occurredAt);
    await writeFile(statePath, frozen);
    await applyClinicalEnrichmentProposals(input);
    rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
  });

  it("retains independently dated historical facts within a source document", async () => {
    const input = await fixture(false, "UTC", "2026-06-10T12:00:00.000Z");
    await prepare(input);
    await applyClinicalEnrichmentProposals(input);
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows[0]?.occurredAt).toBe(occurredAt);
  });

  it.each([undefined, "unknown", "source", "document"] as const)("holds unsupported dates with basis %s", async (dateBasis) => {
    const input = await fixture();
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ dateBasis, payload: measurement("2026-07-10T00:00:00.000Z") }] } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 0, held: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(0);
  });

  it("preserves an evidenced retrieval-day follow-up even when the parent is older", async () => {
    const input = await fixture(false, "UTC", occurredAt);
    const at = "2026-07-10T12:00:00.000Z";
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ dateBasis: "document", dateEvidence: "Follow-up pulse: 2026-07-10T12:00:00Z.", payload: measurement(at) }] } } });
    await applyClinicalEnrichmentProposals(input);
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe(at);
    expect(rows[0]?.tags).toContain("clinical-date-document");
    expect(rows[0]?.attributes.evidence).toEqual([{ rawRef: input.rawRef, page: 1, excerpt: "Follow-up pulse: 2026-07-10T12:00:00Z." }]);
  });
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
    expect(rows[0]?.attributes).toMatchObject({ source: "import", rawRefs: [input.rawRef], externalRef: { ...parentExternalRef, facet: expect.stringMatching(/^document-extraction-[a-f0-9]{64}$/u) }, evidence: [{ rawRef: input.rawRef, page: 1, excerpt: occurredAt }] });
  });

  it("reuses byte-identical extraction across documents while checking and applying each parent", async () => {
    const input = await fixture(true);
    await prepare(input);
    const first = await applyClinicalEnrichmentProposals(input);
    // A separate parent carries identical bytes. Reuse the accepted proposals,
    // then run the ordinary parent/canonical checks without another model call.
    expect(await readNextClinicalEnrichment(input)).toEqual({ status: "apply", jobId: input.jobId });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(first.receipt.changes).toHaveLength(1);
    expect(result.receipt.changes).toEqual([]);
    expect(result.receipt.identity.unit).not.toEqual(first.receipt.identity.unit);
    expect(result.counts.existing).toBeGreaterThan(0);
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);
  });

  it("does not reuse an undated blocked extraction when a second parent supplies a clinical date", async () => {
    const input = await fixture(true, "UTC", [undefined, occurredAt]);
    await prepare(input, { outputs: { labs: empty, measurements: {
      status: "blocked", reason: "The clinical date is unknown.", records: [],
    }, history: empty } });
    await applyClinicalEnrichmentProposals(input);
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract", source: { clinicalOccurredAt: occurredAt } });
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: {
      status: "complete", records: [{ dateBasis: "source", payload: measurement(occurredAt) }],
    } } });
    await applyClinicalEnrichmentProposals(input);
    const rows = await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe(occurredAt);
  });

  it("re-extracts old cached output instead of reusing unsupported date semantics", async () => {
    const input = await fixture();
    const cacheKey = digest(JSON.stringify([input.sha256, "application/pdf", null]));
    const oldCachePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment/extraction-v2", cacheKey, "1.json");
    await mkdir(path.dirname(oldCachePath), { recursive: true });
    await writeFile(oldCachePath, JSON.stringify({ page: 1, totalPages: 1, outputs: {
      labs: empty, history: empty, measurements: { status: "complete", records: [{ payload: measurement() }] },
    } }));
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract", page: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toEqual([]);
  });

  it("replays immutable accepted proposals after canonical commit without duplicating or overwriting", async () => {
    const input = await fixture();
    await prepare(input);
    const statePath = path.join(input.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${input.jobId}.json`);
    const accepted = await readFile(statePath, "utf8");
    const original = await applyClinicalEnrichmentProposals(input);
    // Simulate a process loss after canonical publication but before its state receipt.
    await writeFile(statePath, accepted);
    const replay = await applyClinicalEnrichmentProposals(input);
    expect(original.receipt.changes).toMatchObject([{ action: "created", eventId: original.readback.eventIds[0], revision: 1 }]);
    expect(replay.receipt).toEqual(original.receipt);
    expect(replay.canonical).toBeNull();
    expect(replay.counts).toMatchObject({ created: 0, existing: 1 });
    expect(replay.readback.verifiedCount).toBe(1);
    const changed = JSON.parse(accepted);
    changed.prepared.outputs.measurements.records = [];
    await writeFile(statePath, JSON.stringify(changed));
    await expect(applyClinicalEnrichmentProposals(input)).rejects.toMatchObject({ code: "CLINICAL_RECEIPT_CONFLICT" });
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
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [
      { dateBasis: "document", dateEvidence: occurredAt, payload: measurement() },
      { dateBasis: "document", dateEvidence: "2020-03-12T16:00:00Z", payload: measurement("2020-03-12T16:00:00.000Z") },
    ] } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.counts).toMatchObject({ created: 1, existing: 1, held: 0 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(2);
  });

  it("keeps partial model blockage explicit after applying supported records", async () => {
    const input = await fixture();
    await prepare(input, { outputs: { labs: { status: "blocked", reason: "Synthetic table is illegible.", records: [] }, measurements: { status: "complete", records: [{ dateBasis: "document", dateEvidence: occurredAt, payload: measurement() }] }, history: empty } });
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
    await expect(applyClinicalEnrichmentProposals(input)).rejects.toThrow("integrity mismatch");
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
      { dateBasis: "document", dateEvidence: occurredAt, payload: { ...payload, results: [{ ...result, analyte: "Hgb" }] } },
      { dateBasis: "document", dateEvidence: occurredAt, payload: { ...payload, results: [{ analyte: "Hemoglobin", value: 14, unit: "g/dL" }] } },
    ] } } });
    expect((await applyClinicalEnrichmentProposals(input)).counts).toMatchObject({ created: 0, existing: 1, held: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toHaveLength(1);
  });

  it.each([
    { timezone: "America/New_York", timestamp: "2020-03-12T00:30:00.000Z", dayKey: "2020-03-11" },
    { timezone: "Asia/Tokyo", timestamp: "2020-03-12T20:30:00.000Z", dayKey: "2020-03-13" },
  ])("reads back and replays the canonical local date in $timezone", async ({ timezone, timestamp, dayKey }) => {
    const input = await fixture(false, timezone);
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ dateBasis: "document", dateEvidence: timestamp, payload: measurement(timestamp) }] } } });
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

    expect(await readNextClinicalEnrichment({ vaultRoot: input.vaultRoot })).toMatchObject({ status: "apply", jobId: next.jobId });
  });

  it("finds existing structured facts across the UTC and vault-date boundary", async () => {
    const input = await fixture(false, "America/New_York");
    const payload = measurement("2020-03-12T00:30:00.000Z");
    await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, payloads: [{ ...payload, source: "import", externalRef: { system: "epic-fhir-synthetic", resourceType: "observation", resourceId: "local-day-heart-rate" } }] });
    await prepare(input, { outputs: { labs: empty, history: empty, measurements: { status: "complete", records: [{ dateBasis: "document", dateEvidence: payload.occurredAt, payload }] } } });
    const result = await applyClinicalEnrichmentProposals(input);
    expect(result.canonical).toBeNull();
    expect(result.counts).toMatchObject({ created: 0, existing: 1, held: 0, pages: 1 });
    expect(await listCanonicalEntities(input.vaultRoot, { family: "event", kinds: ["measurement"], limit: 10 })).toHaveLength(1);
  });
});

describe("clinical extraction lookahead", () => {
  const vitals = (page: number) => ({ labs: empty, history: empty,
    measurements: { status: "complete" as const, records: [{ dateBasis: "document" as const, dateEvidence: occurredAt, page, payload: measurement() }] } });
  const plan = (input: Awaited<ReturnType<typeof fixture>>, extra: Partial<Parameters<typeof planClinicalExtractionUnits>[0]> = {}) =>
    planClinicalExtractionUnits({ vaultRoot: input.vaultRoot, limit: 10, countPages: async () => 3, ...extra });

  it("plans the cursor first, then later pages, skipping cached and excluded units", async () => {
    const input = await fixture();
    const units = await plan(input);
    expect(units.map((unit) => [unit.page, unit.cursor, unit.cursorRef, unit.failures])).toEqual([[1, true, "0:0:1", 0], [2, false, "0:0:2", 0], [3, false, "0:0:3", 0]]);
    expect(units.every((unit) => unit.jobId === input.jobId && unit.source.sha256 === input.sha256)).toBe(true);
    expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: units[1]!, totalPages: 3, outputs: vitals(2) })).toBe("saved");
    expect((await plan(input)).map((unit) => unit.page)).toEqual([1, 3]);
    expect((await plan(input, { exclude: (unit) => unit.cursor })).map((unit) => unit.page)).toEqual([3]);
    expect((await plan(input, { limit: 1 })).map((unit) => unit.page)).toEqual([1]);
  });

  it("saves write-if-absent and the cursor promotes cached pages in order with retry state cleared", async () => {
    const input = await fixture();
    const units = await plan(input);
    for (const unit of units.reverse()) {
      expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit, totalPages: 3, outputs: vitals(unit.page) })).toBe("saved");
    }
    expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: units[0]!, totalPages: 3, outputs: vitals(units[0]!.page) })).toBe("existing");
    // A failed earlier attempt leaves a retry on the job; accepting the cached page clears it.
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "apply" });
    for (const page of [1, 2, 3]) {
      if (page > 1) expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "apply" });
      await applyClinicalEnrichmentProposals(input);
    }
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "pending", counts: { pages: 3 }, nextAttemptAt: undefined });
    expect(await plan(input)).toEqual([]);
  });

  it("clears a deferred cursor's retry when its cached proposal is accepted", async () => {
    const input = await fixture();
    const [cursor] = await plan(input);
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract", failures: 0 });
    await deferClinicalEnrichment({ ...input, reason: "Synthetic retry.", nextAttemptAt: "2026-07-10T12:01:00.000Z", cursorRef: cursor!.cursorRef });
    // The deferred job plans nothing until its retry time.
    expect(await plan(input, { now: new Date("2026-07-10T12:00:30.000Z") })).toEqual([]);
    expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: cursor!, totalPages: 3, outputs: vitals(1) })).toBe("saved");
    expect(await readNextClinicalEnrichment({ ...input, now: new Date("2026-07-10T12:02:00.000Z") })).toMatchObject({ status: "apply" });
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "prepared", nextAttemptAt: undefined });
    // A prepared cursor page is frozen in the job; only later pages are planned.
    expect((await plan(input)).map((unit) => unit.page)).toEqual([2, 3]);
  });

  it("settles a failure only while the job's cursor still points at that unit", async () => {
    const input = await fixture();
    const [cursor, ahead] = await plan(input);
    expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract" });
    const deferral = { ...input, reason: "Synthetic retry.", nextAttemptAt: "2026-07-10T12:01:00.000Z" };
    expect(await deferClinicalEnrichment({ ...deferral, cursorRef: ahead!.cursorRef })).toMatchObject({ status: "pending", nextAttemptAt: undefined });
    await blockClinicalEnrichment({ ...input, reason: "Synthetic unsupported.", cursorRef: ahead!.cursorRef });
    expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "pending", counts: { held: 0 } });
    expect(await deferClinicalEnrichment({ ...deferral, cursorRef: cursor!.cursorRef })).toMatchObject({ nextAttemptAt: deferral.nextAttemptAt });
  });

  it("refuses a save whose unit no longer matches its attested source", async () => {
    const input = await fixture();
    const [cursor] = await plan(input);
    expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: { ...cursor!, key: "forged/1.json" }, totalPages: 3, outputs: vitals(1) })).toBe("stale");
    expect(await saveClinicalExtraction({ vaultRoot: input.vaultRoot, unit: { ...cursor!, source: { ...cursor!.source, sha256: "f".repeat(64) } }, totalPages: 3, outputs: vitals(1) })).toBe("stale");
    expect((await plan(input)).map((unit) => unit.page)).toEqual([1, 2, 3]);
  });
});
