import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord } from "@murphai/contracts";

import {
  deleteEvent,
  findEventByExternalRef,
  findEventsByRawRefs,
  importEventBatch,
  initializeVault,
  listHistoryEvents,
  readJsonlRecords,
  updateVaultSummary,
  upsertEvent,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function makeVault(name: string, timezone?: string): Promise<string> {
  const vaultRoot = await makeTempDirectory(name);
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-01T12:00:00.000Z",
    ...(timezone ? { timezone } : {}),
  });
  return vaultRoot;
}

function buildSleepSessionPayload(dayOfMonth: number, overrides: Record<string, unknown> = {}) {
  const day = String(dayOfMonth).padStart(2, "0");
  return {
    kind: "sleep_session",
    occurredAt: `2026-03-${day}T06:50:00.000Z`,
    source: "device",
    title: `Sleep 2026-03-${day}`,
    startAt: `2026-03-${day}T00:10:00.000Z`,
    endAt: `2026-03-${day}T06:50:00.000Z`,
    durationMinutes: 400,
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: `sleep-2026-03-${day}`,
    },
    ...overrides,
  };
}

function buildObservationPayload(dayOfMonth: number, facet: string, value: number) {
  const day = String(dayOfMonth).padStart(2, "0");
  return {
    kind: "observation",
    occurredAt: `2026-03-${day}T06:50:00.000Z`,
    source: "device",
    title: `Sleep efficiency 2026-03-${day}`,
    metric: "sleep-efficiency",
    value,
    unit: "%",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: `sleep-2026-03-${day}`,
      facet,
    },
  };
}

function buildClinicalMeasurementPayload(version: string, value = 72) {
  return {
    kind: "measurement",
    occurredAt: "2026-03-10T08:00:00.000Z",
    source: "import",
    title: "Heart rate",
    measurements: [{ metric: "heart-rate", unit: "bpm", value }],
    evidence: [{
      rawRef: "raw/clinical/fhir/connection-1/retrieval-1/Observation/page-1.json",
      sourceLabel: "Observation/observation-1",
    }],
    externalRef: {
      system: "generic-smart-fhir-base-patient",
      resourceType: "observation",
      resourceId: "observation-1",
      version,
    },
  };
}

test("findEventsByRawRefs returns immutable attachments and latest lifecycle state", async () => {
  const vaultRoot = await makeVault("event-raw-ref-batch");
  const rawRef = "raw/workouts/2026/03/batch/source.csv";
  await importEventBatch({
    vaultRoot,
    payloads: [
      { ...buildObservationPayload(1, "efficiency", 90), rawRefs: [rawRef] },
      { ...buildObservationPayload(2, "efficiency", 91), rawRefs: [rawRef] },
    ],
    apply: true,
  });

  const firstLookup = await findEventsByRawRefs({
    vaultRoot,
    rawRefs: [rawRef, "raw/workouts/missing.csv"],
    system: "whoop",
    resourceType: "sleep",
  });

  assert.deepEqual(
    firstLookup[0]?.map((match) => match.latest.externalRef?.resourceId),
    ["sleep-2026-03-01", "sleep-2026-03-02"],
  );
  assert.deepEqual(firstLookup[1], []);

  const firstEventId = firstLookup[0]![0]!.latest.id;
  await upsertEvent({
    vaultRoot,
    payload: {
      ...buildObservationPayload(1, "efficiency", 90),
      id: firstEventId,
      occurredAt: "2026-03-05T06:50:00.000Z",
      title: "Edited title",
      rawRefs: [],
    },
  });
  await deleteEvent({ vaultRoot, eventId: firstEventId });

  const [matches] = await findEventsByRawRefs({
    vaultRoot,
    rawRefs: [rawRef],
    system: "whoop",
    resourceType: "sleep",
  });
  assert.equal(matches?.[0]?.attachment.title, "Sleep efficiency 2026-03-01");
  assert.equal(matches?.[0]?.latest.title, "Edited title");
  assert.equal(matches?.[0]?.latest.lifecycle?.state, "deleted");
  assert.equal(matches?.[0]?.latest.rawRefs, undefined);
});

function buildClinicalTestPayload(version: string) {
  return {
    kind: "test",
    occurredAt: "2026-03-10T08:00:00.000Z",
    source: "import",
    title: "Glucose",
    testName: "Glucose",
    resultStatus: "normal",
    results: [{ analyte: "Glucose", textValue: "92 mg/dL" }],
    evidence: [{
      rawRef: "raw/clinical/fhir/connection-1/retrieval-2/Observation/page-1.json",
      sourceLabel: "Observation/observation-1",
    }],
    externalRef: {
      system: "generic-smart-fhir-base-patient",
      resourceType: "observation",
      resourceId: "observation-1",
      version,
    },
  };
}

async function readEventShard(vaultRoot: string, relativePath: string): Promise<EventRecord[]> {
  const records = await readJsonlRecords({ vaultRoot, relativePath });
  return records as EventRecord[];
}

function importEventBatchFromRuntime(input: Record<string, unknown>): ReturnType<typeof importEventBatch> {
  return Reflect.apply(importEventBatch, undefined, [input]);
}

test("importEventBatch dry-run reports counts without writing", async () => {
  const vaultRoot = await makeVault("murph-event-batch-dry-run");
  const payloads = [
    buildSleepSessionPayload(10),
    buildSleepSessionPayload(11),
    buildObservationPayload(10, "sleep-efficiency", 97),
  ];

  const result = await importEventBatch({ vaultRoot, payloads });

  assert.equal(result.applied, false);
  assert.equal(result.receivedCount, 3);
  assert.equal(result.createdCount, 3);
  assert.equal(result.skippedExistingCount, 0);
  assert.equal(result.supersededCount, 0);
  assert.equal(result.auditPath, null);
  assert.equal(result.eventShardPaths.length, 1);

  const shardPath = result.eventShardPaths[0]!;
  await assert.rejects(fs.access(path.join(vaultRoot, shardPath)));
});

