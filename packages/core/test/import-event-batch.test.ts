import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord } from "@murphai/contracts";

import {
  importEventBatch,
  initializeVault,
  readJsonlRecords,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function makeVault(name: string): Promise<string> {
  const vaultRoot = await makeTempDirectory(name);
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T12:00:00.000Z" });
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

async function readEventShard(vaultRoot: string, relativePath: string): Promise<EventRecord[]> {
  const records = await readJsonlRecords({ vaultRoot, relativePath });
  return records as EventRecord[];
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

  const recordsAfterRerun = await readEventShard(vaultRoot, shardPath);
  assert.equal(recordsAfterRerun.length, 4);
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

test("importEventBatch appends rows without externalRef on every apply instead of deduping", async () => {
  const vaultRoot = await makeVault("murph-event-batch-no-external-ref");
  const { externalRef: _externalRef, ...payload } = buildSleepSessionPayload(10);

  const first = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });
  assert.equal(first.createdCount, 1);
  assert.equal(first.skippedExistingCount, 0);

  const second = await importEventBatch({ vaultRoot, payloads: [payload], apply: true });
  assert.equal(second.applied, true);
  assert.equal(second.createdCount, 1);
  assert.equal(second.skippedExistingCount, 0);

  const records = await readEventShard(vaultRoot, second.eventShardPaths[0]!);
  assert.equal(records.length, 2);
  assert.notEqual(records[0]!.id, records[1]!.id);
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
