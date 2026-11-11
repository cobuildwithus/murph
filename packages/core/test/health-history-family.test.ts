import { observeWriteOperations } from "./helpers/observed-write-operations.ts";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { expect, test } from "vitest";
import { bloodTestImportPayloadSchema, immunizationImportPayloadSchema } from "@murphai/contracts";

import {
  appendJsonlRecord,
  deleteEvent,
  initializeVault,
  readJsonlRecords,
  readCanonicalEventAvailabilityInterruptible,
  stringifyFrontmatterDocument,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  VaultError,
  walkVaultFilesInterruptible,
} from "../src/index.ts";
import {
  appendBloodTest,
  appendHistoryEvent,
  appendImmunization,
  isBloodTestHistoryRecord,
  listHistoryEvents,
  readHistoryEvent,
  saveEncounterBundle,
} from "../src/history/index.ts";
import type {
  EncounterHistoryEventRecord,
  ImmunizationHistoryEventRecord,
  TestHistoryEventRecord,
} from "../src/history/index.ts";
import { listFamilyMembers, readFamilyMember, upsertFamilyMember } from "../src/family/index.ts";
import { listGeneticVariants, readGeneticVariant, upsertGeneticVariant } from "../src/genetics/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

const { listObservedWriteOperationPaths, readObservedWriteOperation } = observeWriteOperations();

test("health history appends to the shared event ledger and supports list/read flows", async () => {
  const vaultRoot = await makeTempDirectory("murph-history");
  await initializeVault({ vaultRoot });

  const encounter = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-01T12:00:00.000Z",
    title: "Endocrinology follow-up",
    encounterType: "specialist_follow_up",
    location: "Endocrinology clinic",
    providerId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    tags: ["Endocrine", "Quarterly"],
  });
  const adverseEffect = await appendHistoryEvent({
    vaultRoot,
    kind: "adverse_effect",
    occurredAt: "2026-03-02T12:00:00.000Z",
    title: "Rash after antibiotic",
    substance: "amoxicillin",
    effect: "rash",
    severity: "moderate",
  });

  assert.equal(encounter.relativePath, "ledger/events/2026/2026-03.jsonl");
  assert.equal(adverseEffect.relativePath, "ledger/events/2026/2026-03.jsonl");

  const shardRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: encounter.relativePath,
  });
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: adverseEffect.auditPath,
  });

  assert.equal(shardRecords.length, 2);
  assert.equal(
    auditRecords.filter((record) => (record as { action?: string }).action === "history_add").length,
    2,
  );

  const listed = await listHistoryEvents({
    vaultRoot,
    order: "asc",
  });
  const filtered = await listHistoryEvents({
    vaultRoot,
    kinds: ["adverse_effect"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: adverseEffect.record.id,
  });

  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.kind, "encounter");
  assert.deepEqual(listed[0]?.tags, ["endocrine", "quarterly"]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, adverseEffect.record.id);
  assert.equal(read.record.kind, "adverse_effect");
  assert.equal(read.record.effect, "rash");

  const operations = await Promise.all(
    (await listObservedWriteOperationPaths(vaultRoot)).map((relativePath) =>
      readObservedWriteOperation(vaultRoot, relativePath),
    ),
  );
  const historyOperations = operations.filter((operation) => operation.operationType === "history_add");

  assert.equal(historyOperations.length, 2);
  assert.ok(historyOperations.every((operation) => operation.status === "committed"));
});

test("history links round-trip through write, storage, read, and list surfaces", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-links");
  await initializeVault({ vaultRoot });

  const appended = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "Linked encounter",
    encounterType: "office_visit",
    links: [{ type: "related_to", targetId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" }],
  });
  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["encounter"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: appended.record.id,
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  const storedRecord = stored.find(
    (record) => (record as { id?: string }).id === appended.record.id,
  ) as {
    links?: unknown;
    relatedIds?: unknown;
  } | undefined;

  assert.deepEqual(appended.record.links, [
    { type: "related_to", targetId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
  ]);
  assert.deepEqual(listed[0]?.links, [
    { type: "related_to", targetId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
  ]);
  assert.deepEqual(read.record.links, [
    { type: "related_to", targetId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
  ]);
  assert.deepEqual(storedRecord?.links, [
    { type: "related_to", targetId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
  ]);
  assert.equal(storedRecord?.relatedIds, undefined);
});

test("encounter bundles save linked visit facts without promoting durable problem records", async () => {
  const vaultRoot = await makeTempDirectory("murph-encounter-bundle");
  await initializeVault({ vaultRoot });

  const result = await saveEncounterBundle({
    vaultRoot,
    encounter: {
      eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1E0",
      occurredAt: "2026-03-05T16:00:00.000Z",
      recordedAt: "2026-03-05T16:15:00.000Z",
      source: "import",
      title: "Primary care visit",
      encounterType: "office_visit",
      clinician: "Example Clinician",
      facility: "Example Clinic",
      reasonForVisit: "Annual preventive visit",
      assessmentText: "Visit-scoped assessment text.",
      planText: "Visit-scoped plan text.",
      diagnoses: [
        {
          text: "Elevated blood pressure reading",
          status: "active",
          certainty: "documented",
        },
      ],
      rawRefs: ["raw/documents/2026/03/visit-summary.pdf"],
    },
    measurements: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1E1",
        title: "Visit vitals",
        measurements: [
          {
            metric: "systolic-blood-pressure",
            value: 118,
            unit: "mmHg",
          },
          {
            metric: "diastolic-blood-pressure",
            value: 74,
            unit: "mmHg",
          },
        ],
      },
    ],
    procedures: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1E2",
        procedure: "Screening colonoscopy",
        status: "ordered",
      },
    ],
    tests: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1E3",
        testName: "Comprehensive metabolic panel",
        resultStatus: "pending",
      },
    ],
  });

  assert.equal(result.encounter.id, "evt_01JQ9R7WF97M1WAB2B4QF2Q1E0");
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.ledgerFiles, ["ledger/events/2026/2026-03.jsonl"]);
  assert.equal(result.encounter.clinician, "Example Clinician");
  assert.equal(result.encounter.facility, "Example Clinic");
  assert.equal(result.encounter.assessmentText, "Visit-scoped assessment text.");
  assert.equal(result.encounter.planText, "Visit-scoped plan text.");
  assert.deepEqual(result.encounter.diagnoses, [
    {
      text: "Elevated blood pressure reading",
      status: "active",
      certainty: "documented",
    },
  ]);

  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: result.ledgerFiles[0]!,
  });
  const storedById = new Map(stored.map((record) => [
    (record as { id: string }).id,
    record as {
      kind?: string;
      lifecycle?: { revision?: number };
      links?: unknown;
      rawRefs?: unknown;
      procedure?: string;
      status?: string;
      measurements?: unknown;
      testName?: string;
      title?: string;
    },
  ]));
  const measurement = storedById.get("evt_01JQ9R7WF97M1WAB2B4QF2Q1E1");
  const procedure = storedById.get("evt_01JQ9R7WF97M1WAB2B4QF2Q1E2");
  const testRecord = storedById.get("evt_01JQ9R7WF97M1WAB2B4QF2Q1E3");

  assert.equal(measurement?.kind, "measurement");
  assert.deepEqual(measurement?.links, [
    { type: "related_to", targetId: result.encounter.id },
  ]);
  assert.deepEqual(measurement?.rawRefs, ["raw/documents/2026/03/visit-summary.pdf"]);
  assert.deepEqual(measurement?.measurements, [
    {
      metric: "systolic-blood-pressure",
      value: 118,
      unit: "mmHg",
    },
    {
      metric: "diastolic-blood-pressure",
      value: 74,
      unit: "mmHg",
    },
  ]);
  assert.equal(measurement?.lifecycle?.revision, 1);
  assert.equal(procedure?.kind, "procedure");
  assert.equal(procedure?.status, "ordered");
  assert.deepEqual(procedure?.links, [
    { type: "related_to", targetId: result.encounter.id },
  ]);
  assert.deepEqual(procedure?.rawRefs, ["raw/documents/2026/03/visit-summary.pdf"]);
  assert.equal(testRecord?.kind, "test");
  assert.deepEqual(testRecord?.links, [
    { type: "related_to", targetId: result.encounter.id },
  ]);

  const listedHistory = await listHistoryEvents({
    vaultRoot,
    order: "asc",
  });
  assert.deepEqual(
    listedHistory.map((record) => record.kind),
    ["encounter", "procedure", "test"],
  );

  const operations = await Promise.all(
    (await listObservedWriteOperationPaths(vaultRoot)).map((relativePath) =>
      readObservedWriteOperation(vaultRoot, relativePath),
    ),
  );
  const bundleOperations = operations.filter(
    (operation) => operation.operationType === "encounter_bundle_save",
  );

  assert.equal(bundleOperations.length, 1);
  assert.equal(bundleOperations[0]?.status, "committed");
});

