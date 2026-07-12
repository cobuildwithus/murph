import {
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  clinicalFacetSlug,
  clinicalFhirManifestPathSchema,
  clinicalImportDecisionSchema,
  clinicalImportPlanSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  externalRefForFhir,
  fhirResourceTypeToSlug,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  isClinicalFhirUrlWithinBase,
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
    expect(hashClinicalFhirPageUrl(`${FHIR_BASE_URL}/Observation?page=2`)).toMatch(/^[a-f0-9]{64}$/u);
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
