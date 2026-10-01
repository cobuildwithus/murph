import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  appendBloodTest,
  appendJsonlRecord,
  initializeVault,
  readCanonicalEventAvailabilityInterruptible,
  VaultError,
} from "../src/index.ts";

const occurredAt = "2026-08-01T12:00:00.000Z";
const shardPath = "ledger/events/2026/2026-08.jsonl";
const emptyAvailability = {
  interrupted: false,
  latestBloodPressureMeasurementDayKey: null,
  latestBloodPressureMeasurementOccurredAt: null,
  latestBloodTestOccurredAt: null,
  latestBodyMeasurementDayKey: null,
  latestBodyMeasurementOccurredAt: null,
};

function observation(metric: string, revision: number, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "murph.event.v1",
    id: "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F7",
    kind: "observation",
    metric,
    value: 72,
    unit: metric === "weight" ? "kg" : "count",
    source: "device",
    title: "Synthetic observation",
    occurredAt,
    recordedAt: occurredAt,
    dayKey: "2026-08-01",
    externalRef: { system: "synthetic", resourceType: "metric", resourceId: "sample" },
    lifecycle: { revision },
    ...extra,
  };
}

const relevant = observation("weight", 1);
const unrelated = observation("daily-steps", 2, { note: "Synthetic payload. ".repeat(200) });
const deletedUnrelated = observation("daily-steps", 2, {
  lifecycle: { revision: 2, state: "deleted" },
});
const cases = [
  { name: "relevant then unrelated", records: [relevant, unrelated], available: false },
  { name: "unrelated then older relevant", records: [unrelated, relevant], available: false },
  { name: "unrelated then relevant", records: [observation("daily-steps", 1), observation("weight", 2)], available: true },
  { name: "relevant then older unrelated", records: [observation("weight", 2), observation("daily-steps", 1)], available: true },
  { name: "unrelated tombstone supersedes relevant", records: [relevant, deletedUnrelated], available: false },
  { name: "new relevant revision follows unrelated tombstone", records: [deletedUnrelated, observation("weight", 3)], available: true },
  { name: "equal revision retains first relevant", records: [relevant, observation("daily-steps", 1)], available: true },
  { name: "equal revision retains first unrelated", records: [observation("daily-steps", 1), relevant], available: false },
  { name: "latest unrelated suppresses malformed relevant payload", records: [observation("weight", 1, { unit: null }), unrelated], available: false },
  { name: "latest malformed unrelated payload still suppresses relevant", records: [relevant, observation("daily-steps", 2, { unit: null })], available: false },
] as const;

for (const scenario of cases) {
  test(`canonical availability preserves observation ordering: ${scenario.name}`, async () => {
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-availability-order-"));
    try {
      await initializeVault({ vaultRoot });
      for (const record of scenario.records) {
        await appendJsonlRecord({ vaultRoot, relativePath: shardPath, record });
      }
      const actual = await readCanonicalEventAvailabilityInterruptible({ vaultRoot });
      assert.deepEqual(actual, {
        ...emptyAvailability,
        latestBodyMeasurementDayKey: scenario.available ? "2026-08-01" : null,
        latestBodyMeasurementOccurredAt: scenario.available ? occurredAt : null,
      });
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { name: "relevant observation", record: observation("weight", 2, { unit: null }), code: "EVENT_CONTRACT_INVALID" },
  { name: "unrelated history record", record: { ...observation("daily-steps", 2), kind: "procedure" }, code: "VAULT_INVALID_INPUT" },
]) {
  test(`canonical availability retains validation failure for malformed ${scenario.name}`, async () => {
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-availability-invalid-"));
    try {
      await initializeVault({ vaultRoot });
      await appendJsonlRecord({ vaultRoot, relativePath: shardPath, record: observation("daily-steps", 1) });
      await appendJsonlRecord({ vaultRoot, relativePath: shardPath, record: scenario.record });
      await assert.rejects(
        readCanonicalEventAvailabilityInterruptible({ vaultRoot }),
        (error: unknown) => error instanceof VaultError && error.code === scenario.code,
      );
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });
}


test("canonical availability keeps blood-test identity through unrelated observation revisions", async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-availability-blood-revision-"));
  try {
    await initializeVault({ vaultRoot });
    const blood = await appendBloodTest({ vaultRoot, occurredAt, recordedAt: occurredAt, title: "Synthetic panel", testName: "synthetic-panel" });
    await appendJsonlRecord({
      vaultRoot,
      relativePath: blood.relativePath,
      record: { ...observation("daily-steps", 2), id: blood.record.id },
    });
    assert.deepEqual(await readCanonicalEventAvailabilityInterruptible({ vaultRoot }), emptyAvailability);
    await appendJsonlRecord({
      vaultRoot,
      relativePath: blood.relativePath,
      record: { ...blood.record, lifecycle: { revision: 3 } },
    });
    assert.deepEqual(await readCanonicalEventAvailabilityInterruptible({ vaultRoot }), {
      ...emptyAvailability,
      latestBloodTestOccurredAt: occurredAt,
    });
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
