import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hashClinicalFhirBaseUrl, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput } from "@murphai/clinical-records";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { importClinicalFhirSnapshot, type ClinicalFhirSnapshotImportInput } from "@murphai/vault-usecases/clinical-records";
import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, readNextClinicalEnrichment, readClinicalEnrichmentStatus } from "@murphai/vault-usecases/clinical-enrichment";
import { runOneHostedClinicalEnrichment, type HostedClinicalEnrichmentInput } from "../src/hosted-runtime/clinical-enrichment.ts";

const roots: string[] = [];
const date = "2020-03-12T12:00:00.000Z";
const revision = "2026-07-01T12:00:00.000Z";
const source = (id = "unmapped") => ({ resourceType: "Observation", id, status: "final",
  subject: { reference: "Patient/synthetic-patient" }, meta: { lastUpdated: revision }, effectiveDateTime: date,
  code: { text: "Narrative assessment" }, valueString: "Resting heart rate 73 bpm." });
const deterministic = { ...source("known"), code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
  valueString: undefined, valueQuantity: { value: 80, unit: "kg", system: "http://unitsofmeasure.org", code: "kg" } };
const output: ClinicalDocumentExtractionOutput = { status: "complete", records: [{
  dateBasis: "source", excerpt: "Resting heart rate 73 bpm.", payload: { kind: "measurement", occurredAt: date, note: undefined,
    title: "Resting heart rate", measurements: [{ metric: "resting-heart-rate", value: 73, unit: "bpm" }] },
}] };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(resources: unknown[] = [source(), deterministic]) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-structured-flow-")); roots.push(vaultRoot);
  await initializeVault({ vaultRoot, timezone: "UTC", createdAt: revision });
  const input: ClinicalFhirSnapshotImportInput = { vaultRoot, sourceSystem: "epic-fhir", connectionId: "synthetic-connection",
    retrievalJobId: "synthetic-import", fetchedAt: revision, retrievalProtocol: "query-slices-v2",
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: ["patient/Observation.read"], grantedScopes: ["patient/Observation.read"],
    retrievalSlices: [{ queryScopeId: "observation", sliceId: "whole", resourceType: "Observation", coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "observation", sliceId: "whole" }],
    pages: [{ queryScopeId: "observation", sliceId: "whole", resourceType: "Observation", content: JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: resources.map((resource) => ({ resource })) }) }] };
  const result = await importClinicalFhirSnapshot(input);
  const { jobId } = await enqueueClinicalEnrichment({ vaultRoot, manifestPath: result.manifestPath, manifestSha256: result.manifestSha256, structuredSources: result.structuredEnrichmentSources });
  const executeExtraction = vi.fn<NonNullable<HostedClinicalEnrichmentInput["executeExtraction"]>>(async (request) => {
    await request.beforeProviderEntry?.(); return output;
  });
  const runtime: HostedClinicalEnrichmentInput = { vaultRoot, memberId: "synthetic-member", codexHome: null, env: {},
    abortSignal: new AbortController().signal, onStateMutation() {}, executeExtraction };
  return { input, result, vaultRoot, jobId, runtime, executeExtraction };
}

