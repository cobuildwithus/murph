import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  encounterBundlePayloadSchema,
  importEncounterBundleRecord,
  scaffoldEncounterBundlePayload,
} from "../src/usecases/encounter.js";

const mocks = vi.hoisted(() => ({
  saveEncounterBundle: vi.fn(),
}));

vi.mock("../src/runtime-import.js", () => ({
  loadRuntimeModule: vi.fn(async () => ({
    saveEncounterBundle: mocks.saveEncounterBundle,
  })),
}));

const ENCOUNTER_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0";
const MEASUREMENT_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F1";
const PROCEDURE_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F2";
const TEST_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F3";
const EXTRA_MEASUREMENT_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F4";
const EXTRA_PROCEDURE_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F5";
const EXTRA_TEST_EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1F6";
const PROVIDER_ID = "prov_01JQ9R7WF97M1WAB2B4QF2Q1F7";

async function writeEncounterPayload(payload: unknown): Promise<{ inputFile: string; vaultRoot: string }> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-encounter-usecase-"));
  const inputFile = path.join(vaultRoot, "encounter.json");
  await writeFile(inputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return { inputFile, vaultRoot };
}

function createEncounterPayload(overrides: Record<string, unknown> = {}) {
  return {
    encounter: {
      eventId: ENCOUNTER_EVENT_ID,
      occurredAt: "2026-06-17T13:30:00.000Z",
      timeZone: "America/New_York",
      source: "import",
      encounterType: "office_visit",
      clinician: "Dr. Example",
      facility: "Example Clinic",
      location: "Boston, MA",
      providerId: PROVIDER_ID,
      reasonForVisit: "Follow-up",
      assessmentText: "Blood pressure improved.",
      planText: "Continue current plan.",
      instructionsText: "Check blood pressure at home.",
      followUpText: "Return in six months.",
      diagnoses: [
        {
          text: "Essential hypertension",
          code: "I10",
          codeSystem: "ICD-10-CM",
          status: "active",
          note: "Visit-scoped diagnosis.",
        },
      ],
      rawRefs: ["raw/imports/visit.pdf", "raw/imports/visit.pdf"],
      tags: ["primary care", "imported"],
      links: [{ type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" }],
      ...overrides,
    },
    measurements: [
      {
        eventId: MEASUREMENT_EVENT_ID,
        occurredAt: "2026-06-17T13:35:00.000Z",
        title: "Visit vitals",
        note: "Seated.",
        source: "import",
        measurements: [
          {
            metric: "blood pressure systolic",
            value: 128,
            unit: "mmHg",
            qualifiers: { position: "seated" },
          },
          {
            metric: "heart_rate",
            value: 72,
            unit: "bpm",
          },
        ],
        media: [{ kind: "image", relativePath: "raw/imports/vitals.png", mediaType: "image/png" }],
        externalRef: {
          system: "fhir",
          resourceType: "observation",
          resourceId: "obs-vitals-1",
        },
        rawRefs: [],
      },
    ],
    procedures: [
      {
        eventId: PROCEDURE_EVENT_ID,
        procedure: "Colonoscopy referral",
        status: "ordered",
        tags: ["referral"],
      },
    ],
    tests: [
      {
        eventId: TEST_EVENT_ID,
        testName: "Basic metabolic panel",
        resultStatus: "pending",
        summary: "Ordered after visit.",
        testCategory: "chemistry",
        specimenType: "blood",
        labName: "Example Lab",
        labPanelId: "bmp",
        collectedAt: "2026-06-17T14:00:00.000Z",
        reportedAt: "2026-06-18T09:00:00.000Z",
        fastingStatus: "unknown",
        results: [
          {
            analyte: "Glucose",
            value: 88,
            unit: "mg/dL",
            referenceRange: { text: "70-99" },
            flag: "normal",
          },
        ],
      },
    ],
  };
}

describe("encounter usecase", () => {
  beforeEach(() => {
    mocks.saveEncounterBundle.mockReset();
    mocks.saveEncounterBundle.mockResolvedValue({
      encounter: { id: ENCOUNTER_EVENT_ID },
      events: [
        { id: ENCOUNTER_EVENT_ID },
        { id: MEASUREMENT_EVENT_ID },
        { id: PROCEDURE_EVENT_ID },
        { id: TEST_EVENT_ID },
      ],
      ledgerFiles: ["ledger/events/2026/2026-06.jsonl"],
      auditPath: "system/audit/2026-06.jsonl",
    });
  });

  it("normalizes a structured encounter bundle and returns compact ids", async () => {
    const { inputFile, vaultRoot } = await writeEncounterPayload(createEncounterPayload());

    const result = await importEncounterBundleRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    });

    expect(result).toEqual({
      vault: vaultRoot,
      encounterId: ENCOUNTER_EVENT_ID,
      lookupId: ENCOUNTER_EVENT_ID,
      eventIds: [
        ENCOUNTER_EVENT_ID,
        MEASUREMENT_EVENT_ID,
        PROCEDURE_EVENT_ID,
        TEST_EVENT_ID,
      ],
      childEventIds: [
        MEASUREMENT_EVENT_ID,
        PROCEDURE_EVENT_ID,
        TEST_EVENT_ID,
      ],
      ledgerFiles: ["ledger/events/2026/2026-06.jsonl"],
      auditPath: "system/audit/2026-06.jsonl",
    });
    expect(mocks.saveEncounterBundle).toHaveBeenCalledWith({
      vaultRoot,
      encounter: {
        eventId: ENCOUNTER_EVENT_ID,
        occurredAt: "2026-06-17T13:30:00.000Z",
        timeZone: "America/New_York",
        source: "import",
        title: "Encounter: office_visit",
        links: [{ type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" }],
        rawRefs: ["raw/imports/visit.pdf"],
        tags: ["primary care", "imported"],
        encounterType: "office_visit",
        location: "Boston, MA",
        providerId: PROVIDER_ID,
        clinician: "Dr. Example",
        facility: "Example Clinic",
        reasonForVisit: "Follow-up",
        assessmentText: "Blood pressure improved.",
        planText: "Continue current plan.",
        instructionsText: "Check blood pressure at home.",
        followUpText: "Return in six months.",
        diagnoses: [
          {
            text: "Essential hypertension",
            code: "I10",
            codeSystem: "ICD-10-CM",
            status: "active",
            note: "Visit-scoped diagnosis.",
          },
        ],
      },
      measurements: [
        {
          eventId: MEASUREMENT_EVENT_ID,
          occurredAt: "2026-06-17T13:35:00.000Z",
          source: "import",
          title: "Visit vitals",
          note: "Seated.",
          rawRefs: [],
          measurements: [
            {
              metric: "blood-pressure-systolic",
              value: 128,
              unit: "mmHg",
              qualifiers: { position: "seated" },
            },
            {
              metric: "heart-rate",
              value: 72,
              unit: "bpm",
            },
          ],
          media: [{ kind: "image", relativePath: "raw/imports/vitals.png", mediaType: "image/png" }],
          externalRef: {
            system: "fhir",
            resourceType: "observation",
            resourceId: "obs-vitals-1",
          },
        },
      ],
      procedures: [
        {
          eventId: PROCEDURE_EVENT_ID,
          tags: ["referral"],
          procedure: "Colonoscopy referral",
          status: "ordered",
        },
      ],
      tests: [
        {
          eventId: TEST_EVENT_ID,
          testName: "Basic metabolic panel",
          resultStatus: "pending",
          summary: "Ordered after visit.",
          testCategory: "chemistry",
          specimenType: "blood",
          labName: "Example Lab",
          labPanelId: "bmp",
          collectedAt: "2026-06-17T14:00:00.000Z",
          reportedAt: "2026-06-18T09:00:00.000Z",
          fastingStatus: "unknown",
          results: [
            {
              analyte: "Glucose",
              value: 88,
              unit: "mg/dL",
              referenceRange: { text: "70-99" },
              flag: "normal",
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["unknown top-level key", { ...createEncounterPayload(), test: [] }],
    [
      "unknown nested test key",
      {
        ...createEncounterPayload(),
        tests: [
          {
            ...createEncounterPayload().tests[0],
            reportedDate: "2026-06-18",
          },
        ],
      },
    ],
    ["legacy date-only timestamp", createEncounterPayload({ occurredAt: "2026-06-17" })],
  ])("payload schema rejects legacy or non-canonical encounter shape: %s", (_name, payload) => {
    const result = encounterBundlePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it.each([
    {
      name: "missing encounter",
      payload: {},
      message: "encounter must be an object.",
    },
    {
      name: "missing encounter id",
      payload: createEncounterPayload({ eventId: "" }),
      message: "encounter.eventId is required.",
    },
    {
      name: "invalid tags",
      payload: createEncounterPayload({ tags: ["ok", 42] }),
      message: "encounter.tags[1] must be a string.",
    },
    {
      name: "invalid raw ref",
      payload: createEncounterPayload({ rawRefs: ["/absolute/path"] }),
      code: "invalid_path",
      message: 'Vault-relative path "/absolute/path" is invalid.',
    },
    {
      name: "traversal raw ref",
      payload: createEncounterPayload({ rawRefs: ["raw/../../outside"] }),
      code: "invalid_path",
      message: 'Vault-relative path "raw/../../outside" escapes the selected vault root.',
    },
    {
      name: "invalid source",
      payload: createEncounterPayload({ source: "fax" }),
      message: "encounter.source must be one of manual, import, device, or derived.",
    },
    {
      name: "invalid links",
      payload: createEncounterPayload({ links: [{ type: "unsupported", targetId: "evt_1" }] }),
      message: "encounter.links[0] is not a supported event relation link.",
    },
    {
      name: "invalid diagnosis",
      payload: createEncounterPayload({ diagnoses: [{ code: 10 }] }),
      message: "encounter.diagnoses[0] is not a valid encounter diagnosis.",
    },
    {
      name: "invalid measurements list",
      payload: {
        ...createEncounterPayload(),
        measurements: [{ eventId: EXTRA_MEASUREMENT_EVENT_ID, measurements: [] }],
      },
      message: "measurements[0].measurements must include at least one measurement entry.",
    },
    {
      name: "invalid procedure status",
      payload: {
        ...createEncounterPayload(),
        procedures: [{ eventId: EXTRA_PROCEDURE_EVENT_ID, procedure: "Referral", status: "done" }],
      },
      message: "procedures[0].status must be one of ordered, planned, completed, or cancelled.",
    },
    {
      name: "invalid external ref",
      payload: {
        ...createEncounterPayload(),
        measurements: [
          {
            eventId: EXTRA_MEASUREMENT_EVENT_ID,
            measurements: [{ metric: "weight", value: 1, unit: "kg" }],
            externalRef: {},
          },
        ],
      },
      message: "measurements[0].externalRef must include system, resourceType, and resourceId.",
    },
    {
      name: "invalid media",
      payload: {
        ...createEncounterPayload(),
        measurements: [
          {
            eventId: EXTRA_MEASUREMENT_EVENT_ID,
            measurements: [{ metric: "weight", value: 1, unit: "kg" }],
            media: [{}],
          },
        ],
      },
      message: "measurements[0].media[0].relativePath is required.",
    },
    {
      name: "invalid test status",
      payload: {
        ...createEncounterPayload(),
        tests: [{ eventId: EXTRA_TEST_EVENT_ID, testName: "CBC", resultStatus: "done" }],
      },
      message: "tests[0].resultStatus must be one of pending, normal, abnormal, mixed, or unknown.",
    },
    {
      name: "invalid fasting status",
      payload: {
        ...createEncounterPayload(),
        tests: [{ eventId: EXTRA_TEST_EVENT_ID, testName: "CBC", fastingStatus: "nope" }],
      },
      message: "tests[0].fastingStatus must be a supported fasting status.",
    },
    {
      name: "invalid test results",
      payload: {
        ...createEncounterPayload(),
        tests: [{ eventId: EXTRA_TEST_EVENT_ID, testName: "CBC", results: [{}] }],
      },
      message: "tests[0].results[0] is not a valid blood test result.",
    },
    {
      name: "invalid list field",
      payload: {
        ...createEncounterPayload(),
        procedures: { eventId: EXTRA_PROCEDURE_EVENT_ID },
      },
      message: "procedures must be an array.",
    },
  ])("rejects invalid encounter payloads: $name", async ({ payload, code, message }) => {
    const { inputFile, vaultRoot } = await writeEncounterPayload(payload);

    await expect(importEncounterBundleRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    })).rejects.toMatchObject({
      name: "VaultCliError",
      code: code ?? "invalid_payload",
      message,
    });
    expect(mocks.saveEncounterBundle).not.toHaveBeenCalled();
  });

  it("maps core validation errors to CLI-facing errors", async () => {
    const alreadyExistsError = Object.assign(
      new Error("Encounter event id already exists."),
      { name: "VaultError", code: "VAULT_ALREADY_EXISTS", details: {} },
    );
    mocks.saveEncounterBundle.mockRejectedValueOnce(alreadyExistsError);
    const { inputFile, vaultRoot } = await writeEncounterPayload(createEncounterPayload());

    await expect(importEncounterBundleRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    })).rejects.toMatchObject({
      name: "VaultCliError",
      code: "already_exists",
      message: "Encounter event id already exists.",
    });
  });

  it("scaffolds a normalized encounter bundle payload", () => {
    const payload = scaffoldEncounterBundlePayload();

    expect(encounterBundlePayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.encounter.eventId).toBe(ENCOUNTER_EVENT_ID);
    expect(payload.measurements?.[0]?.eventId).toBe(MEASUREMENT_EVENT_ID);
    expect(payload.procedures?.[0]?.status).toBe("ordered");
    expect(payload.tests?.[0]?.resultStatus).toBe("pending");
  });

  it("keeps legacy permissive strings at the runtime import boundary", async () => {
    const payload = createEncounterPayload({
      eventId: "encounter-1",
      occurredAt: "2026-06-17",
    });
    const schemaResult = encounterBundlePayloadSchema.safeParse(payload);

    expect(schemaResult.success).toBe(false);

    const { inputFile, vaultRoot } = await writeEncounterPayload(payload);
    await importEncounterBundleRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    });

    expect(mocks.saveEncounterBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        encounter: expect.objectContaining({
          eventId: "encounter-1",
          occurredAt: "2026-06-17",
        }),
      }),
    );
  });
});
