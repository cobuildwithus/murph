import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { hashClinicalFhirBaseUrl, hashClinicalFhirPatientId, type ClinicalDocumentExtractionOutput, type ClinicalDocumentExtractionPayload } from "@murphai/clinical-records";
import { importEventBatch, initializeVault } from "@murphai/core";
import { listCanonicalEntities, listMetricPoints } from "@murphai/query";
import { describe, expect, it } from "vitest";

import { clinicalEnrichmentLabHoldReason } from "../src/clinical-enrichment-labs.js";
import { applyClinicalEnrichmentProposals, enqueueClinicalEnrichment, persistClinicalEnrichmentProposals, readClinicalEnrichmentStatus, readNextClinicalEnrichment } from "../src/clinical-enrichment.js";
import { importClinicalFhirSnapshot } from "../src/clinical-records.js";

const occurredAt = "2020-03-12T12:00:00.000Z";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const empty: ClinicalDocumentExtractionOutput = { status: "complete", records: [] };
type LabPayload = Extract<ClinicalDocumentExtractionPayload, { kind: "test" }>;
const lab = (specimenType: string, value: number): LabPayload => ({
  kind: "test", occurredAt, title: "Synthetic glucose", note: null, testName: "Glucose", specimenType,
  resultStatus: "unknown",
  results: [{ analyte: "Glucose", value, unit: "mg/dL" }],
});

async function source(vaultRoot: string, specimen: string) {
  const bytes = Buffer.from(`Synthetic ${specimen} glucose report.`);
  const sha256 = digest(bytes);
  const content = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource: {
    resourceType: "DocumentReference", id: "synthetic-document", status: "current", date: occurredAt,
    subject: { reference: "Patient/synthetic-patient" }, meta: { lastUpdated: occurredAt },
    content: [{ attachment: { contentType: "text/plain", url: "Binary/synthetic-document" } }],
  } }] });
  const imported = await importClinicalFhirSnapshot({
    vaultRoot, connectionId: "synthetic-connection", retrievalJobId: "synthetic-retrieval", retrievalProtocol: "query-slices-v2",
    sourceSystem: "epic-fhir", fetchedAt: occurredAt,
    fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://ehr.example.test/fhir"), patientIdHash: hashClinicalFhirPatientId("synthetic-patient"),
    requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"],
    retrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", coverage: "whole-family", queryFingerprint: "a".repeat(64) }],
    completedRetrievalSlices: [{ queryScopeId: "documentreference", sliceId: "whole" }],
    pages: [{ queryScopeId: "documentreference", sliceId: "whole", resourceType: "DocumentReference", content }],
    documentAttachments: [{ parentPageSha256: digest(content), resourceType: "DocumentReference", resourceId: "synthetic-document", attachmentIndex: 0, status: "downloaded", relativePath: `attachments/${sha256}.bin`, sha256, byteLength: bytes.length, mediaType: "text/plain" }],
    attachments: [{ relativePath: `attachments/${sha256}.bin`, contentBase64: bytes.toString("base64") }],
  });
  const job = await enqueueClinicalEnrichment({ vaultRoot, manifestPath: imported.manifestPath, manifestSha256: imported.manifestSha256 });
  return { ...job, vaultRoot, sha256, rawRef: path.posix.join(path.posix.dirname(imported.manifestPath), `attachments/${sha256}.bin`) };
}

