import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clinicalRawManifestSchema,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
} from "@murphai/clinical-records";
import {
  buildClinicalImportPlanFromSnapshot,
  type ClinicalPreviousImportBatch,
} from "../src/clinical-records/index.ts";

const baseUrl = "https://ehr.example.test/fhir";
const nextUrl = `${baseUrl}/Observation?cursor=second`;
const thirdUrl = `${baseUrl}/Observation?cursor=third`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function batch(input: {
  index: number;
  previous?: ClinicalPreviousImportBatch;
  incoming?: string;
  next?: string;
  queryScopeId?: string;
}) {
  const queryScopeId = input.queryScopeId ?? "vitals";
  const relativePath = `${queryScopeId}/all/Observation/page.json`;
  const content = JSON.stringify({
    resourceType: "Bundle", type: "searchset",
    ...(input.next ? { link: [{ relation: "next", url: input.next }] } : {}),
    entry: [{ resource: {
      resourceType: "Observation", id: `weight-${input.index}`,
      meta: { lastUpdated: "2026-09-01T00:00:00.000Z" },
      subject: { reference: "Patient/example-patient" }, status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
      effectiveDateTime: "2001-01-01T00:00:00.000Z",
      valueQuantity: { value: 75, system: "http://unitsofmeasure.org", code: "kg" },
    } }],
  });
  const manifestPath = `raw/clinical/fhir/example-connection/example-run-batch-${input.index}/manifest.json`;
  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v3", kind: "clinical_fhir_retrieval",
    connectionId: "example-connection", retrievalJobId: `example-run-batch-${input.index}`,
    sourceSystem: "epic-fhir", fhirBaseUrlHash: hashClinicalFhirBaseUrl(baseUrl),
    patientIdHash: hashClinicalFhirPatientId("example-patient"),
    fetchedAt: "2026-09-01T00:00:00.000Z",
    requestedScopes: ["patient/*.read"], grantedScopes: ["patient/*.read"],
    retrievalSlices: [{ queryScopeId, sliceId: "all", resourceType: "Observation",
      coverage: "whole-family", queryFingerprint: hash(queryScopeId) }],
    completedRetrievalSlices: [],
    batch: { runId: "example-run", index: input.index,
      ...(input.previous ? { previous: { manifestPath: input.previous.manifestPath,
        sha256: hash(input.previous.manifestContent) } } : {}),
      ...(input.next ? { continuesWith: { queryScopeId, sliceId: "all", pageUrlHash: hashClinicalFhirPageUrl(input.next) } } : {}),
    },
    resourceFiles: [{ queryScopeId, sliceId: "all", resourceType: "Observation",
      relativePath, count: 1, sha256: hash(content),
      ...(input.incoming ? { pageUrlHash: hashClinicalFhirPageUrl(input.incoming) } : {}),
      ...(input.next ? { nextPageUrlHash: hashClinicalFhirPageUrl(input.next) } : {}),
    }],
  });
  const evidence: ClinicalPreviousImportBatch = {
    manifestPath, manifestContent: JSON.stringify(manifest), page: { relativePath, content },
  };
  return {
    evidence,
    input: { manifest, manifestPath, pages: [evidence.page], previousBatch: input.previous },
  };
}

describe("bounded clinical retrieval batches", () => {
  it("imports a historical page immediately and resumes a verified three-page chain", () => {
    const first = batch({ index: 0, next: nextUrl });
    const second = batch({ index: 1, incoming: nextUrl, next: thirdUrl, previous: first.evidence });
    const third = batch({ index: 2, incoming: thirdUrl, previous: second.evidence });
    for (const current of [first, second, third]) {
      const plan = buildClinicalImportPlanFromSnapshot(current.input);
      expect(plan.decisions).toHaveLength(1);
      expect(plan.decisions[0]).toMatchObject({ action: "upsert", payload: { occurredAt: "2001-01-01T00:00:00.000Z" } });
    }
  });

  it("rejects a middle-page hash without exact predecessor bytes", () => {
    const first = batch({ index: 0, next: nextUrl });
    const second = batch({ index: 1, incoming: nextUrl, previous: first.evidence });
    expect(() => buildClinicalImportPlanFromSnapshot({ ...second.input, previousBatch: undefined }))
      .toThrow(/predecessor evidence/u);
    expect(() => buildClinicalImportPlanFromSnapshot({ ...second.input, previousBatch: {
      ...first.evidence, manifestContent: `${first.evidence.manifestContent} `,
    } })).toThrow(/manifest hash/u);
    expect(() => buildClinicalImportPlanFromSnapshot({ ...second.input, previousBatch: {
      ...first.evidence, page: { ...first.evidence.page, content: first.evidence.page.content.replace("75", "99") },
    } })).toThrow(/hash mismatch/u);
  });

  it("rejects a skipped page and a first batch that starts in the middle", () => {
    const first = batch({ index: 0, next: nextUrl });
    const skipped = batch({ index: 1, incoming: thirdUrl, previous: first.evidence });
    expect(() => buildClinicalImportPlanFromSnapshot(skipped.input)).toThrow(/predecessor pagination link/u);
    expect(() => buildClinicalImportPlanFromSnapshot(batch({ index: 0, incoming: nextUrl }).input))
      .toThrow(/pagination root/u);
  });

  it("requires the declared open continuation to match the provider page", () => {
    const first = batch({ index: 0, next: nextUrl });
    if (first.input.manifest.schemaVersion !== "murph.clinical-raw-manifest.v3" || !first.input.manifest.batch) throw new Error("fixture");
    delete first.input.manifest.batch.continuesWith;
    expect(() => buildClinicalImportPlanFromSnapshot(first.input)).toThrow(/raw next link/u);
  });

  it("can start another root slice after an unavailable continuation without claiming completion", () => {
    const first = batch({ index: 0, next: nextUrl });
    const nextSlice = batch({ index: 1, queryScopeId: "outside-vitals", previous: first.evidence });
    expect(buildClinicalImportPlanFromSnapshot(nextSlice.input).decisions).toHaveLength(1);
    const sameSlice = batch({ index: 1, previous: first.evidence });
    expect(() => buildClinicalImportPlanFromSnapshot(sameSlice.input)).toThrow(/predecessor pagination link/u);
  });

  it("rejects wrong run ordering, identity, and whole-slice completion claims", () => {
    const first = batch({ index: 0, next: nextUrl });
    const skipped = batch({ index: 2, incoming: nextUrl, previous: first.evidence });
    expect(() => buildClinicalImportPlanFromSnapshot(skipped.input)).toThrow(/batch identity/u);
    const second = batch({ index: 1, incoming: nextUrl, previous: first.evidence });
    expect(() => buildClinicalImportPlanFromSnapshot({ ...second.input, manifest: {
      ...second.input.manifest, fhirBaseUrlHash: hashClinicalFhirBaseUrl("https://other.example.test/fhir"),
    } })).toThrow(/batch identity/u);
    expect(() => buildClinicalImportPlanFromSnapshot({ ...first.input, manifest: {
      ...first.input.manifest, completedRetrievalSlices: [{ queryScopeId: "vitals", sliceId: "all" }],
    } })).toThrow(/no whole-slice completion/u);
  });
});