test("encounter bundles keep generated child titles within event limits", async () => {
  const vaultRoot = await makeTempDirectory("murph-encounter-bundle-long-child-title");
  await initializeVault({ vaultRoot });
  const procedureName = "P".repeat(160);
  const testName = "T".repeat(160);

  const result = await saveEncounterBundle({
    vaultRoot,
    encounter: {
      eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1C0",
      occurredAt: "2026-03-05T16:00:00.000Z",
      source: "import",
      title: "Primary care visit",
      encounterType: "office_visit",
    },
    procedures: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1C1",
        procedure: procedureName,
        status: "ordered",
      },
    ],
    tests: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1C2",
        testName,
        resultStatus: "pending",
      },
    ],
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: result.ledgerFiles[0]!,
  });
  const storedById = new Map(stored.map((record) => [
    (record as { id: string }).id,
    record as {
      procedure?: string;
      testName?: string;
      title?: string;
    },
  ]));
  const procedure = storedById.get("evt_01JQ9R7WF97M1WAB2B4QF2Q1C1");
  const testRecord = storedById.get("evt_01JQ9R7WF97M1WAB2B4QF2Q1C2");

  assert.equal(procedure?.procedure, procedureName);
  assert.equal(testRecord?.testName, testName);
  assert.equal(procedure?.title?.length, 160);
  assert.equal(testRecord?.title?.length, 160);
  assert.equal(procedure?.title?.startsWith("Procedure: "), true);
  assert.equal(testRecord?.title?.startsWith("Test: "), true);
  assert.equal(procedure?.title?.endsWith("..."), true);
  assert.equal(testRecord?.title?.endsWith("..."), true);
});

test("encounter bundle duplicate explicit ids fail before writing event rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-encounter-bundle-duplicate-id");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      saveEncounterBundle({
        vaultRoot,
        encounter: {
          eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D0",
          occurredAt: "2026-03-05T16:00:00.000Z",
          source: "import",
          title: "Primary care visit",
          encounterType: "office_visit",
        },
        procedures: [
          {
            eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D0",
            procedure: "Screening colonoscopy",
            status: "ordered",
          },
        ],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  await assert.rejects(
    () => fs.access(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT",
  );
});

test("encounter bundles reject missing stable child event ids before writing event rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-encounter-bundle-missing-id");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      saveEncounterBundle({
        vaultRoot,
        encounter: {
          eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1B0",
          occurredAt: "2026-03-05T16:00:00.000Z",
          source: "import",
          title: "Primary care visit",
          encounterType: "office_visit",
        },
        procedures: [
          {
            eventId: "",
            procedure: "Screening colonoscopy",
            status: "ordered",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError
      && error.code === "VAULT_INVALID_INPUT"
      && error.message === "procedures[0].eventId is required.",
  );

  await assert.rejects(
    () => fs.access(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT",
  );
});

test("encounter bundles reject stable event ids that already exist", async () => {
  const vaultRoot = await makeTempDirectory("murph-encounter-bundle-existing-id");
  await initializeVault({ vaultRoot });
  const bundle = {
    vaultRoot,
    encounter: {
      eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A0",
      occurredAt: "2026-03-05T16:00:00.000Z",
      source: "import" as const,
      title: "Primary care visit",
      encounterType: "office_visit" as const,
    },
    procedures: [
      {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A1",
        procedure: "Screening colonoscopy",
        status: "ordered" as const,
      },
    ],
  };

  const first = await saveEncounterBundle(bundle);
  await assert.rejects(
    () => saveEncounterBundle(bundle),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_ALREADY_EXISTS",
  );

  const records = await readJsonlRecords({
    vaultRoot,
    relativePath: first.ledgerFiles[0]!,
  });
  assert.equal(records.length, 2);
});

test("history append rejects deprecated relatedIds inputs", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-related-ids");
  await initializeVault({ vaultRoot });
  const legacyInput = {
    vaultRoot,
    kind: "encounter" as const,
    occurredAt: "2026-03-03T18:00:00.000Z",
    title: "Legacy linked encounter",
    encounterType: "office_visit",
    relatedIds: [
      "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      " prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8 ",
    ],
  };

  await assert.rejects(
    () => appendHistoryEvent(legacyInput),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_INVALID",
  );
});

test("history reads reject legacy stored relatedIds rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-legacy-related-ids");
  await initializeVault({ vaultRoot });

  const legacyRelativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    "2026-03-04T12:00:00.000Z",
    "occurredAt",
  );
  const legacyEventId = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9";

  await appendJsonlRecord({
    vaultRoot,
    relativePath: legacyRelativePath,
    record: {
      schemaVersion: "murph.event.v1",
      id: legacyEventId,
      kind: "encounter",
      occurredAt: "2026-03-04T12:00:00.000Z",
      recordedAt: "2026-03-04T12:05:00.000Z",
      dayKey: "2026-03-04",
      source: "manual",
      title: "Legacy related-id encounter",
      encounterType: "office_visit",
      relatedIds: ["prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      lifecycle: {
        revision: 1,
      },
    },
  });

  await assert.rejects(
    () =>
      readHistoryEvent({
        vaultRoot,
        eventId: legacyEventId,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        kinds: ["encounter"],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
});

test("health history append rejects explicit duplicate event ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-duplicate-event-id");
  await initializeVault({ vaultRoot });

  await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D2",
    kind: "encounter",
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "Original visit",
    encounterType: "office_visit",
  });

  await assert.rejects(
    () =>
      appendHistoryEvent({
        vaultRoot,
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D2",
        kind: "encounter",
        occurredAt: "2026-03-03T12:05:00.000Z",
        title: "Accidental duplicate visit",
        encounterType: "office_visit",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_ALREADY_EXISTS",
  );

  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["encounter"],
  });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.title, "Original visit");
  assert.equal(listed[0]?.lifecycle?.revision, 1);
});

