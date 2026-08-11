import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CLINICAL_IMPORT_PLAN_MAX_DECISIONS,
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  type ClinicalImportDecision,
  type ClinicalImportPlan,
  type ClinicalImportUpsertPayload,
} from "@murphai/clinical-records";
import { findEventByExternalRef, importEventBatch, initializeVault } from "@murphai/core";
import {
  buildClinicalImportPlan,
  clinicalPlanToEventImportDecisions,
} from "../src/clinical-records/index.ts";
import { afterEach, describe, expect, it } from "vitest";

const BAD_SHA256 = "a".repeat(64);
const FHIR_BASE_URL = "https://ehr.example.test/fhir";
const FHIR_BASE_URL_HASH = hashClinicalFhirBaseUrl(FHIR_BASE_URL);
const PATIENT_ID = "patient-1";
const OTHER_PATIENT_ID = "patient-2";
const PATIENT_ID_HASH = hashClinicalFhirPatientId(PATIENT_ID);
const OTHER_PATIENT_ID_HASH = hashClinicalFhirPatientId(OTHER_PATIENT_ID);
const MANIFEST_PATH = "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json";

const tempRoots: string[] = [];
type ClinicalImportUpsertOfKind<K extends ClinicalImportUpsertPayload["kind"]> =
  Extract<ClinicalImportUpsertPayload, { kind: K }>;
type ClinicalImportReviewDecision = Extract<ClinicalImportDecision, { action: "review" }>;
type ClinicalImportRetractDecision = Extract<ClinicalImportDecision, { action: "retract" }>;

function upserts(plan: ClinicalImportPlan): ClinicalImportUpsertPayload[] {
  return plan.decisions.flatMap((decision) => decision.action === "upsert" ? [decision.payload] : []);
}

function reviews(plan: ClinicalImportPlan): ClinicalImportReviewDecision[] {
  return plan.decisions.filter(
    (decision): decision is ClinicalImportReviewDecision => decision.action === "review",
  );
}

function retractions(plan: ClinicalImportPlan): ClinicalImportRetractDecision[] {
  return plan.decisions.filter(
    (decision): decision is ClinicalImportRetractDecision => decision.action === "retract",
  );
}

