import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  appendJsonlRecord,
  initializeVault,
  readJsonlRecords,
  stringifyFrontmatterDocument,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  VaultError,
} from "../src/index.ts";
import {
  appendBloodTest,
  appendHistoryEvent,
  isBloodTestHistoryRecord,
  listHistoryEvents,
  readHistoryEvent,
} from "../src/history/index.ts";
import type {
  EncounterHistoryEventRecord,
  TestHistoryEventRecord,
} from "../src/history/index.ts";
import { listFamilyMembers, readFamilyMember, upsertFamilyMember } from "../src/family/index.ts";
import { listGeneticVariants, readGeneticVariant, upsertGeneticVariant } from "../src/genetics/index.ts";
import { listWriteOperationMetadataPaths, readStoredWriteOperation } from "../src/operations/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

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
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
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
  assert.equal(readProcedure.record.kind, "procedure");
  assert.equal(readProcedure.record.status, "completed");
  assert.equal(listedById.get(procedure.record.id)?.kind, "procedure");
  assert.equal(
    (listedById.get(procedure.record.id) as { status?: string } | undefined)?.status,
    "completed",
  );
  assert.equal(storedById.get(procedure.record.id)?.status, "completed");

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
  assert.equal(appended.record.results.length, 2);
  assert.equal(appended.record.results[0]?.analyte, "Apolipoprotein B");

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
  assert.equal(appended.record.results[0]?.analyte, "Ferritin");
  assert.equal(appended.record.results[0]?.value, undefined);
  assert.equal(appended.record.results[0]?.textValue, "Reported as elevated by external lab");
  assert.equal(storedRecord.results?.[0]?.textValue, "Reported as elevated by external lab");
  assert.equal(storedRecord.results?.[0]?.value, undefined);
  assert.equal(storedRecord.resultStatus, "unknown");

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

  const incompleteResult: {
    analyte: string;
    value?: number;
    textValue?: string;
  } = {
    analyte: "Transferrin",
    value: 18,
  };
  delete incompleteResult.value;

  await assert.rejects(
    () =>
      appendBloodTest({
        vaultRoot,
        occurredAt: "2026-03-05T11:00:00.000Z",
        title: "Incomplete blood panel",
        testName: "incomplete_panel",
        results: [incompleteResult],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
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

test("family members are stored as deterministic markdown registry entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-family");
  await initializeVault({ vaultRoot });

  const created = await upsertFamilyMember({
    vaultRoot,
    title: "Maternal Grandmother",
    relationship: "grandmother",
    conditions: ["Type 2 diabetes", "cardiometabolic risk"],
    note: "Type 2 diabetes diagnosed in her 60s.",
    relatedVariantIds: ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });
  const updated = await upsertFamilyMember({
    vaultRoot,
    familyMemberId: created.record.entity.familyMemberId,
    slug: "changed-slug-that-should-not-rename",
    note: "Updated summary.",
  });

  const listed = await listFamilyMembers(vaultRoot);
  const read = await readFamilyMember({
    vaultRoot,
    slug: created.record.entity.slug,
  });

  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.record.document.relativePath, created.record.document.relativePath);
  assert.equal(updated.record.entity.slug, created.record.entity.slug);
  assert.equal(listed.length, 1);
  assert.equal(read.entity.familyMemberId, created.record.entity.familyMemberId);
  assert.match(read.document.markdown, /## Related Variants/);
  assert.deepEqual(read.entity.relatedVariantIds, ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
  assert.deepEqual(read.entity.links, [
    {
      type: "related_variant",
      targetId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    },
  ]);
  assert.doesNotMatch(read.document.markdown, /updatedAt:/);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: updated.auditPath,
  });

  assert.equal(
    auditRecords.filter((record) => (record as { action?: string }).action === "family_upsert").length,
    2,
  );

  const familyOperations = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
        readStoredWriteOperation(vaultRoot, relativePath),
      ),
    )
  ).filter((operation) => operation.operationType === "family_upsert");

  assert.equal(familyOperations.length, 2);
  assert.ok(familyOperations.every((operation) => operation.status === "committed"));
});

test("family registry upserts reject conflicting family member ids and slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-conflict");
  await initializeVault({ vaultRoot });

  const first = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
  });
  const second = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        familyMemberId: first.record.entity.familyMemberId,
        slug: second.record.entity.slug,
        note: "This should fail.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_FAMILY_MEMBER_CONFLICT" &&
      error.message === "familyMemberId and slug resolve to different family members.",
  );
});

test("family registry listing preserves invalid document shape errors after shared loader extraction", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-invalid-shape");
  await initializeVault({ vaultRoot });

  const invalidMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.family-member-frontmatter.v999",
      docType: "murph.family_member",
      familyMemberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "invalid-family-member",
      title: "Invalid Family Member",
      relationship: "parent",
    },
    body: "# Invalid Family Member\n",
  });

  await fs.writeFile(path.join(vaultRoot, "bank/family/invalid-family-member.md"), invalidMarkdown, "utf8");

  await assert.rejects(
    () => listFamilyMembers(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_FAMILY_MEMBER" &&
      error.message === "Family registry document has an unexpected shape.",
  );
});