test("health history append only rejects explicit ids that already exist, not unrelated malformed rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-unique-event-id-amid-malformed-row");
  await initializeVault({ vaultRoot });

  const original = await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D3",
    kind: "encounter",
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "Original visit",
    encounterType: "office_visit",
  });

  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D4",
      recordedAt: "2026-03-03T12:05:00.000Z",
      dayKey: "2026-3-3",
      lifecycle: {
        revision: 1,
      },
    },
  });

  const appended = await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D5",
    kind: "encounter",
    occurredAt: "2026-03-03T12:10:00.000Z",
    title: "Later visit",
    encounterType: "office_visit",
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: original.relativePath,
  });

  assert.equal(appended.record.id, "evt_01JQ9R7WF97M1WAB2B4QF2Q1D5");
  assert.equal(
    stored.filter((record) => (record as { id?: string }).id === appended.record.id).length,
    1,
  );
});

test("health history writes store the vault-local dayKey and timezone when UTC crosses midnight", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-local-day");
  await initializeVault({
    vaultRoot,
    timezone: "Australia/Melbourne",
  });

  const appended = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-26T21:00:00.000Z",
    title: "Breakfast follow-up",
    encounterType: "office_visit",
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  const storedRecord = stored.find(
    (record) => (record as { id?: string }).id === appended.record.id,
  ) as { dayKey?: string; timeZone?: string } | undefined;

  assert.equal(appended.record.dayKey, "2026-03-27");
  assert.equal(appended.record.timeZone, "Australia/Melbourne");
  assert.equal(storedRecord?.dayKey, "2026-03-27");
  assert.equal(storedRecord?.timeZone, "Australia/Melbourne");
});

test("history readers fail closed on malformed stored dayKey values", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-invalid-daykey");
  await initializeVault({ vaultRoot });

  const original = await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D1",
    kind: "encounter",
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "Original visit",
    encounterType: "office_visit",
  });

  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      recordedAt: "2026-03-03T12:05:00.000Z",
      dayKey: "2026-3-3",
      lifecycle: {
        revision: 2,
      },
    },
  });

  await assert.rejects(
    () =>
      readHistoryEvent({
        vaultRoot,
        eventId: original.record.id,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        kinds: ["encounter"],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
});

test("history read and list collapse append-only revisions, tombstones, and later revival", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-collapse");
  await initializeVault({ vaultRoot });

  const original = await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    kind: "encounter",
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "Original visit",
    encounterType: "office_visit",
  });

  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      recordedAt: "2026-03-03T12:05:00.000Z",
      title: "Updated visit",
      location: "Follow-up clinic",
      lifecycle: {
        revision: 2,
      },
    },
  });
  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      recordedAt: "2026-03-03T12:10:00.000Z",
      title: "Updated visit",
      location: "Follow-up clinic",
      lifecycle: {
        revision: 3,
        state: "deleted",
      },
    },
  });

  await assert.rejects(
    () =>
      readHistoryEvent({
        vaultRoot,
        eventId: original.record.id,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_HISTORY_EVENT_MISSING",
  );
  assert.deepEqual(
    await listHistoryEvents({
      vaultRoot,
      kinds: ["encounter"],
    }),
    [],
  );

  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      recordedAt: "2026-03-03T12:15:00.000Z",
      title: "Revived visit",
      location: "Revival clinic",
      lifecycle: {
        revision: 4,
      },
    },
  });

  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["encounter"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: original.record.id,
  });
  const listedEncounter = listed[0] as EncounterHistoryEventRecord | undefined;
  const readEncounter = read.record as EncounterHistoryEventRecord;

  assert.equal(listed.length, 1);
  assert.equal(listedEncounter?.title, "Revived visit");
  assert.equal(listedEncounter?.location, "Revival clinic");
  assert.equal(listedEncounter?.lifecycle?.revision, 4);
  assert.equal(readEncounter.title, "Revived visit");
  assert.equal(readEncounter.location, "Revival clinic");
  assert.equal(readEncounter.lifecycle?.revision, 4);
});

test("history read and list fail closed when a stored lifecycle is malformed", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-invalid-lifecycle");
  await initializeVault({ vaultRoot });

  const original = await appendHistoryEvent({
    vaultRoot,
    eventId: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
    kind: "encounter",
    occurredAt: "2026-03-04T12:00:00.000Z",
    title: "Original visit",
    encounterType: "office_visit",
  });

  await appendJsonlRecord({
    vaultRoot,
    relativePath: original.relativePath,
    record: {
      ...original.record,
      recordedAt: "2026-03-04T12:05:00.000Z",
      title: "Corrupt revision",
      lifecycle: {
        revision: 0,
      },
    },
  });

  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        kinds: ["encounter"],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
  await assert.rejects(
    () =>
      readHistoryEvent({
        vaultRoot,
        eventId: original.record.id,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_HISTORY_EVENT",
  );
});

test("history test-event normalization keeps writes canonical and ignores legacy status aliases on read", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-test-aliases");
  await initializeVault({ vaultRoot });

  const writeInput = {
    vaultRoot,
    kind: "test" as const,
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "CBC results imported from legacy payload",
    testName: "CBC",
    status: "abnormal",
  } as Parameters<typeof appendHistoryEvent>[0] & { status?: string };

  const appended = await appendHistoryEvent(writeInput);
  assert.equal(appended.record.kind, "test");
  assert.equal(appended.record.resultStatus, "unknown");

  const storedWriteRecord = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  assert.equal((storedWriteRecord[0] as { resultStatus?: string }).resultStatus, "unknown");
  assert.equal((storedWriteRecord[0] as { status?: string }).status, undefined);

  const legacyRelativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    "2026-03-03T18:00:00.000Z",
    "occurredAt",
  );
  const legacyEventId = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";

  await appendJsonlRecord({
    vaultRoot,
    relativePath: legacyRelativePath,
    record: {
      schemaVersion: "murph.event.v1",
      id: legacyEventId,
      kind: "test",
      occurredAt: "2026-03-03T18:00:00.000Z",
      recordedAt: "2026-03-03T18:05:00.000Z",
      dayKey: "2026-03-03",
      source: "manual",
      title: "Legacy CBC result",
      testName: "CBC",
      status: "abnormal",
      summary: "Legacy payload used status.",
    },
  });

  const readLegacy = await readHistoryEvent({
    vaultRoot,
    eventId: legacyEventId,
  });
  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["test"],
    order: "asc",
  });

  assert.equal(readLegacy.record.kind, "test");
  assert.equal(readLegacy.record.resultStatus, "unknown");
  assert.equal(readLegacy.record.summary, "Legacy payload used status.");
  assert.deepEqual(
    listed.map((record) => ({
      id: record.id,
      resultStatus: record.kind === "test" ? record.resultStatus : undefined,
    })),
    [
      { id: appended.record.id, resultStatus: "unknown" },
      { id: legacyEventId, resultStatus: "unknown" },
    ],
  );
});

