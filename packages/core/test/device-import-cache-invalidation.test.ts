import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import * as contracts from "@murphai/contracts";
import * as publication from "../src/operations/write-batch.ts";
import { deterministicContractId, importDeviceBatch, initializeVault, type DeviceBatchImportTiming } from "../src/index.ts";

function input(vaultRoot: string, day: number) {
  const at = `2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  return { vaultRoot, provider: "synthetic", importedAt: at, events: [{
    kind: "observation" as const, occurredAt: at, recordedAt: at,
    externalRef: { system: "synthetic", resourceType: "metric", resourceId: `sample-${day}` },
    fields: { metric: "synthetic-metric", unit: "count", value: day },
  }] };
}

async function withVault(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "identity-cache-"));
  try {
    await initializeVault({ vaultRoot: root, createdAt: "2026-01-01T00:00:00.000Z" });
    await run(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

for (const change of ["append", "delete", "replace", "vault replacement"] as const) {
  test(`rebuilds after an unobserved ${change}`, async () => withVault(async (root) => {
    const seed = await importDeviceBatch(input(root, 1));
    const shard = path.join(root, seed.eventShardPaths[0]!);
    const original = await fs.readFile(shard);
    let timing: DeviceBatchImportTiming | undefined;
    const options = { onTiming: (value: DeviceBatchImportTiming) => { timing = value; } };
    await importDeviceBatch(input(root, 2), options);
    assert.equal(timing?.eventIdentityIndexCacheHit, true);
    if (change === "append") {
      await fs.appendFile(shard, JSON.stringify({ ...seed.events[0], id: deterministicContractId("evt", "external") }) + "\n");
    } else if (change === "delete") {
      await fs.unlink(shard);
    } else if (change === "replace") {
      await fs.rename(shard, `${shard}.old`);
      await fs.writeFile(shard, original);
      await fs.unlink(`${shard}.old`);
    } else {
      // Preserve shard inodes and timestamps while replacing just the root.
      await fs.rename(root, `${root}-old`);
      await fs.mkdir(root);
      for (const child of await fs.readdir(`${root}-old`)) {
        await fs.rename(path.join(`${root}-old`, child), path.join(root, child));
      }
      await fs.rmdir(`${root}-old`);
    }
    await importDeviceBatch(input(root, 3), options);
    assert.equal(timing?.eventIdentityIndexCacheHit, false);
    await importDeviceBatch(input(root, 4), options);
    assert.equal(timing?.eventIdentityIndexCacheHit, true);
  }));
}

for (const afterCommit of [false, true]) {
  test(`publication failure ${afterCommit ? "after" : "before"} commit discards cached state`, async () => withVault(async (root) => {
    await importDeviceBatch(input(root, 1));
    const realWrite = publication.runCanonicalWrite;
    const spy = vi.spyOn(publication, "runCanonicalWrite").mockImplementation(async (request) => {
      if (afterCommit) await realWrite(request);
      throw new Error("Synthetic uncertain publication");
    });
    try {
      await assert.rejects(importDeviceBatch(input(root, 2)), /Synthetic uncertain publication/);
    } finally {
      spy.mockRestore();
    }
    let hit: boolean | undefined;
    await importDeviceBatch(input(root, 2), { onTiming: (timing) => { hit = timing.eventIdentityIndexCacheHit; } });
    assert.equal(hit, false);
  }));
}

test("reducer failure evicts without failing a committed import", async () => withVault(async (root) => {
  await importDeviceBatch(input(root, 1));
  const realWrite = publication.runCanonicalWrite;
  let committed = false;
  const writeSpy = vi.spyOn(publication, "runCanonicalWrite").mockImplementation(async (request) => {
    const result = await realWrite(request);
    committed = true;
    return result;
  });
  const realParse = contracts.safeParseContract;
  const parseSpy = vi.spyOn(contracts, "safeParseContract").mockImplementation((schema, value) => {
    if (committed) throw new Error("Synthetic reducer failure");
    return realParse(schema, value);
  });
  try {
    assert.equal((await importDeviceBatch(input(root, 2))).applied, true);
  } finally {
    writeSpy.mockRestore();
    parseSpy.mockRestore();
  }
  let hit: boolean | undefined;
  await importDeviceBatch(input(root, 3), { onTiming: (timing) => { hit = timing.eventIdentityIndexCacheHit; } });
  assert.equal(hit, false);
}));

test("capacity counts revisions, and a different resident vault evicts the prior vault", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  const shard = path.join(root, seed.eventShardPaths[0]!);
  await fs.writeFile(shard, (JSON.stringify(seed.events[0]) + "\n").repeat(100_001));
  const hits: boolean[] = [];
  const options = { onTiming: (timing: DeviceBatchImportTiming) => hits.push(timing.eventIdentityIndexCacheHit) };
  await importDeviceBatch(input(root, 2), options);
  await importDeviceBatch(input(root, 3), options);
  assert.deepEqual(hits, [false, false]);
  await fs.writeFile(shard, JSON.stringify(seed.events[0]) + "\n");
  await importDeviceBatch(input(root, 4));
  await withVault(async (other) => { await importDeviceBatch(input(other, 1)); });
  await importDeviceBatch(input(root, 5), options);
  assert.equal(hits.at(-1), false);
}));

test("a new module instance reconstructs from durable ledger truth", async () => withVault(async (root) => {
  const seed = await importDeviceBatch(input(root, 1));
  vi.resetModules();
  const freshCore = await import("../src/index.ts");
  let hit: boolean | undefined;
  const replay = await freshCore.importDeviceBatch(input(root, 1), {
    onTiming: (timing) => { hit = timing.eventIdentityIndexCacheHit; },
  });
  assert.equal(hit, false);
  assert.equal(replay.applied, false);
  assert.deepEqual(replay.events, seed.events);
}));

test("returned replay records cannot mutate the resident index", async () => withVault(async (root) => {
  await importDeviceBatch(input(root, 1));
  const replay = await importDeviceBatch(input(root, 1));
  const event = replay.events[0]!;
  assert.ok(event.kind === "observation");
  event.value = 999;
  const again = await importDeviceBatch(input(root, 1));
  assert.ok(again.events[0]?.kind === "observation");
  assert.equal(again.events[0].value, 1);
}));