it("extracts once per retained record, preserves deterministic results and replays frozen proposals without resampling", async () => {
  const f = await fixture();
  expect(f.result.structuredEnrichmentSources).toHaveLength(1);
  expect(f.result.canonical.createdCount).toBe(2);
  expect(await runOneHostedClinicalEnrichment(f.runtime)).toBe("settled");
  expect(f.executeExtraction).toHaveBeenCalledOnce();
  const request = f.executeExtraction.mock.calls[0]![0];
  expect(request).toMatchObject({ family: "all", model: "gpt-5.6-luna", source: { resource: { resourceId: "unmapped" } } });
  expect(request.extractedText).toContain("Resting heart rate 73 bpm.");
  expect(request.extractedText).not.toContain('"id": "known"');
  expect(await runOneHostedClinicalEnrichment(f.runtime)).toBe("idle");
  expect(f.executeExtraction).toHaveBeenCalledOnce();
  const statePath = path.join(f.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${f.jobId}.json`);
  const frozen = await readFile(statePath, "utf8");
  const applied = await applyClinicalEnrichmentProposals(f);
  expect(applied.readback.verifiedCount).toBe(1);
  expect(applied.canonical?.createdCount).toBe(1);
  await writeFile(statePath, frozen);
  expect((await applyClinicalEnrichmentProposals(f)).counts.existing).toBe(1);
  const rows = await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["measurement", "note"], limit: 20 });
  expect(rows).toHaveLength(3);
  expect(rows.filter((row) => row.kind === "note")).toHaveLength(1);
  expect(await readNextClinicalEnrichment(f)).toMatchObject({ status: "advance" });
  expect(await readNextClinicalEnrichment(f)).toBeNull();
});

it.each(["entered-in-error", "corrected"])("retires extracted facts when the parent is %s and rejects its queued old proposal", async (status) => {
  const f = await fixture();
  await runOneHostedClinicalEnrichment(f.runtime);
  const statePath = path.join(f.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${f.jobId}.json`);
  const frozen = await readFile(statePath, "utf8");
  await applyClinicalEnrichmentProposals(f);
  await importClinicalFhirSnapshot({ ...f.input, retrievalJobId: "updated-import", fetchedAt: "2026-07-02T12:00:00.000Z",
    pages: [{ ...f.input.pages[0]!, content: JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource: {
      ...source(), status, meta: { lastUpdated: "2026-07-02T12:00:00.000Z" }, valueString: "Resting heart rate 75 bpm.",
    } }] }) }] });
  expect((await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["measurement"], limit: 20 })).filter((row) => row.title === "Resting heart rate")).toHaveLength(0);
  await writeFile(statePath, frozen);
  expect((await applyClinicalEnrichmentProposals(f)).canonical).toBeNull();
});

it("keeps unsafe statuses held while admitting undated source observations", async () => {
  const f = await fixture([deterministic, { ...source("preliminary"), status: "preliminary" }, { ...source("undated"), effectiveDateTime: undefined }]);
  expect(f.result.structuredEnrichmentSources).toMatchObject([{ resourceId: "undated" }]);
  await runOneHostedClinicalEnrichment(f.runtime);
  expect(f.executeExtraction).toHaveBeenCalledOnce();
});

it.each(["Invented source evidence", "Resting pulse: 73 bpm"])("holds nonliteral evidence (%s) and preserves its source note", async (excerpt) => {
  const f = await fixture();
  f.executeExtraction.mockResolvedValue({ ...output, records: output.records.map((record) => ({ ...record, excerpt })) });
  await runOneHostedClinicalEnrichment(f.runtime);
  const applied = await applyClinicalEnrichmentProposals(f);
  expect(applied).toMatchObject({ canonical: null, counts: { held: 1 } });
  expect((await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["note"], limit: 10 }))).toHaveLength(1);
});

it("does not reuse extraction for a different record on the same page", async () => {
  const f = await fixture([source(), { ...source("second"), effectiveDateTime: "2020-03-13T12:00:00.000Z", valueString: "Resting heart rate 74 bpm." }]);
  await runOneHostedClinicalEnrichment(f.runtime);
  await applyClinicalEnrichmentProposals(f);
  const next = await readNextClinicalEnrichment(f);
  expect(next).toMatchObject({ status: "extract", source: { resource: { resourceId: "second" } } });
  expect(next?.status === "extract" && next.extractedText).toContain("74 bpm");
});