test("importEventBatch apply writes all rows once and re-runs are idempotent", async () => {
  const vaultRoot = await makeVault("murph-event-batch-apply");
  const payloads = [
    buildSleepSessionPayload(10),
    buildSleepSessionPayload(11),
    buildObservationPayload(10, "sleep-efficiency", 97),
    buildObservationPayload(11, "sleep-efficiency", 95),
  ];

  const applied = await importEventBatch({ vaultRoot, payloads, apply: true });

  assert.equal(applied.applied, true);
  assert.equal(applied.receivedCount, 4);
  assert.equal(applied.createdCount, 4);
  assert.equal(applied.skippedExistingCount, 0);
  assert.equal(applied.supersededCount, 0);
  assert.notEqual(applied.auditPath, null);
  assert.equal(applied.eventShardPaths.length, 1);

  const shardPath = applied.eventShardPaths[0]!;
  const records = await readEventShard(vaultRoot, shardPath);
  assert.equal(records.length, 4);
  assert.equal(records.every((record) => record.id.startsWith("evt_")), true);
  assert.equal(
    records.every((record) => record.externalRef?.system === "whoop"),
    true,
  );

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: applied.auditPath!,
  }) as AuditRecord[];
  const batchAudit = auditRecords.find(
    (record) => record.commandName === "core.importEventBatch",
  );
  assert.notEqual(batchAudit, undefined);
  assert.equal(batchAudit!.action, "event_upsert");

  const rerun = await importEventBatch({ vaultRoot, payloads, apply: true });

  assert.equal(rerun.applied, false);
  assert.equal(rerun.receivedCount, 4);
  assert.equal(rerun.createdCount, 0);
  assert.equal(rerun.skippedExistingCount, 4);
  assert.equal(rerun.supersededCount, 0);
  // eventShardPaths reports targeted shards, so an all-skipped rerun still
  // names the shard it evaluated instead of returning [].
  assert.deepEqual(rerun.eventShardPaths, [shardPath]);

  const recordsAfterRerun = await readEventShard(vaultRoot, shardPath);
  assert.equal(recordsAfterRerun.length, 4);
});

test("importEventBatch aborts interruptible history planning before the canonical commit", async () => {
  const vaultRoot = await makeVault("murph-event-batch-abort-planning");
  const baseline = await importEventBatch({
    apply: true,
    payloads: [buildSleepSessionPayload(10), buildSleepSessionPayload(11)],
    vaultRoot,
  });
  const shardPath = baseline.eventShardPaths[0]!;
  const controller = new AbortController();
  const nativeThrowIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
  let cancellationChecks = 0;
  Object.defineProperty(controller.signal, "throwIfAborted", {
    configurable: true,
    value() {
      cancellationChecks += 1;
      if (cancellationChecks === 12) {
        controller.abort(new DOMException("Foreground work arrived.", "AbortError"));
      }
      nativeThrowIfAborted();
    },
  });

  await assert.rejects(
    importEventBatch({
      apply: true,
      payloads: [buildSleepSessionPayload(12)],
      signal: controller.signal,
      vaultRoot,
    }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(cancellationChecks, 12);
  assert.equal((await readEventShard(vaultRoot, shardPath)).length, 2);

  const resumed = await importEventBatch({
    apply: true,
    payloads: [buildSleepSessionPayload(12)],
    vaultRoot,
  });
  assert.equal(resumed.createdCount, 1);
  assert.equal((await readEventShard(vaultRoot, shardPath)).length, 3);
});

test("importEventBatch treats null recordedAt as omitted", async () => {
  const vaultRoot = await makeVault("murph-event-batch-null-recorded-at");

  const applied = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10, { recordedAt: null })],
    apply: true,
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.createdCount, 1);

  const records = await readEventShard(vaultRoot, applied.eventShardPaths[0]!);
  assert.equal(records.length, 1);
  assert.match(records[0]!.recordedAt, /^\d{4}-\d{2}-\d{2}T/u);
});

test("importEventBatch normalizes null optionals and duplicate collections before validation", async () => {
  const vaultRoot = await makeVault("murph-event-batch-raw-optionals");
  const duplicateLink = { type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" };

  const applied = await importEventBatch({
    vaultRoot,
    payloads: [
      buildSleepSessionPayload(10, {
        source: null,
        note: null,
        tags: null,
        links: null,
        rawRefs: null,
        timeZone: null,
      }),
      buildSleepSessionPayload(11, {
        note: "",
        source: "",
        tags: ["sleep", "sleep"],
        links: [duplicateLink, duplicateLink],
        rawRefs: ["raw/imports/sleep.json", "raw/imports/sleep.json"],
      }),
    ],
    apply: true,
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.createdCount, 2);

  const records = await readEventShard(vaultRoot, applied.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  const nullOptionals = records.find((record) => record.title === "Sleep 2026-03-10");
  const duplicateCollections = records.find((record) => record.title === "Sleep 2026-03-11");
  assert.ok(nullOptionals);
  assert.ok(duplicateCollections);

  assert.equal(nullOptionals.source, "manual");
  assert.equal(nullOptionals.note, undefined);
  assert.equal(nullOptionals.tags, undefined);
  assert.equal(nullOptionals.links, undefined);
  assert.equal(nullOptionals.rawRefs, undefined);
  assert.equal(nullOptionals.timeZone, undefined);

  assert.equal(duplicateCollections.source, "manual");
  assert.equal(duplicateCollections.note, undefined);
  assert.deepEqual(duplicateCollections.tags, ["sleep"]);
  assert.deepEqual(duplicateCollections.links, [duplicateLink]);
  assert.deepEqual(duplicateCollections.rawRefs, ["raw/imports/sleep.json"]);
});

test("importEventBatch supersedes changed content for an existing externalRef in place", async () => {
  const vaultRoot = await makeVault("murph-event-batch-supersede");

  const first = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10)],
    apply: true,
  });
  assert.equal(first.createdCount, 1);

  const second = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10, { durationMinutes: 415 })],
    apply: true,
  });

  assert.equal(second.applied, true);
  assert.equal(second.createdCount, 0);
  assert.equal(second.skippedExistingCount, 0);
  assert.equal(second.supersededCount, 1);

  const records = await readEventShard(vaultRoot, second.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  const [original, revision] = records;
  assert.equal(revision!.id, original!.id);
  assert.equal(revision!.lifecycle?.revision, 2);
  assert.equal(
    revision!.kind === "sleep_session" ? revision!.durationMinutes : null,
    415,
  );
});