describe("document laboratory specimen publication", () => {
  it("uses catalog identity while holding unproved specimens and identities", () => {
    expect(clinicalEnrichmentLabHoldReason(lab("serum", 90))).toBeNull();
    expect(clinicalEnrichmentLabHoldReason(lab("urine", 250))).toMatch(/Glucose \(urine\)/u);
    expect(clinicalEnrichmentLabHoldReason(lab("CSF", 90))).not.toBeNull();
    expect(clinicalEnrichmentLabHoldReason(lab("", 90))).not.toBeNull();
    const urineProtein: LabPayload = { ...lab("urine", 5), results: [{ analyte: "Protein", slug: "protein-urine", value: 5, unit: "mg/dL" }] };
    expect(clinicalEnrichmentLabHoldReason(urineProtein)).toBeNull();
    expect(clinicalEnrichmentLabHoldReason({ ...urineProtein, specimenType: "serum" })).not.toBeNull();
    expect(clinicalEnrichmentLabHoldReason({ ...urineProtein, results: [{ analyte: "Glucose", biomarkerSlug: "blood-glucose", value: 250, unit: "mg/dL" }] })).not.toBeNull();
    expect(clinicalEnrichmentLabHoldReason({ ...urineProtein, results: [{ analyte: "Glucose", biomarkerSlug: "urine-protein", value: 250, unit: "mg/dL" }] })).not.toBeNull();
    expect(clinicalEnrichmentLabHoldReason({ ...urineProtein, results: [{ analyte: "Unknown marker", value: 1, unit: "mg/dL" }] })).not.toBeNull();
  });

  for (const existingSerum of [false, true]) {
    it(`holds urine glucose without creating blood metrics ${existingSerum ? "alongside an existing serum result" : "in an empty vault"}`, async () => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-lab-specimen-"));
      try {
        await initializeVault({ vaultRoot, timezone: "UTC", createdAt: occurredAt });
        if (existingSerum) await importEventBatch({ vaultRoot, apply: true, payloads: [{ ...lab("serum", 90), source: "import" }] });
        const input = await source(vaultRoot, "urine");
        expect(await readNextClinicalEnrichment(input)).toMatchObject({ status: "extract" });
        await persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: 1, totalPages: 1,
          outputs: { labs: { status: "complete", records: [{ page: 1, excerpt: "Urine glucose 250 mg/dL", payload: lab("urine", 250) }] }, measurements: empty, history: empty },
        });
        const applied = await applyClinicalEnrichmentProposals(input);
        const points = await listMetricPoints(vaultRoot, { limit: 10 });
        expect(points.filter((point) => point.biomarkerKey === "biomarker:blood-glucose").map((point) => point.value)).toEqual(existingSerum ? [90] : []);
        expect(applied.counts).toMatchObject({ created: 0, held: 1 });
        expect(await listCanonicalEntities(vaultRoot, { family: "event", kinds: ["test"], limit: 10 })).toHaveLength(existingSerum ? 1 : 0);
        await readNextClinicalEnrichment(input);
        expect(await readClinicalEnrichmentStatus(input)).toMatchObject({ status: "blocked", holdReasons: [expect.stringMatching(/Glucose \(urine\)/u)] });
        expect(digest(await readFile(path.join(vaultRoot, input.rawRef)))).toBe(input.sha256);
      } finally { await rm(vaultRoot, { recursive: true, force: true }); }
    });
  }

  it("continues to publish label-only serum glucose through the real enrichment and query owners", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "clinical-lab-specimen-"));
    try {
      await initializeVault({ vaultRoot, timezone: "UTC", createdAt: occurredAt });
      const input = await source(vaultRoot, "serum");
      await readNextClinicalEnrichment(input);
      await persistClinicalEnrichmentProposals({ ...input, sourceSha256: input.sha256, page: 1, totalPages: 1,
        outputs: { labs: { status: "complete", records: [{ page: 1, payload: lab("serum", 90) }] }, measurements: empty, history: empty },
      });
      expect((await applyClinicalEnrichmentProposals(input)).counts).toMatchObject({ created: 1, held: 0 });
      expect(await listMetricPoints(vaultRoot, { limit: 10 })).toEqual(expect.arrayContaining([expect.objectContaining({
        metricKey: "glucose", biomarkerKey: "biomarker:blood-glucose", value: 90, unit: "mg/dL",
      })]));
    } finally { await rm(vaultRoot, { recursive: true, force: true }); }
  });
});