function executableDecisions(plan: ClinicalImportPlan) {
  return clinicalPlanToEventImportDecisions(plan);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("buildClinicalImportPlan", () => {
  it.each([
    ["Device", "patient"],
    ["FamilyMemberHistory", "patient"],
    ["MedicationDispense", "subject"],
    ["ServiceRequest", "subject"],
  ] as const)("admits %s into patient-bound raw evidence", async (resourceType, patientField) => {
    const relativePath = `${resourceType}/page-1.json`;
    const vaultRoot = await writeClinicalFixture({
      addDefaultPatientReference: false,
      resourceFiles: [{ count: 1, relativePath, resourceType }],
      pages: {
        [relativePath]: {
          id: `${resourceType.toLowerCase()}-1`,
          [patientField]: { reference: `Patient/${PATIENT_ID}` },
          resourceType,
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        action: "review",
        reason: "FHIR resource type is raw evidence only in v1",
        resourceType,
      }),
    ]);
  });

  it.each([
    ["Device", "patient"],
    ["FamilyMemberHistory", "patient"],
    ["MedicationDispense", "subject"],
    ["ServiceRequest", "subject"],
  ] as const)("rejects %s raw evidence bound to another patient", async (
    resourceType,
    patientField,
  ) => {
    const relativePath = `${resourceType}/page-1.json`;
    const vaultRoot = await writeClinicalFixture({
      addDefaultPatientReference: false,
      resourceFiles: [{ count: 1, relativePath, resourceType }],
      pages: {
        [relativePath]: {
          id: `${resourceType.toLowerCase()}-other-patient`,
          [patientField]: { reference: `Patient/${OTHER_PATIENT_ID}` },
          resourceType,
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("manifest patient");
  });

  it("plans safe vitals and lab imports while leaving positive conditions raw", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 4,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "Observation",
                id: "bp-panel-1",
                meta: { versionId: "7" },
                status: "final",
                effectiveDateTime: "2026-07-01T12:00:00.000Z",
                code: {
                  coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
                },
                component: [
                  {
                    code: {
                      coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
                    },
                    valueQuantity: { value: 128, system: "http://unitsofmeasure.org", code: "mm[Hg]" },
                  },
                  {
                    code: {
                      coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }],
                    },
                    valueQuantity: { value: 82, unit: "mm[Hg]" },
                  },
                ],
              },
            },
            {
              resource: {
                resourceType: "Observation",
                id: "glucose-1",
                meta: { versionId: "1" },
                status: "final",
                effectiveDateTime: "2026-07-01T12:05:00.000Z",
                issued: "2026-07-01T12:06:00.000Z",
                category: [
                  {
                    coding: [
                      {
                        system: "http://terminology.hl7.org/CodeSystem/observation-category",
                        code: "laboratory",
                      },
                    ],
                  },
                ],
                code: {
                  text: "Glucose",
                  coding: [{ system: "http://loinc.org", code: "2345-7", display: "Glucose" }],
                },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "N",
                    display: "Normal",
                  }],
                }],
                valueQuantity: { comparator: "<", value: 91, unit: "mg/dL" },
              },
            },
            {
              resource: {
                resourceType: "Observation",
                id: "height-1",
                status: "final",
                effectiveDateTime: "2026-07-01T12:07:00.000Z",
                category: [
                  {
                    coding: [
                      {
                        system: "http://terminology.hl7.org/CodeSystem/observation-category",
                        code: "vital-signs",
                      },
                    ],
                  },
                ],
                code: {
                  text: "Body height",
                  coding: [{ system: "http://loinc.org", code: "8302-2", display: "Body height" }],
                },
                valueQuantity: { value: 180, unit: "cm" },
              },
            },
            {
              resource: {
                resourceType: "Observation",
                id: "weight-1",
                status: "final",
                effectiveDateTime: "2026-07-01T12:08:00.000Z",
                code: {
                  text: "Body weight",
                  coding: [{ system: "http://loinc.org", code: "29463-7", display: "Body weight" }],
                },
                valueQuantity: { value: 180, system: "http://unitsofmeasure.org", code: "[lb_av]" },
              },
            },
          ],
        },
        "Condition/page-1.json": {
          resourceType: "Condition",
          id: "condition-positive-1",
          code: {
            text: "Hypertension",
            coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
          },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan).map((candidate) => candidate.kind)).toEqual([
      "measurement",
      "test",
      "measurement",
    ]);
    expect(upserts(plan).some((candidate) => candidate.kind === "clinical_assertion")).toBe(false);
    expect(reviews(plan)).toHaveLength(2);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "Observation",
          resourceId: "height-1",
          reason: "observation code is not importable",
        }),
        expect.objectContaining({
          resourceType: "Condition",
          resourceId: "condition-positive-1",
          reason: "condition registry import not implemented",
        }),
      ]),
    );

    const bloodPressure = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"measurement"> =>
        candidate.kind === "measurement" && candidate.externalRef.resourceId === "bp-panel-1",
    );
    expect(bloodPressure?.title).toBe("Blood pressure panel");
    expect(bloodPressure?.measurements).toEqual([
      { metric: "systolic-blood-pressure", unit: "mmHg", value: 128 },
      { metric: "diastolic-blood-pressure", unit: "mmHg", value: 82 },
    ]);
    expect(bloodPressure?.externalRef).toEqual({
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "bp-panel-1",
      version: "2026-07-01T12:00:00.000Z",
    });

    const bodyWeight = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"measurement"> =>
        candidate.kind === "measurement" && candidate.externalRef.resourceId === "weight-1",
    );
    expect(bodyWeight?.measurements).toEqual([
      { metric: "body-weight", unit: "lb", value: 180 },
    ]);

    const glucose = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test",
    );
    expect(glucose?.testName).toBe("Glucose");
    expect(glucose?.resultStatus).toBe("normal");
    expect(glucose?.results).toEqual([
      {
        analyte: "Glucose",
        biomarkerSlug: "glucose",
        comparator: "<",
        flag: "normal",
        slug: "glucose",
        unit: "mg/dL",
        value: 91,
      },
    ]);
  });

  it("preserves unqualified laboratory reference ranges", async () => {
    const laboratoryCategory = [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "laboratory",
      }],
    }];
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 2,
      }],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "glucose-with-reference-range",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            category: laboratoryCategory,
            code: { text: "Glucose" },
            valueQuantity: {
              value: 91,
              system: "http://unitsofmeasure.org",
              code: "mg/dL",
            },
            referenceRange: [{
              low: {
                value: 70,
                system: "http://unitsofmeasure.org",
                code: "mg/dL",
              },
              high: {
                value: 99,
                system: "http://unitsofmeasure.org",
                code: "mg/dL",
              },
              text: "70-99",
            }],
          },
          {
            resourceType: "Observation",
            id: "qualitative-panel-with-reference-range",
            status: "final",
            effectiveDateTime: "2026-07-01T12:06:00.000Z",
            category: laboratoryCategory,
            code: { text: "Qualitative panel" },
            component: [{
              code: { text: "Ketones" },
              valueString: "Negative",
              referenceRange: [{ text: "Negative" }],
            }],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    expect(reviews(plan)).toEqual([]);
    expect(upserts(plan).map((candidate) =>
      candidate.kind === "test" ? candidate.results : []
    )).toEqual([
      [expect.objectContaining({
        analyte: "Glucose",
        referenceRange: { high: 99, low: 70, text: "70-99" },
        unit: "mg/dL",
        value: 91,
      })],
      [expect.objectContaining({
        analyte: "Ketones",
        referenceRange: { text: "Negative" },
        textValue: "Negative",
      })],
    ]);
  });

  it("holds ambiguous or unit-incompatible laboratory reference ranges for review", async () => {
    const laboratoryCategory = [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "laboratory",
      }],
    }];
    const observation = (id: string, referenceRange: unknown) => ({
      resourceType: "Observation",
      id,
      status: "final",
      effectiveDateTime: "2026-07-01T12:05:00.000Z",
      category: laboratoryCategory,
      code: { text: "Glucose" },
      valueQuantity: { value: 91, unit: "mg/dL" },
      referenceRange,
    });
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 5,
      }],
      pages: {
        "Observation/page-1.json": [
          observation("lab-multiple-ranges", [
            { low: { value: 70, unit: "mg/dL" } },
            { high: { value: 99, unit: "mg/dL" } },
          ]),
          observation("lab-age-qualified-range", [{
            low: { value: 70, unit: "mg/dL" },
            age: { low: { value: 18, unit: "years" } },
          }]),
          observation("lab-unit-mismatched-range", [{
            low: { value: 3.9, unit: "mmol/L" },
          }]),
          observation("lab-inverted-range", [{
            low: { value: 100, unit: "mg/dL" },
            high: { value: 70, unit: "mg/dL" },
          }]),
          observation("lab-malformed-range", [{
            low: { value: "seventy", unit: "mg/dL" },
          }]),
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toHaveLength(5);
    expect(reviews(plan).every((decision) =>
      decision.reason === "laboratory observation result is not importable"
    )).toBe(true);
  });

  it("accepts UCUM per-minute codes for supported rate vitals", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 2,
      }],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "heart-rate-ucum-per-minute",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
            },
            valueQuantity: {
              value: 72,
              system: "http://unitsofmeasure.org",
              code: "/min",
              unit: "beats/minute",
            },
          },
          {
            resourceType: "Observation",
            id: "respiratory-rate-ucum-per-minute",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "9279-1", display: "Respiratory rate" }],
            },
            valueQuantity: {
              value: 16,
              system: "http://unitsofmeasure.org",
              code: "/min",
              unit: "breaths/minute",
            },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    const vitals = upserts(plan).filter(
      (candidate): candidate is ClinicalImportUpsertOfKind<"measurement"> => candidate.kind === "measurement",
    );

    expect(reviews(plan)).toEqual([]);
    expect(vitals.map((candidate) => ({
      measurements: candidate.measurements,
      resourceId: candidate.externalRef.resourceId,
    }))).toEqual([
      {
        measurements: [{ metric: "heart-rate", unit: "bpm", value: 72 }],
        resourceId: "heart-rate-ucum-per-minute",
      },
      {
        measurements: [{ metric: "respiratory-rate", unit: "breaths/min", value: 16 }],
        resourceId: "respiratory-rate-ucum-per-minute",
      },
    ]);
  });

  it("keeps bounded blood pressure panels under the import-plan decision cap", async () => {
    const resourceCount = Math.floor(CLINICAL_IMPORT_PLAN_MAX_DECISIONS / 2) + 1;
    expect(resourceCount).toBeLessThanOrEqual(CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES);

    const resourceFiles: Array<{ count: number; relativePath: string; resourceType: string }> = [];
    const pages: Record<string, unknown> = {};
    for (let startIndex = 0; startIndex < resourceCount; startIndex += CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE) {
      const count = Math.min(CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE, resourceCount - startIndex);
      const relativePath = `Observation/blood-pressure-panels-${resourceFiles.length + 1}.json`;
      resourceFiles.push({ count, relativePath, resourceType: "Observation" });
      pages[relativePath] = Array.from({ length: count }, (_unused, offset) =>
        bloodPressurePanelObservation(startIndex + offset + 1)
      );
    }

    const vaultRoot = await writeClinicalFixture({ resourceFiles, pages });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toHaveLength(resourceCount);
    expect(reviews(plan)).toEqual([]);
    const firstCandidate = upserts(plan)[0];
    expect(firstCandidate?.kind).toBe("measurement");
    if (firstCandidate?.kind === "measurement") {
      expect(firstCandidate.measurements).toEqual([
        { metric: "systolic-blood-pressure", unit: "mmHg", value: 121 },
        { metric: "diastolic-blood-pressure", unit: "mmHg", value: 81 },
      ]);
    }
  });

  it("rejects ambiguous vital CodeableConcepts", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 2,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "bp-ambiguous-top-level",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [
                { system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" },
                { system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" },
              ],
            },
            valueQuantity: { value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "bp-ambiguous-component",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
            },
            component: [
              {
                code: {
                  coding: [
                    { system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" },
                    { system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" },
                  ],
                },
                valueQuantity: { value: 128, unit: "mmHg" },
              },
            ],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "bp-ambiguous-top-level",
        reason: "vital code is ambiguous",
      }),
      expect.objectContaining({
        resourceId: "bp-ambiguous-component",
        reason: "vital code is ambiguous",
      }),
    ]);
  });

  it("rejects mixed vital panels instead of dropping unsupported components", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": [{
          resourceType: "Observation",
          id: "mixed-vital-panel",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
          },
          component: [
            {
              code: {
                coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
              },
              valueQuantity: { value: 128, unit: "mmHg" },
            },
            {
              code: {
                coding: [{ system: "http://loinc.org", code: "8302-2", display: "Body height" }],
              },
              valueQuantity: { value: 170, unit: "cm" },
            },
          ],
        }],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "mixed-vital-panel",
        reason: "vital component code is not importable",
      }),
    ]);
  });

  it("rejects vital observations that mix component and top-level values", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "mixed-top-level-vital",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 188, unit: "bpm" },
          component: [
            {
              code: {
                coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
              },
              valueQuantity: { value: 128, unit: "mmHg" },
            },
            {
              code: {
                coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }],
              },
              valueQuantity: { value: 82, unit: "mmHg" },
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "mixed-top-level-vital",
        reason: "vital observation mixes component and top-level values",
      }),
    ]);
  });

  it("rejects observations with multiple value choices", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 3,
      }],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "ambiguous-vital-value",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
            },
            valueQuantity: { value: 72, unit: "bpm" },
            valueString: "critical",
          },
          {
            resourceType: "Observation",
            id: "ambiguous-vital-component-value",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:30.000Z",
            code: { text: "Vital signs panel" },
            component: [{
              code: {
                coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
              },
              valueQuantity: { value: 72, unit: "bpm" },
              valueString: "critical",
            }],
          },
          {
            resourceType: "Observation",
            id: "ambiguous-lab-component-value",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [{
              code: { text: "Glucose" },
              valueQuantity: { value: 91, unit: "mg/dL" },
              valueString: "critical",
            }],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "ambiguous-vital-value",
        reason: "vital quantity is not importable",
      }),
      expect.objectContaining({
        resourceId: "ambiguous-vital-component-value",
        reason: "vital quantity is not importable",
      }),
      expect.objectContaining({
        resourceId: "ambiguous-lab-component-value",
        reason: "laboratory observation component result is not importable",
      }),
    ]));
  });

  it("rejects scalar vitals that have unhandled components", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": [{
          resourceType: "Observation",
          id: "heart-rate-with-component",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 72, unit: "bpm" },
          component: [{
            code: {
              coding: [{ system: "urn:ehr:observation-context", code: "body-position" }],
              text: "Body position",
            },
            valueString: "sitting",
          }],
        }],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "heart-rate-with-component",
        reason: "vital component code is not importable",
      }),
    ]);
  });

  it("requires trusted result coding while retaining explicit text from unclassified final reports", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 3,
        },
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "lab-local-category",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            category: [{ coding: [{ system: "urn:vendor", code: "lab" }] }],
            code: { text: "Vendor panel" },
            interpretation: [{ coding: [{ system: "urn:vendor-status", code: "N", display: "Normal" }] }],
            valueString: "ok",
          },
          {
            resourceType: "Observation",
            id: "lab-local-interpretation",
            status: "final",
            effectiveDateTime: "2026-07-01T12:06:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Glucose" },
            interpretation: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: "vendor-normal",
                display: "Normal",
              }],
            }],
            valueQuantity: { value: 91, unit: "mg/dL" },
          },
          {
            resourceType: "Observation",
            id: "lab-canonical-short-code",
            status: "final",
            effectiveDateTime: "2026-07-01T12:07:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "lab",
              }],
            }],
            code: { text: "Vendor panel" },
            valueString: "ok",
          },
        ],
        "DiagnosticReport/page-1.json": {
          resourceType: "DiagnosticReport",
          id: "report-local-conclusion-code",
          status: "final",
          issued: "2026-07-01T12:07:00.000Z",
          code: { text: "Serum pregnancy test" },
          conclusion: "Pregnancy test: positive",
          conclusionCode: [{ coding: [{ system: "urn:vendor-status", code: "N", display: "Normal" }] }],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toHaveLength(2);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "lab-local-category",
          reason: "observation code is not importable",
        }),
        expect.objectContaining({
          resourceId: "lab-canonical-short-code",
          reason: "observation code is not importable",
        }),
      ]),
    );
    expect(upserts(plan)).toHaveLength(2);
    expect(upserts(plan).some((candidate) => candidate.externalRef.resourceId === "lab-local-category")).toBe(false);
    expect(upserts(plan).some((candidate) => candidate.externalRef.resourceId === "lab-canonical-short-code"))
      .toBe(false);

    const observation = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "lab-local-interpretation",
    );
    expect(observation?.resultStatus).toBe("unknown");

    const report = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "report-local-conclusion-code",
    );
    expect(report?.resultStatus).toBe("unknown");
    expect(report?.testName).toBe("Serum pregnancy test");
    expect(report?.summary).toBe("Pregnancy test: positive");
  });

  it("preserves lab display units when quantity codes are local", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "lab-local-unit-code",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: {
              text: "Glucose",
              coding: [{ system: "http://loinc.org", code: "2345-7", display: "Glucose" }],
            },
            interpretation: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: "N",
                display: "Normal",
              }],
            }],
            valueQuantity: { value: 91, unit: "mg/dL", system: "urn:vendor:units", code: "M" },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    const glucose = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test",
    );
    expect(glucose?.results).toEqual([
      {
        analyte: "Glucose",
        biomarkerSlug: "glucose",
        flag: "normal",
        slug: "glucose",
        unit: "mg/dL",
        value: 91,
      },
    ]);
  });

  it("plans supported assertions and notes", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 1,
        },
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
      ],
      pages: {
        "DocumentReference/page-1.json": {
          resourceType: "DocumentReference",
          id: "document-1",
          status: "current",
          docStatus: "final",
          date: "2026-07-02T08:30:00.000Z",
          description: "Discharge instructions",
          type: { text: "Discharge summary" },
          content: [
            {
              attachment: {
                contentType: "text/plain",
                data: Buffer.from("Follow up in two weeks.").toString("base64"),
              },
            },
            {
              attachment: {
                contentType: "application/pdf",
                url: "https://example.invalid/discharge-instructions.pdf",
              },
            },
          ],
        },
        "AllergyIntolerance/page-1.json": [
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-1",
            recordedDate: "2026-07-02T09:00:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
        ],
        "Condition/page-1.json": [],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan).map((candidate) => candidate.kind)).toEqual(["note", "clinical_assertion"]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "allergy-negative-1",
        reason: "no-known allergy evidence is resolved at snapshot scope",
      }),
    ]);

    const note = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"note"> =>
        candidate.kind === "note",
    );
    expect(note?.title).toBe("Discharge instructions");
    expect(note?.note).toBe("Follow up in two weeks.");

    const assertion = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"clinical_assertion"> =>
        candidate.kind === "clinical_assertion",
    );
    expect(assertion).toEqual(
      expect.objectContaining({
        occurredAt: "2026-07-02T09:00:00.000Z",
        assertion: "no_known_allergies",
        domain: "allergy",
        polarity: "absent",
        assertedOn: "2026-07-02",
      }),
    );

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    const applied = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(plan),
      apply: true,
    });
    const liveEvents = await Promise.all([note, assertion].map((payload) =>
      payload
        ? findEventByExternalRef({
            vaultRoot: canonicalVaultRoot,
            system: payload.externalRef.system,
            resourceType: payload.externalRef.resourceType,
            resourceId: payload.externalRef.resourceId,
          })
        : null
    ));

    expect(applied.createdCount).toBe(2);
    expect(liveEvents.map((event) => event?.kind)).toEqual(["note", "clinical_assertion"]);
    expect(liveEvents).toHaveLength(2);
  });

  it("blocks no-known allergy assertions when allergy retrieval is incomplete", async () => {
    const incompleteCases: Array<{
      error?: { code: string; message: string; resourceType?: string };
      includeConditionFile: boolean;
      label: string;
    }> = [
      {
        label: "missing-condition",
        includeConditionFile: false,
      },
      {
        label: "scoped",
        includeConditionFile: true,
        error: { resourceType: "AllergyIntolerance", code: "fetch-failed", message: "Allergy page failed" },
      },
      {
        label: "condition",
        includeConditionFile: true,
        error: { resourceType: "Condition", code: "fetch-failed", message: "Condition page failed" },
      },
      {
        label: "unscoped",
        includeConditionFile: true,
        error: { code: "fetch-failed", message: "FHIR retrieval was incomplete" },
      },
    ];

    for (const { error, includeConditionFile, label } of incompleteCases) {
      const resourceId = `allergy-negative-incomplete-${label}`;
      const conditionPath = `Condition/${label}.json`;
      const vaultRoot = await writeClinicalFixture({
        manifest: error === undefined ? undefined : { errors: [error] },
        resourceFiles: [
          {
            resourceType: "AllergyIntolerance",
            relativePath: `AllergyIntolerance/${label}.json`,
            count: 1,
          },
          ...(includeConditionFile
            ? [{ resourceType: "Condition", relativePath: conditionPath, count: 0 }]
            : []),
        ],
        pages: {
          [`AllergyIntolerance/${label}.json`]: [
            {
              resourceType: "AllergyIntolerance",
              id: resourceId,
              recordedDate: "2026-07-02T09:00:00.000Z",
              clinicalStatus: {
                coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
              },
              verificationStatus: {
                coding: [{
                  system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                  code: "confirmed",
                }],
              },
              code: {
                text: "No known allergies",
                coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
              },
            },
          ],
          ...(includeConditionFile ? { [conditionPath]: [] } : {}),
        },
      });

      const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

      expect(upserts(plan)).toEqual([]);
      expect(reviews(plan)).toEqual([
        expect.objectContaining({
          resourceType: "AllergyIntolerance",
          resourceId,
          reason: "no-known allergy evidence is resolved at snapshot scope",
        }),
      ]);
    }
  });

  it("rejects non-canonical manifest error resource families", async () => {
    const vaultRoot = await writeClinicalFixture({
      manifest: {
        errors: [{
          resourceType: "condition",
          code: "fetch-failed",
          message: "Condition retrieval failed",
        }],
      },
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [noKnownAllergyResource("allergy-malformed-error-family")],
        "Condition/page-1.json": [],
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot })).rejects.toThrow();
  });

  it("treats every returned Condition as conflicting no-known allergy evidence", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [noKnownAllergyResource("allergy-code-only-condition")],
        "Condition/page-1.json": [{
          resourceType: "Condition",
          id: "code-only-allergy-condition",
          code: {
            coding: [{ system: "http://snomed.info/sct", code: "703902000" }],
          },
        }],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "allergy-code-only-condition",
        reason: "no-known allergy evidence is resolved at snapshot scope",
      }),
      expect.objectContaining({
        resourceId: "code-only-allergy-condition",
        reason: "condition registry import not implemented",
      }),
    ]));
  });

  it("requires explicit completed families and read scopes before emitting no-known allergies", async () => {
    const incompleteManifests = [
      {
        completedResourceTypes: ["AllergyIntolerance"],
        grantedScopes: ["patient/*.read"],
      },
      {
        completedResourceTypes: ["AllergyIntolerance", "Condition"],
        grantedScopes: ["patient/AllergyIntolerance.read"],
      },
    ];

    for (const [index, manifest] of incompleteManifests.entries()) {
      const resourceId = `allergy-incomplete-contract-${index}`;
      const vaultRoot = await writeClinicalFixture({
        manifest,
        resourceFiles: [
          {
            resourceType: "AllergyIntolerance",
            relativePath: "AllergyIntolerance/page-1.json",
            count: 1,
          },
          {
            resourceType: "Condition",
            relativePath: "Condition/page-1.json",
            count: 0,
          },
        ],
        pages: {
          "AllergyIntolerance/page-1.json": [noKnownAllergyResource(resourceId)],
          "Condition/page-1.json": [],
        },
      });

      const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
      expect(upserts(plan)).toEqual([]);
      expect(reviews(plan)).toEqual([
        expect.objectContaining({
          resourceId,
          reason: "no-known allergy evidence is resolved at snapshot scope",
        }),
      ]);
    }
  });

  it("recognizes SMART read grants without treating write-only scopes as complete", async () => {
    const scopeCases = [
      {
        label: "legacy-read",
        grantedScopes: ["patient/*.read"],
        complete: true,
      },
      {
        label: "v2-read-search",
        grantedScopes: ["patient/*.rs"],
        complete: true,
      },
      {
        label: "legacy-write-only",
        grantedScopes: ["patient/*.write"],
        complete: false,
      },
      {
        label: "v2-write-only",
        grantedScopes: ["patient/*.cud"],
        complete: false,
      },
    ];

    for (const { complete, grantedScopes, label } of scopeCases) {
      const resourceId = `allergy-scope-${label}`;
      const vaultRoot = await writeClinicalFixture({
        manifest: { grantedScopes },
        resourceFiles: [
          {
            resourceType: "AllergyIntolerance",
            relativePath: "AllergyIntolerance/page-1.json",
            count: 1,
          },
          {
            resourceType: "Condition",
            relativePath: "Condition/page-1.json",
            count: 0,
          },
        ],
        pages: {
          "AllergyIntolerance/page-1.json": [noKnownAllergyResource(resourceId)],
          "Condition/page-1.json": [],
        },
      });

      const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
      if (complete) {
        expect(upserts(plan)).toEqual([
          expect.objectContaining({
            kind: "clinical_assertion",
            externalRef: expect.objectContaining({
              resourceId: "global",
              resourceType: "allergy-evidence-summary",
            }),
          }),
        ]);
        expect(reviews(plan)).toEqual([
          expect.objectContaining({
            resourceId,
            reason: "no-known allergy evidence is resolved at snapshot scope",
          }),
        ]);
      } else {
        expect(upserts(plan)).toEqual([]);
        expect(reviews(plan)).toEqual([
          expect.objectContaining({
            resourceId,
            reason: "no-known allergy evidence is resolved at snapshot scope",
          }),
        ]);
      }
    }
  });

  it("fails closed on ambiguous or malformed DocumentReference inline text data", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 5,
        },
      ],
      pages: {
        "DocumentReference/page-1.json": [
          {
            resourceType: "DocumentReference",
            id: "document-malformed-base64",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:30:00.000Z",
            description: "Malformed clinical note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: "not-base64!!!!",
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-invalid-utf8",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:31:00.000Z",
            description: "Invalid UTF-8 clinical note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from([0xff, 0xfe, 0xfd]).toString("base64"),
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-multiple-text",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:32:00.000Z",
            description: "Multipart clinical note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from("Discharge summary.").toString("base64"),
                },
              },
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from("Addendum: stop medication.").toString("base64"),
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-valid-then-malformed",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:33:00.000Z",
            description: "Partially malformed clinical note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from("Discharge summary.").toString("base64"),
                },
              },
              {
                attachment: {
                  contentType: "text/plain",
                  data: "not-base64!!!!",
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-numeric-data",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:34:00.000Z",
            description: "Numeric clinical note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: 1400,
                },
              },
            ],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toHaveLength(5);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "document-malformed-base64",
          reason: "document reference text is not available in raw FHIR page",
        }),
        expect.objectContaining({
          resourceId: "document-invalid-utf8",
          reason: "document reference text is not available in raw FHIR page",
        }),
        expect.objectContaining({
          resourceId: "document-multiple-text",
          reason: "document reference has multiple inline text attachments",
        }),
        expect.objectContaining({
          resourceId: "document-valid-then-malformed",
          reason: "document reference has multiple inline text attachments",
        }),
        expect.objectContaining({
          resourceId: "document-numeric-data",
          reason: "document reference text is not available in raw FHIR page",
        }),
      ]),
    );
  });

  it("plans complete laboratory panels atomically", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "lab-complete-panel",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: "Metabolic panel" },
          component: [
            {
              code: { text: "Glucose" },
              valueQuantity: { value: 91, unit: "mg/dL" },
            },
            {
              code: { text: "Albumin" },
              valueString: "Normal",
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual([]);
    expect(upserts(plan)).toHaveLength(1);
    const panel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test",
    );
    expect(panel?.results).toEqual([
      {
        analyte: "Glucose",
        biomarkerSlug: "glucose",
        slug: "glucose",
        unit: "mg/dL",
        value: 91,
      },
      {
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        slug: "albumin",
        textValue: "Normal",
      },
    ]);
  });

  it("rejects a malformed top-level laboratory result instead of dropping it from a panel", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "malformed-top-level-lab-result",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: "Sodium" },
          valueQuantity: { value: "142", unit: "mmol/L" },
          component: [{
            code: { text: "Potassium" },
            valueQuantity: { value: 4.2, unit: "mmol/L" },
          }],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "malformed-top-level-lab-result",
        reason: "laboratory observation result is not importable",
      }),
    ]);
  });

  it("classifies trusted laboratory observations before overlapping vital codes", async () => {
    const laboratoryCategory = [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "laboratory",
      }],
    }];
    const bodyWeightCode = {
      coding: [{ system: "http://loinc.org", code: "29463-7", display: "Body weight" }],
    };
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 2,
      }],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "laboratory-weight-scalar",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            category: laboratoryCategory,
            code: bodyWeightCode,
            valueQuantity: { value: 70, system: "http://unitsofmeasure.org", code: "kg" },
          },
          {
            resourceType: "Observation",
            id: "laboratory-weight-component",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            category: laboratoryCategory,
            code: { text: "Body composition panel" },
            component: [{
              code: bodyWeightCode,
              valueQuantity: { value: 70, system: "http://unitsofmeasure.org", code: "kg" },
            }],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual([]);
    expect(upserts(plan).map((candidate) => ({
      kind: candidate.kind,
      resourceId: candidate.externalRef.resourceId,
    }))).toEqual([
      { kind: "test", resourceId: "laboratory-weight-scalar" },
      { kind: "test", resourceId: "laboratory-weight-component" },
    ]);
  });

  it("fails closed instead of emitting lossy clinical upserts", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 2,
        },
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 1,
        },
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "lab-partial-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [
              {
                code: { text: "Glucose" },
                valueQuantity: { value: 91, unit: "mg/dL" },
              },
              {
                code: { text: "Albumin" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "lab-oversize-text-value",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Narrative lab" },
            valueString: "x".repeat(161),
          },
        ],
        "DiagnosticReport/page-1.json": {
          resourceType: "DiagnosticReport",
          id: "report-oversize-summary",
          status: "final",
          issued: "2026-07-01T12:02:00.000Z",
          code: { text: "Pathology report" },
          conclusion: "x".repeat(1001),
        },
        "DocumentReference/page-1.json": {
          resourceType: "DocumentReference",
          id: "document-oversize-note",
          status: "current",
          docStatus: "final",
          date: "2026-07-02T08:30:00.000Z",
          description: "Long clinical note",
          content: [
            {
              attachment: {
                contentType: "text/plain",
                data: Buffer.from("x".repeat(4001)).toString("base64"),
              },
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "lab-partial-panel",
          reason: "laboratory observation component result is not importable",
        }),
        expect.objectContaining({
          resourceId: "lab-oversize-text-value",
          reason: "laboratory observation result is not importable",
        }),
        expect.objectContaining({
          resourceId: "report-oversize-summary",
          reason: "diagnostic report summary exceeds supported import bounds",
        }),
        expect.objectContaining({
          resourceId: "document-oversize-note",
          reason: "document reference text exceeds supported import bounds",
        }),
      ]),
    );
  });

  it("rejects whitespace-only and coerced resource text", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 3,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "DiagnosticReport/page-1.json": [
          {
            resourceType: "DiagnosticReport",
            id: "whitespace-report-summary",
            status: "final",
            issued: "2026-07-01T12:00:00.000Z",
            code: { text: "Pathology report" },
            conclusion: "   ",
          },
          {
            resourceType: "DiagnosticReport",
            id: "numeric-report-summary",
            status: "final",
            issued: "2026-07-01T12:01:00.000Z",
            code: { text: "Pathology report" },
            conclusion: 12345,
          },
          {
            resourceType: "DiagnosticReport",
            id: "numeric-report-narrative",
            status: "final",
            issued: "2026-07-01T12:01:30.000Z",
            code: { text: "Pathology report" },
            text: { div: 12345 },
          },
        ],
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "whitespace-lab-analyte",
          status: "final",
          effectiveDateTime: "2026-07-01T12:02:00.000Z",
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: " " },
          valueQuantity: { value: 142, unit: "mmol/L" },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "whitespace-report-summary",
        reason: "diagnostic report summary is not available in raw FHIR page",
      }),
      expect.objectContaining({
        resourceId: "numeric-report-summary",
        reason: "diagnostic report summary is not available in raw FHIR page",
      }),
      expect.objectContaining({
        resourceId: "numeric-report-narrative",
        reason: "diagnostic report summary is not available in raw FHIR page",
      }),
      expect.objectContaining({
        resourceId: "whitespace-lab-analyte",
        reason: "laboratory observation result is not importable",
      }),
    ]));
  });

  it("preserves lab analytes that do not derive a slug", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "non-slug-analyte",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: "血糖" },
          valueQuantity: { value: 91, unit: "mg/dL" },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual([]);
    expect(upserts(plan)).toHaveLength(1);
    const candidate = upserts(plan).find(
      (item): item is ClinicalImportUpsertOfKind<"test"> =>
        item.kind === "test",
    );
    expect(candidate?.testName).toBe("血糖");
    expect(candidate?.results).toEqual([
      {
        analyte: "血糖",
        unit: "mg/dL",
        value: 91,
      },
    ]);
  });

  it("keeps upsert-bound FHIR labels resource-local", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 2,
        },
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 2,
        },
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "oversize-lab-label",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "x".repeat(161) },
            component: [{
              code: { text: "Glucose" },
              valueQuantity: { value: 91, unit: "mg/dL" },
            }],
          },
          {
            resourceType: "Observation",
            id: "valid-lab-neighbor",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Albumin" },
            valueString: "Normal",
          },
        ],
        "DiagnosticReport/page-1.json": [
          {
            resourceType: "DiagnosticReport",
            id: "oversize-report-label",
            status: "final",
            issued: "2026-07-01T12:02:00.000Z",
            code: { text: "x".repeat(161) },
            conclusion: "Clear summary.",
          },
          {
            resourceType: "DiagnosticReport",
            id: "max-report-label",
            status: "final",
            issued: "2026-07-01T12:03:00.000Z",
            code: { text: "r".repeat(160) },
            conclusion: "Summary within bounds.",
          },
        ],
        "DocumentReference/page-1.json": {
          resourceType: "DocumentReference",
          id: "oversize-document-title",
          status: "current",
          docStatus: "final",
          date: "2026-07-02T08:30:00.000Z",
          description: "x".repeat(161),
          content: [
            {
              attachment: {
                contentType: "text/plain",
                data: Buffer.from("Follow up in two weeks.").toString("base64"),
              },
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toHaveLength(2);
    expect(upserts(plan).map((candidate) => candidate.externalRef.resourceId).sort()).toEqual([
      "max-report-label",
      "valid-lab-neighbor",
    ]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "oversize-lab-label",
          reason: "clinical upsert exceeds supported import bounds",
        }),
        expect.objectContaining({
          resourceId: "oversize-report-label",
          reason: "clinical upsert exceeds supported import bounds",
        }),
        expect.objectContaining({
          resourceId: "oversize-document-title",
          reason: "clinical upsert exceeds supported import bounds",
        }),
      ]),
    );
  });

  it("fails closed on conflicting trusted clinical result interpretations", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "conflicting-lab-interpretation",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: "Glucose" },
          interpretation: [
            {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                  code: "N",
                },
                {
                  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                  code: "H",
                },
              ],
            },
          ],
          valueQuantity: { value: 91, unit: "mg/dL" },
        },
        "DiagnosticReport/page-1.json": {
          resourceType: "DiagnosticReport",
          id: "conflicting-report-interpretation",
          status: "final",
          issued: "2026-07-01T12:02:00.000Z",
          code: { text: "Pathology report" },
          conclusion: "Clear summary.",
          conclusionCode: [
            {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                  code: "A",
                },
                {
                  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                  code: "N",
                },
              ],
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "conflicting-lab-interpretation",
          reason: "clinical result interpretation is ambiguous",
        }),
        expect.objectContaining({
          resourceId: "conflicting-report-interpretation",
          reason: "clinical result interpretation is ambiguous",
        }),
      ]),
    );
  });

  it("uses lab component interpretations without hiding abnormal results", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 7,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "component-abnormal-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [
              {
                code: { text: "Glucose" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "H",
                  }],
                }],
                valueQuantity: { value: 191, unit: "mg/dL" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "component-normal-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [
              {
                code: { text: "Albumin" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "N",
                  }],
                }],
                valueString: "Normal",
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "component-conflicting-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:02:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [
              {
                code: { text: "Potassium" },
                interpretation: [{
                  coding: [
                    {
                      system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                      code: "N",
                    },
                    {
                      system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                      code: "H",
                    },
                  ],
                }],
                valueQuantity: { value: 5.8, unit: "mmol/L" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "component-partial-normal-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:02:30.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            component: [
              {
                code: { text: "Albumin" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "N",
                  }],
                }],
                valueString: "Normal",
              },
              {
                code: { text: "Potassium" },
                valueQuantity: { value: 4.2, unit: "mmol/L" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "parent-component-conflict-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:03:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            interpretation: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: "N",
              }],
            }],
            component: [
              {
                code: { text: "Potassium" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "H",
                  }],
                }],
                valueQuantity: { value: 5.8, unit: "mmol/L" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "parent-normal-partial-component-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:04:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            interpretation: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: "N",
              }],
            }],
            component: [
              {
                code: { text: "Albumin" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "N",
                  }],
                }],
                valueString: "Normal",
              },
              {
                code: { text: "Potassium" },
                valueQuantity: { value: 4.2, unit: "mmol/L" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "parent-value-normal-component-panel",
            status: "final",
            effectiveDateTime: "2026-07-01T12:05:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Metabolic panel" },
            valueQuantity: { value: 999, unit: "mg/dL" },
            component: [
              {
                code: { text: "Albumin" },
                interpretation: [{
                  coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: "N",
                  }],
                }],
                valueString: "Normal",
              },
            ],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toHaveLength(5);
    const abnormalPanel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "component-abnormal-panel",
    );
    expect(abnormalPanel?.resultStatus).toBe("abnormal");
    expect(abnormalPanel?.results).toEqual([
      {
        analyte: "Glucose",
        biomarkerSlug: "glucose",
        flag: "high",
        slug: "glucose",
        unit: "mg/dL",
        value: 191,
      },
    ]);

    const normalPanel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "component-normal-panel",
    );
    expect(normalPanel?.resultStatus).toBe("normal");
    expect(normalPanel?.results).toEqual([
      {
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        flag: "normal",
        slug: "albumin",
        textValue: "Normal",
      },
    ]);

    const partialNormalPanel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "component-partial-normal-panel",
    );
    expect(partialNormalPanel?.resultStatus).toBe("unknown");
    expect(partialNormalPanel?.results).toEqual([
      {
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        flag: "normal",
        slug: "albumin",
        textValue: "Normal",
      },
      {
        analyte: "Potassium",
        biomarkerSlug: "potassium",
        slug: "potassium",
        unit: "mmol/L",
        value: 4.2,
      },
    ]);

    const parentNormalPartialPanel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "parent-normal-partial-component-panel",
    );
    expect(parentNormalPartialPanel?.resultStatus).toBe("unknown");
    expect(parentNormalPartialPanel?.results).toEqual([
      {
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        flag: "normal",
        slug: "albumin",
        textValue: "Normal",
      },
      {
        analyte: "Potassium",
        biomarkerSlug: "potassium",
        slug: "potassium",
        unit: "mmol/L",
        value: 4.2,
      },
    ]);

    const parentValueNormalComponentPanel = upserts(plan).find(
      (candidate): candidate is ClinicalImportUpsertOfKind<"test"> =>
        candidate.kind === "test" && candidate.externalRef.resourceId === "parent-value-normal-component-panel",
    );
    expect(parentValueNormalComponentPanel?.resultStatus).toBe("unknown");
    expect(parentValueNormalComponentPanel?.results).toEqual([
      {
        analyte: "Metabolic panel",
        biomarkerSlug: "metabolic-panel",
        slug: "metabolic-panel",
        unit: "mg/dL",
        value: 999,
      },
      {
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        flag: "normal",
        slug: "albumin",
        textValue: "Normal",
      },
    ]);

    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "component-conflicting-panel",
          reason: "clinical result interpretation is ambiguous",
        }),
        expect.objectContaining({
          resourceId: "parent-component-conflict-panel",
          reason: "clinical result interpretation is ambiguous",
        }),
      ]),
    );
  });

  it("routes unsafe clinical resources to review or authoritative retraction", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
          {
            resourceType: "Observation",
            relativePath: "Observation/page-1.json",
            count: 11,
          },
          {
            resourceType: "DiagnosticReport",
            relativePath: "DiagnosticReport/page-1.json",
            count: 3,
          },
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 3,
        },
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 6,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          {
            resourceType: "Observation",
            id: "bp-missing-time",
            status: "final",
            code: {
              coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
            },
            valueQuantity: { value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "bp-entered-in-error",
            status: "entered-in-error",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
            },
            valueQuantity: { value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "bp-comparator",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
            },
            valueQuantity: { comparator: "<", value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "bp-local-code-system",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "urn:vendor:loinc-alias", code: "8480-6", display: "Local systolic blood pressure" }],
            },
            valueQuantity: { value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "bp-local-unit-system",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
            },
            valueQuantity: { value: 128, system: "urn:vendor:units", code: "mm[Hg]" },
          },
          {
            resourceType: "Observation",
            id: "bp-missing-code-system",
            status: "final",
            effectiveDateTime: "2026-07-01T12:00:00.000Z",
            code: {
              coding: [{ code: "8480-6", display: "Systolic blood pressure" }],
            },
            valueQuantity: { value: 128, unit: "mmHg" },
          },
          {
            resourceType: "Observation",
            id: "weight-unsupported-unit",
            status: "final",
            effectiveDateTime: "2026-07-01T12:01:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "29463-7", display: "Body weight" }],
            },
            valueQuantity: { value: 12, system: "http://unitsofmeasure.org", code: "[stone_av]" },
          },
          {
            resourceType: "Observation",
            id: "bp-component-unsupported-unit",
            status: "final",
            effectiveDateTime: "2026-07-01T12:02:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
            },
            component: [
              {
                code: {
                  coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
                },
                valueQuantity: { value: 12, system: "http://unitsofmeasure.org", code: "[stone_av]" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "bp-component-local-unit-system",
            status: "final",
            effectiveDateTime: "2026-07-01T12:02:30.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
            },
            component: [
              {
                code: {
                  coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
                },
                valueQuantity: { value: 128, system: "urn:vendor:units", code: "mm[Hg]" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "bp-duplicate-component-facet",
            status: "final",
            effectiveDateTime: "2026-07-01T12:03:00.000Z",
            code: {
              coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
            },
            component: [
              {
                code: {
                  coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
                },
                valueQuantity: { value: 128, unit: "mmHg" },
              },
              {
                code: {
                  coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
                },
                valueQuantity: { value: 132, unit: "mmHg" },
              },
            ],
          },
          {
            resourceType: "Observation",
            id: "lab-date-only",
            status: "final",
            effectiveDateTime: "2026-07-01",
            issued: "2026-07-02T14:30:00.000Z",
            category: [{
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              }],
            }],
            code: { text: "Glucose" },
            valueQuantity: { value: 91, unit: "mg/dL" },
          },
        ],
        "DiagnosticReport/page-1.json": [
          {
            resourceType: "DiagnosticReport",
            id: "report-cancelled",
            status: "cancelled",
            issued: "2026-07-01T12:00:00.000Z",
            code: { text: "Metabolic panel" },
            conclusion: "Cancelled result.",
          },
          {
            resourceType: "DiagnosticReport",
            id: "report-no-summary",
            status: "final",
            issued: "2026-07-01T12:01:00.000Z",
            code: { text: "Metabolic panel" },
          },
          {
            resourceType: "DiagnosticReport",
            id: "report-date-only-effective",
            status: "final",
            effectiveDateTime: "2026-07-01",
            issued: "2026-07-02T14:30:00.000Z",
            code: { text: "Metabolic panel" },
            conclusion: "Date-only effective report.",
          },
        ],
        "DocumentReference/page-1.json": [
          {
            resourceType: "DocumentReference",
            id: "document-entered-in-error",
            status: "entered-in-error",
            date: "2026-07-02T08:30:00.000Z",
            description: "Retracted note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from("This note was retracted.").toString("base64"),
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-docstatus-entered-in-error",
            status: "current",
            docStatus: "entered-in-error",
            date: "2026-07-02T08:31:00.000Z",
            description: "Retracted note",
            content: [
              {
                attachment: {
                  contentType: "text/plain",
                  data: Buffer.from("This note was entered in error.").toString("base64"),
                },
              },
            ],
          },
          {
            resourceType: "DocumentReference",
            id: "document-metadata-only",
            status: "current",
            docStatus: "final",
            date: "2026-07-02T08:32:00.000Z",
            description: "Pathology report",
            text: { status: "generated", div: "<div>Pathology report</div>" },
            content: [
              {
                attachment: {
                  contentType: "application/pdf",
                  url: "https://example.invalid/pathology-report.pdf",
                },
              },
            ],
          },
        ],
        "AllergyIntolerance/page-1.json": [
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-refuted",
            recordedDate: "2026-07-02T09:00:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "refuted",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-missing-status",
            recordedDate: "2026-07-02T09:01:00.000Z",
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-unknown-status",
            recordedDate: "2026-07-02T09:02:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "provisional",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-scoped-negative",
            recordedDate: "2026-07-02T09:03:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known drug allergies",
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-local-no-known-code",
            recordedDate: "2026-07-02T09:04:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "Penicillin",
              coding: [{ system: "urn:vendor:allergies", code: "716186003", display: "Penicillin" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-local-status-system",
            recordedDate: "2026-07-02T09:05:00.000Z",
            clinicalStatus: {
              coding: [{ system: "urn:vendor:allergy-status", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toHaveLength(19);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "bp-missing-time",
          reason: "clinical timestamp is missing",
        }),
        expect.objectContaining({
          resourceId: "bp-comparator",
          reason: "vital quantity comparator is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-local-code-system",
          reason: "vital coding system is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-local-unit-system",
          reason: "vital quantity unit is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-missing-code-system",
          reason: "vital coding system is not importable",
        }),
        expect.objectContaining({
          resourceId: "weight-unsupported-unit",
          reason: "vital quantity unit is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-component-unsupported-unit",
          reason: "vital quantity unit is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-component-local-unit-system",
          reason: "vital quantity unit is not importable",
        }),
        expect.objectContaining({
          resourceId: "bp-duplicate-component-facet",
          reason: "duplicate vital facet in FHIR observation",
        }),
        expect.objectContaining({
          resourceId: "lab-date-only",
          reason: "clinical timestamp is missing",
        }),
        expect.objectContaining({
          resourceId: "report-no-summary",
          reason: "diagnostic report summary is not available in raw FHIR page",
        }),
        expect.objectContaining({
          resourceId: "report-date-only-effective",
          reason: "clinical timestamp is missing",
        }),
        expect.objectContaining({
          resourceId: "document-metadata-only",
          reason: "document reference text is not available in raw FHIR page",
        }),
        expect.objectContaining({
          resourceId: "allergy-missing-status",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-unknown-status",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-scoped-negative",
          reason: "allergy registry import not implemented",
        }),
        expect.objectContaining({
          resourceId: "allergy-local-no-known-code",
          reason: "no-known allergy code system is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-local-status-system",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-refuted",
          reason: "allergy status is not importable",
        }),
      ]),
    );
    expect(retractions(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalRef: expect.objectContaining({ resourceId: "bp-entered-in-error" }),
        reason: "FHIR Observation status entered-in-error",
      }),
      expect.objectContaining({
        externalRef: expect.objectContaining({ resourceId: "report-cancelled" }),
        reason: "FHIR DiagnosticReport status cancelled",
      }),
      expect.objectContaining({
        externalRef: expect.objectContaining({ resourceId: "document-entered-in-error" }),
        reason: "FHIR DocumentReference status entered-in-error",
      }),
      expect.objectContaining({
        externalRef: expect.objectContaining({ resourceId: "document-docstatus-entered-in-error" }),
        reason: "FHIR DocumentReference docStatus entered-in-error",
      }),
    ]));
  });

  it("rejects raw FHIR pages whose manifest integrity does not match", async () => {
    const page = {
      resourceType: "Observation",
      id: "shared-bp",
      status: "final",
      effectiveDateTime: "2026-07-01T12:00:00.000Z",
      code: {
        coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
      },
      valueQuantity: { value: 128, unit: "mmHg" },
    };
    const resourceFile = {
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    };

    const hashMismatchRoot = await writeClinicalFixture({
      resourceFiles: [{ ...resourceFile, sha256: BAD_SHA256 }],
      pages: { "Observation/page-1.json": page },
    });
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: hashMismatchRoot }),
    ).rejects.toThrow("hash mismatch");

    const countMismatchRoot = await writeClinicalFixture({
      resourceFiles: [{ ...resourceFile, count: 2 }],
      pages: { "Observation/page-1.json": page },
    });
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: countMismatchRoot }),
    ).rejects.toThrow("count mismatch");

    const overDeclaredCountRoot = await writeClinicalFixture({
      resourceFiles: [{ ...resourceFile, count: 1 }],
      pages: {
        "Observation/page-1.json": [
          page,
          { ...page, id: "shared-bp-extra" },
        ],
      },
    });
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: overDeclaredCountRoot }),
    ).rejects.toThrow("exceeds declared count");
  });

  it("requires raw FHIR manifest paths to match their clinical retrieval identity", async () => {
    const resourceFile = {
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 0,
    };
    const outOfFamilyManifestPath = "raw/tmp/manifest.json";
    const outOfFamilyRoot = await writeClinicalFixture({
      manifestPath: outOfFamilyManifestPath,
      resourceFiles: [resourceFile],
      pages: { "Observation/page-1.json": [] },
    });
    await expect(
      buildClinicalImportPlan({ manifestPath: outOfFamilyManifestPath, vaultRoot: outOfFamilyRoot }),
    ).rejects.toThrow();

    const mismatchedIdentityRoot = await writeClinicalFixture({
      manifest: { connectionId: "different-connection" },
      resourceFiles: [resourceFile],
      pages: { "Observation/page-1.json": [] },
    });
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: mismatchedIdentityRoot }),
    ).rejects.toThrow("does not match manifest identity");
  });

  it("rejects symlinked raw FHIR manifests and resource pages", async () => {
    const page = {
      resourceType: "Observation",
      id: "shared-bp",
      status: "final",
      effectiveDateTime: "2026-07-01T12:00:00.000Z",
      code: {
        coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
      },
      valueQuantity: { value: 128, unit: "mmHg" },
    };
    const resourceFile = {
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    };

    const manifestSymlinkRoot = await writeClinicalFixture({
      resourceFiles: [resourceFile],
      pages: { "Observation/page-1.json": page },
    });
    const externalManifestRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-outside-"));
    tempRoots.push(externalManifestRoot);
    await writeText(externalManifestRoot, "manifest.json", "{}\n");
    await rm(path.join(manifestSymlinkRoot, MANIFEST_PATH), { force: true });
    await symlink(
      path.join(externalManifestRoot, "manifest.json"),
      path.join(manifestSymlinkRoot, MANIFEST_PATH),
    );
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: manifestSymlinkRoot }),
    ).rejects.toThrow("symbolic links");

    const pageSymlinkRoot = await writeClinicalFixture({
      resourceFiles: [resourceFile],
      pages: { "Observation/page-1.json": page },
    });
    const externalPageRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-outside-"));
    tempRoots.push(externalPageRoot);
    await writeText(externalPageRoot, "page-1.json", serializeJson(page));
    await rm(
      path.join(pageSymlinkRoot, "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json"),
      { force: true },
    );
    await symlink(
      path.join(externalPageRoot, "page-1.json"),
      path.join(pageSymlinkRoot, "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/Observation/page-1.json"),
    );
    await expect(
      buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: pageSymlinkRoot }),
    ).rejects.toThrow("symbolic links");
  });

  it("rejects oversized raw FHIR manifests before parsing them", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
    tempRoots.push(vaultRoot);

    await writeText(
      vaultRoot,
      MANIFEST_PATH,
      `${JSON.stringify({
        schemaVersion: "murph.clinical-raw-manifest.v2",
        kind: "clinical_fhir_retrieval",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
        sourceSystem: "epic-fhir",
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        fetchedAt: "2026-07-01T12:00:00.000Z",
        resourceFiles: [],
        retrievalScopes: [],
        requestedScopes: ["patient/*.read"],
        grantedScopes: ["patient/*.read"],
      })}${" ".repeat(CLINICAL_RAW_MANIFEST_MAX_BYTES + 1)}`,
    );

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("raw file exceeds");
  });

  it("rejects over-cap raw FHIR manifests before reading resource pages", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
    tempRoots.push(vaultRoot);

    const overCapFileCount = Math.floor(
      CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES / CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    ) + 1;
    await writeJson(vaultRoot, MANIFEST_PATH, {
      schemaVersion: "murph.clinical-raw-manifest.v2",
      kind: "clinical_fhir_retrieval",
      connectionId: "clinical-connection-1",
      retrievalJobId: "retrieval-job-1",
      sourceSystem: "epic-fhir",
      fhirBaseUrlHash: FHIR_BASE_URL_HASH,
      patientIdHash: PATIENT_ID_HASH,
      fetchedAt: "2026-07-01T12:00:00.000Z",
      resourceFiles: Array.from({ length: overCapFileCount }, (_, index) => ({
        resourceType: "Observation",
        relativePath: `Observation/missing-page-${index}.json`,
        count: CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
        sha256: BAD_SHA256,
      })),
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: BAD_SHA256,
        resourceType: "Observation",
      }],
      completedResourceTypes: ["Observation"],
      requestedScopes: ["patient/*.read"],
      grantedScopes: ["patient/*.read"],
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("total resource count");
  });

  it("rejects oversized raw FHIR pages before parsing them", async () => {
    const oversizedPage = "x".repeat(CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES + 1);
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 0,
          sha256: sha256Hex(oversizedPage),
        },
      ],
      pages: {
        "Observation/page-1.json": oversizedPage,
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("raw resource file exceeds");
  });

  it("does not import global no-known allergies when positive allergy evidence is present", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 3,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-conflict",
            recordedDate: "2026-07-02T09:00:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-positive-conflict",
            recordedDate: "2026-07-02T09:05:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            code: {
              text: "Penicillin",
              coding: [{ system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-mixed-no-known",
            recordedDate: "2026-07-02T09:10:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "Penicillin allergy",
              coding: [
                { system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" },
                { system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" },
              ],
            },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "allergy-negative-conflict",
          reason: "no-known allergy evidence is resolved at snapshot scope",
        }),
        expect.objectContaining({
          resourceId: "allergy-positive-conflict",
          reason: "allergy registry import not implemented",
        }),
        expect.objectContaining({
          resourceId: "allergy-mixed-no-known",
          reason: "no-known allergy code is ambiguous",
        }),
      ]),
    );
  });

  it("blocks no-known allergies when a raw Condition contains allergy evidence", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [{
          resourceType: "AllergyIntolerance",
          id: "allergy-negative-with-condition-conflict",
          recordedDate: "2026-07-02T09:00:00.000Z",
          clinicalStatus: {
            coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
          },
          verificationStatus: {
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
              code: "confirmed",
            }],
          },
          code: {
            text: "No known allergies",
            coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
          },
        }],
        "Condition/page-1.json": [{
          resourceType: "Condition",
          id: "penicillin-allergy-condition",
          code: {
            text: "Penicillin allergy",
            coding: [{ system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" }],
          },
        }],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "allergy-negative-with-condition-conflict",
        reason: "no-known allergy evidence is resolved at snapshot scope",
      }),
      expect.objectContaining({
        resourceId: "penicillin-allergy-condition",
        reason: "condition registry import not implemented",
      }),
    ]));
  });

  it("blocks no-known allergies when another resource contains allergy evidence", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [
          noKnownAllergyResource("allergy-negative-with-contained-conflict"),
        ],
        "Condition/page-1.json": [],
        "Observation/page-1.json": {
          ...heartRateResource("observation-with-contained-condition"),
          contained: [{
            resourceType: "Condition",
            id: "contained-penicillin-condition",
            clinicalStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
                code: "active",
              }],
            },
            code: {
              text: "Penicillin allergy",
              coding: [{
                system: "http://snomed.info/sct",
                code: "91936005",
                display: "Penicillin allergy",
              }],
            },
          }],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "allergy-negative-with-contained-conflict",
        reason: "no-known allergy evidence is resolved at snapshot scope",
      }),
    ]));
  });

  it("routes malformed contained resources to review and blocks no-known allergies", async () => {
    for (const testCase of [
      {
        suffix: "object",
        contained: {
          resourceType: "Condition",
          id: "contained-penicillin-condition",
          code: { text: "Penicillin allergy" },
        },
      },
      {
        suffix: "padded-type",
        contained: [{
          resourceType: " Condition ",
          id: "contained-penicillin-condition",
          code: { text: "Penicillin allergy" },
        }],
      },
    ]) {
      const vaultRoot = await writeClinicalFixture({
        resourceFiles: [
          {
            resourceType: "AllergyIntolerance",
            relativePath: "AllergyIntolerance/page-1.json",
            count: 1,
          },
          {
            resourceType: "Condition",
            relativePath: "Condition/page-1.json",
            count: 0,
          },
          {
            resourceType: "Observation",
            relativePath: "Observation/page-1.json",
            count: 1,
          },
        ],
        pages: {
          "AllergyIntolerance/page-1.json": [
            noKnownAllergyResource(`allergy-negative-with-malformed-contained-${testCase.suffix}`),
          ],
          "Condition/page-1.json": [],
          "Observation/page-1.json": {
            ...heartRateResource(`observation-with-malformed-contained-${testCase.suffix}`),
            contained: testCase.contained,
          },
        },
      });

      const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

      expect(upserts(plan)).toEqual([]);
      expect(reviews(plan)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          resourceId: `allergy-negative-with-malformed-contained-${testCase.suffix}`,
          reason: "no-known allergy evidence is resolved at snapshot scope",
        }),
        expect.objectContaining({
          resourceId: `observation-with-malformed-contained-${testCase.suffix}`,
          reason: "FHIR contained resources are invalid",
        }),
      ]));
    }
  });

  it("does not import global no-known allergies when unsafe no-known allergy evidence is present", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 3,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-safe",
            recordedDate: "2026-07-02T09:00:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-refuted",
            recordedDate: "2026-07-02T09:05:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "refuted",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-with-reaction",
            recordedDate: "2026-07-02T09:10:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            category: ["medication"],
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
            reaction: [{
              manifestation: [{
                text: "Hives",
                coding: [{ system: "http://snomed.info/sct", code: "247472004", display: "Hives" }],
              }],
            }],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "allergy-negative-safe",
          reason: "no-known allergy evidence is resolved at snapshot scope",
        }),
        expect.objectContaining({
          resourceId: "allergy-negative-with-reaction",
          reason: "no-known allergy conflicts with allergy evidence",
        }),
      ]),
    );
    expect(retractions(plan)).toEqual([]);
    expect(executableDecisions(plan)).toEqual([]);
  });

  it("rejects no-known allergies with contradictory note detail", async () => {
    for (const testCase of [
      {
        resourceId: "allergy-negative-with-note",
        note: [{ text: "except penicillin" }],
      },
      {
        resourceId: "allergy-negative-with-malformed-note",
        note: { text: "except penicillin" },
      },
    ]) {
      const vaultRoot = await writeClinicalFixture({
        resourceFiles: [
          {
            resourceType: "AllergyIntolerance",
            relativePath: "AllergyIntolerance/page-1.json",
            count: 1,
          },
          {
            resourceType: "Condition",
            relativePath: "Condition/page-1.json",
            count: 0,
          },
        ],
        pages: {
          "AllergyIntolerance/page-1.json": [{
            ...noKnownAllergyResource(testCase.resourceId),
            note: testCase.note,
          }],
          "Condition/page-1.json": [],
        },
      });

      const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

      expect(upserts(plan)).toEqual([]);
      expect(reviews(plan)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          resourceId: testCase.resourceId,
          reason: "no-known allergy conflicts with allergy evidence",
        }),
      ]));
    }
  });

  it("keeps no-known-allergy assertedOn on the source-local date", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [{
          ...noKnownAllergyResource("allergy-negative-offset-boundary"),
          recordedDate: "2026-07-01T23:30:00-05:00",
        }],
        "Condition/page-1.json": [],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    const assertion = upserts(plan)[0];

    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "allergy-negative-offset-boundary",
        reason: "no-known allergy evidence is resolved at snapshot scope",
      }),
    ]);
    expect(assertion).toEqual(expect.objectContaining({
      kind: "clinical_assertion",
      occurredAt: "2026-07-02T04:30:00.000Z",
      assertedOn: "2026-07-01",
    }));
  });

  it("does not import global no-known allergies with contradictory or mixed allergy statuses", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 4,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": [
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-confirmed-refuted",
            recordedDate: "2026-07-02T09:00:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                  code: "confirmed",
                },
                {
                  system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                  code: "refuted",
                },
              ],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-active-inactive",
            recordedDate: "2026-07-02T09:05:00.000Z",
            clinicalStatus: {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" },
                { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "inactive" },
              ],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-local-clinical-inactive",
            recordedDate: "2026-07-02T09:10:00.000Z",
            clinicalStatus: {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" },
                { system: "urn:vendor:allergy-status", code: "inactive" },
              ],
            },
            verificationStatus: {
              coding: [{
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "confirmed",
              }],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-negative-local-verification-refuted",
            recordedDate: "2026-07-02T09:15:00.000Z",
            clinicalStatus: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
            },
            verificationStatus: {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                  code: "confirmed",
                },
                {
                  system: "urn:vendor:allergy-status",
                  code: "refuted",
                },
              ],
            },
            code: {
              text: "No known allergies",
              coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergies" }],
            },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "allergy-negative-confirmed-refuted",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-negative-active-inactive",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-negative-local-clinical-inactive",
          reason: "allergy status is not importable",
        }),
        expect.objectContaining({
          resourceId: "allergy-negative-local-verification-refuted",
          reason: "allergy status is not importable",
        }),
      ]),
    );
  });

  it("rejects raw FHIR resources that do not belong to the manifest patient", async () => {
    const vaultRoot = await writeClinicalFixture({
      manifest: { patientId: "patient-a" },
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "other-patient-heart-rate",
          meta: { lastUpdated: "2026-07-01T12:01:00.000Z" },
          subject: { reference: "Patient/patient-b" },
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("manifest patient");
  });

  it("rejects missing, non-Patient, conflicting, and mixed patient references", async () => {
    const heartRate = (id: string, subject: unknown, patient?: unknown) => ({
      resourceType: "Observation",
      id,
      subject,
      ...(patient === undefined ? {} : { patient }),
      status: "final",
      effectiveDateTime: "2026-07-01T12:00:00.000Z",
      code: {
        coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
      },
      valueQuantity: { value: 70, unit: "bpm" },
    });
    const invalidPages = [
      heartRate("missing-patient", null),
      heartRate("bare-patient-id", { reference: "patient-1" }),
      heartRate("non-patient-reference", { reference: "Practitioner/practitioner-1" }),
      heartRate("nested-patient-reference", { reference: "Observation/obs-1/Patient/patient-1" }),
      heartRate(
        "conflicting-patient-reference",
        { reference: "Patient/patient-1" },
        { reference: "Patient/patient-2" },
      ),
      {
        resourceType: "Bundle",
        entry: [
          { resource: heartRate("mixed-patient-a", { reference: "Patient/patient-1" }) },
          { resource: heartRate("mixed-patient-b", { reference: "Patient/patient-2" }) },
        ],
      },
    ];

    for (const [index, page] of invalidPages.entries()) {
      const vaultRoot = await writeClinicalFixture({
        resourceFiles: [{
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: index === invalidPages.length - 1 ? 2 : 1,
        }],
        pages: { "Observation/page-1.json": page },
      });
      await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
        .rejects.toThrow(/manifest patient/u);
    }
  });

  it("accepts same-base absolute Patient references and rejects foreign bases", async () => {
    const writeAbsoluteReferenceFixture = (reference: string) => writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "absolute-reference-heart-rate",
          subject: { reference },
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });

    const matchingRoot = await writeAbsoluteReferenceFixture(`${FHIR_BASE_URL}/Patient/patient-1`);
    const matchingPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: matchingRoot });
    expect(upserts(matchingPlan)).toEqual([
      expect.objectContaining({
        externalRef: expect.objectContaining({ resourceId: "absolute-reference-heart-rate" }),
      }),
    ]);

    const foreignRoot = await writeAbsoluteReferenceFixture(
      "https://foreign.example.test/fhir/Patient/patient-1",
    );
    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: foreignRoot }))
      .rejects.toThrow("invalid manifest patient reference");
  });

  it("rejects resources outside their declared FHIR family", async () => {
    const mislabeledRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Condition",
        relativePath: "Condition/page-1.json",
        count: 1,
      }],
      pages: {
        "Condition/page-1.json": {
          resourceType: "Observation",
          id: "mislabeled-observation",
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });
    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: mislabeledRoot }))
      .rejects.toThrow("declared resource type");
  });

  it("counts but does not import a formally marked search outcome entry", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 2,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          type: "searchset",
          entry: [
            { resource: heartRateResource("heart-rate-with-search-outcome") },
            {
              search: { mode: "outcome" },
              resource: {
                resourceType: "OperationOutcome",
                issue: [{ severity: "warning", code: "informational" }],
              },
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    expect(upserts(plan).map((candidate) => candidate.externalRef.resourceId)).toEqual([
      "heart-rate-with-search-outcome",
    ]);
    expect(reviews(plan)).toEqual([]);
  });

  it("rejects an unmarked outcome resource in an Observation family", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          type: "searchset",
          entry: [{
            resource: {
              resourceType: "OperationOutcome",
              issue: [{ severity: "warning", code: "informational" }],
            },
          }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("declared resource type");
  });

  it("rejects unresolved FHIR pagination before emitting no-known allergies", async () => {
    const nextPageUrl = "https://ehr.example.test/fhir/AllergyIntolerance?page=2";
    const unresolvedPaginationRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
          nextPageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: nextPageUrl }],
          entry: [{
            resource: {
              resourceType: "AllergyIntolerance",
              id: "incomplete-no-known-allergies",
              recordedDate: "2026-07-02T09:00:00.000Z",
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
            },
          }],
        },
        "Condition/page-1.json": [],
      },
    });
    await expect(buildClinicalImportPlan({
      manifestPath: MANIFEST_PATH,
      vaultRoot: unresolvedPaginationRoot,
    })).rejects.toThrow("unresolved pagination");
  });

  it("rejects FHIR pagination without exactly one root", async () => {
    const firstPageUrl = "https://ehr.example.test/fhir/AllergyIntolerance?page=1";
    const secondPageUrl = "https://ehr.example.test/fhir/AllergyIntolerance?page=2";
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 1,
          pageUrlHash: hashClinicalFhirPageUrl(firstPageUrl),
          nextPageUrlHash: hashClinicalFhirPageUrl(secondPageUrl),
        },
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-2.json",
          count: 0,
          pageUrlHash: hashClinicalFhirPageUrl(secondPageUrl),
          nextPageUrlHash: hashClinicalFhirPageUrl(firstPageUrl),
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 0,
        },
      ],
      pages: {
        "AllergyIntolerance/page-1.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: secondPageUrl }],
          entry: [{ resource: noKnownAllergyResource("cyclic-no-known-allergies") }],
        },
        "AllergyIntolerance/page-2.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: firstPageUrl }],
          entry: [],
        },
        "Condition/page-1.json": [],
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("exactly one pagination root");
  });

  it("accepts a FHIR pagination chain only when raw evidence matches the manifest hash", async () => {
    const nextPageUrl = "https://ehr.example.test/fhir/Observation?page=2";
    const observation = (id: string, value: number) => ({
      resourceType: "Observation",
      id,
      status: "final",
      effectiveDateTime: "2026-07-01T12:00:00.000Z",
      code: {
        coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
      },
      valueQuantity: { value, unit: "bpm" },
    });
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
          nextPageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-2.json",
          count: 1,
          pageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: nextPageUrl }],
          entry: [{ resource: observation("page-1-heart-rate", 70) }],
        },
        "Observation/page-2.json": {
          resourceType: "Bundle",
          entry: [{ resource: observation("page-2-heart-rate", 72) }],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    expect(upserts(plan).map((candidate) => candidate.externalRef.resourceId)).toEqual([
      "page-1-heart-rate",
      "page-2-heart-rate",
    ]);
  });

  it("rejects a manifest pagination hash without the matching raw Bundle link", async () => {
    const nextPageUrl = "https://ehr.example.test/fhir/Observation?page=2";
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
          nextPageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-2.json",
          count: 1,
          pageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          entry: [{ resource: heartRateResource("missing-raw-next-page") }],
        },
        "Observation/page-2.json": {
          resourceType: "Bundle",
          entry: [{ resource: heartRateResource("unproved-next-page") }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("does not match its manifest hash");
  });

  it("rejects a same-base next link for another resource family", async () => {
    const nextPageUrl = "https://ehr.example.test/fhir/Condition?page=2";
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
        nextPageUrlHash: hashClinicalFhirPageUrl(nextPageUrl),
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: nextPageUrl }],
          entry: [{ resource: heartRateResource("cross-family-next-page") }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("declared resource family");
  });

  it("rejects multiple independent roots for one whole-family snapshot", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/root-one.json",
          count: 1,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/root-two.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/root-one.json": {
          resourceType: "Bundle",
          entry: [{ resource: heartRateResource("root-one") }],
        },
        "Observation/root-two.json": {
          resourceType: "Bundle",
          entry: [{ resource: heartRateResource("root-two") }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("exactly one pagination root");
  });

  it("rejects pagination that leaves the manifest FHIR base", async () => {
    const foreignPageUrl = "https://foreign.example.test/fhir/Observation?page=2";
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-2.json",
          count: 1,
          pageUrlHash: hashClinicalFhirPageUrl(foreignPageUrl),
        },
      ],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          link: [{ relation: "next", url: foreignPageUrl }],
          entry: [{ resource: heartRateResource("expected-base-page") }],
        },
        "Observation/page-2.json": {
          resourceType: "Bundle",
          entry: [{ resource: heartRateResource("foreign-base-page") }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("outside the manifest FHIR base");
  });

  it("rejects ambiguous next links before validating their FHIR base", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Bundle",
          link: [
            { relation: "next", url: "https://foreign-a.example.test/fhir/Observation?page=2" },
            { relation: "next", url: "https://foreign-b.example.test/fhir/Observation?page=2" },
          ],
          entry: [{ resource: heartRateResource("ambiguous-next-links") }],
        },
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("ambiguous next links");
  });

  it("rejects pagination pages that are not reachable from a root page", async () => {
    const orphanPageUrl = `${FHIR_BASE_URL}/Observation?page=2`;
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        },
        {
          resourceType: "Observation",
          relativePath: "Observation/page-2.json",
          count: 1,
          pageUrlHash: hashClinicalFhirPageUrl(orphanPageUrl),
        },
      ],
      pages: {
        "Observation/page-1.json": heartRateResource("root-page"),
        "Observation/page-2.json": heartRateResource("orphan-page"),
      },
    });

    await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
      .rejects.toThrow("unreachable pagination");
  });

  it("keeps one external identity when an Observation changes mapping shape", async () => {
    const resourceFiles = [{
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    }];
    const scalarRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "shape-changing-observation",
          meta: { lastUpdated: "2026-07-01T12:01:00.000Z" },
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });
    const panelRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "shape-changing-observation",
          meta: { lastUpdated: "2026-07-01T12:02:00.000Z" },
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: { text: "Vitals panel" },
          component: [{
            code: {
              coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
            },
            valueQuantity: { value: 72, unit: "bpm" },
          }],
        },
      },
    });

    const scalarPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: scalarRoot });
    const panelPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: panelRoot });
    const scalarRef = upserts(scalarPlan)[0]?.externalRef;
    const panelRef = upserts(panelPlan)[0]?.externalRef;

    expect(scalarRef).toEqual(expect.objectContaining({
      resourceType: "observation",
      resourceId: "shape-changing-observation",
      version: "2026-07-01T12:01:00.000Z",
    }));
    expect(panelRef).toEqual(expect.objectContaining({
      resourceType: "observation",
      resourceId: "shape-changing-observation",
      version: "2026-07-01T12:02:00.000Z",
    }));
    expect(scalarRef).not.toHaveProperty("facet");
    expect(panelRef).not.toHaveProperty("facet");

    const canonicalVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-apply-"));
    tempRoots.push(canonicalVaultRoot);
    await initializeVault({
      vaultRoot: canonicalVaultRoot,
      createdAt: "2026-07-01T12:00:00.000Z",
      timezone: "America/New_York",
    });
    const scalarCandidate = upserts(scalarPlan)[0];
    const panelCandidate = upserts(panelPlan)[0];
    expect(scalarCandidate).toBeDefined();
    expect(panelCandidate).toBeDefined();
    if (!scalarCandidate || !panelCandidate) {
      throw new Error("Expected scalar and panel clinical import upserts.");
    }

    const firstImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: [{ action: "upsert", payload: scalarCandidate }],
      apply: true,
    });
    const secondImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: [{ action: "upsert", payload: panelCandidate }],
      apply: true,
    });
    expect(firstImport.createdCount).toBe(1);
    expect(secondImport.createdCount).toBe(0);
    expect(secondImport.supersededCount).toBe(1);
    expect(secondImport.eventIds).toEqual(firstImport.eventIds);
  });

  it("replays the same source revision across retrieval-local evidence paths", async () => {
    const resourceFiles = [{
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    }];
    const resource = {
      ...heartRateResource("retrieval-replay-heart-rate"),
      meta: { lastUpdated: "2026-07-01T12:01:00.123456Z" },
    };
    const firstRoot = await writeClinicalFixture({
      resourceFiles,
      pages: { "Observation/page-1.json": resource },
    });
    const secondManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-2/manifest.json";
    const secondRoot = await writeClinicalFixture({
      manifest: { retrievalJobId: "retrieval-job-2" },
      manifestPath: secondManifestPath,
      resourceFiles,
      pages: { "Observation/page-1.json": resource },
    });
    const firstPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: firstRoot });
    const secondPlan = await buildClinicalImportPlan({
      manifestPath: secondManifestPath,
      vaultRoot: secondRoot,
    });
    expect(upserts(firstPlan)[0]?.evidence).not.toEqual(upserts(secondPlan)[0]?.evidence);

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    const firstImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(firstPlan),
      apply: true,
    });
    const replay = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(secondPlan),
      apply: true,
    });

    expect(firstImport.createdCount).toBe(1);
    expect(replay.applied).toBe(false);
    expect(replay.skippedExistingCount).toBe(1);
    expect(replay.supersededCount).toBe(0);
  });

  it("retracts snapshot-scoped no-known-allergy truth before an older snapshot can resurrect it", async () => {
    const firstManifestPath = MANIFEST_PATH;
    const conflictManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-2/manifest.json";
    const restoredManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-3/manifest.json";
    const incompleteManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-4/manifest.json";
    const allergyFile = {
      resourceType: "AllergyIntolerance",
      relativePath: "AllergyIntolerance/page-1.json",
      count: 1,
    };
    const conditionFile = {
      resourceType: "Condition",
      relativePath: "Condition/page-1.json",
      count: 0,
    };
    const noKnownAllergy = noKnownAllergyResource("snapshot-no-known-allergy");
    const firstRoot = await writeClinicalFixture({
      manifest: { fetchedAt: "2026-07-01T12:00:00.000Z" },
      resourceFiles: [allergyFile, conditionFile],
      pages: {
        "AllergyIntolerance/page-1.json": [noKnownAllergy],
        "Condition/page-1.json": [],
      },
    });
    const conflictRoot = await writeClinicalFixture({
      manifest: {
        fetchedAt: "2026-07-01T13:00:00.000Z",
        retrievalJobId: "retrieval-job-2",
      },
      manifestPath: conflictManifestPath,
      resourceFiles: [{ ...allergyFile, count: 2 }, conditionFile],
      pages: {
        "AllergyIntolerance/page-1.json": [
          noKnownAllergy,
          {
            resourceType: "AllergyIntolerance",
            id: "snapshot-positive-allergy",
            recordedDate: "2026-07-01T12:30:00.000Z",
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
              text: "Penicillin allergy",
              coding: [{
                system: "http://snomed.info/sct",
                code: "91936005",
                display: "Penicillin allergy",
              }],
            },
          },
        ],
        "Condition/page-1.json": [],
      },
    });
    const restoredRoot = await writeClinicalFixture({
      manifest: {
        fetchedAt: "2026-07-01T14:00:00.000Z",
        retrievalJobId: "retrieval-job-3",
      },
      manifestPath: restoredManifestPath,
      resourceFiles: [allergyFile, conditionFile],
      pages: {
        "AllergyIntolerance/page-1.json": [noKnownAllergy],
        "Condition/page-1.json": [],
      },
    });
    const incompleteRoot = await writeClinicalFixture({
      manifest: {
        completedResourceTypes: ["AllergyIntolerance"],
        fetchedAt: "2026-07-01T15:00:00.000Z",
        retrievalJobId: "retrieval-job-4",
      },
      manifestPath: incompleteManifestPath,
      resourceFiles: [allergyFile],
      pages: { "AllergyIntolerance/page-1.json": [noKnownAllergy] },
    });
    const firstPlan = await buildClinicalImportPlan({
      manifestPath: firstManifestPath,
      vaultRoot: firstRoot,
    });
    const conflictPlan = await buildClinicalImportPlan({
      manifestPath: conflictManifestPath,
      vaultRoot: conflictRoot,
    });
    const restoredPlan = await buildClinicalImportPlan({
      manifestPath: restoredManifestPath,
      vaultRoot: restoredRoot,
    });
    const incompletePlan = await buildClinicalImportPlan({
      manifestPath: incompleteManifestPath,
      vaultRoot: incompleteRoot,
    });
    const firstAssertion = upserts(firstPlan).find(
      (payload): payload is ClinicalImportUpsertOfKind<"clinical_assertion"> =>
        payload.kind === "clinical_assertion",
    );
    expect(firstAssertion).toBeDefined();
    expect(retractions(conflictPlan)).toEqual([
      expect.objectContaining({
        externalRef: expect.objectContaining({
          resourceId: "global",
          resourceType: "allergy-evidence-summary",
        }),
      }),
    ]);
    expect(upserts(restoredPlan).filter((payload) => payload.kind === "clinical_assertion")).toHaveLength(1);
    expect(upserts(incompletePlan).filter((payload) => payload.kind === "clinical_assertion")).toEqual([]);
    expect(retractions(incompletePlan)).toEqual([]);
    expect(executableDecisions(incompletePlan)).toEqual([]);
    if (!firstAssertion) {
      throw new Error("Expected snapshot-scoped no-known-allergy assertion.");
    }

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    const firstImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(firstPlan),
      apply: true,
    });
    const conflictImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(conflictPlan),
      apply: true,
    });
    const conflictReplay = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(conflictPlan),
      apply: true,
    });
    const delayedOlderSnapshot = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(firstPlan),
      apply: true,
    });
    const restoredImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(restoredPlan),
      apply: true,
    });

    expect(firstImport.createdCount).toBe(1);
    expect(conflictImport.retractedCount).toBe(1);
    expect(conflictReplay.applied).toBe(false);
    expect(delayedOlderSnapshot.applied).toBe(false);
    expect(delayedOlderSnapshot.skippedExistingCount).toBeGreaterThan(0);
    expect(restoredImport.createdCount).toBe(1);
    expect(await findEventByExternalRef({
      vaultRoot: canonicalVaultRoot,
      system: firstAssertion.externalRef.system,
      resourceType: firstAssertion.externalRef.resourceType,
      resourceId: firstAssertion.externalRef.resourceId,
    })).toEqual(expect.objectContaining({
      externalRef: expect.objectContaining({ version: "2026-07-01T14:00:00.000Z" }),
    }));
  });

  it("uses a newer comparable review as a hold against delayed older revisions", async () => {
    const reviewManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-2/manifest.json";
    const delayedManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-3/manifest.json";
    const recoveryManifestPath =
      "raw/clinical/fhir/clinical-connection-1/retrieval-job-4/manifest.json";
    const resourceFile = {
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    };
    const firstRoot = await writeClinicalFixture({
      resourceFiles: [resourceFile],
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("review-held-heart-rate"),
          meta: { lastUpdated: "2026-07-01T12:01:00.000Z" },
        },
      },
    });
    const reviewRoot = await writeClinicalFixture({
      manifest: { retrievalJobId: "retrieval-job-2" },
      manifestPath: reviewManifestPath,
      resourceFiles: [{ ...resourceFile, count: 2 }],
      pages: {
        "Observation/page-1.json": [
          {
            ...heartRateResource("review-held-heart-rate"),
            meta: { lastUpdated: "2026-07-01T12:03:00.000Z" },
            modifierExtension: [{
              url: "https://ehr.example.test/fhir/StructureDefinition/negated",
              valueBoolean: true,
            }],
          },
          {
            ...heartRateResource("review-hold-batch-companion"),
            meta: { lastUpdated: "2026-07-01T12:03:00.000Z" },
          },
        ],
      },
    });
    const delayedRoot = await writeClinicalFixture({
      manifest: { retrievalJobId: "retrieval-job-3" },
      manifestPath: delayedManifestPath,
      resourceFiles: [resourceFile],
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("review-held-heart-rate"),
          meta: { lastUpdated: "2026-07-01T12:02:00.000Z" },
        },
      },
    });
    const recoveryRoot = await writeClinicalFixture({
      manifest: { retrievalJobId: "retrieval-job-4" },
      manifestPath: recoveryManifestPath,
      resourceFiles: [resourceFile],
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("review-held-heart-rate"),
          meta: { lastUpdated: "2026-07-01T12:04:00.000Z" },
        },
      },
    });
    const firstPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: firstRoot });
    const reviewPlan = await buildClinicalImportPlan({
      manifestPath: reviewManifestPath,
      vaultRoot: reviewRoot,
    });
    const delayedPlan = await buildClinicalImportPlan({
      manifestPath: delayedManifestPath,
      vaultRoot: delayedRoot,
    });
    const recoveryPlan = await buildClinicalImportPlan({
      manifestPath: recoveryManifestPath,
      vaultRoot: recoveryRoot,
    });
    const firstPayload = upserts(firstPlan)[0];
    expect(firstPayload).toBeDefined();
    if (!firstPayload) {
      throw new Error("Expected initial clinical observation upsert.");
    }

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(firstPlan),
      apply: true,
    });
    const hold = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(reviewPlan),
      apply: true,
    });
    const holdReplay = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(reviewPlan),
      apply: true,
    });
    const delayed = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(delayedPlan),
      apply: true,
    });
    expect(hold.retractedCount).toBe(1);
    expect(holdReplay.applied).toBe(false);
    expect(delayed.applied).toBe(false);
    expect(await findEventByExternalRef({
      vaultRoot: canonicalVaultRoot,
      system: firstPayload.externalRef.system,
      resourceType: firstPayload.externalRef.resourceType,
      resourceId: firstPayload.externalRef.resourceId,
    })).toBeNull();

    const recovery = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(recoveryPlan),
      apply: true,
    });
    expect(recovery.createdCount).toBe(1);
    expect(await findEventByExternalRef({
      vaultRoot: canonicalVaultRoot,
      system: firstPayload.externalRef.system,
      resourceType: firstPayload.externalRef.resourceType,
      resourceId: firstPayload.externalRef.resourceId,
    })).toEqual(expect.objectContaining({
      externalRef: expect.objectContaining({ version: "2026-07-01T12:04:00.000Z" }),
    }));
  });

  it.each([
    ["Observation", "observation"],
    ["DiagnosticReport", "diagnostic-report"],
    ["DocumentReference", "document-reference"],
  ] as const)("turns a comparable %s review into an event-ledger retraction hold", (resourceType, resourceTypeSlug) => {
    const externalRef = {
      system: "epic-fhir-review-hold",
      resourceType: resourceTypeSlug,
      resourceId: "review-held-resource",
      version: "2026-07-01T12:03:00.000Z",
    };
    const evidence = [{
      rawRef: `raw/clinical/fhir/clinical-connection-1/retrieval-job-1/${resourceType}/page-1.json`,
      sourceLabel: `${resourceType}/review-held-resource`,
    }];

    expect(clinicalPlanToEventImportDecisions({
      schemaVersion: "murph.clinical-import-plan.v1",
      source: {
        kind: "fhir",
        rawManifestPath: MANIFEST_PATH,
        sourceSystem: "epic-fhir",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
      },
      decisions: [{
        action: "review",
        resourceType,
        resourceId: "review-held-resource",
        externalRef,
        reason: "unsupported modifier semantics",
        evidence,
      }],
    })).toEqual([{
      action: "retract",
      externalRef,
      reason: "unsupported modifier semantics",
      evidence,
    }]);
  });

  it("tombstones and replaces an Observation whose canonical kind changes", async () => {
    const resourceFiles = [{
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    }];
    const measurementRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("kind-changing-observation"),
          meta: { lastUpdated: "2026-07-01T12:01:00.000Z" },
        },
      },
    });
    const testRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("kind-changing-observation"),
          meta: { lastUpdated: "2026-07-01T12:02:00.000Z" },
          category: [{
            coding: [{
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            }],
          }],
          code: { text: "Heart rate laboratory result" },
        },
      },
    });
    const measurementPlan = await buildClinicalImportPlan({
      manifestPath: MANIFEST_PATH,
      vaultRoot: measurementRoot,
    });
    const testPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: testRoot });
    expect(upserts(measurementPlan)[0]?.kind).toBe("measurement");
    expect(upserts(testPlan)[0]?.kind).toBe("test");

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    const firstImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(measurementPlan),
      apply: true,
    });
    const replacement = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(testPlan),
      apply: true,
    });

    expect(firstImport.createdCount).toBe(1);
    expect(replacement.createdCount).toBe(1);
    expect(replacement.supersededCount).toBe(1);
    expect(replacement.eventIds).not.toEqual(firstImport.eventIds);
  });

  it("applies and idempotently replays an authoritative FHIR retraction", async () => {
    const resourceFiles = [{
      resourceType: "Observation",
      relativePath: "Observation/page-1.json",
      count: 1,
    }];
    const liveRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("retracted-heart-rate"),
          meta: { lastUpdated: "2026-07-01T12:01:00.000Z" },
        },
      },
    });
    const retractedRoot = await writeClinicalFixture({
      resourceFiles,
      pages: {
        "Observation/page-1.json": {
          ...heartRateResource("retracted-heart-rate"),
          meta: { lastUpdated: "2026-07-01T12:02:00.000Z" },
          status: "entered-in-error",
        },
      },
    });
    const livePlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: liveRoot });
    const retractedPlan = await buildClinicalImportPlan({
      manifestPath: MANIFEST_PATH,
      vaultRoot: retractedRoot,
    });
    expect(retractions(retractedPlan)).toHaveLength(1);

    const canonicalVaultRoot = await initializeCanonicalFixtureVault();
    const firstImport = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(livePlan),
      apply: true,
    });
    const retraction = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(retractedPlan),
      apply: true,
    });
    const replay = await importEventBatch({
      vaultRoot: canonicalVaultRoot,
      decisions: executableDecisions(retractedPlan),
      apply: true,
    });

    expect(firstImport.createdCount).toBe(1);
    expect(retraction.retractedCount).toBe(1);
    expect(retraction.retractedEventIds).toEqual(firstImport.eventIds);
    expect(replay.applied).toBe(false);
    expect(replay.skippedExistingCount).toBe(1);
    expect(replay.retractedCount).toBe(0);
  });

  it("normalizes high-precision FHIR event times while preserving source revision precision", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "high-precision-heart-rate",
          meta: { lastUpdated: "2026-07-01T12:01:00.123456Z" },
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.654321Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(reviews(plan)).toEqual([]);
    expect(upserts(plan)).toEqual([
      expect.objectContaining({
        kind: "measurement",
        occurredAt: "2026-07-01T12:00:00.654Z",
        externalRef: expect.objectContaining({ version: "2026-07-01T12:01:00.123456Z" }),
      }),
    ]);
  });

  it("rejects FHIR modifiers before mapping supported resources", async () => {
    const rootModifier = {
      url: "https://ehr.example.test/fhir/StructureDefinition/negated",
      valueBoolean: true,
    };
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 5,
      }],
      pages: {
        "Observation/page-1.json": [
          {
            ...heartRateResource("implicit-rules-heart-rate"),
            implicitRules: "https://ehr.example.test/fhir/rules/custom",
          },
          {
            ...heartRateResource("root-modifier-heart-rate"),
            modifierExtension: [rootModifier],
          },
          {
            ...bloodPressurePanelObservation(9001),
            id: "component-modifier-blood-pressure",
            component: bloodPressurePanelObservation(9001).component.map((component, index) =>
              index === 0 ? { ...component, modifierExtension: [rootModifier] } : component
            ),
          },
          {
            ...heartRateResource("ordinary-extension-heart-rate"),
            extension: [{
              url: "https://ehr.example.test/fhir/StructureDefinition/device-label",
              valueString: "home cuff",
            }],
          },
          {
            ...heartRateResource("modified-retraction-heart-rate"),
            status: "entered-in-error",
            modifierExtension: [rootModifier],
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan).map((candidate) => candidate.externalRef.resourceId)).toEqual([
      "ordinary-extension-heart-rate",
    ]);
    expect(reviews(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: "implicit-rules-heart-rate",
        reason: "FHIR modifier semantics are not importable",
      }),
      expect.objectContaining({
        resourceId: "root-modifier-heart-rate",
        reason: "FHIR modifier semantics are not importable",
      }),
      expect.objectContaining({
        resourceId: "component-modifier-blood-pressure",
        reason: "FHIR modifier semantics are not importable",
      }),
      expect.objectContaining({
        resourceId: "modified-retraction-heart-rate",
        reason: "FHIR modifier semantics are not importable",
      }),
    ]));
    expect(retractions(plan)).toEqual([]);
  });

  it("rejects modifier semantics on Bundle envelopes and entry wrappers", async () => {
    const modifierExtension = [{
      url: "https://ehr.example.test/fhir/StructureDefinition/negated",
      valueBoolean: true,
    }];
    const bundles = [
      {
        resourceType: "Bundle",
        modifierExtension,
        entry: [{ resource: heartRateResource("bundle-modifier-heart-rate") }],
      },
      {
        resourceType: "Bundle",
        entry: [{
          modifierExtension,
          resource: heartRateResource("entry-modifier-heart-rate"),
        }],
      },
    ];

    for (const bundle of bundles) {
      const vaultRoot = await writeClinicalFixture({
        resourceFiles: [{
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 1,
        }],
        pages: { "Observation/page-1.json": bundle },
      });
      await expect(buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot }))
        .rejects.toThrow("unsupported modifier semantics");
    }
  });

  it("routes resources without provider freshness to review", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [{
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      }],
      pages: {
        "Observation/page-1.json": {
          resourceType: "Observation",
          id: "missing-provider-freshness",
          meta: null,
          status: "final",
          effectiveDateTime: "2026-07-01T12:00:00.000Z",
          code: {
            coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
          },
          valueQuantity: { value: 70, unit: "bpm" },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });
    expect(upserts(plan)).toEqual([]);
    expect(reviews(plan)).toEqual([
      expect.objectContaining({
        resourceId: "missing-provider-freshness",
        reason: "FHIR resource lastUpdated is missing",
      }),
    ]);
    expect(() => executableDecisions(plan)).toThrow(
      "Clinical review for Observation/missing-provider-freshness has no comparable source revision.",
    );
  });

  it("routes oversized FHIR ids and source revisions to review without aborting the plan", async () => {
    const oversizedId = "x".repeat(250);
    const oversizedLastUpdated = `2026-01-03T00:00:00.${"1".repeat(190)}Z`;
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 3,
        },
        {
          resourceType: "Condition",
          relativePath: "Condition/page-1.json",
          count: 1,
        },
      ],
      pages: {
        "Observation/page-1.json": [
          heartRateResource(oversizedId),
          {
            ...heartRateResource(oversizedId),
            status: "cancelled",
          },
          {
            ...heartRateResource("oversized-source-revision"),
            meta: { lastUpdated: oversizedLastUpdated },
          },
        ],
        "Condition/page-1.json": {
          resourceType: "Condition",
          id: oversizedId,
          code: { text: "Hypertension" },
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(upserts(plan)).toEqual([]);
    expect(retractions(plan)).toEqual([]);
    expect(reviews(plan).map((decision) => decision.reason)).toEqual([
      "FHIR resource id is missing",
      "FHIR resource id is missing",
      "FHIR resource lastUpdated is missing",
      "condition registry import not implemented",
    ]);
  });

  it("namespaces FHIR external refs by source base and patient", async () => {
    const resourceFiles = [
      {
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
      },
    ];
    const pages = {
      "Observation/page-1.json": {
        resourceType: "Observation",
        id: "shared-bp",
        status: "final",
        effectiveDateTime: "2026-07-01T12:00:00.000Z",
        code: {
          coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
        },
        valueQuantity: { value: 128, unit: "mmHg" },
      },
    };
    const firstVaultRoot = await writeClinicalFixture({ pages, resourceFiles });
    const secondVaultRoot = await writeClinicalFixture({
      manifest: { patientId: OTHER_PATIENT_ID },
      pages,
      resourceFiles,
    });

    const firstPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: firstVaultRoot });
    const secondPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: secondVaultRoot });
    const firstRef = upserts(firstPlan)[0]?.externalRef;
    const secondRef = upserts(secondPlan)[0]?.externalRef;

    expect(firstRef).toEqual(
      expect.objectContaining({
        system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
        resourceType: "observation",
        resourceId: "shared-bp",
      }),
    );
    expect(secondRef).toEqual(
      expect.objectContaining({
        system: `epic-fhir-${FHIR_BASE_URL_HASH}-${OTHER_PATIENT_ID_HASH}`,
        resourceType: "observation",
        resourceId: "shared-bp",
      }),
    );
    expect(firstRef?.system).not.toBe(secondRef?.system);
  });
});