test("importEventBatch does not let an older source revision replace a newer event", async () => {
  const vaultRoot = await makeVault("murph-event-batch-source-revision-order");
  const newerBase = buildObservationPayload(10, "heart-rate", 72);
  const newer = {
    ...newerBase,
    externalRef: { ...newerBase.externalRef, version: "2026-03-10T08:00:00.123457Z" },
  };
  const olderBase = buildObservationPayload(10, "heart-rate", 68);
  const older = {
    ...olderBase,
    externalRef: { ...olderBase.externalRef, version: "2026-03-10T08:00:00.123456Z" },
  };

  const first = await importEventBatch({ vaultRoot, payloads: [newer], apply: true });
  assert.equal(first.createdCount, 1);

  const replay = await importEventBatch({ vaultRoot, payloads: [older], apply: true });
  assert.equal(replay.applied, false);
  assert.equal(replay.skippedExistingCount, 1);
  assert.equal(replay.supersededCount, 0);

  const records = await readEventShard(vaultRoot, first.eventShardPaths[0]!);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.kind === "observation" ? records[0]!.value : null, 72);

  const conflictingBase = buildObservationPayload(10, "heart-rate", 71);
  const conflicting = {
    ...conflictingBase,
    externalRef: { ...conflictingBase.externalRef, version: "2026-03-10T08:00:00.123457Z" },
  };
  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [conflicting], apply: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_SOURCE_REVISION_CONFLICT");
      return true;
    },
  );

  const newestBase = buildObservationPayload(10, "heart-rate", 74);
  const newest = {
    ...newestBase,
    externalRef: { ...newestBase.externalRef, version: "2026-03-10T08:00:00.123458Z" },
  };
  const update = await importEventBatch({ vaultRoot, payloads: [newest], apply: true });
  assert.equal(update.supersededCount, 1);
  const updatedRecords = await readEventShard(vaultRoot, first.eventShardPaths[0]!);
  assert.equal(updatedRecords.length, 2);
  assert.equal(updatedRecords[1]!.kind === "observation" ? updatedRecords[1]!.value : null, 74);
});

test("importEventBatch skips an equal-version payload replay with an equivalent version lexeme", async () => {
  const vaultRoot = await makeVault("murph-event-batch-version-lexeme-replay");
  const firstPayload = buildClinicalMeasurementPayload("2026-03-10T08:00:00.000Z");
  const replayPayload = {
    ...firstPayload,
    externalRef: {
      ...firstPayload.externalRef,
      version: "2026-03-10T08:00:00Z",
    },
  };

  const first = await importEventBatch({ vaultRoot, payloads: [firstPayload], apply: true });
  const replay = await importEventBatch({ vaultRoot, payloads: [replayPayload], apply: true });

  assert.equal(first.createdCount, 1);
  assert.equal(replay.applied, false);
  assert.equal(replay.skippedExistingCount, 1);
  assert.equal(replay.supersededCount, 0);
  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);
});

test("importEventBatch skips an identical equal-version payload after the vault timezone changes", async () => {
  const vaultRoot = await makeVault("murph-event-batch-timezone-replay", "UTC");
  const payload = {
    ...buildClinicalMeasurementPayload("2026-03-10T08:00:00.000Z"),
    occurredAt: "2026-03-10T01:00:00.000Z",
  };

  const first = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });
  await updateVaultSummary({ vaultRoot, timezone: "America/Los_Angeles" });
  const replay = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });

  assert.equal(first.createdCount, 1);
  assert.equal(replay.applied, false);
  assert.equal(replay.skippedExistingCount, 1);
  assert.equal(replay.supersededCount, 0);
  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);
});

test("importEventBatch rejects an equal-version payload when only rawRefs change", async () => {
  const vaultRoot = await makeVault("murph-event-batch-versioned-raw-ref-conflict");
  const version = "2026-03-10T08:00:00.000Z";
  const firstPayload = {
    ...buildClinicalMeasurementPayload(version),
    rawRefs: ["raw/clinical/import-a.json"],
  };
  const conflictingPayload = {
    ...firstPayload,
    rawRefs: ["raw/clinical/import-b.json"],
  };

  const first = await importEventBatch({ vaultRoot, payloads: [firstPayload], apply: true });
  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [conflictingPayload], apply: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_SOURCE_REVISION_CONFLICT");
      return true;
    },
  );

  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);
});