test("history append keeps per-kind defaults and ignores the removed resultSummary alias", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-kind-normalization");
  await initializeVault({ vaultRoot });

  const procedure = await appendHistoryEvent({
    vaultRoot,
    kind: "procedure",
    occurredAt: "2026-03-04T09:00:00.000Z",
    title: "Left knee arthroscopy",
    procedure: "arthroscopy",
    externalRef: {
      system: "source-document",
      resourceType: "procedure-entry",
      resourceId: "synthetic-procedure-row-1",
    },
  });
  const adverseEffect = await appendHistoryEvent({
    vaultRoot,
    kind: "adverse_effect",
    occurredAt: "2026-03-04T10:00:00.000Z",
    title: "Nausea after ibuprofen",
    substance: "ibuprofen",
    effect: "nausea",
  });
  const exposure = await appendHistoryEvent({
    vaultRoot,
    kind: "exposure",
    occurredAt: "2026-03-04T11:00:00.000Z",
    title: "Mold cleanup",
    substance: "mold",
  });
  const labResult = await appendHistoryEvent({
    vaultRoot,
    kind: "test",
    occurredAt: "2026-03-04T12:00:00.000Z",
    title: "hs-CRP imported from summary-only payload",
    testName: "hs_crp",
    resultSummary: "Borderline elevation noted in source system.",
  } as Parameters<typeof appendHistoryEvent>[0] & { resultSummary?: string });
  const canonicalLabResult = await appendHistoryEvent({
    vaultRoot,
    kind: "test",
    occurredAt: "2026-03-04T12:30:00.000Z",
    title: "hs-CRP imported from canonical summary payload",
    testName: "hs_crp",
    summary: "Canonical summary text.",
  });

  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: procedure.relativePath,
  });
  const storedById = new Map(
    stored.map((record) => [(record as { id?: string }).id, record as Record<string, unknown>]),
  );
  const listed = await listHistoryEvents({
    vaultRoot,
    order: "asc",
  });
  const listedById = new Map(listed.map((record) => [record.id, record]));
  const readProcedure = await readHistoryEvent({
    vaultRoot,
    eventId: procedure.record.id,
  });
  const readAdverseEffect = await readHistoryEvent({
    vaultRoot,
    eventId: adverseEffect.record.id,
  });
  const readExposure = await readHistoryEvent({
    vaultRoot,
    eventId: exposure.record.id,
  });
  const readLabResult = await readHistoryEvent({
    vaultRoot,
    eventId: labResult.record.id,
  });
  const readCanonicalLabResult = await readHistoryEvent({
    vaultRoot,
    eventId: canonicalLabResult.record.id,
  });

  assert.equal(procedure.record.kind, "procedure");
  assert.equal(procedure.record.status, "completed");
  assert.equal(procedure.record.externalRef?.resourceId, "synthetic-procedure-row-1");
  assert.equal(readProcedure.record.kind, "procedure");
  assert.equal(readProcedure.record.status, "completed");
  assert.equal(readProcedure.record.externalRef?.resourceId, "synthetic-procedure-row-1");
  assert.equal(listedById.get(procedure.record.id)?.kind, "procedure");
  assert.equal(
    (listedById.get(procedure.record.id) as { status?: string } | undefined)?.status,
    "completed",
  );
  assert.equal(
    (listedById.get(procedure.record.id) as { externalRef?: { resourceId?: string } } | undefined)
      ?.externalRef?.resourceId,
    "synthetic-procedure-row-1",
  );
  assert.equal(storedById.get(procedure.record.id)?.status, "completed");
  assert.equal(
    (storedById.get(procedure.record.id)?.externalRef as { resourceId?: string } | undefined)?.resourceId,
    "synthetic-procedure-row-1",
  );

  assert.equal(adverseEffect.record.kind, "adverse_effect");
  assert.equal(adverseEffect.record.severity, "moderate");
  assert.equal(readAdverseEffect.record.kind, "adverse_effect");
  assert.equal(readAdverseEffect.record.severity, "moderate");
  assert.equal(listedById.get(adverseEffect.record.id)?.kind, "adverse_effect");
  assert.equal(
    (listedById.get(adverseEffect.record.id) as { severity?: string } | undefined)?.severity,
    "moderate",
  );
  assert.equal(storedById.get(adverseEffect.record.id)?.severity, "moderate");

  assert.equal(exposure.record.kind, "exposure");
  assert.equal(exposure.record.exposureType, "unspecified");
  assert.equal(readExposure.record.kind, "exposure");
  assert.equal(readExposure.record.exposureType, "unspecified");
  assert.equal(listedById.get(exposure.record.id)?.kind, "exposure");
  assert.equal(
    (listedById.get(exposure.record.id) as { exposureType?: string } | undefined)?.exposureType,
    "unspecified",
  );
  assert.equal(storedById.get(exposure.record.id)?.exposureType, "unspecified");

  assert.equal(labResult.record.kind, "test");
  assert.equal(labResult.record.summary, undefined);
  assert.equal(labResult.record.resultStatus, "unknown");
  assert.equal(readLabResult.record.kind, "test");
  assert.equal(readLabResult.record.summary, undefined);
  assert.equal(readLabResult.record.resultStatus, "unknown");
  assert.equal(listedById.get(labResult.record.id)?.kind, "test");
  assert.equal(
    (listedById.get(labResult.record.id) as { summary?: string } | undefined)?.summary,
    undefined,
  );
  assert.equal(storedById.get(labResult.record.id)?.summary, undefined);
  assert.equal(storedById.get(labResult.record.id)?.resultSummary, undefined);

  assert.equal((canonicalLabResult.record as TestHistoryEventRecord).summary, "Canonical summary text.");
  assert.equal(readCanonicalLabResult.record.kind, "test");
  assert.equal((readCanonicalLabResult.record as TestHistoryEventRecord).summary, "Canonical summary text.");
  assert.equal(
    (listedById.get(canonicalLabResult.record.id) as { summary?: string } | undefined)?.summary,
    "Canonical summary text.",
  );
});

test("blood-test writes infer result status and persist structured analytes canonically", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test");
  await initializeVault({ vaultRoot });

  const appended = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-03-05T08:30:00.000Z",
    title: "Functional health panel",
    testName: "functional_health_panel",
    labName: "Function Health",
    fastingStatus: "fasting",
    results: [
      {
        analyte: "Apolipoprotein B",
        value: 87,
        unit: "mg/dL",
        flag: "normal",
        referenceRange: {
          text: "<90",
        },
      },
      {
        analyte: "LDL Cholesterol",
        value: 134,
        unit: "mg/dL",
        flag: "high",
        referenceRange: {
          high: 99,
        },
      },
    ],
  });

  assert.equal(appended.record.kind, "test");
  assert.equal(appended.record.testCategory, "blood");
  assert.equal(appended.record.specimenType, "blood");
  assert.equal(appended.record.resultStatus, "mixed");
  assert.equal(appended.record.fastingStatus, "fasting");
  assert.equal(appended.record.labName, "Function Health");
  assert.equal(appended.record.results?.length, 2);
  assert.equal(appended.record.results?.[0]?.analyte, "Apolipoprotein B");

  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["test"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: appended.record.id,
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.kind, "test");
  assert.equal(listed[0]?.resultStatus, "mixed");
  assert.equal(listed[0]?.testCategory, "blood");
  assert.equal(read.record.kind, "test");
  assert.equal(read.record.resultStatus, "mixed");
  assert.equal(read.record.labName, "Function Health");
  assert.equal(read.record.results?.length, 2);
  assert.equal((stored[0] as { resultStatus?: string }).resultStatus, "mixed");
  assert.equal((stored[0] as { testCategory?: string }).testCategory, "blood");
  assert.equal((stored[0] as { specimenType?: string }).specimenType, "blood");
});