function noKnownAllergyResource(resourceId: string) {
  return {
    resourceType: "AllergyIntolerance",
    id: resourceId,
    recordedDate: "2026-07-02T09:00:00.000Z",
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

function heartRateResource(resourceId: string) {
  return {
    resourceType: "Observation",
    id: resourceId,
    status: "final",
    effectiveDateTime: "2026-07-01T12:00:00.000Z",
    code: {
      coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
    },
    valueQuantity: { value: 70, unit: "bpm" },
  };
}

function bloodPressurePanelObservation(index: number) {
  return {
    resourceType: "Observation",
    id: `bp-panel-${index}`,
    status: "final",
    effectiveDateTime: "2026-07-01T12:00:00.000Z",
    code: {
      coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }],
    },
    component: [
      {
        code: {
          coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }],
        },
        valueQuantity: { value: 120 + (index % 5), system: "http://unitsofmeasure.org", code: "mm[Hg]" },
      },
      {
        code: {
          coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }],
        },
        valueQuantity: { value: 80 + (index % 5), system: "http://unitsofmeasure.org", code: "mm[Hg]" },
      },
    ],
  };
}

async function initializeCanonicalFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-apply-"));
  tempRoots.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    createdAt: "2026-07-01T12:00:00.000Z",
    timezone: "America/New_York",
  });
  return vaultRoot;
}