test("importEventBatch treats retrieval-local provenance changes as a source replay", async () => {
  const vaultRoot = await makeVault("murph-event-batch-source-replay", "UTC");
  const firstPayload = {
    ...buildClinicalMeasurementPayload("2026-03-10T08:00:00.123456Z"),
    occurredAt: "2026-03-10T01:00:00.000Z",
  };
  const replayPayload = {
    ...firstPayload,
    evidence: [{
      rawRef: "raw/clinical/fhir/connection-1/retrieval-2/Observation/page-1.json",
      sourceLabel: "Observation/observation-1",
    }],
    externalRef: {
      ...firstPayload.externalRef,
      version: "2026-03-10T08:00:00.1234560Z",
    },
  };

  const first = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: firstPayload }],
    apply: true,
  });
  await updateVaultSummary({ vaultRoot, timezone: "America/Los_Angeles" });
  const replay = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: replayPayload }],
    apply: true,
  });

  assert.equal(first.createdCount, 1);
  assert.equal(replay.applied, false);
  assert.equal(replay.skippedExistingCount, 1);
  assert.equal(replay.supersededCount, 0);

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      decisions: [{
        action: "upsert",
        payload: {
          ...replayPayload,
          measurements: [{ metric: "heart-rate", unit: "bpm", value: 73 }],
        },
      }],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_SOURCE_REVISION_CONFLICT");
      return true;
    },
  );
  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);
});

test("importEventBatch orders source revisions before changing event kind", async () => {
  const vaultRoot = await makeVault("murph-event-batch-kind-revision-order");
  const current = buildClinicalMeasurementPayload("2026-03-10T08:00:00.123457Z");
  const older = buildClinicalTestPayload("2026-03-10T08:00:00.123456Z");
  const newer = buildClinicalTestPayload("2026-03-10T08:00:00.123458Z");

  const first = await importEventBatch({ vaultRoot, payloads: [current], apply: true });
  const stale = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: older }],
    apply: true,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.skippedExistingCount, 1);

  const replacement = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: newer }],
    apply: true,
  });
  assert.equal(replacement.applied, true);
  assert.equal(replacement.createdCount, 1);
  assert.equal(replacement.supersededCount, 1);

  const records = await readEventShard(vaultRoot, first.eventShardPaths[0]!);
  assert.equal(records.length, 3);
  assert.equal(records[0]!.kind, "measurement");
  assert.equal(records[1]!.kind, "measurement");
  assert.equal(records[1]!.lifecycle?.state, "deleted");
  assert.equal(records[2]!.kind, "test");
  assert.notEqual(records[2]!.id, records[0]!.id);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: replacement.auditPath!,
  }) as AuditRecord[];
  const replacementAudit = auditRecords.at(-1);
  assert.deepEqual(
    new Set(replacementAudit?.targetIds),
    new Set([records[0]!.id, records[2]!.id]),
  );
});

test("importEventBatch applies a newer source retraction and replays it idempotently", async () => {
  const vaultRoot = await makeVault("murph-event-batch-source-retraction");
  const current = buildClinicalMeasurementPayload("2026-03-10T08:00:00.123456Z");
  const first = await importEventBatch({ vaultRoot, payloads: [current], apply: true });
  const retraction = {
    action: "retract" as const,
    externalRef: {
      ...current.externalRef,
      version: "2026-03-10T08:00:00.123457Z",
    },
    reason: "FHIR resource entered in error",
    evidence: [{
      rawRef: "raw/clinical/fhir/connection-1/retrieval-2/Observation/page-1.json",
      sourceLabel: "Observation/observation-1",
    }],
  };

  const stale = await importEventBatch({
    vaultRoot,
    decisions: [{
      ...retraction,
      externalRef: {
        ...retraction.externalRef,
        version: "2026-03-10T08:00:00.123455Z",
      },
    }],
    apply: true,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.retractedCount, 0);
  assert.equal(stale.skippedExistingCount, 1);

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      decisions: [{
        ...retraction,
        externalRef: {
          ...retraction.externalRef,
          version: current.externalRef.version,
        },
      }],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_SOURCE_REVISION_CONFLICT");
      return true;
    },
  );
  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);

  const applied = await importEventBatch({ vaultRoot, decisions: [retraction], apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.createdCount, 0);
  assert.equal(applied.retractedCount, 1);
  assert.equal(applied.skippedExistingCount, 0);

  const replay = await importEventBatch({
    vaultRoot,
    decisions: [{
      ...retraction,
      evidence: [{
        rawRef: "raw/clinical/fhir/connection-1/retrieval-3/Observation/page-1.json",
        sourceLabel: "Observation/observation-1",
      }],
    }],
    apply: true,
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.retractedCount, 0);
  assert.equal(replay.skippedExistingCount, 1);

  const records = await readEventShard(vaultRoot, first.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  assert.equal(records[1]!.id, records[0]!.id);
  assert.equal(records[1]!.lifecycle?.state, "deleted");
  assert.equal(records[1]!.externalRef?.version, "2026-03-10T08:00:00.123457Z");
  assert.deepEqual(records[1]!.evidence, retraction.evidence);
});

test("importEventBatch rejects a versioned retraction when the stored source revision is unordered", async () => {
  const vaultRoot = await makeVault("murph-event-batch-unordered-retraction");
  const payload = buildSleepSessionPayload(10);
  const first = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      decisions: [{
        action: "retract",
        externalRef: {
          ...payload.externalRef,
          version: "2026-03-10T08:00:00.000Z",
        },
        reason: "FHIR resource entered in error",
      }],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_SOURCE_REVISION_UNORDERED");
      return true;
    },
  );

  assert.equal((await readEventShard(vaultRoot, first.eventShardPaths[0]!)).length, 1);
});