it.each([
  { code: "assessment", codeSystem: "urn:oid:1.2.3.4", accepted: true },
  { code: "assessment", codeSystem: "urn:oid:1.2.3", accepted: false },
  { code: "assessment", codeSystem: "urn:oid:1.2.3.5", accepted: false },
  { code: "invented", codeSystem: "urn:oid:1.2.3.4", accepted: false },
  { code: "assessment", codeSystem: undefined, accepted: false },
])("attests a clinical assertion coding as an exact pair: $code / $codeSystem", async ({ code, codeSystem, accepted }) => {
  const text = "Clinical assessment completed.";
  const f = await fixture([{ ...source(), valueString: text, code: { coding: [
    { code: "assessment", system: "urn:oid:1.2.3.4", display: "Clinical assessment" },
    { code: "encounter", system: "urn:oid:1.2.3.5", display: "Encounter" },
  ] } }]);
  f.executeExtraction.mockResolvedValue({ status: "complete", records: [{ dateBasis: "source", excerpt: text,
    payload: { kind: "clinical_assertion", occurredAt: date, assertedOn: date.slice(0, 10),
      title: "Clinical assessment", note: undefined, assertion: "not_applicable", domain: "exam", code, codeSystem,
      assertionText: text },
  }] });
  await runOneHostedClinicalEnrichment(f.runtime);
  const applied = await applyClinicalEnrichmentProposals(f);
  expect(applied.counts).toMatchObject({ created: accepted ? 1 : 0, held: accepted ? 0 : 1 });
  expect(applied.readback.verifiedCount).toBe(accepted ? 1 : 0);
  expect(await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["note"], limit: 10 })).toHaveLength(1);
});

it("holds a changed raw page before any model call", async () => {
  const f = await fixture();
  const rawRef = f.result.structuredEnrichmentSources![0]!.rawRef;
  await writeFile(path.join(f.vaultRoot, rawRef), "{}");
  await runOneHostedClinicalEnrichment(f.runtime);
  expect(f.executeExtraction).not.toHaveBeenCalled();
  expect(await readClinicalEnrichmentStatus(f)).toMatchObject({ counts: { held: 1 } });
});

it("keeps the configured Venice provider and selects its Luna model identifier", async () => {
  const f = await fixture();
  await runOneHostedClinicalEnrichment({ ...f.runtime, modelProvider: "venice" });
  expect(f.executeExtraction).toHaveBeenCalledWith(expect.objectContaining({ modelProvider: "venice", model: "openai-gpt-56-luna", reasoningEffort: "medium" }));
});

it("clears a failed record's retry state when attestation holds it and continues to the next record", async () => {
  const f = await fixture([source(), { ...source("second"), valueString: "Resting heart rate 74 bpm." }]);
  f.executeExtraction.mockRejectedValueOnce(new Error("Synthetic transient failure"));
  await runOneHostedClinicalEnrichment(f.runtime);
  const statePath = path.join(f.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${f.jobId}.json`);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.structuredSources[0].sha256 = "0".repeat(64);
  await writeFile(statePath, JSON.stringify(state));
  expect(await readNextClinicalEnrichment({ ...f, now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ status: "advance" });
  const next = await readNextClinicalEnrichment(f);
  expect(next).toMatchObject({ status: "extract", source: { resource: { resourceId: "second" } } });
  f.executeExtraction.mockRejectedValueOnce(new Error("Synthetic second-record failure"));
  expect(await runOneHostedClinicalEnrichment(f.runtime)).toBe("idle");
  expect(await readClinicalEnrichmentStatus(f)).toMatchObject({ status: "pending", counts: { held: 1 } });
});


it.each([null, "2020-03-12T12:00:00.000Z"])("persists structured source answers with clinicalDate %s and replays without duplication", async (clinicalDate) => {
  const answer = "Occasional outdoor exercise";
  const f = await fixture([{ ...source(), effectiveDateTime: clinicalDate ?? undefined, valueString: answer }]);
  const clinicalFact = { category: "social-history" as const, label: "Exercise context", subject: "member" as const,
    clinicalDate, statement: answer, value: answer, status: "final" };
  f.executeExtraction.mockResolvedValue({ status: "complete", records: [{
    dateBasis: clinicalDate ? "document" : "unknown", ...(clinicalDate ? { dateEvidence: clinicalDate } : {}), excerpt: answer,
    payload: { kind: "note", title: "Source answer", occurredAt: "1999-01-01", note: answer, clinicalFact },
  }] });
  await runOneHostedClinicalEnrichment(f.runtime);
  const statePath = path.join(f.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${f.jobId}.json`);
  const frozen = await readFile(statePath, "utf8");
  const applied = await applyClinicalEnrichmentProposals(f);
  expect(applied).toMatchObject({ counts: { created: 1, held: 0 }, readback: { verifiedCount: 1 } });
  await writeFile(statePath, frozen);
  expect((await applyClinicalEnrichmentProposals(f)).counts.existing).toBe(1);
  const facts = (await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["note"], limit: 20 }))
    .filter((row) => row.attributes.clinicalFact);
  expect(facts).toHaveLength(1);
  expect(facts[0]!.attributes.clinicalFact).toEqual(clinicalFact);
  expect(facts[0]!.occurredAt).toBe(clinicalDate ?? f.input.fetchedAt);
  expect(facts[0]!.attributes.noteType).toBe("clinical_fact");
  expect(facts[0]!.attributes.tags).toContain("clinical-fact-social-history");
  expect(facts[0]!.attributes.evidence).toEqual([expect.not.objectContaining({ page: expect.anything() })]);
});

