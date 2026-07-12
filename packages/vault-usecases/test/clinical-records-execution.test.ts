import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type ClinicalFhirRetrievalScope,
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPatientId,
} from "@murphai/clinical-records";
import {
  findEventByExternalRef,
  initializeVault,
} from "@murphai/core";
import {
  importClinicalFhirSnapshot,
  type ClinicalFhirSnapshotImportInput,
} from "@murphai/vault-usecases/clinical-records";
import { afterEach, describe, expect, it } from "vitest";

const FHIR_BASE_URL = "https://ehr.example.test/fhir";
const FHIR_BASE_URL_HASH = hashClinicalFhirBaseUrl(FHIR_BASE_URL);
const PATIENT_ID = "patient-1";
const PATIENT_ID_HASH = hashClinicalFhirPatientId(PATIENT_ID);
const QUERY_FINGERPRINT = "a".repeat(64);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("importClinicalFhirSnapshot", () => {
  it("atomically persists raw evidence and idempotently applies executable decisions", async () => {
    const input = await createSnapshotInput({
      pages: [{
        content: fhirBundle([heartRateObservation("heart-rate-1")]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });

    const first = await importClinicalFhirSnapshot(input);
    const replay = await importClinicalFhirSnapshot(input);

    expect(first).toEqual(expect.objectContaining({
      canonical: expect.objectContaining({ applied: true, createdCount: 1 }),
      executableDecisionCount: 1,
      rawFileCount: 2,
      reviewDecisionCount: 0,
    }));
    expect(replay.canonical).toEqual(expect.objectContaining({
      applied: false,
      createdCount: 0,
      skippedExistingCount: 1,
    }));
    expect(await readFile(path.join(input.vaultRoot, first.manifestPath), "utf8"))
      .toContain('"schemaVersion": "murph.clinical-raw-manifest.v2"');

    const event = await findEventByExternalRef({
      vaultRoot: input.vaultRoot,
      system: `epic-fhir-${FHIR_BASE_URL_HASH}-${PATIENT_ID_HASH}`,
      resourceType: "observation",
      resourceId: "heart-rate-1",
    });
    expect(event?.kind).toBe("measurement");
  });

  it("rejects conflicting raw replay at the stable retrieval identity", async () => {
    const input = await createSnapshotInput({
      pages: [{
        content: fhirBundle([heartRateObservation("heart-rate-conflict", 70)]),
        resourceType: "Observation",
      }],
      resourceTypes: ["Observation"],
    });
    await importClinicalFhirSnapshot(input);

    await expect(importClinicalFhirSnapshot({
      ...input,
      pages: [{
        content: fhirBundle([heartRateObservation("heart-rate-conflict", 99)]),
        resourceType: "Observation",
      }],
    })).rejects.toThrow();
  });

  it("preserves review-only evidence without attempting an empty canonical batch", async () => {
    const input = await createSnapshotInput({
      pages: [{
        content: fhirBundle([{
          resourceType: "Condition",
          id: "condition-1",
          meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
          subject: { reference: `Patient/${PATIENT_ID}` },
          code: { text: "Example condition" },
        }]),
        resourceType: "Condition",
      }],
      resourceTypes: ["Condition"],
    });

    const result = await importClinicalFhirSnapshot(input);

    expect(result.canonical).toEqual({
      applied: false,
      createdCount: 0,
      retractedCount: 0,
      skippedExistingCount: 0,
      supersededCount: 0,
    });
    expect(result.executableDecisionCount).toBe(0);
    expect(result.reviewDecisionCount).toBe(1);
  });

  it("does not treat a completed bounded window as whole-family absence evidence", async () => {
    const input = await createSnapshotInput({
      pages: [
        {
          content: fhirBundle([noKnownAllergyResource()]),
          resourceType: "AllergyIntolerance",
        },
        {
          content: fhirBundle([]),
          resourceType: "Condition",
        },
      ],
      resourceTypes: ["AllergyIntolerance", "Condition"],
      retrievalCoverage: "bounded-window",
    });

    const result = await importClinicalFhirSnapshot(input);

    expect(result.executableDecisionCount).toBe(0);
    expect(result.reviewDecisionCount).toBe(1);
  });
});

async function createSnapshotInput(input: {
  pages: ClinicalFhirSnapshotImportInput["pages"];
  resourceTypes: ClinicalFhirRetrievalScope["resourceType"][];
  retrievalCoverage?: "bounded-window" | "whole-family";
}): Promise<ClinicalFhirSnapshotImportInput> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-execution-"));
  tempRoots.push(vaultRoot);
  await initializeVault({
    createdAt: "2026-07-10T12:00:00.000Z",
    timezone: "America/New_York",
    vaultRoot,
  });
  const retrievalCoverage = input.retrievalCoverage ?? "whole-family";
  return {
    completedResourceTypes: input.resourceTypes,
    connectionId: "clinical-connection-1",
    fetchedAt: "2026-07-10T12:00:00.000Z",
    fhirBaseUrlHash: FHIR_BASE_URL_HASH,
    grantedScopes: input.resourceTypes.map((resourceType) => `patient/${resourceType}.read`),
    pages: input.pages,
    patientIdHash: PATIENT_ID_HASH,
    requestedScopes: input.resourceTypes.map((resourceType) => `patient/${resourceType}.read`),
    retrievalJobId: "retrieval-job-1",
    retrievalScopes: input.resourceTypes.map((resourceType) => retrievalCoverage === "whole-family"
      ? {
          coverage: "whole-family" as const,
          queryFingerprint: QUERY_FINGERPRINT,
          resourceType,
        }
      : {
          coverage: "bounded-window" as const,
          from: "2026-01-01T00:00:00.000Z",
          queryFingerprint: QUERY_FINGERPRINT,
          resourceType,
          to: "2026-07-10T12:00:00.000Z",
        }),
    sourceSystem: "epic-fhir",
    vaultRoot,
  };
}

function fhirBundle(resources: unknown[]): string {
  return `${JSON.stringify({
    resourceType: "Bundle",
    type: "searchset",
    entry: resources.map((resource) => ({ resource })),
  })}\n`;
}

function heartRateObservation(resourceId: string, value = 70) {
  return {
    resourceType: "Observation",
    id: resourceId,
    meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    status: "final",
    subject: { reference: `Patient/${PATIENT_ID}` },
    effectiveDateTime: "2026-07-10T11:59:00.000Z",
    code: {
      coding: [{
        system: "http://loinc.org",
        code: "8867-4",
        display: "Heart rate",
      }],
    },
    valueQuantity: { value, unit: "bpm" },
  };
}

function noKnownAllergyResource() {
  return {
    resourceType: "AllergyIntolerance",
    id: "no-known-allergy",
    meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    recordedDate: "2026-07-10T11:59:00.000Z",
    patient: { reference: `Patient/${PATIENT_ID}` },
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