test("importEventBatch persists unseen retractions and orders same-batch source revisions", async () => {
  const vaultRoot = await makeVault("murph-event-batch-unseen-retraction");
  const current = buildClinicalMeasurementPayload("2026-03-10T08:00:00.123456Z");
  const retraction = {
    action: "retract" as const,
    externalRef: {
      ...current.externalRef,
      version: "2026-03-10T08:00:00.123457Z",
    },
    reason: "FHIR resource entered in error",
  };

  const marker = await importEventBatch({ vaultRoot, decisions: [retraction], apply: true });
  assert.equal(marker.applied, true);
  assert.equal(marker.createdCount, 0);
  assert.equal(marker.retractedCount, 1);

  const markerReplay = await importEventBatch({ vaultRoot, decisions: [retraction], apply: true });
  assert.equal(markerReplay.applied, false);
  assert.equal(markerReplay.retractedCount, 0);
  assert.equal(markerReplay.skippedExistingCount, 1);

  const stale = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: current }],
    apply: true,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.skippedExistingCount, 1);

  const markerRecords = await readEventShard(vaultRoot, marker.eventShardPaths[0]!);
  assert.equal(markerRecords.length, 1);
  assert.equal(markerRecords[0]!.kind, "note");
  assert.equal(markerRecords[0]!.lifecycle?.state, "deleted");
  assert.equal(markerRecords[0]!.externalRef?.version, retraction.externalRef.version);
  assert.deepEqual(await listHistoryEvents({ vaultRoot }), []);
  assert.equal(await findEventByExternalRef({
    vaultRoot,
    system: retraction.externalRef.system,
    resourceType: retraction.externalRef.resourceType,
    resourceId: retraction.externalRef.resourceId,
  }), null);

  const markerAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: marker.auditPath!,
  }) as AuditRecord[];
  assert.deepEqual(markerAuditRecords.at(-1)?.targetIds, marker.retractedEventIds);

  const advancedRetraction = {
    ...retraction,
    externalRef: {
      ...retraction.externalRef,
      version: "2026-03-10T08:00:00.123458Z",
    },
    reason: "FHIR resource was superseded",
  };
  const advanced = await importEventBatch({
    vaultRoot,
    decisions: [advancedRetraction],
    apply: true,
  });
  assert.equal(advanced.retractedCount, 1);
  assert.deepEqual(advanced.retractedEventIds, marker.retractedEventIds);

  const advancedMarkerRecords = await readEventShard(vaultRoot, marker.eventShardPaths[0]!);
  assert.equal(advancedMarkerRecords.length, 2);
  assert.equal(advancedMarkerRecords[1]!.id, marker.retractedEventIds[0]);
  assert.equal(advancedMarkerRecords[1]!.lifecycle?.state, "deleted");
  assert.equal(advancedMarkerRecords[1]!.externalRef?.version, advancedRetraction.externalRef.version);
  assert.equal(advancedMarkerRecords[1]!.note, advancedRetraction.reason);

  const orderedVaultRoot = await makeVault("murph-event-batch-ordered-retraction");
  const applied = await importEventBatch({
    vaultRoot: orderedVaultRoot,
    decisions: [retraction, { action: "upsert", payload: current }],
    apply: true,
  });
  assert.equal(applied.createdCount, 1);
  assert.equal(applied.retractedCount, 1);
  assert.equal(applied.skippedExistingCount, 0);

  const records = await readEventShard(orderedVaultRoot, applied.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.id, records[1]!.id);
  assert.equal(records[1]!.lifecycle?.state, "deleted");
  assert.equal(records[1]!.externalRef?.version, retraction.externalRef.version);

  const newerVaultRoot = await makeVault("murph-event-batch-stale-unseen-retraction");
  const newer = buildClinicalMeasurementPayload("2026-03-10T08:00:00.123458Z", 73);
  const newerResult = await importEventBatch({
    vaultRoot: newerVaultRoot,
    decisions: [retraction, { action: "upsert", payload: newer }],
    apply: true,
  });
  assert.equal(newerResult.createdCount, 1);
  assert.equal(newerResult.retractedCount, 1);
  assert.equal(newerResult.skippedExistingCount, 0);

  const newerRecords = await readEventShard(newerVaultRoot, newerResult.eventShardPaths[0]!);
  assert.equal(newerRecords.length, 2);
  assert.equal(newerRecords[0]!.lifecycle?.state, "deleted");
  assert.equal(newerRecords[1]!.lifecycle?.state, undefined);
  assert.equal(newerRecords[1]!.externalRef?.version, newer.externalRef.version);
});

test("importEventBatch allows a newer explicit upsert after a persisted unseen retraction", async () => {
  const vaultRoot = await makeVault("murph-event-batch-persisted-retraction-replacement");
  const marker = await importEventBatch({
    vaultRoot,
    decisions: [{
      action: "retract",
      externalRef: {
        ...buildClinicalMeasurementPayload("2026-03-10T08:00:00.123457Z").externalRef,
      },
      reason: "FHIR resource entered in error",
    }],
    apply: true,
  });
  const replacement = buildClinicalTestPayload("2026-03-10T08:00:00.123458Z");

  const applied = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: replacement }],
    apply: true,
  });

  assert.equal(applied.createdCount, 1);
  assert.equal(applied.retractedCount, 0);
  assert.equal(applied.skippedExistingCount, 0);
  assert.notEqual(applied.eventIds[0], marker.retractedEventIds[0]);

  const records = await readEventShard(vaultRoot, marker.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.lifecycle?.state, "deleted");
  assert.equal(records[1]!.id, applied.eventIds[0]);
  assert.equal(records[1]!.externalRef?.version, replacement.externalRef.version);

  const history = await listHistoryEvents({ vaultRoot });
  assert.deepEqual(history.map((record) => record.id), applied.eventIds);
  assert.equal((await findEventByExternalRef({
    vaultRoot,
    system: replacement.externalRef.system,
    resourceType: replacement.externalRef.resourceType,
    resourceId: replacement.externalRef.resourceId,
  }))?.id, applied.eventIds[0]);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: applied.auditPath!,
  }) as AuditRecord[];
  assert.deepEqual(auditRecords.at(-1)?.targetIds, applied.eventIds);
});