async function writeClinicalFixture(input: {
  addDefaultPatientReference?: boolean;
  manifest?: {
    completedResourceTypes?: string[];
    connectionId?: string;
    errors?: Array<{ code: string; message: string; resourceType?: string }>;
    fetchedAt?: string;
    fhirBaseUrlHash?: string;
    grantedScopes?: string[];
    patientId?: string;
    patientIdHash?: string;
    requestedScopes?: string[];
    retrievalScopes?: Array<{
      coverage: "whole-family";
      queryFingerprint: string;
      resourceType: string;
    } | {
      coverage: "bounded-window";
      from: string;
      queryFingerprint: string;
      resourceType: string;
      to: string;
    }>;
    retrievalJobId?: string;
  };
  manifestPath?: string;
  pages: Record<string, unknown>;
  resourceFiles: Array<{
    count: number;
    relativePath: string;
    resourceType: string;
    pageUrlHash?: string;
    nextPageUrlHash?: string;
    sha256?: string;
  }>;
}): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
  tempRoots.push(vaultRoot);
  const manifestPath = input.manifestPath ?? MANIFEST_PATH;
  const patientId = input.manifest?.patientId ?? PATIENT_ID;

  const pageTexts = new Map(
    Object.entries(input.pages).map(([relativePath, value]) => [
      relativePath,
      serializeJson(withClinicalFixtureDefaults(
        value,
        patientId,
        input.addDefaultPatientReference ?? true,
      )),
    ]),
  );
  const resourceFiles = input.resourceFiles.map((resourceFile) => ({
    ...resourceFile,
    sha256: resourceFile.sha256 ?? sha256Hex(pageTexts.get(resourceFile.relativePath) ?? ""),
  }));

  await writeJson(vaultRoot, manifestPath, {
    schemaVersion: "murph.clinical-raw-manifest.v2",
    kind: "clinical_fhir_retrieval",
    connectionId: input.manifest?.connectionId ?? "clinical-connection-1",
    retrievalJobId: input.manifest?.retrievalJobId ?? "retrieval-job-1",
    sourceSystem: "epic-fhir",
    fhirBaseUrlHash: input.manifest?.fhirBaseUrlHash ?? FHIR_BASE_URL_HASH,
    patientIdHash: input.manifest?.patientIdHash ?? hashClinicalFhirPatientId(patientId),
    fetchedAt: input.manifest?.fetchedAt ?? "2026-07-01T12:00:00.000Z",
    resourceFiles,
    retrievalScopes: input.manifest?.retrievalScopes
      ?? [...new Set(resourceFiles.map((resourceFile) => resourceFile.resourceType))].map((resourceType) => ({
        coverage: "whole-family" as const,
        queryFingerprint: BAD_SHA256,
        resourceType,
      })),
    completedResourceTypes: input.manifest?.completedResourceTypes
      ?? [...new Set(resourceFiles.map((resourceFile) => resourceFile.resourceType))],
    requestedScopes: input.manifest?.requestedScopes ?? ["patient/*.read"],
    grantedScopes: input.manifest?.grantedScopes ?? ["patient/*.read"],
    ...(input.manifest?.errors === undefined ? {} : { errors: input.manifest.errors }),
  });

  for (const [relativePath, text] of pageTexts) {
    await writeText(
      vaultRoot,
      `${path.posix.dirname(manifestPath)}/${relativePath}`,
      text,
    );
  }

  return vaultRoot;
}

