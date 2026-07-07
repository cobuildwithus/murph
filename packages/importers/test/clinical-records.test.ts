import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ClinicalImportCandidate } from "@murphai/clinical-records";
import { buildClinicalImportPlan } from "../src/clinical-records/index.ts";
import { afterEach, describe, expect, it } from "vitest";

const SHA256 = "a".repeat(64);
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
          count: 3,
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
                      coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }],
                    },
                    valueQuantity: { value: 82, unit: "mmHg" },
                  },
                ],
              },
            },
            {
              resource: {
                resourceType: "Observation",
                id: "glucose-1",
                meta: { versionId: "1" },
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
                valueQuantity: { value: 91, unit: "mg/dL" },
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
      system: "epic-fhir",
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
});

async function writeClinicalFixture(input: {
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
    fhirBaseUrlHash: "base-url-sha256",
    patientIdHash: "patient-id-sha256",
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
