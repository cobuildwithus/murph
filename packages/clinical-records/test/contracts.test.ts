import {
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  clinicalImportCandidateSchema,
  clinicalFacetSlug,
  clinicalImportPlanSchema,
  clinicalImportUnsupportedResourceSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  externalRefForFhir,
  fhirResourceTypeToSlug,
  fhirSourceRefSchema,
  rawRefForClinicalManifestFile,
} from "../src/index.ts";
import { describe, expect, it } from "vitest";

const SHA256 = "0".repeat(64);
const FHIR_BASE_URL_HASH = "1".repeat(64);
const PATIENT_ID_HASH = "2".repeat(64);
const OTHER_PATIENT_ID_HASH = "3".repeat(64);
const RAW_REF = "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json";

const sourceRef = {
  sourceSystem: "epic-fhir",
  resourceType: "Observation",
  resourceId: "obs-1",
  rawRef: RAW_REF,
} as const;

const externalRef = {
  system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
  resourceType: "observation",
  resourceId: "obs-1",
} as const;

const commonPayload = {
  occurredAt: "2026-07-01T12:00:00.000Z",
  externalRef,
} as const;

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
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: [resourceFile],
      requestedScopes: ["patient/Observation.read"],
      grantedScopes: ["patient/Observation.read"],
    });

    expect(manifest.resourceFiles).toEqual([resourceFile]);
    expect(() =>
      clinicalRawManifestSchema.parse({
        ...manifest,
        fhirBaseUrlHash: "https-example.test-fhir",
      }),
    ).toThrow();
    expect(
      rawRefForClinicalManifestFile({
        manifestPath: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json",
        resourceFile,
      }),
    ).toBe("raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json");
  });

  it("bounds raw manifests and raw file paths", () => {
    expect(() =>
      clinicalRawManifestSchema.parse({
        schemaVersion: "murph.clinical-raw-manifest.v1",
        kind: "clinical_fhir_retrieval",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
        providerDirectoryEntryId: "provider-entry-1",
        sourceSystem: "cerner-fhir",
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        fetchedAt: "2026-07-01T12:00:00.000Z",
        resourceFiles: [
          {
            resourceType: "Observation",
            relativePath: "Observation/page-1.json",
            count: CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES + 1,
            sha256: SHA256,
            pageUrlHash: SHA256,
          },
        ],
        requestedScopes: ["patient/Observation.read"],
        grantedScopes: ["patient/Observation.read"],
        errors: [
          {
            resourceType: "Observation",
            code: "rate_limited",
            message: "FHIR source rate limited this page.",
          },
        ],
      }),
    ).toThrow(/total resource count/u);

    expect(() =>
      clinicalRawManifestSchema.parse({
        schemaVersion: "murph.clinical-raw-manifest.v1",
        kind: "clinical_fhir_retrieval",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
        sourceSystem: "cerner-fhir",
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        fetchedAt: "2026-07-01T12:00:00.000Z",
        resourceFiles: [
          {
            resourceType: "Observation",
            relativePath: "../Observation/page-1.json",
            count: 1,
            sha256: SHA256,
          },
        ],
        requestedScopes: [],
        grantedScopes: [],
      }),
    ).toThrow();
  });

  it("normalizes deterministic FHIR external references", () => {
    expect(fhirResourceTypeToSlug("DiagnosticReport")).toBe("diagnostic-report");
    expect(clinicalFacetSlug("Systolic BP (mmHg)")).toBe("systolic-bp-mm-hg");
    expect(
      externalRefForFhir({
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        sourceSystem: "epic-fhir",
        resourceType: "Observation",
        resourceId: "obs-1",
        version: "3",
        facet: "BP Systolic",
      }),
    ).toEqual({
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "obs-1",
      version: "3",
      facet: "bp-systolic",
    });
    expect(
      externalRefForFhir({
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: OTHER_PATIENT_ID_HASH,
        sourceSystem: "epic-fhir",
        resourceType: "Observation",
        resourceId: "obs-1",
        facet: "BP Systolic",
      }).system,
    ).not.toBe(
      externalRefForFhir({
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        sourceSystem: "epic-fhir",
        resourceType: "Observation",
        resourceId: "obs-1",
        facet: "BP Systolic",
      }).system,
    );
    expect(
      externalRefForFhir({
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        sourceSystem: "generic-smart-fhir",
        resourceType: "DocumentReference",
        resourceId: "doc-1",
      }),
    ).toEqual({
      system: `generic-smart-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "document-reference",
      resourceId: "doc-1",
    });
    expect(() =>
      externalRefForFhir({
        fhirBaseUrlHash: "a-b",
        patientIdHash: "c",
        sourceSystem: "epic-fhir",
        resourceType: "Observation",
        resourceId: "obs-1",
        facet: "BP Systolic",
      }),
    ).toThrow();
  });

  it("rejects raw path parent traversal at the contract boundary", () => {
    expect(() => clinicalRawPathSchema.parse("raw/clinical/fhir/../escape.json")).toThrow();
  });

  it("validates FHIR source refs and unsupported resources", () => {
    expect(
      fhirSourceRefSchema.parse({
        ...sourceRef,
        version: "3",
        facet: "systolic",
      }),
    ).toEqual({
      ...sourceRef,
      version: "3",
      facet: "systolic",
    });

    expect(() =>
      fhirSourceRefSchema.parse({
        ...sourceRef,
        facet: "Systolic BP",
      }),
    ).toThrow();

    expect(
      clinicalImportUnsupportedResourceSchema.parse({
        resourceType: "Procedure",
        reason: "procedure import not implemented",
        rawRef: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Procedure/page-1.json",
      }),
    ).toEqual({
      resourceType: "Procedure",
      reason: "procedure import not implemented",
      rawRef: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Procedure/page-1.json",
    });
  });

  it("validates each clinical import candidate payload boundary", () => {
    expect(
      clinicalImportCandidateSchema.parse({
        kind: "vitals",
        resource: sourceRef,
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          measurements: [
            {
              metric: "blood-pressure-systolic",
              value: 120,
              unit: "mmHg",
            },
          ],
          timeZone: "America/New_York",
          rawRefs: [RAW_REF],
          evidence: [
            {
              rawRef: RAW_REF,
              spanStart: 0,
              spanEnd: 5,
            },
          ],
        },
      }).payload,
    ).toMatchObject({
      source: "import",
      title: "FHIR vitals",
    });

    expect(
      clinicalImportCandidateSchema.parse({
        kind: "diagnostic-test",
        resource: sourceRef,
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          testName: "Basic metabolic panel",
          results: [
            {
              analyte: "Glucose",
              value: 92,
              unit: "mg/dL",
              flag: "normal",
            },
          ],
          collectedAt: "2026-07-01T11:00:00.000Z",
          reportedAt: "2026-07-01T12:00:00.000Z",
          fastingStatus: "fasting",
        },
      }).payload,
    ).toMatchObject({
      resultStatus: "unknown",
      source: "import",
    });

    expect(
      clinicalImportCandidateSchema.parse({
        kind: "clinical-note",
        resource: {
          ...sourceRef,
          resourceType: "DocumentReference",
          resourceId: "doc-1",
        },
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          authoredAt: "2026-07-01T11:00:00.000Z",
          signedAt: "2026-07-01T12:00:00.000Z",
          sections: [
            {
              kind: "assessment",
              heading: "Assessment",
              text: "Patient is stable.",
            },
          ],
        },
      }).payload,
    ).toMatchObject({
      noteType: "clinical_note",
      title: "FHIR clinical note",
    });

    expect(
      clinicalImportCandidateSchema.parse({
        kind: "assertion",
        resource: {
          ...sourceRef,
          resourceType: "AllergyIntolerance",
          resourceId: "allergy-1",
        },
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          assertion: "no_known_allergies",
          domain: "allergy",
          polarity: "absent",
          subject: "No known allergies",
          assertedOn: "2026-07-01",
          sourceLabel: "FHIR AllergyIntolerance",
        },
      }).payload,
    ).toMatchObject({
      title: "FHIR clinical assertion",
      source: "import",
    });
  });

  it("rejects lossy clinical import candidate payloads", () => {
    expect(() =>
      clinicalImportCandidateSchema.parse({
        kind: "clinical-note",
        resource: sourceRef,
        rawRef: RAW_REF,
        payload: commonPayload,
      }),
    ).toThrow(/requires note or sections/u);

    expect(() =>
      clinicalImportCandidateSchema.parse({
        kind: "vitals",
        resource: sourceRef,
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          occurredAt: "2026-07-01",
          measurements: [
            {
              metric: "blood-pressure-systolic",
              value: 120,
              unit: "mmHg",
            },
          ],
        },
      }),
    ).toThrow();

    expect(() =>
      clinicalImportCandidateSchema.parse({
        kind: "assertion",
        resource: sourceRef,
        rawRef: RAW_REF,
        payload: {
          ...commonPayload,
          assertion: "no_known_allergies",
          assertedOn: "2026-07-01T12:00:00.000Z",
        },
      }),
    ).toThrow();
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
