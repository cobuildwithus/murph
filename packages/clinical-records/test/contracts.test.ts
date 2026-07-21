import {
  CLINICAL_FHIR_MAX_RETRIEVAL_SLICES,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  clinicalFacetSlug,
  clinicalFhirManifestPathSchema,
  clinicalFhirRetrievalPlanSchema,
  clinicalImportDecisionSchema,
  clinicalImportPlanSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  countClinicalFhirPageResources,
  externalRefForFhir,
  fhirResourceTypeToSlug,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  isClinicalFhirUrlWithinBase,
  isClinicalFhirUrlWithinBaseResourceType,
  normalizeClinicalFhirPatientId,
  normalizeClinicalFhirPatientReference,
  rawRefForClinicalManifestFile,
} from "../src/index.ts";
import { describe, expect, it } from "vitest";

const SHA256 = "0".repeat(64);
const FHIR_BASE_URL = "https://ehr.example.test/fhir";
const FHIR_BASE_URL_HASH = hashClinicalFhirBaseUrl(FHIR_BASE_URL);
const PATIENT_ID_HASH = hashClinicalFhirPatientId("patient-1");
const OTHER_PATIENT_ID_HASH = hashClinicalFhirPatientId("patient-2");
const RAW_REF = "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json";
const SOURCE_VERSION = "2026-07-01T12:00:00.123456Z";

const externalRef = {
  system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
  resourceType: "observation",
  resourceId: "obs-1",
  version: SOURCE_VERSION,
} as const;

const evidence = [{
  rawRef: RAW_REF,
  sourceLabel: "Observation/obs-1",
}] as const;

const planSource = {
  kind: "fhir",
  rawManifestPath: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json",
  sourceSystem: "epic-fhir",
  connectionId: "clinical-connection-1",
  retrievalJobId: "retrieval-job-1",
} as const;

