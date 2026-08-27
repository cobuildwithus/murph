import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  createDeviceBatchImportSession,
  importDeviceBatch,
  initializeVault,
  type DeviceBatchImportTiming,
} from "../src/index.ts";

function buildObservation(resourceId: string, occurredAt: string, value: number) {
  return {
    kind: "observation" as const,
    occurredAt,
    recordedAt: occurredAt,
    title: "Synthetic observation",
    externalRef: {
      system: "synthetic",
      resourceType: "metric",
      resourceId,
      version: occurredAt,
    },
    fields: {
      metric: "synthetic-metric",
      unit: "count",
      value,
    },
  };
}

async function withTempVault(
  operation: (vaultRoot: string) => Promise<void>,
): Promise<void> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-device-import-session-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await operation(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

test("reuses a large event identity index only for non-overlapping imports", async () => {
  await withTempVault(async (vaultRoot) => {
    const start = Date.parse("2020-01-01T00:00:00.000Z");
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: "2026-01-01T00:00:00.000Z",
      events: Array.from({ length: 1_000 }, (_, index) => {
        const occurredAt = new Date(start + index * 60_000).toISOString();
        return buildObservation(`seed-${index}`, occurredAt, index);
      }),
    });

    const session = createDeviceBatchImportSession();
    const timings: DeviceBatchImportTiming[] = [];
    const firstAt = "2026-01-02T00:00:00.000Z";
    const first = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: firstAt,
      events: [buildObservation("incremental-a", firstAt, 1)],
    }, {
      session,
      onTiming: (timing) => timings.push(timing),
    });
    const secondAt = "2026-01-03T00:00:00.000Z";
    const second = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: secondAt,
      events: [buildObservation("incremental-b", secondAt, 2)],
    }, {
      session,
      onTiming: (timing) => timings.push(timing),
    });

    assert.equal(timings[0]?.eventIdentityIndexCacheHit, false);
    assert.equal(timings[1]?.eventIdentityIndexCacheHit, true);
    assert.equal(first.events.length, 1);
    assert.equal(second.events.length, 1);

    const correctionAt = "2026-01-04T00:00:00.000Z";
    const correction = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: correctionAt,
      events: [buildObservation("incremental-a", correctionAt, 3)],
    }, {
      session,
      onTiming: (timing) => timings.push(timing),
    });

    assert.equal(timings[2]?.eventIdentityIndexCacheHit, false);
    assert.equal(correction.events[0]?.id, first.events[0]?.id);
    assert.equal(correction.events[0]?.lifecycle?.revision, 2);

    const externalAt = "2026-01-05T00:00:00.000Z";
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: externalAt,
      events: [buildObservation("outside-session", externalAt, 4)],
    });
    const afterExternalAt = "2026-01-06T00:00:00.000Z";
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: afterExternalAt,
      events: [buildObservation("after-outside-session", afterExternalAt, 5)],
    }, {
      session,
      onTiming: (timing) => timings.push(timing),
    });
    assert.equal(timings[3]?.eventIdentityIndexCacheHit, false);
  });
}, 30_000);

test("does not seed an empty event identity cache from a sample-only import", async () => {
  await withTempVault(async (vaultRoot) => {
    const persistedAt = "2026-01-02T00:00:00.000Z";
    const persisted = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: persistedAt,
      events: [buildObservation("existing", persistedAt, 1)],
    });
    const session = createDeviceBatchImportSession();
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: "2026-01-03T00:00:00.000Z",
      samples: [{
        recordedAt: "2026-01-03T00:00:00.000Z",
        stream: "heart_rate",
        unit: "bpm",
        sample: {
          recordedAt: "2026-01-03T00:00:00.000Z",
          value: 60,
        },
      }],
    }, { session });

    let replayTiming: DeviceBatchImportTiming | undefined;
    const replay = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: "2026-01-04T00:00:00.000Z",
      events: [buildObservation("existing", "2026-01-04T00:00:00.000Z", 2)],
    }, {
      session,
      onTiming: (timing) => {
        replayTiming = timing;
      },
    });

    assert.equal(replayTiming?.eventIdentityIndexCacheHit, false);
    assert.equal(replay.events[0]?.id, persisted.events[0]?.id);
    assert.equal(replay.events[0]?.lifecycle?.revision, 2);
  });
});

test("does not fail a committed import when the timing observer throws", async () => {
  await withTempVault(async (vaultRoot) => {
    const occurredAt = "2026-01-02T00:00:00.000Z";
    const result = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: occurredAt,
      events: [buildObservation("timing-observer", occurredAt, 1)],
    }, {
      onTiming: () => {
        throw new Error("synthetic timing observer failure");
      },
    });

    assert.equal(result.applied, true);
    assert.equal(result.events.length, 1);
  });
});
