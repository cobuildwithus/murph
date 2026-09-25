import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
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
    const novelty = vi.spyOn(ingests, "selectNovelIntegrationIngestEvidence");
    try {
      const first = await importDeviceBatch(input(vaultRoot));
      assert.equal(first.applied, true);
      assert.equal(novelty.mock.calls.length, 1);
      novelty.mockClear();

      const corrected = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(corrected.applied, true);
      assert.equal(novelty.mock.calls.length, 1);
      assert.equal(corrected.events[0]?.id, first.events[0]?.id);
      assert.equal(corrected.events[0]?.lifecycle?.revision, 2);
      const event = await readEvent({ vaultRoot, eventId: corrected.events[0]!.id });
      assert.ok(event.event.kind === "observation");
      assert.equal(event.event.value, 2);
      assert.ok(corrected.ingestId);
      assert.ok(await readIntegrationIngestById(vaultRoot, corrected.ingestId));
      novelty.mockClear();

      const replay = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(replay.applied, false);
      assert.equal(novelty.mock.calls.length, 0);
    } finally {
      novelty.mockRestore();
    }
  });
});

test("device imports rebuild preparation when the bounded inspection expands to full history", async () => {
  await withVault(async (vaultRoot) => {
    const first = await importDeviceBatch(input(vaultRoot));
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    const stored = await readIntegrationIngestById(vaultRoot, first.ingestId);
    assert.ok(stored);
    // Unrelated rows push the original delivery outside the bounded tail.
    const unrelated = `${JSON.stringify({ ...stored.record, id: "xfm_00000000000000000000000000", provider: "unrelated" })}\n`;
    await fs.appendFile(path.join(vaultRoot, first.ingestShardPath), unrelated.repeat(65));
    const inspection = vi.spyOn(ingests, "inspectIntegrationIngestIdsForImportedAt");
    const novelty = vi.spyOn(ingests, "selectNovelIntegrationIngestEvidence");
    try {
      const corrected = await importDeviceBatch(input(vaultRoot, 2));
      assert.equal(corrected.applied, true);
      assert.equal(inspection.mock.calls.filter((call) => call[3]?.fullScan).length, 1);
      assert.equal(novelty.mock.calls.length, 2);
      assert.equal(corrected.events[0]?.id, first.events[0]?.id);
      assert.equal(corrected.events[0]?.lifecycle?.revision, 2);
    } finally {
      inspection.mockRestore();
      novelty.mockRestore();
    }
  });
});