describe("clinical records contracts", () => {
  it("keys retrieval by query and deterministic slice instead of resource type", () => {
    const plan = clinicalFhirRetrievalPlanSchema.parse({
      schemaVersion: "murph.clinical-retrieval-plan.v1",
      slices: [
        {
          coverage: "whole-family",
          queryFingerprint: "1".repeat(64),
          queryScopeId: "observation-labs",
          resourceType: "Observation",
          sliceId: "whole",
        },
        {
          coverage: "whole-family",
          queryFingerprint: "2".repeat(64),
          queryScopeId: "observation-vitals",
          resourceType: "Observation",
          sliceId: "whole",
        },
      ],
    });

    expect(plan.slices.map((slice) => slice.queryScopeId)).toEqual([
      "observation-labs",
      "observation-vitals",
    ]);
    expect(() => clinicalFhirRetrievalPlanSchema.parse({
      ...plan,
      slices: [plan.slices[0], plan.slices[0]],
    })).toThrow("identity to be unique");
  });

  it("keeps retrieval plans within the composed execution envelope", () => {
    const slices = Array.from(
      { length: CLINICAL_FHIR_MAX_RETRIEVAL_SLICES },
      (_, index) => ({
        coverage: "whole-family" as const,
        queryFingerprint: SHA256,
        queryScopeId: `observation-query-${index}`,
        resourceType: "Observation" as const,
        sliceId: "whole",
      }),
    );

    expect(clinicalFhirRetrievalPlanSchema.parse({
      schemaVersion: "murph.clinical-retrieval-plan.v1",
      slices,
    }).slices).toHaveLength(CLINICAL_FHIR_MAX_RETRIEVAL_SLICES);
    expect(() => clinicalFhirRetrievalPlanSchema.parse({
      schemaVersion: "murph.clinical-retrieval-plan.v1",
      slices: [
        ...slices,
        {
          ...slices[0],
          queryScopeId: "one-query-beyond-the-execution-envelope",
        },
      ],
    })).toThrow();
  });

  it("requires bounded slices to be contiguous, ordered, and non-overlapping", () => {
    const slice = {
      coverage: "bounded-window" as const,
      from: "2025-01-01T00:00:00.000Z",
      queryFingerprint: SHA256,
      queryScopeId: "encounter-history",
      resourceType: "Encounter",
      sliceId: "2025-h1",
      to: "2025-07-01T00:00:00.000Z",
    };
    const plan = {
      schemaVersion: "murph.clinical-retrieval-plan.v1",
      slices: [
        slice,
        {
          ...slice,
          from: slice.to,
          sliceId: "2025-h2",
          to: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    expect(clinicalFhirRetrievalPlanSchema.parse(plan).slices).toHaveLength(2);
    expect(() => clinicalFhirRetrievalPlanSchema.parse({
      ...plan,
      slices: [plan.slices[0], { ...plan.slices[1], from: "2025-06-01T00:00:00.000Z" }],
    })).toThrow("ordered and non-overlapping");
  });

  it("validates query-aware raw evidence for repeated resource types", () => {
    const manifest = clinicalRawManifestSchema.parse({
      schemaVersion: "murph.clinical-raw-manifest.v3",
      kind: "clinical_fhir_retrieval",
      connectionId: "clinical-connection-1",
      retrievalJobId: "retrieval-job-1",
      sourceSystem: "epic-fhir",
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: ["observation-labs", "observation-vitals"].map((queryScopeId) => ({
        queryScopeId,
        sliceId: "whole",
        resourceType: "Observation",
        relativePath: `${queryScopeId}/whole/Observation/page-0001.json`,
        count: 1,
        sha256: SHA256,
      })),
      retrievalSlices: ["observation-labs", "observation-vitals"].map((queryScopeId, index) => ({
        coverage: "whole-family",
        queryFingerprint: String(index + 1).repeat(64),
        queryScopeId,
        resourceType: "Observation",
        sliceId: "whole",
      })),
      completedRetrievalSlices: ["observation-labs", "observation-vitals"].map((queryScopeId) => ({
        queryScopeId,
        sliceId: "whole",
      })),
      requestedScopes: ["patient/Observation.read"],
      grantedScopes: ["patient/Observation.read"],
    });

    expect(manifest.resourceFiles).toHaveLength(2);
    expect(rawRefForClinicalManifestFile({
      manifestPath: planSource.rawManifestPath,
      resourceFile: manifest.resourceFiles[1]!,
    })).toContain("observation-vitals/whole/Observation/page-0001.json");
  });

  it("validates raw manifests and derives raw FHIR refs", () => {
    const resourceFile = {
      resourceType: "Observation" as const,
      relativePath: "Observation/page-1.json",
      count: 2,
      sha256: SHA256,
    };
    const manifest = clinicalRawManifestSchema.parse({
      schemaVersion: "murph.clinical-raw-manifest.v2",
      kind: "clinical_fhir_retrieval",
      connectionId: "clinical-connection-1",
      retrievalJobId: "retrieval-job-1",
      sourceSystem: "epic-fhir",
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: [resourceFile],
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: SHA256,
        resourceType: "Observation",
      }],
      completedResourceTypes: ["Observation"],
      requestedScopes: ["patient/Observation.read"],
      grantedScopes: ["patient/Observation.read"],
    });

    expect(manifest.resourceFiles).toEqual([resourceFile]);
    expect(() => clinicalRawManifestSchema.parse({ ...manifest, fhirBaseUrlHash: "not-a-hash" })).toThrow();
    expect(() => clinicalRawManifestSchema.parse({ ...manifest, connectionId: "clinical/connection" })).toThrow();
    expect(() => clinicalRawManifestSchema.parse({
      ...manifest,
      completedResourceTypes: ["Observation", "Observation"],
    })).toThrow("unique");
    expect(() => clinicalRawManifestSchema.parse({
      ...manifest,
      completedResourceTypes: ["Condition"],
    })).toThrow("declared raw resource file");
    expect(() => clinicalRawManifestSchema.parse({
      ...manifest,
      errors: [{
        resourceType: "condition",
        code: "fetch-failed",
        message: "Condition retrieval failed",
      }],
    })).toThrow();
    expect(rawRefForClinicalManifestFile({
      manifestPath: planSource.rawManifestPath,
      resourceFile,
    })).toBe(RAW_REF);
  });

  it("bounds raw manifests and raw file paths", () => {
    expect(() => clinicalRawManifestSchema.parse({
      schemaVersion: "murph.clinical-raw-manifest.v2",
      kind: "clinical_fhir_retrieval",
      connectionId: "clinical-connection-1",
      retrievalJobId: "retrieval-job-1",
      sourceSystem: "cerner-fhir",
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES + 1,
        sha256: SHA256,
      }],
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: SHA256,
        resourceType: "Observation",
      }],
      completedResourceTypes: ["Observation"],
      requestedScopes: [],
      grantedScopes: [],
    })).toThrow(/total resource count/u);

    for (const relativePath of ["../Observation/page-1.json", "misc/page-1.json", "page-1.json"]) {
      expect(() => clinicalRawManifestSchema.parse({
        schemaVersion: "murph.clinical-raw-manifest.v2",
        kind: "clinical_fhir_retrieval",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
        sourceSystem: "cerner-fhir",
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        fetchedAt: "2026-07-01T12:00:00.000Z",
        resourceFiles: [{ resourceType: "Observation", relativePath, count: 1, sha256: SHA256 }],
        retrievalScopes: [{
          coverage: "whole-family",
          queryFingerprint: SHA256,
          resourceType: "Observation",
        }],
        completedResourceTypes: ["Observation"],
        requestedScopes: [],
        grantedScopes: [],
      })).toThrow();
    }
  });

  it("rejects duplicate raw manifest resource file paths", () => {
    expect(() => clinicalRawManifestSchema.parse({
      schemaVersion: "murph.clinical-raw-manifest.v2",
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
          relativePath: "Observation/page-1.json",
          count: 1,
          sha256: SHA256,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
          sha256: SHA256,
        },
      ],
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: SHA256,
        resourceType: "Observation",
      }],
      completedResourceTypes: ["Observation"],
      requestedScopes: [],
      grantedScopes: [],
    })).toThrow("relativePath values must be unique");
  });

  it("normalizes deterministic source-resource external references", () => {
    expect(normalizeClinicalFhirPatientId("Patient/patient-1")).toBe("patient-1");
    expect(normalizeClinicalFhirPatientId(`${FHIR_BASE_URL}/Patient/patient-1/_history/2`)).toBe("patient-1");
    expect(normalizeClinicalFhirPatientId("Practitioner/patient-1")).toBeNull();
    expect(hashClinicalFhirBaseUrl(`${FHIR_BASE_URL}/`)).toBe(FHIR_BASE_URL_HASH);
    expect(normalizeClinicalFhirPatientReference({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      reference: `${FHIR_BASE_URL}/Patient/patient-1`,
    })).toBe("patient-1");
    expect(normalizeClinicalFhirPatientReference({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      reference: "https://foreign.example.test/fhir/Patient/patient-1",
    })).toBeNull();
    expect(isClinicalFhirUrlWithinBase({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      url: `${FHIR_BASE_URL}/Observation?page=2`,
    })).toBe(true);
    expect(isClinicalFhirUrlWithinBase({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      url: "https://ehr.example.test/fhir2/Observation?page=2",
    })).toBe(false);
    expect(isClinicalFhirUrlWithinBaseResourceType({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      resourceType: "Observation",
      url: `${FHIR_BASE_URL}/Observation?page=2`,
    })).toBe(true);
    expect(isClinicalFhirUrlWithinBaseResourceType({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      resourceType: "Observation",
      url: `${FHIR_BASE_URL}/Condition?page=2`,
    })).toBe(false);
    expect(hashClinicalFhirPageUrl(`${FHIR_BASE_URL}/Observation?page=2`)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashClinicalFhirPageUrl(` ${FHIR_BASE_URL}/Observation?page=2`)).not.toBe(
      hashClinicalFhirPageUrl(`${FHIR_BASE_URL}/Observation?page=2`),
    );
    expect(hashClinicalFhirPageUrl(`${FHIR_BASE_URL}/Observation?page=2 `)).not.toBe(
      hashClinicalFhirPageUrl(`${FHIR_BASE_URL}/Observation?page=2`),
    );
    expect(fhirResourceTypeToSlug("DiagnosticReport")).toBe("diagnostic-report");
    expect(clinicalFacetSlug("Systolic BP (mmHg)")).toBe("systolic-bp-mm-hg");

    expect(externalRefForFhir({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      sourceSystem: "epic-fhir",
      resourceType: "Observation",
      resourceId: "obs-1",
      version: SOURCE_VERSION,
    })).toEqual(externalRef);
    expect(externalRefForFhir({
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: OTHER_PATIENT_ID_HASH,
      sourceSystem: "epic-fhir",
      resourceType: "Observation",
      resourceId: "obs-1",
      version: SOURCE_VERSION,
    }).system).not.toBe(externalRef.system);
    expect(() => externalRefForFhir({
      fhirBaseUrlHash: "not-a-hash",
      patientIdHash: PATIENT_ID_HASH,
      sourceSystem: "epic-fhir",
      resourceType: "Observation",
      resourceId: "obs-1",
      version: SOURCE_VERSION,
    })).toThrow();
  });

  it("counts supported FHIR page shapes and rejects malformed payloads", () => {
    expect(countClinicalFhirPageResources("[]")).toBe(0);
    expect(countClinicalFhirPageResources("[{},{}]")).toBe(2);
    expect(countClinicalFhirPageResources(JSON.stringify({
      id: "observation-1",
      resourceType: "Observation",
    }))).toBe(1);
    expect(countClinicalFhirPageResources(JSON.stringify({
      resourceType: "Bundle",
    }))).toBe(0);
    expect(countClinicalFhirPageResources(JSON.stringify({
      entry: [{ resource: { resourceType: "Observation" } }],
      resourceType: "Bundle",
    }))).toBe(1);

    expect(() => countClinicalFhirPageResources("not-json")).toThrow(
      "Clinical FHIR raw page must be valid JSON.",
    );
    expect(() => countClinicalFhirPageResources("null")).toThrow(
      "Clinical FHIR raw page must contain a FHIR resource or Bundle.",
    );
    expect(() => countClinicalFhirPageResources("{}")).toThrow(
      "Clinical FHIR raw page must contain a FHIR resource or Bundle.",
    );
    expect(() => countClinicalFhirPageResources(JSON.stringify({
      entry: {},
      resourceType: "Bundle",
    }))).toThrow("Clinical FHIR Bundle entry must be an array.");
  });

  it("validates raw and manifest paths at the contract boundary", () => {
    expect(() => clinicalRawPathSchema.parse("raw/clinical/fhir/../escape.json")).toThrow();
    expect(clinicalFhirManifestPathSchema.parse(planSource.rawManifestPath)).toBe(planSource.rawManifestPath);
    expect(() => clinicalFhirManifestPathSchema.parse("raw/tmp/manifest.json")).toThrow();
    expect(() => rawRefForClinicalManifestFile({
      manifestPath: "raw/tmp/manifest.json",
      resourceFile: {
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
        sha256: SHA256,
      },
    })).toThrow();
  });

  it("validates canonical upsert, retract, and review decisions", () => {
    const decisions = [
      {
        action: "upsert",
        payload: {
          kind: "measurement",
          occurredAt: "2026-07-01T12:00:00.000Z",
          source: "import",
          title: "FHIR vitals",
          measurements: [{ metric: "heart-rate", value: 72, unit: "bpm" }],
          externalRef,
          evidence,
        },
      },
      {
        action: "upsert",
        payload: {
          kind: "test",
          occurredAt: "2026-07-01T12:00:00.000Z",
          source: "import",
          title: "Basic metabolic panel",
          testName: "Basic metabolic panel",
          resultStatus: "unknown",
          results: [{ analyte: "Glucose", value: 92, unit: "mg/dL", flag: "normal" }],
          externalRef,
          evidence,
        },
      },
      {
        action: "upsert",
        payload: {
          kind: "note",
          occurredAt: "2026-07-01T12:00:00.000Z",
          source: "import",
          title: "FHIR clinical note",
          note: "Patient is stable.",
          noteType: "clinical_note",
          externalRef,
          evidence,
        },
      },
      {
        action: "upsert",
        payload: {
          kind: "clinical_assertion",
          occurredAt: "2026-07-01T12:00:00.000Z",
          source: "import",
          title: "No known allergies",
          assertion: "no_known_allergies",
          assertedOn: "2026-07-01",
          externalRef,
          evidence,
        },
      },
      {
        action: "retract",
        externalRef,
        reason: "FHIR resource entered in error",
        evidence,
      },
      {
        action: "review",
        resourceType: "Condition",
        resourceId: "condition-1",
        reason: "condition registry import not implemented",
        evidence: [{
          rawRef: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Condition/page-1.json",
          sourceLabel: "Condition/condition-1",
        }],
      },
    ];

    for (const decision of decisions) {
      expect(() => clinicalImportDecisionSchema.parse(decision)).not.toThrow();
    }
  });

  it("keeps one identity and one provenance owner per decision", () => {
    const upsert = {
      action: "upsert",
      payload: {
        kind: "measurement",
        occurredAt: "2026-07-01T12:00:00.000Z",
        source: "import",
        title: "FHIR vitals",
        measurements: [{ metric: "heart-rate", value: 72, unit: "bpm" }],
        externalRef,
        evidence,
      },
    };

    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      rawRef: RAW_REF,
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: { ...upsert.payload, rawRefs: [RAW_REF] },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: {
        ...upsert.payload,
        attachments: [{
          role: "source-document",
          kind: "document",
          relativePath: RAW_REF,
          mediaType: "application/json",
          sha256: SHA256,
          originalFileName: "page-1.json",
        }],
      },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: {
        ...upsert.payload,
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sourceInstanceId: "device-1",
          timestampSemantics: "utc",
        },
      },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: {
        ...upsert.payload,
        links: [{
          type: "related_to",
          targetId: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        }],
      },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: { ...upsert.payload, evidence: undefined },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: {
        ...upsert.payload,
        externalRef: { ...externalRef, facet: "heart-rate" },
      },
    })).toThrow();
    expect(() => clinicalImportDecisionSchema.parse({
      ...upsert,
      payload: {
        ...upsert.payload,
        externalRef: { ...externalRef, version: undefined },
      },
    })).toThrow();
  });

  it("stores decisions under retrieval-only plan metadata", () => {
    expect(() => clinicalImportPlanSchema.parse({
      schemaVersion: "murph.clinical-import-plan.v1",
      source: planSource,
      decisions: [{
        action: "review",
        resourceType: "Condition",
        resourceId: "condition-1",
        reason: "condition registry import not implemented",
        evidence: [{
          rawRef: "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Condition/page-1.json",
          sourceLabel: "Condition/condition-1",
        }],
      }],
    })).not.toThrow();
  });
});