function withClinicalFixtureDefaults(
  value: unknown,
  patientId: string,
  addDefaultPatientReference: boolean,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      withClinicalFixtureDefaults(entry, patientId, addDefaultPatientReference)
    );
  }
  if (!isFixtureRecord(value) || typeof value.resourceType !== "string") {
    return value;
  }
  if (value.resourceType === "Bundle") {
    return {
      ...value,
      ...(Array.isArray(value.entry)
        ? {
            entry: value.entry.map((entry) =>
              isFixtureRecord(entry)
                ? {
                    ...entry,
                    resource: withClinicalFixtureDefaults(
                      entry.resource,
                      patientId,
                      addDefaultPatientReference,
                    ),
                  }
                : entry
            ),
          }
        : {}),
    };
  }

  const resource = { ...value };
  if (resource.meta === undefined) {
    resource.meta = { lastUpdated: "2026-07-01T12:00:00.000Z" };
  } else if (isFixtureRecord(resource.meta) && resource.meta.lastUpdated === undefined) {
    resource.meta = { ...resource.meta, lastUpdated: "2026-07-01T12:00:00.000Z" };
  }

  if (addDefaultPatientReference && resource.resourceType !== "Patient") {
    const patientField = (
      resource.resourceType === "AllergyIntolerance"
      || resource.resourceType === "Device"
      || resource.resourceType === "FamilyMemberHistory"
      || resource.resourceType === "Immunization"
    ) ? "patient" : "subject";
    if (resource[patientField] === undefined) {
      resource[patientField] = { reference: `Patient/${patientId}` };
    }
  }

  return resource;
}

function isFixtureRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeText(root, relativePath, serializeJson(value));
}

async function writeText(root: string, relativePath: string, text: string): Promise<void> {
  const targetPath = path.join(root, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, text, "utf8");
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
