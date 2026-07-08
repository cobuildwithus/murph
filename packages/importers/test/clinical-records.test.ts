import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ClinicalImportCandidate } from "@murphai/clinical-records";
import { buildClinicalImportPlan } from "../src/clinical-records/index.ts";
import { afterEach, describe, expect, it } from "vitest";

const SHA256 = "a".repeat(64);
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
          count: 4,
          sha256: SHA256,
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
                interpretation: [{ coding: [{ code: "N", display: "Normal" }] }],
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
    ]);
    expect(plan.candidates.some((candidate) => candidate.kind === "assertion")).toBe(false);
    expect(plan.unsupported).toEqual([
      expect.objectContaining({
        resourceType: "Condition",
        resourceId: "condition-positive-1",
        reason: "condition registry import not implemented",
      }),
    ]);

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

  it("plans supported assertions and notes without importing positive allergies", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 1,
          sha256: SHA256,
        },
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 2,
          sha256: SHA256,
        },
      ],
      pages: {
        "DocumentReference/page-1.json": {
          resourceType: "DocumentReference",
          id: "document-1",
          status: "current",
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
          {
            resourceType: "AllergyIntolerance",
            id: "allergy-positive-1",
            recordedDate: "2026-07-02T09:05:00.000Z",
            code: {
              text: "Penicillin",
              coding: [{ system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" }],
            },
          },
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.candidates.map((candidate) => candidate.kind)).toEqual(["clinical-note", "assertion"]);
    expect(plan.unsupported).toEqual([
      expect.objectContaining({
        resourceType: "AllergyIntolerance",
        resourceId: "allergy-positive-1",
        reason: "allergy registry import not implemented",
      }),
    ]);

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

  it("leaves unsafe clinical resources unsupported instead of importing live candidates", async () => {
    const vaultRoot = await writeClinicalFixture({
      resourceFiles: [
        {
          resourceType: "Observation",
          relativePath: "Observation/page-1.json",
          count: 3,
          sha256: SHA256,
        },
        {
          resourceType: "DiagnosticReport",
          relativePath: "DiagnosticReport/page-1.json",
          count: 1,
          sha256: SHA256,
        },
        {
          resourceType: "DocumentReference",
          relativePath: "DocumentReference/page-1.json",
          count: 1,
          sha256: SHA256,
        },
        {
          resourceType: "AllergyIntolerance",
          relativePath: "AllergyIntolerance/page-1.json",
          count: 3,
          sha256: SHA256,
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
        ],
        "DiagnosticReport/page-1.json": {
          resourceType: "DiagnosticReport",
          id: "report-cancelled",
          status: "cancelled",
          issued: "2026-07-01T12:00:00.000Z",
          code: { text: "Metabolic panel" },
          conclusion: "Cancelled result.",
        },
        "DocumentReference/page-1.json": {
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
        ],
      },
    });

    const plan = await buildClinicalImportPlan({ manifestPath: MANIFEST_PATH, vaultRoot });

    expect(plan.candidates).toEqual([]);
    expect(plan.unsupported).toHaveLength(8);
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
          resourceId: "report-cancelled",
          reason: "diagnostic report status is not importable",
        }),
        expect.objectContaining({
          resourceId: "document-entered-in-error",
          reason: "document reference status is not importable",
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
      ]),
    );
  });

  it("namespaces FHIR external refs by source base and patient", async () => {
    const resourceFiles = [
      {
        resourceType: "Observation",
        relativePath: "Observation/page-1.json",
        count: 1,
        sha256: SHA256,
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
    sha256: string;
  }>;
}): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-records-"));
  tempRoots.push(vaultRoot);

  await writeJson(vaultRoot, MANIFEST_PATH, {
    schemaVersion: "murph.clinical-raw-manifest.v1",
    kind: "clinical_fhir_retrieval",
    connectionId: "clinical-connection-1",
    retrievalJobId: "retrieval-job-1",
    sourceSystem: "epic-fhir",
    fhirBaseUrlHash: input.manifest?.fhirBaseUrlHash ?? FHIR_BASE_URL_HASH,
    patientIdHash: input.manifest?.patientIdHash ?? PATIENT_ID_HASH,
    fetchedAt: "2026-07-01T12:00:00.000Z",
    resourceFiles: input.resourceFiles,
    requestedScopes: ["patient/*.read"],
    grantedScopes: ["patient/*.read"],
  });

  for (const [relativePath, value] of Object.entries(input.pages)) {
    await writeJson(
      vaultRoot,
      `raw/clinical/fhir/clinical-connection-1/retrieval-job-1/${relativePath}`,
      value,
    );
  }

  return vaultRoot;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const targetPath = path.join(root, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