test("importEventBatch preserves source ordering after a same-id edit drops externalRef", async () => {
  const vaultRoot = await makeVault("murph-event-batch-historical-source-ref");
  const current = buildClinicalTestPayload("2026-03-10T08:00:00.123456Z");
  const imported = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: current }],
    apply: true,
  });
  const eventId = imported.eventIds[0]!;
  const { externalRef: _externalRef, ...editedPayload } = current;

  await upsertEvent({
    vaultRoot,
    payload: {
      ...editedPayload,
      id: eventId,
      recordedAt: "2026-03-10T09:00:00.000Z",
    },
  });

  const stale = await importEventBatch({
    vaultRoot,
    decisions: [{
      action: "upsert",
      payload: buildClinicalTestPayload("2026-03-10T08:00:00.123455Z"),
    }],
    apply: true,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.skippedExistingCount, 1);

  const editedHistory = await listHistoryEvents({ vaultRoot });
  assert.deepEqual(editedHistory.map((record) => record.id), [eventId]);
  assert.equal(editedHistory[0]!.externalRef, undefined);

  const retraction = await importEventBatch({
    vaultRoot,
    decisions: [{
      action: "retract",
      externalRef: {
        ...current.externalRef,
        version: "2026-03-10T08:00:00.123457Z",
      },
      reason: "FHIR resource entered in error",
    }],
    apply: true,
  });
  assert.equal(retraction.retractedCount, 1);
  assert.deepEqual(retraction.retractedEventIds, [eventId]);
  assert.deepEqual(await listHistoryEvents({ vaultRoot }), []);
  assert.equal(await findEventByExternalRef({
    vaultRoot,
    system: current.externalRef.system,
    resourceType: current.externalRef.resourceType,
    resourceId: current.externalRef.resourceId,
  }), null);

  const records = await readEventShard(vaultRoot, imported.eventShardPaths[0]!);
  assert.equal(records.length, 3);
  assert.equal(records[2]!.id, eventId);
  assert.equal(records[2]!.lifecycle?.state, "deleted");
  assert.equal(records[2]!.externalRef?.version, "2026-03-10T08:00:00.123457Z");
});

test("importEventBatch keeps the newest source tombstone after a revised kind replacement", async () => {
  const vaultRoot = await makeVault("murph-event-batch-kind-retraction-order");
  const versions = [
    "2026-03-10T08:00:00.123451Z",
    "2026-03-10T08:00:00.123452Z",
    "2026-03-10T08:00:00.123453Z",
  ];

  for (const [index, version] of versions.entries()) {
    const result = await importEventBatch({
      vaultRoot,
      decisions: [{
        action: "upsert",
        payload: buildClinicalMeasurementPayload(version, 70 + index),
      }],
      apply: true,
    });
    assert.equal(index === 0 ? result.createdCount : result.supersededCount, 1);
  }

  const replacement = buildClinicalTestPayload("2026-03-10T08:00:00.123454Z");
  const replaced = await importEventBatch({
    vaultRoot,
    decisions: [{ action: "upsert", payload: replacement }],
    apply: true,
  });
  assert.equal(replaced.createdCount, 1);
  assert.equal(replaced.supersededCount, 1);

  const retraction = {
    action: "retract" as const,
    externalRef: {
      ...replacement.externalRef,
      version: "2026-03-10T08:00:00.123455Z",
    },
    reason: "FHIR resource entered in error",
  };
  const retracted = await importEventBatch({
    vaultRoot,
    decisions: [retraction],
    apply: true,
  });
  assert.equal(retracted.retractedCount, 1);

  const replay = await importEventBatch({
    vaultRoot,
    decisions: [retraction],
    apply: true,
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.retractedCount, 0);
  assert.equal(replay.skippedExistingCount, 1);

  const stale = await importEventBatch({
    vaultRoot,
    decisions: [{
      action: "upsert",
      payload: buildClinicalTestPayload("2026-03-10T08:00:00.1234545Z"),
    }],
    apply: true,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.skippedExistingCount, 1);
});

test("importEventBatch keeps legacy payload kind stability after a source retraction", async () => {
  const vaultRoot = await makeVault("murph-event-batch-legacy-kind-after-retraction");
  const current = buildClinicalMeasurementPayload("2026-03-10T08:00:00.123456Z");
  await importEventBatch({ vaultRoot, payloads: [current], apply: true });
  await importEventBatch({
    vaultRoot,
    decisions: [{
      action: "retract",
      externalRef: {
        ...current.externalRef,
        version: "2026-03-10T08:00:00.123457Z",
      },
      reason: "FHIR resource entered in error",
    }],
    apply: true,
  });

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      payloads: [buildClinicalTestPayload("2026-03-10T08:00:00.123458Z")],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_KIND_MISMATCH");
      return true;
    },
  );
});

test("importEventBatch rejects the whole batch when any payload is invalid", async () => {
  const vaultRoot = await makeVault("murph-event-batch-invalid");
  const { title: _title, ...missingTitle } = buildSleepSessionPayload(11);

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      payloads: [buildSleepSessionPayload(10), missingTitle],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      assert.equal(vaultError.details.failureCount, 1);
      const failures = vaultError.details.failures as Array<{ index: number, message: string }>;
      assert.equal(failures[0]!.index, 1);
      return true;
    },
  );

  const dryRun = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10)],
  });
  assert.equal(dryRun.createdCount, 1);
});