test("genetic variants are stored in markdown registries and can link to family members", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics");
  await initializeVault({ vaultRoot });

  const familyMember = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });
  const created = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
    zygosity: "compound_heterozygous",
    significance: "risk_factor",
    inheritance: "maternal lineage",
    sourceFamilyMemberIds: [familyMember.record.entity.familyMemberId],
    note: "Family history and genotype raise late-life risk.",
  });
  const updated = await upsertGeneticVariant({
    vaultRoot,
    variantId: created.record.entity.variantId,
    slug: "changed-slug-that-should-not-rename",
    title: "APOE e4 allele updated",
    significance: "risk_factor",
    note: "Maintain aggressive cardiometabolic prevention.",
    sourceFamilyMemberIds: [familyMember.record.entity.familyMemberId],
  });

  const listed = await listGeneticVariants(vaultRoot);
  const read = await readGeneticVariant({
    vaultRoot,
    variantId: created.record.entity.variantId,
  });

  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.record.entity.slug, created.record.entity.slug);
  assert.equal(updated.record.document.relativePath, created.record.document.relativePath);
  assert.equal(listed.length, 1);
  assert.equal(read.entity.variantId, created.record.entity.variantId);
  assert.equal(read.entity.gene, "APOE");
  assert.equal(read.entity.title, "APOE e4 allele updated");
  assert.equal(read.entity.zygosity, "compound_heterozygous");
  assert.equal(read.entity.inheritance, "maternal lineage");
  assert.deepEqual(read.entity.sourceFamilyMemberIds, [familyMember.record.entity.familyMemberId]);
  assert.deepEqual(read.entity.links, [
    {
      type: "source_family_member",
      targetId: familyMember.record.entity.familyMemberId,
    },
  ]);
  assert.match(read.document.markdown, /## Source Family Members/);
  assert.doesNotMatch(read.document.markdown, /updatedAt:/);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: updated.auditPath,
  });

  const geneticsAuditRecords = auditRecords.filter(
    (record) =>
      (record as { action?: string; targetIds?: string[] }).action === "genetics_upsert" &&
      (record as { targetIds?: string[] }).targetIds?.includes(created.record.entity.variantId),
  ) as Array<{
    changes?: Array<{ path?: string; op?: string }>;
  }>;

  assert.equal(geneticsAuditRecords.length, 2);
  assert.deepEqual(
    geneticsAuditRecords.map((record) => record.changes?.[0]),
    [
      { path: created.record.document.relativePath, op: "create" },
      { path: created.record.document.relativePath, op: "update" },
    ],
  );

  const geneticOperations = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
        readStoredWriteOperation(vaultRoot, relativePath),
      ),
    )
  ).filter((operation) => operation.operationType === "genetics_upsert");

  assert.equal(geneticOperations.length, 2);
  assert.ok(geneticOperations.every((operation) => operation.status === "committed"));
});

test("family and genetics updates clear normalized links without breaking patch semantics", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-clear-links");
  await initializeVault({ vaultRoot });

  const relatedVariantId = "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  const familyMember = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
    relatedVariantIds: [relatedVariantId],
  });
  const variant = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
    sourceFamilyMemberIds: [familyMember.record.entity.familyMemberId],
  });

  const clearedFamilyMember = await upsertFamilyMember({
    vaultRoot,
    familyMemberId: familyMember.record.entity.familyMemberId,
    relatedVariantIds: [],
  });
  const clearedVariant = await upsertGeneticVariant({
    vaultRoot,
    variantId: variant.record.entity.variantId,
    sourceFamilyMemberIds: [],
    note: "Cleared source links without resupplying gene.",
  });
  const readFamilyRecord = await readFamilyMember({
    vaultRoot,
    familyMemberId: familyMember.record.entity.familyMemberId,
  });
  const readVariantRecord = await readGeneticVariant({
    vaultRoot,
    variantId: variant.record.entity.variantId,
  });

  assert.equal(clearedFamilyMember.created, false);
  assert.equal(clearedVariant.created, false);
  assert.equal(readFamilyRecord.entity.relationship, "mother");
  assert.equal(readFamilyRecord.entity.relatedVariantIds, undefined);
  assert.deepEqual(readFamilyRecord.entity.links, []);
  assert.match(readFamilyRecord.document.markdown, /## Related Variants[\s\S]*- none/);
  assert.doesNotMatch(readFamilyRecord.document.markdown, new RegExp(relatedVariantId));
  assert.equal(readVariantRecord.entity.gene, "APOE");
  assert.equal(readVariantRecord.entity.sourceFamilyMemberIds, undefined);
  assert.deepEqual(readVariantRecord.entity.links, []);
  assert.equal(readVariantRecord.entity.note, "Cleared source links without resupplying gene.");
  assert.match(readVariantRecord.document.markdown, /## Source Family Members[\s\S]*- none/);
  assert.doesNotMatch(readVariantRecord.document.markdown, new RegExp(familyMember.record.entity.familyMemberId));
});