test("canonical event availability collapses blood-test tombstones", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test-summary");
  await initializeVault({ vaultRoot });

  const older = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-01-15T08:30:00.000Z",
    title: "Older live panel",
    testName: "older_live_panel",
  });
  const newer = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-05-31T08:30:00.000Z",
    title: "Deleted newer panel",
    testName: "deleted_newer_panel",
  });
  await deleteEvent({
    eventId: newer.record.id,
    vaultRoot,
  });

  const summary = await readCanonicalEventAvailabilityInterruptible({
    vaultRoot,
  });
  assert.deepEqual(summary, {
    interrupted: false,
    latestBloodPressureMeasurementDayKey: null,
    latestBloodPressureMeasurementOccurredAt: null,
    latestBloodTestOccurredAt: older.record.occurredAt,
    latestBodyMeasurementDayKey: null,
    latestBodyMeasurementOccurredAt: null,
  });
});

test("canonical event availability reads supported legacy provider body rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-canonical-availability-legacy-grain");
  await initializeVault({ vaultRoot });
  const occurredAt = "2026-07-15T12:00:00.000Z";

  await appendJsonlRecord({
    vaultRoot,
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      occurredAt,
      "occurredAt",
    ),
    record: {
      dayKey: "2026-07-15",
      externalRef: {
        resourceId: "legacy-body-summary-2026-07-15",
        resourceType: "daily-summary",
        system: "junction",
      },
      id: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F7",
      kind: "observation",
      metric: "body-fat-pct",
      observationGrain: "daily_timeseries_aggregate",
      occurredAt,
      recordedAt: "2026-07-15T12:05:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Legacy body composition summary",
      unit: "%",
      value: 18.4,
    },
  });
  const partialProvenanceOccurredAt = "2026-07-15T13:00:00.000Z";
  await appendJsonlRecord({
    vaultRoot,
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      partialProvenanceOccurredAt,
      "occurredAt",
    ),
    record: {
      dayKey: "2026-07-15",
      externalRef: {
        system: "oura",
      },
      id: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F4",
      kind: "observation",
      metric: "weight",
      occurredAt: partialProvenanceOccurredAt,
      recordedAt: "2026-07-15T13:05:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Legacy body weight",
      unit: "kg",
      value: 74.2,
    },
  });
  await appendJsonlRecord({
    vaultRoot,
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      occurredAt,
      "occurredAt",
    ),
    record: {
      dayKey: "2026-07-15",
      id: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F5",
      kind: "observation",
      lifecycle: {
        revision: 0,
      },
      metric: "daily-steps",
      occurredAt,
      recordedAt: "2026-07-15T12:06:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Unrelated malformed activity summary",
      value: 7000,
    },
  });

  const summary = await readCanonicalEventAvailabilityInterruptible({
    vaultRoot,
  });
  assert.equal(summary.interrupted, false);
  assert.equal(summary.latestBodyMeasurementDayKey, "2026-07-15");
  assert.equal(
    summary.latestBodyMeasurementOccurredAt,
    partialProvenanceOccurredAt,
  );
});

test("canonical event availability recognizes Junction body-composition summaries", async () => {
  const vaultRoot = await makeTempDirectory("murph-canonical-availability-body-composition");
  await initializeVault({ vaultRoot });
  const observations = [
    { metric: "bone-mass-percentage", occurredAt: "2026-07-15T10:00:00.000Z", unit: "%", value: 4.2 },
    { metric: "muscle-mass-percentage", occurredAt: "2026-07-15T11:00:00.000Z", unit: "%", value: 63.4 },
    { metric: "visceral-fat-index", occurredAt: "2026-07-15T12:00:00.000Z", unit: "index", value: 7 },
    { metric: "body-water-percentage", occurredAt: "2026-07-15T13:00:00.000Z", unit: "%", value: 51.8 },
  ];

  for (const [index, observation] of observations.entries()) {
    await appendJsonlRecord({
      vaultRoot,
      relativePath: toMonthlyShardRelativePath(
        VAULT_LAYOUT.eventLedgerDirectory,
        observation.occurredAt,
        "occurredAt",
      ),
      record: {
        dayKey: "2026-07-15",
        externalRef: {
          resourceId: `body-composition-${index}`,
          resourceType: "junction-withings-body",
          system: "junction",
        },
        id: `evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F${index}`,
        kind: "observation",
        lifecycle: {
          revision: 1,
        },
        metric: observation.metric,
        observationGrain: "summary",
        occurredAt: observation.occurredAt,
        recordedAt: observation.occurredAt,
        schemaVersion: "murph.event.v1",
        source: "device",
        title: "Body composition summary",
        unit: observation.unit,
        value: observation.value,
      },
    });
  }

  const summary = await readCanonicalEventAvailabilityInterruptible({ vaultRoot });
  assert.equal(summary.latestBodyMeasurementDayKey, "2026-07-15");
  assert.equal(
    summary.latestBodyMeasurementOccurredAt,
    observations.at(-1)?.occurredAt,
  );
});

test("canonical event availability still fails closed for malformed relevant records", async () => {
  const vaultRoot = await makeTempDirectory("murph-canonical-availability-malformed-body-alias");
  await initializeVault({ vaultRoot });
  const occurredAt = "2026-07-15T12:00:00.000Z";

  await appendJsonlRecord({
    vaultRoot,
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      occurredAt,
      "occurredAt",
    ),
    record: {
      dayKey: "2026-07-15",
      id: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F6",
      kind: "measurement",
      measurements: [{
        metric: "bodymassindex",
        value: 22.1,
      }],
      occurredAt,
      recordedAt: "2026-07-15T12:05:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Malformed body measurement alias",
    },
  });

  await assert.rejects(
    () => readCanonicalEventAvailabilityInterruptible({ vaultRoot }),
    (error: unknown) =>
      error instanceof VaultError
      && error.code === "EVENT_CONTRACT_INVALID",
  );
});

test("canonical event availability collapses revisions before filtering by kind", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test-summary-kind-revision");
  await initializeVault({ vaultRoot });

  const reclassified = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-01-15T08:30:00.000Z",
    recordedAt: "2026-01-15T08:31:00.000Z",
    title: "Reclassified panel",
    testName: "reclassified_panel",
  });
  await appendJsonlRecord({
    vaultRoot,
    relativePath: reclassified.relativePath,
    record: {
      schemaVersion: reclassified.record.schemaVersion,
      id: reclassified.record.id,
      kind: "procedure",
      occurredAt: reclassified.record.occurredAt,
      recordedAt: "2026-01-15T08:32:00.000Z",
      dayKey: reclassified.record.dayKey,
      source: reclassified.record.source,
      title: "Reclassified procedure",
      procedure: "Reclassified procedure",
      status: "completed",
      lifecycle: {
        revision: 2,
      },
    },
  });
  const legacyBodyId = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F3";
  await appendJsonlRecord({
    vaultRoot,
    relativePath: reclassified.relativePath,
    record: {
      dayKey: "2026-01-15",
      externalRef: {
        system: "oura",
      },
      id: legacyBodyId,
      kind: "observation",
      metric: "weight",
      occurredAt: "2026-01-15T09:00:00.000Z",
      recordedAt: "2026-01-15T09:01:00.000Z",
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Superseded malformed body observation",
      value: 74.2,
    },
  });
  await appendJsonlRecord({
    vaultRoot,
    relativePath: reclassified.relativePath,
    record: {
      schemaVersion: "murph.event.v1",
      id: legacyBodyId,
      kind: "procedure",
      occurredAt: "2026-01-15T09:00:00.000Z",
      recordedAt: "2026-01-15T09:02:00.000Z",
      dayKey: "2026-01-15",
      source: "manual",
      title: "Reclassified legacy body row",
      procedure: "Reclassified legacy body row",
      status: "completed",
      lifecycle: {
        revision: 2,
      },
    },
  });

  const summary = await readCanonicalEventAvailabilityInterruptible({
    vaultRoot,
  });
  assert.deepEqual(summary, {
    interrupted: false,
    latestBloodPressureMeasurementDayKey: null,
    latestBloodPressureMeasurementOccurredAt: null,
    latestBloodTestOccurredAt: null,
    latestBodyMeasurementDayKey: null,
    latestBodyMeasurementOccurredAt: null,
  });
});