test("importEventBatch rejects kinds outside the public event write surface", async () => {
  const vaultRoot = await makeVault("murph-event-batch-kind-gate");

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      payloads: [
        {
          kind: "encounter",
          occurredAt: "2026-03-10T10:00:00.000Z",
          source: "import",
          title: "Annual physical",
          encounterType: "checkup",
        },
      ],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      const failures = vaultError.details.failures as Array<{ index: number, message: string }>;
      assert.match(failures[0]!.message, /not supported by generic event import/u);
      return true;
    },
  );
});

test("importEventBatch routes rows to their monthly shards and reports each touched shard", async () => {
  const vaultRoot = await makeVault("murph-event-batch-shards");
  const aprilPayload = buildSleepSessionPayload(2, {
    occurredAt: "2026-04-02T06:50:00.000Z",
    startAt: "2026-04-02T00:10:00.000Z",
    endAt: "2026-04-02T06:50:00.000Z",
    title: "Sleep 2026-04-02",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: "sleep-2026-04-02",
    },
  });

  const result = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10), aprilPayload],
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(result.createdCount, 2);
  assert.equal(result.eventShardPaths.length, 2);

  const [marchShard, aprilShard] = result.eventShardPaths;
  assert.match(marchShard!, /2026-03/u);
  assert.match(aprilShard!, /2026-04/u);
  assert.equal((await readEventShard(vaultRoot, marchShard!)).length, 1);
  assert.equal((await readEventShard(vaultRoot, aprilShard!)).length, 1);
});

test("importEventBatch preserves append-only rows without externalRef", async () => {
  const vaultRoot = await makeVault("murph-event-batch-no-external-ref");
  const { externalRef: _externalRef, ...payload } = buildSleepSessionPayload(10);

  const first = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });
  assert.equal(first.createdCount, 1);
  assert.equal(first.skippedExistingCount, 0);
  assert.equal(first.supersededCount, 0);

  const second = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });
  assert.equal(second.createdCount, 1);
  assert.equal(second.skippedExistingCount, 0);
  assert.equal(second.supersededCount, 0);

  const records = await readEventShard(vaultRoot, first.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  assert.notEqual(records[0]!.id, records[1]!.id);
  assert.equal(records.every((record) => record.externalRef === undefined), true);
});

test("importEventBatch rejects payloads that carry an explicit event id", async () => {
  const vaultRoot = await makeVault("murph-event-batch-explicit-id");
  const explicitId = `evt_${"0".repeat(26)}`;
  const payload = buildSleepSessionPayload(10, { id: explicitId });

  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [payload], apply: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      const failures = vaultError.details.failures as Array<{ index: number, message: string }>;
      assert.match(failures[0]!.message, /must not carry an explicit event id/u);
      return true;
    },
  );

  const shardPath = "ledger/events/2026/2026-03.jsonl";
  await assert.rejects(fs.access(path.join(vaultRoot, shardPath)));
});

test("importEventBatch rejects caller-supplied dayKey values", async () => {
  const vaultRoot = await makeVault("murph-event-batch-explicit-day-key");
  const payload = buildSleepSessionPayload(10, { dayKey: "2026-03-09" });

  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [payload], apply: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      const failures = vaultError.details.failures as Array<{ index: number, message: string }>;
      assert.match(failures[0]!.message, /failed validation/u);
      return true;
    },
  );

  await assert.rejects(fs.access(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")));
});

test("importEventBatch accepts writable date-only and microsecond timestamps", async () => {
  const vaultRoot = await makeVault("murph-event-batch-date-only", "America/New_York");
  const dateOnlyPayload = buildSleepSessionPayload(12, {
    occurredAt: "2026-03-12",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: "sleep-date-only",
    },
  });
  const microsecondPayload = buildSleepSessionPayload(13, {
    occurredAt: "2026-03-13t13:30:00.123456-05:00",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: "sleep-microseconds",
    },
  });

  const result = await importEventBatch({
    vaultRoot,
    payloads: [dateOnlyPayload, microsecondPayload],
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(result.createdCount, 2);
  assert.deepEqual(result.eventShardPaths, ["ledger/events/2026/2026-03.jsonl"]);

  const records = await readEventShard(vaultRoot, result.eventShardPaths[0]!);
  assert.equal(records[0]?.occurredAt, "2026-03-12T00:00:00.000Z");
  assert.equal(records[0]?.dayKey, "2026-03-12");
  assert.equal(records[1]?.occurredAt, "2026-03-13T18:30:00.123Z");
});

test("importEventBatch rejects legacy offsetless date-times", async () => {
  const vaultRoot = await makeVault("murph-event-batch-offsetless", "America/New_York");
  const payload = buildSleepSessionPayload(10, { occurredAt: "2026-03-12T23:30:00" });

  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [payload], apply: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      const failures = vaultError.details.failures as Array<{ index: number, message: string }>;
      assert.match(failures[0]!.message, /failed validation/u);
      return true;
    },
  );

  await assert.rejects(fs.access(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")));
});

