import assert from "node:assert/strict";
import nodeFs, { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

import { test, vi } from "vitest";

import * as ingests from "../src/integration-ingests.ts";
import {
  importDeviceBatch,
  initializeVault,
  readEvent,
  readIntegrationIngestById,
} from "../src/index.ts";

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-import-preparation-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

function input(vaultRoot: string, value = 1) {
  return {
    vaultRoot,
    provider: "synthetic",
    accountId: "synthetic-account",
    importedAt: "2026-01-02T00:00:00.000Z",
    events: [{
      kind: "observation" as const,
      occurredAt: "2026-01-01T12:00:00.000Z",
      externalRef: { system: "synthetic", resourceType: "metric", resourceId: "sample" },
      fields: { metric: "synthetic-metric", unit: "count", value },
      evidenceRoles: ["synthetic-evidence"],
    }],
    evidenceParts: [{ role: "synthetic-evidence", fileName: "sample.json", content: { value } }],
  };
}

test("new and corrected device imports inspect evidence once when delivery history is complete", async () => {
  await withVault(async (vaultRoot) => {
    const inspection = vi.spyOn(ingests, "inspectIntegrationIngestHistory");
    try {
      const first = await importDeviceBatch(input(vaultRoot));
      assert.equal(first.applied, true);
      assert.equal(inspection.mock.calls.length, 1);
      inspection.mockClear();

      const corrected = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(corrected.applied, true);
      assert.equal(inspection.mock.calls.length, 1);
      assert.equal(corrected.events[0]?.id, first.events[0]?.id);
      assert.equal(corrected.events[0]?.lifecycle?.revision, 2);
      const event = await readEvent({ vaultRoot, eventId: corrected.events[0]!.id });
      assert.ok(event.event.kind === "observation");
      assert.equal(event.event.value, 2);
      assert.ok(corrected.ingestId);
      assert.ok(await readIntegrationIngestById(vaultRoot, corrected.ingestId));
      inspection.mockClear();

      const replay = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(replay.applied, false);
      assert.equal(inspection.mock.calls.length, 1);
    } finally {
      inspection.mockRestore();
    }
  });
});

test("one full shard inspection proves a duplicate beyond the bounded tail and prepares a correction once", async () => {
  await withVault(async (vaultRoot) => {
    const first = await importDeviceBatch(input(vaultRoot));
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    const stored = await readIntegrationIngestById(vaultRoot, first.ingestId);
    assert.ok(stored);
    // Unrelated rows push the original delivery outside the bounded tail.
    const unrelated = Array.from({ length: 65 }, (_, index) => JSON.stringify({
      ...stored.record,
      id: `xfm_${index.toString(16).padStart(24, "0")}`,
      provider: "unrelated",
      provenance: { padding: "x".repeat(140_000) },
    })).join("\n") + "\n";
    await fs.appendFile(path.join(vaultRoot, first.ingestShardPath), unrelated);
    const inspection = vi.spyOn(ingests, "inspectIntegrationIngestHistory");
    const reads = vi.spyOn(nodeFs, "createReadStream");
    syncBuiltinESMExports();
    // Publication separately hashes bytes for the canonical journal receipt.
    const shardReads = () => reads.mock.calls.filter(([file, options]) =>
      String(file).endsWith(`/${first.ingestShardPath}`)
      && typeof options === "object" && options?.encoding === "utf8"
    ).length;
    try {
      const replay = await importDeviceBatch(input(vaultRoot));
      assert.equal(replay.applied, false);
      assert.equal(inspection.mock.calls.length, 1);
      assert.equal(shardReads(), 1);
      assert.equal(reads.mock.calls.filter(([file]) =>
        String(file).endsWith(`/${first.ingestShardPath}`)
      ).length, 1);
      inspection.mockClear();
      reads.mockClear();
      const laterDelivery = await importDeviceBatch({
        ...input(vaultRoot), importedAt: "2026-01-03T00:00:00.000Z",
      });
      assert.equal(laterDelivery.applied, false);
      assert.equal(inspection.mock.calls.length, 1);
      assert.equal(shardReads(), 1);
      assert.equal(reads.mock.calls.filter(([file]) =>
        String(file).endsWith(`/${first.ingestShardPath}`)
      ).length, 1);
      inspection.mockClear();
      reads.mockClear();
      const corrected = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(corrected.applied, true);
      assert.equal(inspection.mock.calls.length, 1);
      assert.equal(shardReads(), 1);
      assert.equal(corrected.events[0]?.id, first.events[0]?.id);
      assert.equal(corrected.events[0]?.lifecycle?.revision, 2);
    } finally {
      reads.mockRestore();
      syncBuiltinESMExports();
      inspection.mockRestore();
    }
  });
});

test("recent evidence beyond 64 rows uses the byte prefilter without a full scan", async () => {
  await withVault(async (vaultRoot) => {
    const first = await importDeviceBatch(input(vaultRoot));
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    const stored = await readIntegrationIngestById(vaultRoot, first.ingestId);
    assert.ok(stored);
    const unrelated = Array.from({ length: 300 }, (_, index) => JSON.stringify({
      ...stored.record,
      id: `xfm_${index.toString(16).padStart(24, "0")}`,
      provider: "unrelated",
      parts: [],
      outputs: { events: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true },
      counts: { eventCount: 0, sampleCount: 0 },
    })).join("\n") + "\n";
    await fs.appendFile(path.join(vaultRoot, first.ingestShardPath), unrelated);
    const reads = vi.spyOn(nodeFs, "createReadStream");
    syncBuiltinESMExports();
    const parses = vi.spyOn(JSON, "parse");
    try {
      const replay = await importDeviceBatch({
        ...input(vaultRoot), importedAt: "2026-01-03T00:00:00.000Z",
      });
      assert.equal(replay.applied, false);
      assert.equal(reads.mock.calls.filter(([file]) =>
        String(file).endsWith(`/${first.ingestShardPath}`)
      ).length, 0);
      assert.equal(parses.mock.calls.filter(([text]) => text.includes('"provider":"unrelated"')).length, 64);
    } finally {
      parses.mockRestore();
      reads.mockRestore();
      syncBuiltinESMExports();
    }
  });
});
