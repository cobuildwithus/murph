import {
  clinicalFacetSlug,
  clinicalImportPlanSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  externalRefForFhir,
  fhirResourceTypeToSlug,
  rawRefForClinicalManifestFile,
} from "../src/index.ts";
import { describe, expect, it } from "vitest";

const SHA256 = "0".repeat(64);

describe("clinical records contracts", () => {
  it("validates raw manifests and derives raw FHIR refs", () => {
    const resourceFile = {
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 2,
      sha256: SHA256,
    };
    const manifest = clinicalRawManifestSchema.parse({
      schemaVersion: "murph.clinical-raw-manifest.v1",
      kind: "clinical_fhir_retrieval",
      connectionId: "clinical-connection-1",
      retrievalJobId: "retrieval-job-1",
      sourceSystem: "epic-fhir",
      fhirBaseUrlHash: "base-url-sha256",
      patientIdHash: "patient-id-sha256",
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: [resourceFile],
      requestedScopes: ["patient/Observation.read"],
      grantedScopes: ["patient/Observation.read"],
    });

    expect(manifest.resourceFiles).toEqual([resourceFile]);
    expect(
      rawRefForClinicalManifestFile({
        manifestPath: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json",
        resourceFile,
      }),
    ).toBe("raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json");
  });

  it("normalizes deterministic FHIR external references", () => {
    expect(fhirResourceTypeToSlug("DiagnosticReport")).toBe("diagnostic-report");
    expect(clinicalFacetSlug("Systolic BP (mmHg)")).toBe("systolic-bp-mm-hg");
    expect(
      externalRefForFhir({
        sourceSystem: "epic-fhir",
        resourceType: "Observation",
        resourceId: "obs-1",
        version: "3",
        facet: "BP Systolic",
      }),
    ).toEqual({
      system: "epic-fhir",
      resourceType: "observation",
      resourceId: "obs-1",
      version: "3",
      facet: "bp-systolic",
    });
  });

  it("rejects raw path parent traversal at the contract boundary", () => {
    expect(() => clinicalRawPathSchema.parse("raw/clinical/fhir/../escape.json")).toThrow();
  });

  it("keeps raw evidence separate from import candidates", () => {
    expect(() =>
      clinicalImportPlanSchema.parse({
        schemaVersion: "murph.clinical-import-plan.v1",
        source: {
          kind: "fhir",
          rawManifestPath: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json",
          sourceSystem: "epic-fhir",
          connectionId: "clinical-connection-1",
          retrievalJobId: "retrieval-job-1",
        },
        candidates: [],
        unsupported: [
          {
            resourceType: "Condition",
            resourceId: "condition-1",
            reason: "condition registry import not implemented",
            rawRef: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Condition/page-1.json",
          },
        ],
      }),
    ).not.toThrow();
  });
});