test("importEventBatch supersedes an existing externalRef across monthly shards", async () => {
  const vaultRoot = await makeVault("murph-event-batch-cross-shard");

  const first = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10)],
    apply: true,
  });
  assert.equal(first.createdCount, 1);
  const marchShard = first.eventShardPaths[0]!;
  assert.match(marchShard, /2026-03/u);

  // Same externalRef, corrected occurredAt that moves the row into April:
  // the import must supersede the March event vault-wide, not mint a
  // duplicate because the target shard changed.
  const correctedPayload = buildSleepSessionPayload(10, {
    occurredAt: "2026-04-01T06:50:00.000Z",
    startAt: "2026-04-01T00:10:00.000Z",
    endAt: "2026-04-01T06:50:00.000Z",
  });
  const second = await importEventBatch({
    vaultRoot,
    payloads: [correctedPayload],
    apply: true,
  });

  assert.equal(second.applied, true);
  assert.equal(second.createdCount, 0);
  assert.equal(second.skippedExistingCount, 0);
  assert.equal(second.supersededCount, 1);
  assert.equal(second.eventShardPaths.length, 1);
  const aprilShard = second.eventShardPaths[0]!;
  assert.match(aprilShard, /2026-04/u);

  const marchRecords = await readEventShard(vaultRoot, marchShard);
  const aprilRecords = await readEventShard(vaultRoot, aprilShard);
  assert.equal(marchRecords.length, 1);
  assert.equal(aprilRecords.length, 1);
  assert.equal(aprilRecords[0]!.id, marchRecords[0]!.id);
  assert.equal(aprilRecords[0]!.lifecycle?.revision, 2);

  // Re-importing the corrected row stays idempotent against the April copy.
  const third = await importEventBatch({
    vaultRoot,
    payloads: [correctedPayload],
    apply: true,
  });
  assert.equal(third.createdCount, 0);
  assert.equal(third.supersededCount, 0);
  assert.equal(third.skippedExistingCount, 1);
  assert.equal((await readEventShard(vaultRoot, aprilShard)).length, 1);
});

test("importEventBatch treats rawRefs changes as content changes", async () => {
  const vaultRoot = await makeVault("murph-event-batch-raw-refs");

  const first = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10, { rawRefs: ["raw/notes/source-a.md"] })],
    apply: true,
  });
  assert.equal(first.createdCount, 1);

  const identicalRerun = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10, { rawRefs: ["raw/notes/source-a.md"] })],
    apply: true,
  });
  assert.equal(identicalRerun.skippedExistingCount, 1);
  assert.equal(identicalRerun.supersededCount, 0);

  // A rawRefs-only correction carries caller-supplied provenance, so it must
  // supersede the stored event instead of being skipped as identical.
  const correctedRefs = await importEventBatch({
    vaultRoot,
    payloads: [buildSleepSessionPayload(10, { rawRefs: ["raw/notes/source-b.md"] })],
    apply: true,
  });
  assert.equal(correctedRefs.supersededCount, 1);
  assert.equal(correctedRefs.createdCount, 0);

  const records = await readEventShard(vaultRoot, correctedRefs.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  const revision = records[1]!;
  assert.equal(revision.lifecycle?.revision, 2);
  assert.deepEqual(revision.rawRefs, ["raw/notes/source-b.md"]);
});

test("importEventBatch rejects kind rewrites through a shared externalRef", async () => {
  const vaultRoot = await makeVault("murph-event-batch-kind-stability");
  const initialPayload = buildSleepSessionPayload(10);

  const first = await importEventBatch({
    vaultRoot,
    payloads: [{
      ...initialPayload,
      externalRef: {
        ...initialPayload.externalRef,
        version: "2026-03-10T08:00:00.000Z",
      },
    }],
    apply: true,
  });
  assert.equal(first.createdCount, 1);
  const shardPath = first.eventShardPaths[0]!;
  assert.equal((await readEventShard(vaultRoot, shardPath)).length, 1);

  // Same externalRef identity (system + resourceType + resourceId, no facet)
  // but a different kind: the spine is kind-stable, so the whole batch must
  // reject atomically instead of superseding the sleep_session.
  const conflictingKind = {
    kind: "observation",
    occurredAt: "2026-03-10T06:50:00.000Z",
    source: "device",
    title: "Sleep efficiency 2026-03-10",
    metric: "sleep-efficiency",
    value: 97,
    unit: "%",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: "sleep-2026-03-10",
      version: "2026-03-10T09:00:00.000Z",
    },
  };

  await assert.rejects(
    importEventBatch({
      vaultRoot,
      payloads: [conflictingKind],
      apply: true,
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_KIND_MISMATCH");
      assert.match(vaultError.message, /already belongs to kind "sleep_session"/u);
      return true;
    },
  );

  const records = await readEventShard(vaultRoot, shardPath);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.kind, "sleep_session");
});

test("importEventBatch enforces batch-shape invariants in core", async () => {
  const vaultRoot = await makeVault("murph-event-batch-shape");

  await assert.rejects(
    importEventBatch({ vaultRoot, payloads: [] }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_BATCH_EMPTY");
      return true;
    },
  );

  // Boundary probe: importEventBatch is public API, so its runtime guards
  // must reject rows that bypass the TypeScript signature.
  await assert.rejects(
    importEventBatchFromRuntime({ vaultRoot, payloads: [null] }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_BATCH_INVALID");
      assert.match(vaultError.message, /payload 1 must be a plain object/u);
      return true;
    },
  );

  await assert.rejects(
    importEventBatchFromRuntime({ vaultRoot, payloads: {} }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_BATCH_INVALID");
      return true;
    },
  );

  await assert.rejects(
    importEventBatchFromRuntime({
      vaultRoot,
      payloads: [buildSleepSessionPayload(10)],
      decisions: [{ action: "upsert", payload: buildClinicalMeasurementPayload("2026-03-10T08:00:00.000Z") }],
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "EVENT_BATCH_INVALID");
      assert.match((error as VaultError).message, /exactly one of payloads or decisions/u);
      return true;
    },
  );
});

test("importEventBatch dedupes rows that repeat within one batch", async () => {
  const vaultRoot = await makeVault("murph-event-batch-within-batch");
  const payload = buildSleepSessionPayload(10);

  const result = await importEventBatch({
    vaultRoot,
    payloads: [payload, payload],
    apply: true,
  });

  assert.equal(result.receivedCount, 2);
  assert.equal(result.createdCount, 1);
  assert.equal(result.skippedExistingCount, 1);

  const records = await readEventShard(vaultRoot, result.eventShardPaths[0]!);
  assert.equal(records.length, 1);
});