test("genetic registry upserts reject conflicting variant ids and slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics-conflict");
  await initializeVault({ vaultRoot });

  const first = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
  });
  const second = await upsertGeneticVariant({
    vaultRoot,
    gene: "MTHFR",
    title: "MTHFR C677T",
  });

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        variantId: first.record.entity.variantId,
        slug: second.record.entity.slug,
        gene: "APOE",
        note: "This should fail.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GENETIC_VARIANT_CONFLICT" &&
      error.message === "variantId and slug resolve to different variants.",
  );
});

test("genetic registry listing preserves invalid document shape errors after shared loader extraction", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics-invalid-shape");
  await initializeVault({ vaultRoot });

  const invalidMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.genetic-variant-frontmatter.v999",
      docType: "murph.genetic_variant",
      variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "invalid-genetic-variant",
      gene: "APOE",
      title: "Invalid Genetic Variant",
    },
    body: "# Invalid Genetic Variant\n",
  });

  await fs.writeFile(path.join(vaultRoot, "bank/genetics/invalid-genetic-variant.md"), invalidMarkdown, "utf8");

  await assert.rejects(
    () => listGeneticVariants(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_GENETIC_VARIANT" &&
      error.message === "Genetics registry document has an unexpected shape.",
  );
});

test("family and genetics registry reads reject extra noncanonical frontmatter keys under the hard cut", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-hard-cut-frontmatter");
  await initializeVault({ vaultRoot });

  const familyMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.frontmatter.family-member.v1",
      docType: "family_member",
      familyMemberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "mother",
      title: "Mother",
      relationship: "mother",
      lineage: "maternal",
    },
    body: "# Mother\n",
  });
  const geneticsMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.frontmatter.genetic-variant.v1",
      docType: "genetic_variant",
      variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "apoe-e4",
      title: "APOE e4 allele",
      gene: "APOE",
      updatedAt: "2026-03-12T11:00:00Z",
    },
    body: "# APOE e4 allele\n",
  });

  await fs.writeFile(path.join(vaultRoot, "bank/family/mother.md"), familyMarkdown, "utf8");
  await fs.writeFile(path.join(vaultRoot, "bank/genetics/apoe-e4.md"), geneticsMarkdown, "utf8");

  await assert.rejects(
    () => listFamilyMembers(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_FAMILY_MEMBER" &&
      error.message === "Family registry document has an unexpected shape.",
  );

  await assert.rejects(
    () => listGeneticVariants(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_GENETIC_VARIANT" &&
      error.message === "Genetics registry document has an unexpected shape.",
  );
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

test("family and genetics registry id-or-slug resolution preserves conflict and missing errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-resolution");
  await initializeVault({ vaultRoot });

  const mother = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
  });
  const father = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        familyMemberId: mother.record.entity.familyMemberId,
        slug: father.record.entity.slug,
        note: "Should fail because id and slug resolve to different records.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_FAMILY_MEMBER_CONFLICT" &&
      error.message === "familyMemberId and slug resolve to different family members.",
  );

  await assert.rejects(
    () =>
      readFamilyMember({
        vaultRoot,
        slug: "missing-family-member",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FAMILY_MEMBER_MISSING",
  );

  const readFamilyByConflictingSelectors = await readFamilyMember({
    vaultRoot,
    familyMemberId: mother.record.entity.familyMemberId,
    slug: father.record.entity.slug,
  });

  assert.equal(readFamilyByConflictingSelectors.entity.familyMemberId, mother.record.entity.familyMemberId);

  const apoe = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
  });
  const mthfr = await upsertGeneticVariant({
    vaultRoot,
    gene: "MTHFR",
    title: "MTHFR C677T",
  });

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        variantId: apoe.record.entity.variantId,
        slug: mthfr.record.entity.slug,
        gene: "APOE",
        title: "Conflicting selector",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GENETIC_VARIANT_CONFLICT" &&
      error.message === "variantId and slug resolve to different variants.",
  );

  await assert.rejects(
    () =>
      readGeneticVariant({
        vaultRoot,
        variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_GENETIC_VARIANT_MISSING",
  );

  const readVariantByConflictingSelectors = await readGeneticVariant({
    vaultRoot,
    variantId: apoe.record.entity.variantId,
    slug: mthfr.record.entity.slug,
  });

  assert.equal(readVariantByConflictingSelectors.entity.variantId, apoe.record.entity.variantId);
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