it.each(["corrected", "entered-in-error"])("retires typed historical facts when their source is %s", async (status) => {
  const f = await fixture();
  f.executeExtraction.mockResolvedValue({ status: "complete", records: [{ dateBasis: "unknown", excerpt: "Resting heart rate 73 bpm.",
    payload: { kind: "note", title: "Source fact", occurredAt: date, note: "Historical statement", clinicalFact: {
      category: "observation", label: "Historical pulse statement", subject: "member", clinicalDate: null,
      statement: "Resting heart rate 73 bpm.", value: 73, unit: "bpm",
    } },
  }] });
  await runOneHostedClinicalEnrichment(f.runtime);
  const statePath = path.join(f.vaultRoot, ".runtime/operations/clinical-records/enrichment", `${f.jobId}.json`);
  const frozen = await readFile(statePath, "utf8");
  expect((await applyClinicalEnrichmentProposals(f)).counts.created).toBe(1);
  await importClinicalFhirSnapshot({ ...f.input, retrievalJobId: "typed-correction", fetchedAt: "2026-07-02T12:00:00.000Z",
    pages: [{ ...f.input.pages[0]!, content: JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource: {
      ...source(), status, meta: { lastUpdated: "2026-07-02T12:00:00.000Z" }, valueString: "Corrected source statement.",
    } }] }) }] });
  const rows = await listCanonicalEntities(f.vaultRoot, { family: "event", kinds: ["note"], limit: 20 });
  expect(rows.filter((row) => row.attributes.clinicalFact)).toHaveLength(0);
  await writeFile(statePath, frozen);
  expect((await applyClinicalEnrichmentProposals(f)).canonical).toBeNull();
});

it.each([
  { dateBasis: "source" as const, clinicalDate: null, excerpt: "Resting heart rate 73 bpm.", codings: undefined },
  { dateBasis: "unknown" as const, clinicalDate: null, excerpt: "Invented answer", codings: undefined },
  { dateBasis: "unknown" as const, clinicalDate: null, excerpt: "Resting heart rate 73 bpm.", codings: [{ code: "invented", system: "urn:synthetic" }] },
  { dateBasis: "document" as const, clinicalDate: "2020-03-12", excerpt: "Resting heart rate 73 bpm.", codings: undefined },
])("holds unsupported typed facts ($dateBasis, $excerpt)", async ({ dateBasis, clinicalDate, excerpt, codings }) => {
  const f = await fixture();
  f.executeExtraction.mockResolvedValue({ status: "complete", records: [{ dateBasis, excerpt,
    payload: { kind: "note", title: "Source fact", occurredAt: date, note: "Source statement", clinicalFact: {
      category: "observation", label: "Source answer", subject: "member", clinicalDate,
      statement: "Source statement", codings,
    } },
  }] });
  await runOneHostedClinicalEnrichment(f.runtime);
  expect(await applyClinicalEnrichmentProposals(f)).toMatchObject({ canonical: null, counts: { held: 1 } });
});
