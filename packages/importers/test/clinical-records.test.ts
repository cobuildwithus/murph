import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  type ClinicalImportCandidate,
} from "@murphai/clinical-records";
import { buildClinicalImportPlan } from "../src/clinical-records/index.ts";
import { afterEach, describe, expect, it } from "vitest";

const BAD_SHA256 = "a".repeat(64);
const FHIR_BASE_URL_HASH = "b".repeat(64);
const PATIENT_ID_HASH = "c".repeat(64);
const OTHER_PATIENT_ID_HASH = "d".repeat(64);
const MANIFEST_PATH = "raw/clinical/fhir/clinical-connection-1/retrieval-job-1/manifest.json";

const tempRoots: string[] = [];
type ClinicalImportCandidateOfKind<K extends ClinicalImportCandidate["kind"]> =
  Extract<ClinicalImportCandidate, { kind: K }>;

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("buildClinicalImportPlan", () => {
  it("plans safe vitals and lab imports while leaving positive conditions raw", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 5,
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
            {
              resource: {
                resourceType: "Condition",
                id: "condition-positive-1",
                code: {
                  text: "Hypertension",
                  coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
                },
              },
            },
          ],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.candidates.map((candidate) => candidate.kind)).toEqual([
      "vitals",
      "vitals",
      "diagnostic-test",
      "vitals",
    ]);
    expect(plan.candidates.some((candidate) => candidate.kind === "assertion")).toBe(false);
    expect(plan.unsupported).toHaveLength(2);
    expect(plan.unsupported).toEqual(
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

    const systolic = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"vitals"> =>
        candidate.kind === "vitals" && candidate.resource.facet === "bp-systolic",
    );
    expect(systolic?.payload.measurements).toEqual([
      { metric: "systolic-blood-pressure", unit: "mmHg", value: 128 },
    ]);
    expect(systolic?.payload.externalRef).toEqual({
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "bp-panel-1",
      version: "7",
      facet: "bp-systolic",
    });

    const bodyWeight = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"vitals"> =>
        candidate.kind === "vitals" && candidate.resource.facet === "body-weight",
    );
    expect(bodyWeight?.payload.measurements).toEqual([
      { metric: "body-weight", unit: "lb", value: 180 },
    ]);

    const glucose = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"diagnostic-test"> =>
        candidate.kind === "diagnostic-test",
    );
    expect(glucose?.payload.testName).toBe("Glucose");
    expect(glucose?.payload.resultStatus).toBe("normal");
    expect(glucose?.payload.results).toEqual([
      {
        analyte: "Glucose",
        biomarkerSlug: "glucose",
        comparator: "<",
        slug: "glucose",
        unit: "mg/dL",
        value: 91,
      },
    ]);
  });

  it("requires trusted lab category and result status coding systems", async () => {
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
          code: { text: "Metabolic panel" },
          conclusion: "Within range.",
          conclusionCode: [{ coding: [{ system: "urn:vendor-status", code: "N", display: "Normal" }] }],
        },
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.unsupported).toHaveLength(2);
    expect(plan.unsupported).toEqual(
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
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates.some((candidate) => candidate.resource.resourceId === "lab-local-category")).toBe(false);
    expect(plan.candidates.some((candidate) => candidate.resource.resourceId === "lab-canonical-short-code"))
      .toBe(false);

    const observation = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"diagnostic-test"> =>
        candidate.kind === "diagnostic-test" && candidate.resource.resourceId === "lab-local-interpretation",
    );
    expect(observation?.payload.resultStatus).toBe("unknown");

    const report = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"diagnostic-test"> =>
        candidate.kind === "diagnostic-test" && candidate.resource.resourceId === "report-local-conclusion-code",
    );
    expect(report?.payload.resultStatus).toBe("unknown");
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
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.candidates.map((candidate) => candidate.kind)).toEqual(["clinical-note", "assertion"]);
    expect(plan.unsupported).toEqual([]);

    const note = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"clinical-note"> =>
        candidate.kind === "clinical-note",
    );
    expect(note?.payload.title).toBe("Discharge instructions");
    expect(note?.payload.note).toBe("Follow up in two weeks.");

    const assertion = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"assertion"> =>
        candidate.kind === "assertion",
    );
    expect(assertion?.payload).toEqual(
      expect.objectContaining({
        occurredAt: "2026-07-02T09:00:00.000Z",
        assertion: "no_known_allergies",
        domain: "allergy",
        polarity: "absent",
        assertedOn: "2026-07-02",
      }),
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

    expect(plan.unsupported).toEqual([]);
    expect(plan.candidates).toHaveLength(1);
    const panel = plan.candidates.find(
      (candidate): candidate is ClinicalImportCandidateOfKind<"diagnostic-test"> =>
        candidate.kind === "diagnostic-test",
    );
    expect(panel?.payload.results).toEqual([
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

  it("fails closed instead of emitting lossy clinical candidates", async () => {
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

    expect(plan.candidates).toEqual([]);
    expect(plan.unsupported).toEqual(
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
          reason: "diagnostic report summary exceeds candidate bounds",
        }),
        expect.objectContaining({
          resourceId: "document-oversize-note",
          reason: "document reference text exceeds candidate bounds",
        }),
      ]),
    );
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

    expect(plan.unsupported).toEqual([]);
    expect(plan.candidates).toHaveLength(1);
    const candidate = plan.candidates.find(
      (item): item is ClinicalImportCandidateOfKind<"diagnostic-test"> =>
        item.kind === "diagnostic-test",
    );
    expect(candidate?.payload.testName).toBe("血糖");
    expect(candidate?.payload.results).toEqual([
      {
        analyte: "血糖",
        unit: "mg/dL",
        value: 91,
      },
    ]);
  });

  it("keeps candidate-bound FHIR labels resource-local", async () => {
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

    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates.map((candidate) => candidate.resource.resourceId).sort()).toEqual([
      "max-report-label",
      "valid-lab-neighbor",
    ]);
    expect(plan.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "oversize-lab-label",
          reason: "clinical candidate exceeds supported import bounds",
        }),
        expect.objectContaining({
          resourceId: "oversize-report-label",
          reason: "clinical candidate exceeds supported import bounds",
        }),
        expect.objectContaining({
          resourceId: "oversize-document-title",
          reason: "clinical candidate exceeds supported import bounds",
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

    expect(plan.candidates).toEqual([]);
    expect(plan.unsupported).toEqual(
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

  it("leaves unsafe clinical resources unsupported instead of importing live candidates", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
          {
            resourceType: "Observation",
            relativePath: "Observation/page-1.json",
            count: 9,
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

    expect(plan.candidates).toEqual([]);
    expect(plan.unsupported).toHaveLength(21);
    expect(plan.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "bp-missing-time",
          reason: "clinical timestamp is missing",
        }),
        expect.objectContaining({
          resourceId: "bp-entered-in-error",
          reason: "observation status is not importable",
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
          resourceId: "bp-duplicate-component-facet",
          reason: "duplicate vital facet in FHIR observation",
        }),
        expect.objectContaining({
          resourceId: "lab-date-only",
          reason: "clinical timestamp is missing",
        }),
        expect.objectContaining({
          resourceId: "report-cancelled",
          reason: "diagnostic report status is not importable",
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
          resourceId: "document-entered-in-error",
          reason: "document reference status is not importable",
        }),
        expect.objectContaining({
          resourceId: "document-docstatus-entered-in-error",
          reason: "document reference docStatus is not importable",
        }),
        expect.objectContaining({
          resourceId: "document-metadata-only",
          reason: "document reference text is not available in raw FHIR page",
        }),
        expect.objectContaining({
          resourceId: "allergy-refuted",
          reason: "allergy status is not importable",
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
      ]),
    );
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

  it("rejects oversized raw FHIR manifests before parsing them", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
    tempRoots.push(vaultRoot);

    await writeText(
      vaultRoot,
      MANIFEST_PATH,
      `${JSON.stringify({
        schemaVersion: "murph.clinical-raw-manifest.v1",
        kind: "clinical_fhir_retrieval",
        connectionId: "clinical-connection-1",
        retrievalJobId: "retrieval-job-1",
        sourceSystem: "epic-fhir",
        fhirBaseUrlHash: FHIR_BASE_URL_HASH,
        patientIdHash: PATIENT_ID_HASH,
        fetchedAt: "2026-07-01T12:00:00.000Z",
        resourceFiles: [],
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
      schemaVersion: "murph.clinical-raw-manifest.v1",
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
          count: 2,
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
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.candidates).toEqual([]);
    expect(plan.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "allergy-negative-conflict",
          reason: "no-known allergy conflicts with allergy evidence",
        }),
        expect.objectContaining({
          resourceId: "allergy-positive-conflict",
          reason: "allergy registry import not implemented",
        }),
      ]),
    );
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
      manifest: { patientIdHash: OTHER_PATIENT_ID_HASH },
      pages,
      resourceFiles,
    });

    const firstPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: firstVaultRoot });
    const secondPlan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot: secondVaultRoot });
    const firstRef = firstPlan.candidates[0]?.payload.externalRef;
    const secondRef = secondPlan.candidates[0]?.payload.externalRef;

    expect(firstRef).toEqual(
      expect.objectContaining({
        system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
        resourceType: "observation",
        resourceId: "shared-bp",
        facet: "bp-systolic",
      }),
    );
    expect(secondRef).toEqual(
      expect.objectContaining({
        system: `epic-fhir-${FHIR_BASE_URL_HASH}-${OTHER_PATIENT_ID_HASH}`,
        resourceType: "observation",
        resourceId: "shared-bp",
        facet: "bp-systolic",
      }),
    );
    expect(firstRef?.system).not.toBe(secondRef?.system);
  });
});

async function writeClinicalFixture(input: {
  manifest?: {
    fhirBaseUrlHash?: string;
    patientIdHash?: string;
  };
  pages: Record<string, unknown>;
  resourceFiles: Array<{
    count: number;
    relativePath: string;
    resourceType: string;
    sha256?: string;
  }>;
}): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
  tempRoots.push(vaultRoot);

  const pageTexts = new Map(
    Object.entries(input.pages).map(([relativePath, value]) => [relativePath, serializeJson(value)]),
  );
  const resourceFiles = input.resourceFiles.map((resourceFile) => ({
    ...resourceFile,
    sha256: resourceFile.sha256 ?? sha256Hex(pageTexts.get(resourceFile.relativePath) ?? ""),
  }));

  await writeJson(vaultRoot, MANIFEST_PATH, {
    schemaVersion: "murph.clinical-raw-manifest.v1",
    kind: "clinical_fhir_retrieval",
    connectionId: "clinical-connection-1",
    retrievalJobId: "retrieval-job-1",
    sourceSystem: "epic-fhir",
    fhirBaseUrlHash: input.manifest?.fhirBaseUrlHash ?? FHIR_BASE_URL_HASH,
    patientIdHash: input.manifest?.patientIdHash ?? PATIENT_ID_HASH,
    fetchedAt: "2026-07-01T12:00:00.000Z",
    resourceFiles,
    requestedScopes: ["patient/*.read"],
    grantedScopes: ["patient/*.read"],
  });

  for (const [relativePath, text] of pageTexts) {
    await writeText(
      vaultRoot,
      `raw/clinical/fhir/clinical-connection-1/retrieval-job-1/${relativePath}`,
      text,
    );
  }

  return vaultRoot;
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
