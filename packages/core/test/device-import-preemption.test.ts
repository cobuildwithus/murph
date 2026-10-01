import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test, vi } from "vitest";

import * as eventLedger from "../src/event-ledger-storage.ts";
import * as integrationIngests from "../src/integration-ingests.ts";
import * as writeBatch from "../src/operations/write-batch.ts";
import {
  createDeviceBatchImportSession,
  importDeviceBatch,
  initializeVault,
  inspectCanonicalWriteLock,
} from "../src/index.ts";

function observation(resourceId: string, occurredAt: string) {
  return {
    kind: "observation" as const,
    occurredAt,
    recordedAt: occurredAt,
    title: "Synthetic observation",
    externalRef: { system: "synthetic", resourceType: "metric", resourceId },
    fields: { metric: "synthetic-metric", unit: "count", value: 1 },
  };
}

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-device-preemption-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

test("device import rejects an already-aborted request before locking or writing", async () => {
  await withVault(async (vaultRoot) => {
    const controller = new AbortController();
    const reason = new Error("synthetic foreground request");
    controller.abort(reason);
    await assert.rejects(importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      events: [observation("pending", "2026-02-01T00:00:00.000Z")],
    }, { signal: controller.signal }), (error) => error === reason);
    assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
    assert.deepEqual(await eventLedger.listEventLedgerShardPaths(vaultRoot), []);
  });
});

test("timer-driven device import preemption releases the canonical lock and retries from durable truth", async () => {
  await withVault(async (vaultRoot) => {
    const seed = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      events: Array.from({ length: 1_024 }, (_, index) =>
        observation(`seed-${index}`, "2026-01-01T00:00:00.000Z")),
    });
    const seedPath = seed.eventShardPaths[0];
    assert.ok(seedPath);
    const before = await fs.readFile(path.join(vaultRoot, seedPath));
    const session = createDeviceBatchImportSession();
    const controller = new AbortController();
    const reason = new Error("synthetic foreground request");
    const realVisit = eventLedger.visitEventLedgerShardRecordsInterruptible;
    let visited = 0;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const spy = vi.spyOn(eventLedger, "visitEventLedgerShardRecordsInterruptible")
      .mockImplementation((input) => realVisit({
        ...input,
        visit(record, lineNumber) {
          visited += 1;
          if (visited === 1) {
            abortTimer = setTimeout(() => controller.abort(reason), 0);
          }
          return input.visit(record, lineNumber);
        },
      }));
    const request = {
      vaultRoot,
      provider: "synthetic",
      events: [observation("pending", "2026-02-01T00:00:00.000Z")],
    };
    try {
      await assert.rejects(importDeviceBatch(request, {
        session,
        signal: controller.signal,
      }), (error) => error === reason);
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
      spy.mockRestore();
    }
    assert.ok(visited > 0 && visited < 1_024);
    assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
    assert.deepEqual(await eventLedger.listEventLedgerShardPaths(vaultRoot), [seedPath]);
    assert.deepEqual(await fs.readFile(path.join(vaultRoot, seedPath)), before);
    let cacheHit: boolean | undefined;
    const resumed = await importDeviceBatch(request, {
      session,
      onTiming: (timing) => { cacheHit = timing.eventIdentityIndexCacheHit; },
    });
    assert.equal(resumed.applied, true);
    assert.equal(cacheHit, false);
    assert.equal(resumed.events.length, 1);
    const replay = await importDeviceBatch(request);
    assert.equal(replay.applied, false);
    assert.equal(replay.events[0]?.id, resumed.events[0]?.id);
  });
}, 30_000);

test("device import finishes atomic publication when cancellation arrives after commit starts", async () => {
  await withVault(async (vaultRoot) => {
    const controller = new AbortController();
    const request = {
      vaultRoot,
      provider: "synthetic",
      events: [observation("committed", "2026-02-01T00:00:00.000Z")],
    };
    const realWrite = writeBatch.runCanonicalWrite;
    const spy = vi.spyOn(writeBatch, "runCanonicalWrite").mockImplementation((input) => {
      controller.abort(new Error("synthetic foreground request"));
      return realWrite(input);
    });
    let result: Awaited<ReturnType<typeof importDeviceBatch>>;
    try {
      result = await importDeviceBatch(request, { signal: controller.signal });
    } finally {
      spy.mockRestore();
    }
    assert.equal(controller.signal.aborted, true);
    assert.equal(result.applied, true);
    assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
    const replay = await importDeviceBatch(request);
    assert.equal(replay.applied, false);
    assert.equal(replay.events[0]?.id, result.events[0]?.id);
  });
});


test("device import preserves a preparation failure that coincides with cancellation", async () => {
  await withVault(async (vaultRoot) => {
    const controller = new AbortController();
    const failure = new Error("synthetic stored-evidence failure");
    const spy = vi.spyOn(integrationIngests, "selectNovelIntegrationIngestEvidence")
      .mockImplementation(async () => {
        controller.abort(new Error("synthetic foreground request"));
        throw failure;
      });
    const request = {
      vaultRoot,
      provider: "synthetic",
      events: [observation("pending", "2026-02-01T00:00:00.000Z")],
      evidenceParts: [{ role: "snapshot", fileName: "snapshot.json", content: { synthetic: true } }],
    };
    try {
      await assert.rejects(importDeviceBatch(request, {
        signal: controller.signal,
      }), (error) => error === failure);
      assert.equal(spy.mock.calls.length, 1);
    } finally {
      spy.mockRestore();
    }
    assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
    assert.deepEqual(await eventLedger.listEventLedgerShardPaths(vaultRoot), []);
    const resumed = await importDeviceBatch(request);
    assert.equal(resumed.applied, true);
  });
});
