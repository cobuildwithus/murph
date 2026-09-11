import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type ClinicalFhirRetrievalSlice,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
} from "@murphai/clinical-records";
import {
  findEventByExternalRef,
  initializeVault,
} from "@murphai/core";
import {
  clearClinicalFhirRetrievalCheckpoint,
  ClinicalFhirRetrievalCheckpointError,
  ClinicalFhirSnapshotRejectedError,
  importClinicalFhirSnapshot,
  readClinicalFhirRetrievalCheckpoint,
  readClinicalFhirRetrievalCheckpointForRun,
  type ClinicalFhirSnapshotImportInput,
  writeClinicalFhirRetrievalCheckpoint,
} from "@murphai/vault-usecases/clinical-records";
import { listMetricPoints, rebuildQueryProjection, summarizeWearableBodyStateRuntime, summarizeWearableRecoveryRuntime } from "@murphai/query";
import { afterEach, describe, expect, it } from "vitest";

const FHIR_BASE_URL = "https://ehr.example.test/fhir";
const FHIR_BASE_URL_HASH = hashClinicalFhirBaseUrl(FHIR_BASE_URL);
const PATIENT_ID = "patient-1";
const OTHER_PATIENT_ID = "patient-2";
const PATIENT_ID_HASH = hashClinicalFhirPatientId(PATIENT_ID);
const QUERY_FINGERPRINT = "a".repeat(64);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("importClinicalFhirSnapshot", () => {
  it("imports a long inline note without losing its body and replays without duplicates", async () => {
    const text = "Historical discharge instruction. ".repeat(600);
    const resource = {
      resourceType: "DocumentReference", id: "historical-long-note",
      subject: { reference: `Patient/${PATIENT_ID}` },
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      status: "current", docStatus: "final", date: "2004-03-12T12:00:00.000Z",
      type: { text: "Discharge summary" },
      content: [{ attachment: { contentType: "text/plain", data: Buffer.from(text).toString("base64") } }],
    };
    const input = await createSnapshotInput({
      pages: [{ resourceType: "DocumentReference", content: fhirBundle([resource]) }],
      resourceTypes: ["DocumentReference"],
    });
    const externalRef = {
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "document-reference", resourceId: resource.id, version: resource.meta.lastUpdated,
    };
    const upgrade = input;
    expect((await importClinicalFhirSnapshot(upgrade)).canonical.createdCount).toBe(1);
    const note = await findEventByExternalRef({ vaultRoot: input.vaultRoot, ...externalRef });
    if (note?.kind !== "note") throw new Error("Clinical note is missing.");
    expect(note.sections?.map((section) => section.text).join("")).toBe(text.trim());
    expect(note.occurredAt).toBe(resource.date);
    expect((await importClinicalFhirSnapshot(upgrade)).canonical.createdCount).toBe(0);
  });
  it("preserves every downloaded original beside unchanged FHIR and exposes all document text", async () => {
    const original = Buffer.from("Historical discharge summary: continue outpatient follow-up.");
    const sha256 = createHash("sha256").update(original).digest("hex");
    const resource = {
      resourceType: "DocumentReference", id: "downloaded-note", status: "current",
      subject: { reference: `Patient/${PATIENT_ID}` },
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" }, date: "2020-07-10T12:00:00.000Z",
      content: [{ attachment: { contentType: "text/plain", url: "Binary/discharge" } }],
    };
    const content = fhirBundle([resource]);
    const input = await createSnapshotInput({ pages: [{ content, resourceType: "DocumentReference" }], resourceTypes: ["DocumentReference"] });
    input.documentAttachments = [{ parentPageSha256: createHash("sha256").update(content).digest("hex"), resourceType: "DocumentReference", resourceId: resource.id,
      attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: original.length, mediaType: "text/plain" }];
    input.attachments = [{ relativePath: `attachments/${sha256}.bin`, contentBase64: original.toString("base64") }];
    const result = await importClinicalFhirSnapshot(input);
    expect(result.canonical.createdCount).toBe(1);
    expect(await readFile(path.join(input.vaultRoot, path.posix.dirname(result.manifestPath), `attachments/${sha256}.bin`))).toEqual(original);
    expect(await readFile(path.join(input.vaultRoot, path.posix.dirname(result.manifestPath), "documentreference/whole/DocumentReference/page-0001.json"), "utf8")).toBe(content);
    const note = await findEventByExternalRef({ vaultRoot: input.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "document-reference", resourceId: resource.id });
    expect(JSON.stringify(note)).toContain("Historical discharge summary");
    expect((await importClinicalFhirSnapshot(input)).canonical.skippedExistingCount).toBe(1);
  });

  it("preserves a DiagnosticReport study image with a metadata-only source receipt", async () => {
    const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=", "base64");
    const sha256 = createHash("sha256").update(original).digest("hex");
    const resource = {
      resourceType: "DiagnosticReport", id: "cardiology-study", status: "final",
      subject: { reference: `Patient/${PATIENT_ID}` },
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      effectiveDateTime: "2020-07-10T12:00:00.000Z",
      code: { text: "Cardiac study" },
      media: [{ link: { reference: "Media/study-image" } }],
    };
    const content = fhirBundle([resource]);
    const input = await createSnapshotInput({ pages: [{ content, resourceType: "DiagnosticReport" }], resourceTypes: ["DiagnosticReport"] });
    input.documentAttachments = [{ parentPageSha256: createHash("sha256").update(content).digest("hex"), resourceType: "DiagnosticReport", resourceId: resource.id,
      attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: original.length, mediaType: "image/png" }];
    input.attachments = [{ relativePath: `attachments/${sha256}.bin`, contentBase64: original.toString("base64") }];
    const result = await importClinicalFhirSnapshot(input);
    expect(result).toMatchObject({ incompleteRevisionCount: 0, labResultCount: 0, rawFileCount: 3, canonical: { createdCount: 1, retractedCount: 0 } });
    const snapshotRoot = path.join(input.vaultRoot, path.posix.dirname(result.manifestPath));
    expect(await readFile(path.join(snapshotRoot, `attachments/${sha256}.bin`))).toEqual(original);
    expect(await readFile(path.join(snapshotRoot, "diagnosticreport/whole/DiagnosticReport/page-0001.json"), "utf8")).toBe(content);
    const receipt = await findEventByExternalRef({ vaultRoot: input.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "diagnostic-report", resourceId: resource.id });
    expect(receipt).toMatchObject({
      kind: "note", noteType: "clinical-document-receipt", title: "Cardiac study", occurredAt: resource.effectiveDateTime,
      note: "FHIR DiagnosticReport source document.\nSource status: final.\nAttachment count: 1.",
      externalRef: { version: resource.meta.lastUpdated },
    });
    expect(await listMetricPoints(input.vaultRoot, { limit: 10 })).toEqual([]);
    expect((await importClinicalFhirSnapshot(input)).canonical).toMatchObject({ createdCount: 0, skippedExistingCount: 1 });
  });

  it("resumes from a validated immutable preceding page without claiming whole-family completion", async () => {
    const next = `${FHIR_BASE_URL}/Observation?page=2`;
    const pageUrlHash = hashClinicalFhirPageUrl(next);
    const first = await createSnapshotInput({ pages: [{ content: fhirBundle([heartRateObservation("page-one")], [{ relation: "next", url: next }]), resourceType: "Observation" }], resourceTypes: ["Observation"] });
    first.completedRetrievalSlices = [];
    first.retrievalJobId = "run-batch-0";
    first.batch = { runId: "run", index: 0, continuesWith: { queryScopeId: "observation", sliceId: "whole", pageUrlHash } };
    const previous = await importClinicalFhirSnapshot(first);
    const second: ClinicalFhirSnapshotImportInput = {
      ...first, retrievalJobId: "run-batch-1",
      batch: { runId: "run", index: 1, previous: { manifestPath: previous.manifestPath, sha256: previous.manifestSha256 } },
      pages: [{ content: fhirBundle([heartRateObservation("page-two")]), pageUrlHash, resourceType: "Observation", queryScopeId: "observation", sliceId: "whole" }],
    };
    expect((await importClinicalFhirSnapshot(second)).canonical.createdCount).toBe(1);
    expect((await importClinicalFhirSnapshot(second)).canonical.skippedExistingCount).toBe(1);
    await expect(importClinicalFhirSnapshot({ ...second, batch: { ...second.batch!, previous: { manifestPath: previous.manifestPath, sha256: "b".repeat(64) } } })).rejects.toBeInstanceOf(ClinicalFhirSnapshotRejectedError);
    expect(await findEventByExternalRef({ vaultRoot: first.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "observation", resourceId: "page-one" })).not.toBeNull();
  });

  it("keeps retrieval checkpoints private, run-bound, and terminally clearable", async () => {
    const input = await createSnapshotInput({
      pages: [],
      resourceTypes: ["Observation"],
    });
    const identity = {
      connectionId: input.connectionId,
      fetchedAt: input.fetchedAt,
      fhirBaseUrlHash: input.fhirBaseUrlHash,
      generation: 1,
      grantedScopes: input.grantedScopes,
      patientIdHash: input.patientIdHash,
      requestedScopes: input.requestedScopes,
      retrievalJobId: input.retrievalJobId,
      retrievalProtocol: "query-slices-v2" as const,
      retrievalSlices: input.retrievalSlices,
      runId: "clinical-run-1",
      sourceSystem: input.sourceSystem,
    };
    const pageContent = "{\"resourceType\":\"Bundle\",\"entry\":[]}";
    const checkpoint = {
      batchIndex: 0,
      importedCounts: { createdCount: 0, executableDecisionCount: 0, labResultCount: 0, rawFileCount: 0, retractedCount: 0, reviewDecisionCount: 0, skippedExistingCount: 0, supersededCount: 0, incompleteRevisionCount: 0 },
      attachments: [], documentAttachments: [], pendingDocuments: [],
      authorizationRequired: false,
      completedRetrievalSlices: [],
      currentResourceIndex: 0,
      cursor: "randomized-cursor-2",
      errors: [],
      pageFetchCount: 1,
      pages: [{ content: pageContent, resourceType: "Observation" as const, queryScopeId: "observation", sliceId: "whole" }],
      resourcePageStartIndex: 0,
      seenCursors: [],
      seenPageUrlHashes: [],
      successfulPageCount: 1,
      totalBodyBytes: Buffer.byteLength(pageContent, "utf8"),
      totalResourceCount: 0,
    };

    await writeClinicalFhirRetrievalCheckpoint({
      checkpoint,
      identity,
      vaultRoot: input.vaultRoot,
    });

    const checkpointDirectory = path.join(
      input.vaultRoot,
      ".runtime",
      "operations",
      "clinical-records",
    );
    const checkpointFiles = await readdir(checkpointDirectory);
    expect(checkpointFiles).toHaveLength(1);
    expect((await stat(checkpointDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(checkpointDirectory, checkpointFiles[0]!))).mode & 0o777)
      .toBe(0o600);
    await expect(readClinicalFhirRetrievalCheckpoint({
      identity,
      vaultRoot: input.vaultRoot,
    })).resolves.toEqual(checkpoint);
    await expect(readClinicalFhirRetrievalCheckpointForRun({
      identity: { generation: identity.generation, runId: identity.runId },
      vaultRoot: input.vaultRoot,
    })).resolves.toEqual({ checkpoint, identity });
    const persistedCheckpoint = await readFile(
      path.join(checkpointDirectory, checkpointFiles[0]!),
      "utf8",
    );
    expect(persistedCheckpoint).not.toContain(FHIR_BASE_URL);
    expect(persistedCheckpoint).not.toContain(PATIENT_ID);
    const persistedCheckpointValue = JSON.parse(persistedCheckpoint);
    expect(persistedCheckpointValue.schema)
      .toBe("murph.clinical-retrieval-checkpoint.v4");
    expect(persistedCheckpointValue.identity.retrievalProtocol).toBe("query-slices-v2");
    expect(persistedCheckpointValue.identity.retrievalSlices).toEqual(input.retrievalSlices);
    await expect(readClinicalFhirRetrievalCheckpoint({
      identity,
      vaultRoot: input.vaultRoot,
    })).resolves.toEqual(checkpoint);

    await expect(readClinicalFhirRetrievalCheckpoint({
      identity: { ...identity, connectionId: "different-clinical-connection" },
      vaultRoot: input.vaultRoot,
    })).rejects.toBeInstanceOf(ClinicalFhirRetrievalCheckpointError);
    const tamperedCheckpoint = JSON.parse(persistedCheckpoint);
    tamperedCheckpoint.identity.connectionId = "tampered-clinical-connection";
    await writeFile(
      path.join(checkpointDirectory, checkpointFiles[0]!),
      JSON.stringify(tamperedCheckpoint),
      "utf8",
    );
    await expect(readClinicalFhirRetrievalCheckpointForRun({
      identity: { generation: identity.generation, runId: identity.runId },
      vaultRoot: input.vaultRoot,
    })).rejects.toBeInstanceOf(ClinicalFhirRetrievalCheckpointError);

    await clearClinicalFhirRetrievalCheckpoint({
      identity,
      vaultRoot: input.vaultRoot,
    });
    await expect(readClinicalFhirRetrievalCheckpoint({
      identity,
      vaultRoot: input.vaultRoot,
    })).resolves.toBeNull();
  });

  it("atomically persists raw evidence and idempotently applies executable decisions", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("heart-rate-1")]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    const first = await importClinicalFhirSnapshot(input);
    const replay = await importClinicalFhirSnapshot(input);

    expect(first).toEqual(expect.objectContaining({
      canonical: expect.objectContaining({ applied: true, createdCount: 1 }),
      executableDecisionCount: 1,
      rawFileCount: 2,
      reviewDecisionCount: 0,
    }));
    expect(replay.canonical).toEqual(expect.objectContaining({
      applied: false,
      createdCount: 0,
      skippedExistingCount: 1,
    }));
    expect(await readFile(path.join(input.vaultRoot, first.manifestPath), "utf8"))
      .toContain('"schemaVersion": "murph.clinical-raw-manifest.v3"');

    const event = await findEventByExternalRef({
      vaultRoot: input.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "heart-rate-1",
    });
    expect(event?.kind).toBe("measurement");
  });

  it("persists historical height, BMI and standard oxygen saturation with replay-safe provenance", async () => {
    const measurements = [
      { id: "historical-height", codes: ["8302-2"], value: 69, code: "[in_i]", metric: "body-height", unit: "in" },
      { id: "historical-bmi", codes: ["39156-5"], value: 24.2, code: "kg/m2", metric: "bmi", unit: "kg/m^2" },
      { id: "historical-oxygen", codes: ["2708-6", "59408-5"], value: 98, code: "%", metric: "spo2", unit: "percent" },
    ];
    const resources = measurements.map((item) => ({
      ...heartRateObservation(item.id, item.value),
      effectiveDateTime: "2010-04-02T12:00:00.000Z",
      code: { coding: item.codes.map((code) => ({ system: "http://loinc.org", code })) },
      valueQuantity: { value: item.value, system: "http://unitsofmeasure.org", code: item.code },
    }));
    const input = await createSnapshotInput({
      pages: [{ resourceType: "Observation", content: fhirBundle(resources) }],
      resourceTypes: ["Observation"],
    });

    const result = await importClinicalFhirSnapshot(input);
    expect(result).toMatchObject({
      canonical: { createdCount: 3 },
      executableDecisionCount: 3,
      reviewDecisionCount: 0,
    });
    expect((await importClinicalFhirSnapshot(input)).canonical).toMatchObject({
      createdCount: 0,
      skippedExistingCount: 3,
    });
    for (const item of measurements) {
      const event = await findEventByExternalRef({
        vaultRoot: input.vaultRoot,
        system: "epic-fhir-" + FHIR_BASE_URL_HASH + "-" + PATIENT_ID_HASH,
        resourceType: "observation",
        resourceId: item.id,
      });
      expect(event).toMatchObject({
        kind: "measurement",
        occurredAt: "2010-04-02T12:00:00.000Z",
        measurements: [{ metric: item.metric, unit: item.unit, value: item.value }],
        externalRef: { version: "2026-07-10T12:00:00.000Z" },
      });
    }
  });

  it("deduplicates reordered hospital records within a snapshot and across retrieval jobs", async () => {
    const procedure = {
      resourceType: "Procedure", id: "same-procedure", subject: { reference: `Patient/${PATIENT_ID}` },
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" }, status: "completed",
      code: { coding: [{ system: "http://example.test/procedures", code: "synthetic", display: "Synthetic procedure" }] },
      performedDateTime: "2010-04-02T12:00:00.000Z", note: [{ text: "First" }, { text: "Second" }],
    };
    const reordered = Object.fromEntries(Object.entries({
      ...procedure, code: { coding: [{ display: "Synthetic procedure", code: "synthetic", system: "http://example.test/procedures" }] },
    }).reverse());
    const base = await createSnapshotInput({ pages: [], resourceTypes: ["Procedure", "Observation"] });
    const slices: ClinicalFhirRetrievalSlice[] = [
      { resourceType: "Procedure", queryScopeId: "procedure-orders", sliceId: "whole", coverage: "whole-family", queryFingerprint: "1".repeat(64) },
      { resourceType: "Procedure", queryScopeId: "procedure-surgeries", sliceId: "whole", coverage: "whole-family", queryFingerprint: "2".repeat(64) },
      { resourceType: "Observation", queryScopeId: "observation", sliceId: "whole", coverage: "whole-family", queryFingerprint: "3".repeat(64) },
    ];
    const input: ClinicalFhirSnapshotImportInput = {
      ...base, retrievalSlices: slices,
      completedRetrievalSlices: slices.map(({ queryScopeId, sliceId }) => ({ queryScopeId, sliceId })),
      pages: slices.map(({ resourceType, queryScopeId, sliceId }, index) => ({
        resourceType, queryScopeId, sliceId,
        content: fhirBundle([index === 0 ? procedure : index === 1 ? reordered : heartRateObservation("unrelated-vital")]),
      })),
    };
    expect((await importClinicalFhirSnapshot(input)).canonical)
      .toMatchObject({ createdCount: 2, skippedExistingCount: 1 });
    const lookup = { vaultRoot: input.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "procedure", resourceId: procedure.id };
    const saved = await findEventByExternalRef(lookup);
    expect(saved?.note).toContain('"text": "First"');
    expect(saved?.note?.indexOf('"text": "First"')).toBeLessThan(saved?.note?.indexOf('"text": "Second"') ?? -1);
    const repeat = { ...input, retrievalJobId: "reordered-repeat", pages: input.pages.map((page, index) => index < 2 ? { ...page, content: fhirBundle([index === 0 ? reordered : procedure]) } : page) };
    expect((await importClinicalFhirSnapshot(repeat)).canonical)
      .toMatchObject({ createdCount: 0, skippedExistingCount: 3 });
    expect(await findEventByExternalRef(lookup)).toEqual(saved);
    for (const [index, changed] of [
      { ...procedure, status: "not-done" },
      { ...procedure, note: [...procedure.note].reverse() },
    ].entries()) {
      await expect(importClinicalFhirSnapshot({
        ...input, retrievalJobId: `genuine-conflict-${index}`,
        pages: input.pages.map((page, pageIndex) => pageIndex === 0 ? { ...page, content: fhirBundle([changed]) } : page),
      })).rejects.toBeInstanceOf(ClinicalFhirSnapshotRejectedError);
      expect(await findEventByExternalRef(lookup)).toEqual(saved);
    }
  });

  it("keeps provider allergy history source-versioned across replay, correction and retraction", async () => {
    const resource = {
      resourceType: "AllergyIntolerance", id: "historical-allergy",
      patient: { reference: `Patient/${PATIENT_ID}` },
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      recordedDate: "2001-02-03",
      code: { text: "Penicillin" },
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
      reaction: [{ manifestation: [{ text: "Hives" }] }],
    };
    const input = await createSnapshotInput({ pages: [{ resourceType: "AllergyIntolerance", content: fhirBundle([resource]) }], resourceTypes: ["AllergyIntolerance"] });
    const lookup = { vaultRoot: input.vaultRoot, system: "epic-fhir-" + FHIR_BASE_URL_HASH + "-" + PATIENT_ID_HASH, resourceType: "allergy-intolerance", resourceId: resource.id };
    expect((await importClinicalFhirSnapshot(input)).canonical.createdCount).toBe(1);
    const original = await findEventByExternalRef(lookup);
    expect(original).toMatchObject({ kind: "note", occurredAt: "2001-02-03T00:00:00.000Z" });
    expect(original?.note).toContain("Hives");
    expect((await importClinicalFhirSnapshot(input)).canonical.skippedExistingCount).toBe(1);
    const corrected = { ...resource, meta: { lastUpdated: "2026-07-11T12:00:00.000Z" }, reaction: [{ manifestation: [{ text: "Rash" }] }] };
    await importClinicalFhirSnapshot({ ...input, retrievalJobId: "allergy-correction", pages: [{ resourceType: "AllergyIntolerance", queryScopeId: "allergyintolerance", sliceId: "whole", content: fhirBundle([corrected]) }] });
    const updated = await findEventByExternalRef(lookup);
    expect(updated?.note).toContain("Rash");
    expect(updated?.note).not.toContain("Hives");
    await importClinicalFhirSnapshot(input);
    expect((await findEventByExternalRef(lookup))?.note).toContain("Rash");
    const retracted = { ...corrected, meta: { lastUpdated: "2026-07-12T12:00:00.000Z" }, verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "entered-in-error" }] } };
    await importClinicalFhirSnapshot({ ...input, retrievalJobId: "allergy-retraction", pages: [{ resourceType: "AllergyIntolerance", queryScopeId: "allergyintolerance", sliceId: "whole", content: fhirBundle([retracted]) }] });
    expect(await findEventByExternalRef(lookup)).toBeNull();
    await importClinicalFhirSnapshot(input);
    expect(await findEventByExternalRef(lookup)).toBeNull();
  });

  it.each([
    { code: "[degF]", value: 98.6, unit: "degF" },
    { code: "Cel", value: 37, unit: "Cel" },
  ])("keeps $code clinical temperature source units while projecting Celsius summaries", async ({ code, value, unit }) => {
    const resource = {
      ...heartRateObservation("historical-temperature", value),
      effectiveDateTime: "2010-04-02T12:00:00.000Z",
      code: { coding: [{ system: "http://loinc.org", code: "8310-5" }] },
      valueQuantity: { value, system: "http://unitsofmeasure.org", code },
    };
    const input = await createSnapshotInput({
      pages: [{ resourceType: "Observation", content: fhirBundle([resource]) }],
      resourceTypes: ["Observation"],
    });
    expect((await importClinicalFhirSnapshot(input)).canonical.createdCount).toBe(1);
    for (const retrievalJobId of [input.retrievalJobId, "temperature-repeat"]) {
      expect((await importClinicalFhirSnapshot({ ...input, retrievalJobId })).canonical)
        .toMatchObject({ createdCount: 0, skippedExistingCount: 1 });
      await rebuildQueryProjection(input.vaultRoot);
      for (const readSummary of [summarizeWearableBodyStateRuntime, summarizeWearableRecoveryRuntime]) {
        expect(await readSummary(input.vaultRoot)).toMatchObject([
          { date: "2010-04-02", temperature: { selection: { value: 37, unit: "celsius" } } },
        ]);
      }
      expect(await findEventByExternalRef({
        vaultRoot: input.vaultRoot,
        system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
        resourceType: "observation", resourceId: resource.id,
      })).toMatchObject({
        measurements: [{ metric: "temperature", value, unit }],
        externalRef: { version: resource.meta.lastUpdated },
        occurredAt: resource.effectiveDateTime,
      });
    }
  });

  it("persists repeated resource types beneath query-aware raw evidence paths", async () => {
    const base = await createSnapshotInput({
      pages: [],
      resourceTypes: ["Observation"],
    });
    const retrievalSlices = ["observation-labs", "observation-vitals"].map(
      (queryScopeId, index) => ({
        coverage: "whole-family" as const,
        queryFingerprint: String(index + 1).repeat(64),
        queryScopeId,
        resourceType: "Observation" as const,
        sliceId: "whole",
      }),
    );
    const input: ClinicalFhirSnapshotImportInput = {
      ...base,
      completedRetrievalSlices: retrievalSlices.map(({ queryScopeId, sliceId }) => ({
        queryScopeId,
        sliceId,
      })),
      pages: retrievalSlices.map(({ queryScopeId, resourceType, sliceId }) => ({
        content: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        queryScopeId,
        resourceType,
        sliceId,
      })),
      retrievalProtocol: "query-slices-v2",
      retrievalSlices,
    };

    const result = await importClinicalFhirSnapshot(input);
    const manifest = await readFile(path.join(input.vaultRoot, result.manifestPath), "utf8");

    expect(result.rawFileCount).toBe(3);
    expect(manifest).toContain('"schemaVersion": "murph.clinical-raw-manifest.v3"');
    expect(manifest).toContain('"relativePath": "observation-labs/whole/Observation/page-0001.json"');
    expect(manifest).toContain('"relativePath": "observation-vitals/whole/Observation/page-0001.json"');
  });

  it("yields to cancellation before persisting a planned snapshot", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("cancelled-heart-rate")]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    const controller = new AbortController();
    setImmediate(() => controller.abort(
      new DOMException("Foreground work arrived.", "AbortError"),
    ));

    await expect(importClinicalFhirSnapshot({
      ...input,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("rechecks current run authority immediately before raw persistence", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("revoked-before-raw")]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    const revoked = new Error("Clinical retrieval authority ended.");
    let authorityChecks = 0;

    await expect(importClinicalFhirSnapshot({
      ...input,
      assertCurrent: async () => {
        authorityChecks += 1;
        throw revoked;
      },
    })).rejects.toBe(revoked);

    expect(authorityChecks).toBe(1);
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("rechecks authority between raw persistence and canonical mutation", async () => {
    const resourceId = "revoked-before-canonical";
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation(resourceId)]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    const revoked = new Error("Clinical retrieval authority ended.");
    let authorityChecks = 0;

    await expect(importClinicalFhirSnapshot({
      ...input,
      assertCurrent: async () => {
        authorityChecks += 1;
        if (authorityChecks === 2) {
          throw revoked;
        }
      },
    })).rejects.toBe(revoked);

    expect(authorityChecks).toBe(2);
    await expect(access(path.join(
      input.vaultRoot,
      "raw/clinical/fhir",
      input.connectionId,
      input.retrievalJobId,
      "manifest.json",
    ))).resolves.toBeUndefined();
    expect(await findEventByExternalRef({
      vaultRoot: input.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId,
    })).toBeNull();

    const resumed = await importClinicalFhirSnapshot({
      ...input,
      assertCurrent: async () => undefined,
    });
    expect(resumed.canonical).toEqual(expect.objectContaining({
      applied: true,
      createdCount: 1,
    }));
  });

  it("persists and resolves a two-page FHIR continuation chain", async () => {
    const nextPageUrl = `${FHIR_BASE_URL}/Observation?page=2`;
    const nextPageUrlHash = hashClinicalFhirPageUrl(nextPageUrl);
    const input = await createSnapshotInput({
      pages: [
        {queryScopeId: "observation", sliceId: "whole",
          content: fhirBundle(
            [heartRateObservation("page-1-heart-rate", 70)],
            [{ relation: "next", url: nextPageUrl }],
          ),
            resourceType: "Observation",
        },
        {queryScopeId: "observation", sliceId: "whole",
          content: fhirBundle([heartRateObservation("page-2-heart-rate", 72)]),
          pageUrlHash: nextPageUrlHash,
          resourceType: "Observation",
        },
      ],
      resourceTypes: ["Observation"],
    });

    const result = await importClinicalFhirSnapshot(input);
    const manifest = JSON.parse(await readFile(
      path.join(input.vaultRoot, result.manifestPath),
      "utf8",
    )) as { resourceFiles: Array<Record<string, unknown>> };

    expect(result.canonical.createdCount).toBe(2);
    expect(manifest.resourceFiles).toEqual([
      expect.not.objectContaining({ nextPageUrlHash: expect.anything() }),
      expect.objectContaining({ pageUrlHash: nextPageUrlHash }),
    ]);
    expect(manifest.resourceFiles[0]).not.toHaveProperty("pageUrlHash");
  });

  it("rejects conflicting raw replay at the stable retrieval identity", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("heart-rate-conflict", 70)]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    await importClinicalFhirSnapshot(input);

    await expect(importClinicalFhirSnapshot({
      ...input,
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("heart-rate-conflict", 99)]),
        resourceType: "Observation",
      }],
    })).rejects.toMatchObject({
      code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
      message: "Clinical FHIR snapshot failed semantic validation.",
    });
  });

  it("terminalizes a deterministic canonical conflict after preserving raw evidence", async () => {
    const resourceId = "canonical-conflict-heart-rate";
    const initial = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation(resourceId, 70)]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    await importClinicalFhirSnapshot(initial);

    const conflicting = {
      ...initial,
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation(resourceId, 99)]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-2",
    } satisfies ClinicalFhirSnapshotImportInput;
    let rejection: unknown;
    try {
      await importClinicalFhirSnapshot(conflicting);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(ClinicalFhirSnapshotRejectedError);
    if (!(rejection instanceof ClinicalFhirSnapshotRejectedError)) {
      throw new Error("Expected a typed Clinical FHIR snapshot rejection.");
    }
    expect(rejection.message).toBe("Clinical FHIR snapshot failed semantic validation.");
    expect(rejection.message).not.toContain(resourceId);
    await expect(access(path.join(
      conflicting.vaultRoot,
      "raw/clinical/fhir",
      conflicting.connectionId,
      conflicting.retrievalJobId,
      "manifest.json",
    ))).resolves.toBeUndefined();
    await expect(access(path.join(
      conflicting.vaultRoot,
      "raw/clinical/fhir",
      conflicting.connectionId,
      conflicting.retrievalJobId,
      "observation/whole/Observation/page-0001.json",
    ))).resolves.toBeUndefined();
  });

  it("applies importer-owned review holds across delayed clinical revisions", async () => {
    const resourceId = "review-held-heart-rate";
    const initial = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([{
          ...heartRateObservation(resourceId),
          meta: { lastUpdated: "2026-07-10T12:01:00.000Z" },
        }]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    const review = {
      ...initial,
      fetchedAt: "2026-07-10T12:03:00.000Z",
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([{
          ...heartRateObservation(resourceId),
          meta: { lastUpdated: "2026-07-10T12:03:00.000Z" },
          modifierExtension: [{
            url: "https://ehr.example.test/fhir/StructureDefinition/negated",
            valueBoolean: true,
          }],
        }]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-2",
    } satisfies ClinicalFhirSnapshotImportInput;
    const delayed = {
      ...initial,
      fetchedAt: "2026-07-10T12:02:00.000Z",
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([{
          ...heartRateObservation(resourceId),
          meta: { lastUpdated: "2026-07-10T12:02:00.000Z" },
        }]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-3",
    } satisfies ClinicalFhirSnapshotImportInput;
    const recovery = {
      ...initial,
      fetchedAt: "2026-07-10T12:04:00.000Z",
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([{
          ...heartRateObservation(resourceId),
          meta: { lastUpdated: "2026-07-10T12:04:00.000Z" },
        }]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-4",
    } satisfies ClinicalFhirSnapshotImportInput;

    await importClinicalFhirSnapshot(initial);
    const hold = await importClinicalFhirSnapshot(review);
    const delayedResult = await importClinicalFhirSnapshot(delayed);

    expect(hold).toEqual(expect.objectContaining({
      canonical: expect.objectContaining({ retractedCount: 1 }),
      executableDecisionCount: 1,
      reviewDecisionCount: 1,
    }));
    expect(delayedResult.canonical).toEqual(expect.objectContaining({
      applied: false,
      skippedExistingCount: 1,
    }));
    expect(await findEventByExternalRef({
      vaultRoot: initial.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId,
    })).toBeNull();

    const recoveryResult = await importClinicalFhirSnapshot(recovery);
    expect(recoveryResult.canonical.createdCount).toBe(1);
    expect(await findEventByExternalRef({
      vaultRoot: initial.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId,
    })).toEqual(expect.objectContaining({
      externalRef: expect.objectContaining({ version: "2026-07-10T12:04:00.000Z" }),
    }));
  });

  it("retains evidence without a comparable revision and leaves canonical facts unchanged", async () => {
    const observation: Record<string, unknown> = heartRateObservation("missing-source-revision");
    delete observation.meta;
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([observation]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    await expect(importClinicalFhirSnapshot(input)).resolves.toMatchObject({
      canonical: { createdCount: 0, retractedCount: 0, supersededCount: 0 },
      incompleteRevisionCount: 1,
      rawFileCount: 2,
    });
  });

  it.each(["2026-07-10T12:00:00.000Z", "2026-07-12T12:00:00.000Z"])("keeps validated facts when a SUBSETTED revision arrives at %s", async (revision) => {
    const resourceId = "subsetted-observation";
    const initial = await createSnapshotInput({ resourceTypes: ["Observation"], pages: [{ resourceType: "Observation", content: fhirBundle([heartRateObservation(resourceId, 70)]) }] });
    await importClinicalFhirSnapshot(initial);
    const lookup = { vaultRoot: initial.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "observation", resourceId };
    const prior = await findEventByExternalRef(lookup);
    const subsetted = { ...heartRateObservation(resourceId, 99), meta: { lastUpdated: revision, tag: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue", code: "SUBSETTED" }] } };
    const result = await importClinicalFhirSnapshot({ ...initial, retrievalJobId: "retrieval-job-subsetted", pages: [{ queryScopeId: "observation", sliceId: "whole", resourceType: "Observation", content: fhirBundle([subsetted]) }] });
    expect(result).toMatchObject({ incompleteRevisionCount: 1, rawFileCount: 2, canonical: { createdCount: 0, retractedCount: 0, supersededCount: 0 } });
    expect(await findEventByExternalRef(lookup)).toEqual(prior);
  });

  it.each([false, true])("does not order a timestamped sibling around an unknown revision (reverse=%s)", async (reverse) => {
    const resourceId = "unordered-observation";
    const initial = await createSnapshotInput({ resourceTypes: ["Observation"], pages: [{ resourceType: "Observation", content: fhirBundle([heartRateObservation(resourceId, 70)]) }] });
    await importClinicalFhirSnapshot(initial);
    const lookup = { vaultRoot: initial.vaultRoot, system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`, resourceType: "observation", resourceId };
    const prior = await findEventByExternalRef(lookup);
    const { meta: _meta, ...unknownRevision } = heartRateObservation(resourceId, 99);
    const siblings = [unknownRevision, { ...heartRateObservation(resourceId, 80), meta: { lastUpdated: "2026-07-12T12:00:00.000Z" } }];
    const result = await importClinicalFhirSnapshot({ ...initial, retrievalJobId: "retrieval-job-unordered", pages: [{ queryScopeId: "observation", sliceId: "whole", resourceType: "Observation", content: fhirBundle(reverse ? siblings.reverse() : siblings) }] });
    expect(result.canonical).toMatchObject({ createdCount: 0, retractedCount: 0, supersededCount: 0 });
    expect(result.incompleteRevisionCount).toBe(2);
    expect(await findEventByExternalRef(lookup)).toEqual(prior);
  });

  it("rejects a wrong-patient page before persisting raw evidence", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([
          heartRateObservation("wrong-patient", 70, `Patient/${OTHER_PATIENT_ID}`),
        ]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    await expect(importClinicalFhirSnapshot(input)).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("does not match manifest patient"),
      }),
      code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
    });
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("rejects a wrong resource family before persisting raw evidence", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "condition", sliceId: "whole",
        content: fhirBundle([heartRateObservation("wrong-resource-family")]),
        resourceType: "Condition",
      }],
      resourceTypes: ["Condition"],
    });

    await expect(importClinicalFhirSnapshot(input)).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("declared resource type"),
      }),
      code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
    });
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("rejects a foreign FHIR base before persisting raw evidence", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([
          heartRateObservation(
            "foreign-fhir-base",
            70,
            "https://foreign.example.test/fhir/Patient/patient-1",
          ),
        ]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    await expect(importClinicalFhirSnapshot(input)).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("invalid manifest patient reference"),
      }),
      code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
    });
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("rejects invalid pagination before persisting raw evidence", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation("unresolved-pagination")], [{ relation: "next", url: `${FHIR_BASE_URL}/Observation?page=2` }]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    await expect(importClinicalFhirSnapshot(input)).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("unresolved pagination"),
      }),
      code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
    });
    await expectClinicalRawSnapshotAbsent(input);
  });

  it("preserves review-only evidence without attempting an empty canonical batch", async () => {
    const input = await createSnapshotInput({
      pages: [{queryScopeId: "condition", sliceId: "whole",
        content: fhirBundle([{
          resourceType: "Condition",
          id: "condition-1",
          subject: { reference: `Patient/${PATIENT_ID}` },
          code: { text: "Example condition" },
        }]),
        resourceType: "Condition",
      }],
      resourceTypes: ["Condition"],
    });

    const result = await importClinicalFhirSnapshot(input);

    expect(result.canonical).toEqual({
      applied: false,
      createdCount: 0,
      retractedCount: 0,
      skippedExistingCount: 0,
      supersededCount: 0,
    });
    expect(result.executableDecisionCount).toBe(0);
    expect(result.reviewDecisionCount).toBe(1);
  });

  it("does not treat a completed bounded window as whole-family absence evidence", async () => {
    const input = await createSnapshotInput({
      pages: [
        {queryScopeId: "allergyintolerance", sliceId: "whole",
          content: fhirBundle([noKnownAllergyResource()]),
          resourceType: "AllergyIntolerance",
        },
        {queryScopeId: "condition", sliceId: "whole",
          content: fhirBundle([]),
          resourceType: "Condition",
        },
      ],
      resourceTypes: ["AllergyIntolerance", "Condition"],
      retrievalCoverage: "bounded-window",
    });

    const result = await importClinicalFhirSnapshot(input);

    // The individual source identity may be held/retracted; no absence assertion is created.
    expect(result.executableDecisionCount).toBe(1);
    expect(result.canonical.createdCount).toBe(0);
    expect(result.reviewDecisionCount).toBe(1);
  });

  it("uses a newer review hold to block a delayed older executable revision", async () => {
    const first = await createSnapshotInput({
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation(
          "review-held-heart-rate",
          70,
          `Patient/${PATIENT_ID}`,
          "2026-07-10T12:01:00.000Z",
        )]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    const review = {
      ...first,
      fetchedAt: "2026-07-10T12:03:00.000Z",
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([{
          ...heartRateObservation(
            "review-held-heart-rate",
            73,
            `Patient/${PATIENT_ID}`,
            "2026-07-10T12:03:00.000Z",
          ),
          modifierExtension: [{
            url: "https://ehr.example.test/fhir/StructureDefinition/negated",
            valueBoolean: true,
          }],
        }]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-3",
    } satisfies ClinicalFhirSnapshotImportInput;
    const delayed = {
      ...first,
      fetchedAt: "2026-07-10T12:02:00.000Z",
      pages: [{queryScopeId: "observation", sliceId: "whole",
        content: fhirBundle([heartRateObservation(
          "review-held-heart-rate",
          72,
          `Patient/${PATIENT_ID}`,
          "2026-07-10T12:02:00.000Z",
        )]),
        resourceType: "Observation",
      }],
      retrievalJobId: "retrieval-job-2",
    } satisfies ClinicalFhirSnapshotImportInput;

    const firstResult = await importClinicalFhirSnapshot(first);
    const reviewResult = await importClinicalFhirSnapshot(review);
    const delayedResult = await importClinicalFhirSnapshot(delayed);

    expect(firstResult.canonical.createdCount).toBe(1);
    expect(reviewResult).toEqual(expect.objectContaining({
      executableDecisionCount: 1,
      reviewDecisionCount: 1,
      canonical: expect.objectContaining({ retractedCount: 1 }),
    }));
    expect(delayedResult.canonical).toEqual(expect.objectContaining({
      applied: false,
      skippedExistingCount: 1,
    }));
    expect(await findEventByExternalRef({
      vaultRoot: first.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "review-held-heart-rate",
    })).toBeNull();
  });
});

async function createSnapshotInput(input: {
  pages: Array<Omit<ClinicalFhirSnapshotImportInput["pages"][number], "queryScopeId" | "sliceId"> & Partial<Pick<ClinicalFhirSnapshotImportInput["pages"][number], "queryScopeId" | "sliceId">>>;
  resourceTypes: ClinicalFhirRetrievalSlice["resourceType"][];
  retrievalCoverage?: "bounded-window" | "whole-family";
}): Promise<ClinicalFhirSnapshotImportInput> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-execution-"));
  tempRoots.push(vaultRoot);
  await initializeVault({
    createdAt: "2026-07-10T12:00:00.000Z",
    timezone: "America/New_York",
    vaultRoot,
  });
  const retrievalCoverage = input.retrievalCoverage ?? "whole-family";
  return {
    completedRetrievalSlices: input.resourceTypes.map((type) => ({ queryScopeId: type.toLowerCase(), sliceId: "whole" })),
    retrievalProtocol: "query-slices-v2",
    connectionId: "clinical-connection-1",
    fetchedAt: "2026-07-10T12:00:00.000Z",
    fhirBaseUrlHash: FHIR_BASE_URL_HASH,
    grantedScopes: input.resourceTypes.map((resourceType) => `patient/${resourceType}.read`),
    pages: input.pages.map((page) => ({ ...page, queryScopeId: page.resourceType.toLowerCase(), sliceId: "whole" })),
    patientIdHash: PATIENT_ID_HASH,
    requestedScopes: input.resourceTypes.map((resourceType) => `patient/${resourceType}.read`),
    retrievalJobId: "retrieval-job-1",
    retrievalSlices: input.resourceTypes.map((resourceType) => retrievalCoverage === "whole-family"
      ? {
          coverage: "whole-family" as const,
          queryFingerprint: QUERY_FINGERPRINT,
          queryScopeId: resourceType.toLowerCase(),
          sliceId: "whole",
          resourceType,
        }
      : {
          coverage: "bounded-window" as const,
          from: "2026-01-01T00:00:00.000Z",
          queryFingerprint: QUERY_FINGERPRINT,
          queryScopeId: resourceType.toLowerCase(),
          sliceId: "whole",
          resourceType,
          to: "2026-07-10T12:00:00.000Z",
        }),
    sourceSystem: "epic-fhir",
    vaultRoot,
  };
}

async function expectClinicalRawSnapshotAbsent(
  input: ClinicalFhirSnapshotImportInput,
): Promise<void> {
  const snapshotRoot = path.join(
    input.vaultRoot,
    "raw",
    "clinical",
    "fhir",
    input.connectionId,
    input.retrievalJobId,
  );
  await expect(access(path.join(snapshotRoot, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });

  const ordinalsByResourceType = new Map<string, number>();
  for (const page of input.pages) {
    const ordinal = (ordinalsByResourceType.get(page.resourceType) ?? 0) + 1;
    ordinalsByResourceType.set(page.resourceType, ordinal);
    await expect(access(path.join(
      snapshotRoot,
      page.resourceType,
      `page-${String(ordinal).padStart(4, "0")}.json`,
    ))).rejects.toMatchObject({ code: "ENOENT" });
  }
}

function fhirBundle(
  resources: unknown[],
  links?: Array<{ relation: string; url: string }>,
): string {
  return `${JSON.stringify({
    resourceType: "Bundle",
    type: "searchset",
    ...(links ? { link: links } : {}),
    entry: resources.map((resource) => ({ resource })),
  })}\n`;
}

function heartRateObservation(
  resourceId: string,
  value = 70,
  patientReference = `Patient/${PATIENT_ID}`,
  lastUpdated = "2026-07-10T12:00:00.000Z",
) {
  return {
    resourceType: "Observation",
    id: resourceId,
    meta: { lastUpdated },
    status: "final",
    subject: { reference: patientReference },
    effectiveDateTime: "2026-07-10T11:59:00.000Z",
    code: {
      coding: [{
        system: "http://loinc.org",
        code: "8867-4",
        display: "Heart rate",
      }],
    },
    valueQuantity: { value, unit: "bpm" },
  };
}

function noKnownAllergyResource() {
  return {
    resourceType: "AllergyIntolerance",
    id: "no-known-allergy",
    meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    recordedDate: "2026-07-10T11:59:00.000Z",
    patient: { reference: `Patient/${PATIENT_ID}` },
    clinicalStatus: {
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
        code: "active",
      }],
    },
    verificationStatus: {
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
        code: "confirmed",
      }],
    },
    code: {
      text: "No known allergies",
      coding: [{
        system: "http://snomed.info/sct",
        code: "716186003",
        display: "No known allergies",
      }],
    },
  };
}