test("canonical event availability stops between JSONL records", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test-summary-interrupt");
  await initializeVault({ vaultRoot });

  const appended = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-01-15T08:30:00.000Z",
    title: "Blood panel",
    testName: "blood_panel",
  });
  await fs.appendFile(
    path.join(vaultRoot, appended.relativePath),
    "invalid later record\n",
    "utf8",
  );

  let walkContinuationChecks = 0;
  const walked = await walkVaultFilesInterruptible(
    vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    {
      extension: ".jsonl",
      shouldContinue: () => {
        walkContinuationChecks += 1;
        return true;
      },
    },
  );
  assert.equal(walked.interrupted, false);
  assert.deepEqual(walked.relativePaths, [appended.relativePath]);

  let continuationChecks = 0;
  const interrupted = await readCanonicalEventAvailabilityInterruptible({
    shouldContinue: () => {
      continuationChecks += 1;
      return continuationChecks <= walkContinuationChecks + 2;
    },
    vaultRoot,
  });

  assert.deepEqual(interrupted, {
    interrupted: true,
    latestBloodPressureMeasurementDayKey: null,
    latestBloodPressureMeasurementOccurredAt: null,
    latestBloodTestOccurredAt: null,
    latestBodyMeasurementDayKey: null,
    latestBodyMeasurementOccurredAt: null,
  });
  assert.equal(continuationChecks, walkContinuationChecks + 3);
});

test("immunization writes persist vaccine metadata as event-ledger history", async () => {
  const vaultRoot = await makeTempDirectory("murph-immunization");
  await initializeVault({ vaultRoot });

  const appended = await appendImmunization({
    vaultRoot,
    occurredAt: "2026-03-05T08:30:00.000Z",
    source: "import",
    title: "Influenza vaccine",
    vaccineName: "Influenza",
    manufacturer: "Example manufacturer",
    lotNumber: "LOT123",
    route: "intramuscular",
    site: "left deltoid",
    series: "annual",
    targetDiseases: ["influenza", "influenza"],
    externalRef: {
      system: "source-document",
      resourceType: "immunization-entry",
      resourceId: "synthetic-row-1",
    },
  });

  assert.equal(appended.record.kind, "immunization");
  assert.equal(appended.record.vaccineName, "Influenza");
  assert.equal(appended.record.lotNumber, "LOT123");
  assert.deepEqual(appended.record.targetDiseases, ["influenza"]);

  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["immunization"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: appended.record.id,
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.kind, "immunization");
  assert.equal((listed[0] as ImmunizationHistoryEventRecord | undefined)?.manufacturer, "Example manufacturer");
  assert.equal(read.record.kind, "immunization");
  assert.equal((read.record as ImmunizationHistoryEventRecord).externalRef?.resourceId, "synthetic-row-1");
  assert.equal((stored[0] as { vaccineName?: string }).vaccineName, "Influenza");
  assert.deepEqual((stored[0] as { targetDiseases?: string[] }).targetDiseases, ["influenza"]);
});

test("blood-test writes accept textValue-only results and reject empty or incomplete result payloads", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test-text-only");
  await initializeVault({ vaultRoot });

  const appended = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-03-05T09:00:00.000Z",
    title: "Blood panel with textual result",
    testName: "text_only_panel",
    results: [
      {
        analyte: "Ferritin",
        textValue: "Reported as elevated by external lab",
      },
    ],
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  const storedRecord = stored[0] as {
    results?: Array<{ analyte?: string; value?: number; textValue?: string }>;
    resultStatus?: string;
  };

  assert.equal(appended.record.kind, "test");
  assert.equal(appended.record.testCategory, "blood");
  assert.equal(appended.record.specimenType, "blood");
  assert.equal(appended.record.resultStatus, "unknown");
  assert.equal(appended.record.results?.[0]?.analyte, "Ferritin");
  assert.equal(appended.record.results?.[0]?.value, undefined);
  assert.equal(appended.record.results?.[0]?.textValue, "Reported as elevated by external lab");
  assert.equal(storedRecord.results?.[0]?.textValue, "Reported as elevated by external lab");
  assert.equal(storedRecord.results?.[0]?.value, undefined);
  assert.equal(storedRecord.resultStatus, "unknown");

  const pending = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-03-06T09:00:00.000Z",
    title: "Pending blood panel",
    testName: "pending_panel",
    resultStatus: "pending",
  });

  assert.equal(pending.record.kind, "test");
  assert.equal(pending.record.resultStatus, "pending");
  assert.equal(pending.record.results, undefined);

  await assert.rejects(
    () =>
      appendBloodTest({
        vaultRoot,
        occurredAt: "2026-03-05T10:00:00.000Z",
        title: "Empty blood panel",
        testName: "empty_panel",
        results: [],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  await assert.rejects(
    () => {
      const incompleteInput = JSON.parse(
        JSON.stringify({
          vaultRoot,
          occurredAt: "2026-03-05T11:00:00.000Z",
          title: "Incomplete blood panel",
          testName: "incomplete_panel",
          results: [
            {
              analyte: "Transferrin",
            },
          ],
        }),
      );

      return appendBloodTest(incompleteInput);
    },
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  await assert.rejects(
    () => {
      const typoInput = JSON.parse(
        JSON.stringify({
          vaultRoot,
          occurredAt: "2026-03-05T12:00:00.000Z",
          title: "Blood panel with typo",
          testName: "typo_panel",
          results: [
            {
              analyte: "ANA",
              valueText: "Negative",
            },
          ],
        }),
      );

      return appendBloodTest(typoInput);
    },
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message ===
        "results[0].valueText is not supported. Did you mean results[0].textValue?",
  );
});

test("isBloodTestHistoryRecord matches blood-category and specimen-driven test records", () => {
  assert.equal(
    isBloodTestHistoryRecord({
      kind: "test",
      testCategory: "chemistry",
      specimenType: "urine",
    }),
    false,
  );
  assert.equal(
    isBloodTestHistoryRecord({
      kind: "test",
      testCategory: "blood",
      specimenType: "urine",
    }),
    true,
  );
  assert.equal(
    isBloodTestHistoryRecord({
      kind: "test",
      testCategory: "chemistry",
      specimenType: "serum",
    }),
    true,
  );
  assert.equal(
    isBloodTestHistoryRecord({
      kind: "test",
      testCategory: "chemistry",
      specimenType: "urine",
    }),
    false,
  );
});

test("history list filters by source and date range, respects limit, and rejects invalid inputs", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-list-filters");
  await initializeVault({ vaultRoot });

  const manualEarly = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-10T08:00:00.000Z",
    title: "Manual early visit",
    encounterType: "office_visit",
    source: "manual",
  });
  const importedMiddle = await appendHistoryEvent({
    vaultRoot,
    kind: "test",
    occurredAt: "2026-03-11T08:00:00.000Z",
    title: "Imported lab result",
    testName: "imported_panel",
    source: "import",
  });
  const manualLate = await appendHistoryEvent({
    vaultRoot,
    kind: "procedure",
    occurredAt: "2026-03-12T08:00:00.000Z",
    title: "Manual late procedure",
    procedure: "screening",
    source: "manual",
  });

  const imported = await listHistoryEvents({
    vaultRoot,
    source: "import",
    order: "asc",
  });
  const manualRange = await listHistoryEvents({
    vaultRoot,
    source: "manual",
    from: "2026-03-10T08:00:00.000Z",
    to: "2026-03-12T08:00:00.000Z",
    order: "asc",
  });
  const manualLimited = await listHistoryEvents({
    vaultRoot,
    source: "manual",
    from: "2026-03-10T08:00:00.000Z",
    to: "2026-03-12T08:00:00.000Z",
    order: "asc",
    limit: 1,
  });

  assert.deepEqual(imported.map((record) => record.id), [importedMiddle.record.id]);
  assert.deepEqual(manualRange.map((record) => record.id), [
    manualEarly.record.id,
    manualLate.record.id,
  ]);
  assert.deepEqual(manualLimited.map((record) => record.id), [manualEarly.record.id]);

  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        // @ts-expect-error runtime validation case
        source: "invalid",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        from: "not-a-timestamp",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_DATE",
  );
  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        to: "not-a-timestamp",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_DATE",
  );
  await assert.rejects(
    () =>
      listHistoryEvents({
        vaultRoot,
        limit: 0,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );
});

test("history writes reject provider ids and raw refs that violate the canonical event contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-contracts");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      appendHistoryEvent({
        vaultRoot,
        kind: "encounter",
        occurredAt: "2026-03-04T12:00:00.000Z",
        title: "Contract-invalid encounter",
        encounterType: "office_visit",
        providerId: "dr-smith",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_INVALID",
  );

  await assert.rejects(
    () =>
      appendHistoryEvent({
        vaultRoot,
        kind: "adverse_effect",
        occurredAt: "2026-03-04T12:00:00.000Z",
        title: "Contract-invalid raw ref",
        substance: "amoxicillin",
        effect: "rash",
        rawRefs: ["bank/goals/sleep.md"],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_INVALID",
  );
});

test.each([
  {
    name: "family members",
    upsert: upsertFamilyMember,
    read: readFamilyMember,
    list: listFamilyMembers,
    selector: { familyMemberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
    input: {
      title: "Maternal Grandmother",
      relationship: "grandmother",
      conditions: ["Type 2 diabetes", "cardiometabolic risk"],
      note: "Type 2 diabetes diagnosed in her 60s.",
      relatedVariantIds: ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
    },
    patch: { note: "Updated summary." },
    expected: {
      title: "Maternal Grandmother",
      relationship: "grandmother",
      conditions: ["cardiometabolic risk", "Type 2 diabetes"],
      note: "Updated summary.",
      relatedVariantIds: ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      links: [{ type: "related_variant", targetId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" }],
    },
    clear: { relatedVariantIds: [] },
    cleared: { relatedVariantIds: undefined, relationship: "grandmother" },
    section: /## Related Variants/,
    emptySection: /## Related Variants[\s\S]*- none/,
    relatedId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    slug: "maternal-grandmother",
    relativePath: "bank/family/maternal-grandmother.md",
    other: { title: "Father", relationship: "father" },
    missing: { slug: "missing-family-member" },
    missingCode: "VAULT_FAMILY_MEMBER_MISSING",
    conflictCode: "VAULT_FAMILY_MEMBER_CONFLICT",
    conflictMessage: "familyMemberId and slug resolve to different family members.",
    invalidCode: "VAULT_INVALID_FAMILY_MEMBER",
    invalidMessage: "Family registry document has an unexpected shape.",
    invalidDocType: "murph.family_member",
    extraFrontmatter: "lineage: maternal",
    action: "family_upsert",
  },
  {
    name: "genetic variants",
    upsert: upsertGeneticVariant,
    read: readGeneticVariant,
    list: listGeneticVariants,
    selector: { variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
    input: {
      gene: "APOE",
      title: "APOE e4 allele",
      zygosity: "compound_heterozygous",
      significance: "risk_factor",
      inheritance: "maternal lineage",
      sourceFamilyMemberIds: ["fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      note: "Family history and genotype raise late-life risk.",
    } satisfies Omit<Parameters<typeof upsertGeneticVariant>[0], "vaultRoot">,
    patch: {
      title: "APOE e4 allele updated",
      note: "Maintain aggressive cardiometabolic prevention.",
    },
    expected: {
      gene: "APOE",
      title: "APOE e4 allele updated",
      zygosity: "compound_heterozygous",
      significance: "risk_factor",
      inheritance: "maternal lineage",
      note: "Maintain aggressive cardiometabolic prevention.",
      sourceFamilyMemberIds: ["fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      links: [{ type: "source_family_member", targetId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" }],
    },
    clear: { sourceFamilyMemberIds: [], note: "Cleared source links without resupplying gene." },
    cleared: {
      sourceFamilyMemberIds: undefined,
      gene: "APOE",
      note: "Cleared source links without resupplying gene.",
    },
    section: /## Source Family Members/,
    emptySection: /## Source Family Members[\s\S]*- none/,
    relatedId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    slug: "apoe-apoe-e4-allele",
    relativePath: "bank/genetics/apoe-apoe-e4-allele.md",
    other: { gene: "MTHFR", title: "MTHFR C677T" },
    missing: { variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F9" },
    missingCode: "VAULT_GENETIC_VARIANT_MISSING",
    conflictCode: "VAULT_GENETIC_VARIANT_CONFLICT",
    conflictMessage: "variantId and slug resolve to different variants.",
    invalidCode: "VAULT_INVALID_GENETIC_VARIANT",
    invalidMessage: "Genetics registry document has an unexpected shape.",
    invalidDocType: "murph.genetic_variant",
    extraFrontmatter: "updatedAt: 2026-03-12T11:00:00Z",
    action: "genetics_upsert",
  },
])("$name preserve fields, links, selectors, and strict storage through the registry lifecycle", async (row) => {
  const vaultRoot = await makeTempDirectory("murph-family-registry");
  await initializeVault({ vaultRoot });
  if (row.name === "genetic variants") {
    await upsertFamilyMember({
      vaultRoot,
      familyMemberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      title: "Father",
      relationship: "father",
    });
  }

  const created = await row.upsert({ vaultRoot, ...row.selector, ...row.input });
  const updated = await row.upsert({
    vaultRoot,
    ...row.selector,
    ...row.patch,
    slug: "changed-slug-that-should-not-rename",
  });
  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(created.record.entity.slug, row.slug);
  assert.equal(created.record.document.relativePath, row.relativePath);
  assert.equal(updated.record.entity.slug, row.slug);
  assert.equal(updated.record.document.relativePath, row.relativePath);
  const listed = await row.list(vaultRoot);
  assert.equal(listed.length, 1);
  for (const record of [
    listed[0]!,
    await row.read({ vaultRoot, ...row.selector }),
    await row.read({ vaultRoot, slug: row.slug }),
  ]) {
    expect(record.entity).toMatchObject({ ...row.selector, ...row.expected });
    assert.deepEqual(record.entity.links, row.expected.links);
    assert.match(record.document.markdown, row.section);
    assert.doesNotMatch(record.document.markdown, /updatedAt:/);
  }

  const auditRecords = await readJsonlRecords({ vaultRoot, relativePath: updated.auditPath });
  const registryAudits = auditRecords.filter(
    (record) => (record as { action?: string }).action === row.action,
  ) as Array<{ targetIds?: string[]; changes?: Array<{ path?: string; op?: string }> }>;
  assert.deepEqual(registryAudits.map((record) => record.targetIds), [
    Object.values(row.selector),
    Object.values(row.selector),
  ]);
  assert.deepEqual(registryAudits.map((record) => record.changes?.[0]), [
    { path: row.relativePath, op: "create" },
    { path: row.relativePath, op: "update" },
  ]);
  const operations = await Promise.all(
    (await listObservedWriteOperationPaths(vaultRoot)).map((relativePath) =>
      readObservedWriteOperation(vaultRoot, relativePath),
    ),
  );
  assert.deepEqual(
    operations.filter((operation) => operation.operationType === row.action).map((operation) => operation.status),
    ["committed", "committed"],
  );

  const cleared = await row.upsert({ vaultRoot, ...row.selector, ...row.clear });
  assert.equal(cleared.created, false);
  const readCleared = await row.read({ vaultRoot, ...row.selector });
  expect(readCleared.entity).toMatchObject(row.cleared);
  assert.deepEqual(readCleared.entity.links, []);
  assert.match(readCleared.document.markdown, row.emptySection);
  assert.doesNotMatch(readCleared.document.markdown, new RegExp(row.relatedId));

  const other = await row.upsert({ vaultRoot, ...row.other });
  await assert.rejects(
    () => row.upsert({ vaultRoot, ...row.selector, slug: other.record.entity.slug }),
    (error: unknown) => error instanceof VaultError &&
      error.code === row.conflictCode && error.message === row.conflictMessage,
  );
  expect((await row.read({ vaultRoot, ...row.selector, slug: other.record.entity.slug })).entity)
    .toMatchObject(row.selector);
  await assert.rejects(
    () => row.read({ vaultRoot, ...row.missing }),
    (error: unknown) => error instanceof VaultError && error.code === row.missingCode,
  );

  for (const malformed of [
    readCleared.document.markdown.replace(/^schemaVersion:.*$/m, "schemaVersion: unsupported.v999"),
    readCleared.document.markdown.replace(/^docType:.*$/m, `docType: ${row.invalidDocType}`),
    readCleared.document.markdown.replace("---\n", `---\n${row.extraFrontmatter}\n`),
  ]) {
    await fs.writeFile(path.join(vaultRoot, row.relativePath), malformed, "utf8");
    await assert.rejects(
      () => row.list(vaultRoot),
      (error: unknown) => error instanceof VaultError &&
        error.code === row.invalidCode && error.message === row.invalidMessage,
    );
  }
});

test("family and genetics registry writes enforce the frozen contract length boundaries", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-boundaries");
  await initializeVault({ vaultRoot });

  const familyAtLimit = await upsertFamilyMember({
    vaultRoot,
    title: "F".repeat(160),
    relationship: "R".repeat(120),
  });

  assert.equal(familyAtLimit.record.entity.title.length, 160);
  assert.equal(familyAtLimit.record.entity.relationship.length, 120);

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        title: "F".repeat(161),
        relationship: "parent",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "title exceeds the maximum length.",
  );

  const variantAtLimit = await upsertGeneticVariant({
    vaultRoot,
    slug: "variant-at-limit",
    gene: "G".repeat(40),
    title: "T".repeat(160),
  });

  assert.equal(variantAtLimit.record.entity.gene.length, 40);
  assert.equal(variantAtLimit.record.entity.title.length, 160);

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        slug: "variant-too-long-gene",
        gene: "G".repeat(41),
        title: "Boundary check",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "gene exceeds the maximum length.",
  );
});

test("family and genetics registry creation preserves caller-provided ids and explicit slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-explicit-ids");
  await initializeVault({ vaultRoot });

  const familyMemberId = "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  const variantId = "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";

  const familyMember = await upsertFamilyMember({
    vaultRoot,
    familyMemberId,
    slug: "maternal-uncle",
    title: "Maternal Uncle",
    relationship: "uncle",
  });
  const variant = await upsertGeneticVariant({
    vaultRoot,
    variantId,
    slug: "apoe-e3",
    gene: "APOE",
    title: "APOE e3 allele",
  });

  assert.equal(familyMember.record.entity.familyMemberId, familyMemberId);
  assert.equal(familyMember.record.entity.slug, "maternal-uncle");
  assert.equal(familyMember.record.document.relativePath, "bank/family/maternal-uncle.md");
  assert.equal(variant.record.entity.variantId, variantId);
  assert.equal(variant.record.entity.slug, "apoe-e3");
  assert.equal(variant.record.document.relativePath, "bank/genetics/apoe-e3.md");
});

test("family and genetics upserts require canonical title and familyMemberId fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-hard-cut");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        name: "Mother",
        relationship: "mother",
      } as Parameters<typeof upsertFamilyMember>[0] & { name?: string }),
    /title is required/u,
  );

  await assert.rejects(
    () =>
      readFamilyMember({
        vaultRoot,
        memberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      } as Parameters<typeof readFamilyMember>[0] & { memberId?: string }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FAMILY_MEMBER_MISSING",
  );

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        gene: "APOE",
        label: "APOE e4 allele",
      } as Parameters<typeof upsertGeneticVariant>[0] & { label?: string }),
    /title is required/u,
  );
});

test("clinical import schemas compose directly with canonical history writers", async () => {
  const vaultRoot = await makeTempDirectory("murph-clinical-import-types");
  await initializeVault({ vaultRoot });
  const common = {
    eventId: null,
    occurredAt: "2026-11-10T12:00:00.000Z",
    recordedAt: null,
    source: "",
    title: "Synthetic imported record",
    note: null,
    tags: null,
    links: null,
    rawRefs: null,
  };
  const blood = await appendBloodTest({
    ...bloodTestImportPayloadSchema.parse({
      ...common,
      testName: "Synthetic panel",
      resultStatus: null,
      results: [{ analyte: "Synthetic marker", value: 3, unit: null }],
    }),
    vaultRoot,
  });
  const immunization = await appendImmunization({
    ...immunizationImportPayloadSchema.parse({
      ...common,
      vaccineName: "Synthetic vaccine",
      manufacturer: null,
      targetDiseases: null,
    }),
    vaultRoot,
  });
  for (const result of [blood, immunization]) {
    const stored = await readHistoryEvent({ vaultRoot, eventId: result.record.id });
    assert.equal(stored.record.source, "manual");
    assert.equal(stored.record.note, undefined);
    assert.equal(stored.record.occurredAt, common.occurredAt);
  }
  assert.equal(blood.record.results?.[0]?.unit, undefined);
  assert.equal(immunization.record.manufacturer, undefined);
});
