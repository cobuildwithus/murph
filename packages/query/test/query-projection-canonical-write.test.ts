import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { test, vi } from "vitest";
import { initializeVault, withCanonicalWriteLock } from "@murphai/core";
import * as core from "@murphai/core";
import { createWorkspaceSourceImportExecOptions } from "../../../config/workspace-source-resolution.js";
import { listCanonicalEntitiesRuntime, getQueryProjectionStatus, summarizeWearableSourceHealthRuntime, rebuildQueryProjection } from "../src/query-projection.ts";
import { readExperimentQuerySource } from "../src/experiment-query-source.ts";
import { isWearableProjectionFresh } from "../src/projection/freshness.ts";
import { currentQueryProjectionLocation } from "../src/projection/schema.ts";
import { listCanonicalSourceManifest } from "../src/vault-source.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const reader of ["projection", "experiment", "source-health", "source-health-fresh"] as const) {
for (const outcome of ["commit", "rollback"] as const) {
  test(`a separate canonical writer's ${outcome} completes before a ${reader} query publishes its snapshot`, async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-write-"));
    await initializeVault({ vaultRoot });
    if (reader === "source-health-fresh") await rebuildQueryProjection(vaultRoot);
    const options = createWorkspaceSourceImportExecOptions(packageDir);
    const child = spawn(process.execPath, [
      "--import", "tsx/esm", "--input-type=module", "--eval", `
        import { once } from "node:events";
        import { addMeal, importDeviceBatch, withHostedCanonicalWritePort } from "@murphai/core";
        const [vaultRoot, outcome, reader] = process.argv.slice(1);
        try {
          await withHostedCanonicalWritePort({
            async persistCanonicalWrite() {
              const release = once(process.stdin, "data");
              process.stdout.write("persistence-pending\\n");
              await release;
              if (outcome === "rollback") throw new Error("injected persistence failure");
            },
          }, () => reader.startsWith("source-health") ? importDeviceBatch({
            vaultRoot, provider: "garmin", importedAt: "2026-09-01T13:00:00Z",
            events: [{
              kind: "observation", occurredAt: "2026-09-01T12:00:00Z",
              recordedAt: "2026-09-01T12:01:00Z", timeZone: "UTC", title: "Synthetic steps",
              externalRef: { system: "garmin", resourceType: "daily", resourceId: "synthetic-write" },
              fields: { metric: "steps", value: 8000, unit: "count" },
            }],
          }) : addMeal({
            vaultRoot,
            occurredAt: "2026-09-01T12:00:00.000Z",
            note: "Concurrent snapshot fixture",
          }));
        } catch (error) {
          if (outcome !== "rollback" || !String(error).includes("injected persistence failure")) throw error;
        }
        process.stdin.pause();
      `, vaultRoot, outcome, reader,
    ], { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const exited = once(child, "exit");
    let query: Promise<Awaited<ReturnType<typeof listCanonicalEntitiesRuntime>> | Awaited<ReturnType<typeof summarizeWearableSourceHealthRuntime>>> | null = null;
    try {
      const ready = once(child.stdout, "data");
      const started = await Promise.race([
        ready.then(([chunk]) => String(chunk)),
        exited.then(() => { throw new Error(`Writer exited before persistence: ${stderr}`); }),
      ]);
      assert.match(started, /persistence-pending/u);
      query = reader === "projection"
        ? listCanonicalEntitiesRuntime(vaultRoot)
        : reader === "experiment"
          ? readExperimentQuerySource(vaultRoot).then(source => source.readModel.entities)
          : summarizeWearableSourceHealthRuntime(vaultRoot);
      // The writer is parked after canonical files changed and before persistence
      // succeeds or rolls back. A query must not expose this uncommitted state.
      const beforePersistence = await Promise.race([
        query.then(() => "published"),
        delay(200).then(() => "waiting"),
      ]);
      assert.equal(beforePersistence, "waiting");
      child.stdin.end("release\n");
      const [code] = await exited;
      assert.equal(code, 0, stderr);
      const rows = await query;
      if (reader.startsWith("source-health")) {
        assert.equal(rows.length, outcome === "commit" ? 1 : 0);
        if (outcome === "commit") assert.ok(rows.some(row => "provider" in row && row.provider === "garmin"));
        assert.equal(await isWearableProjectionFresh(
          currentQueryProjectionLocation(vaultRoot), await listCanonicalSourceManifest(vaultRoot),
        ), true);
        assert.deepEqual(await summarizeWearableSourceHealthRuntime(vaultRoot), rows);
        // Rollback may invalidate manifest mtimes. Refresh only committed
        // wearable rows, never certify unfinished global work.
        if (outcome === "commit" || reader === "source-health") {
          assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
        }
      } else {
        const meals = rows.filter(row => "family" in row && row.family === "event" && row.kind === "meal");
        assert.equal(meals.length, outcome === "commit" ? 1 : 0);
      }
      if (reader === "projection") assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, true);
    } finally {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      await exited;
      await query?.catch(() => undefined);
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
}
}


test("a canonical lock owner can query while another reader waits to rebuild", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-reentrant-"));
  await initializeVault({ vaultRoot });
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let markRebuilding!: () => void;
  const rebuilding = new Promise<void>((resolve) => { markRebuilding = resolve; });
  let nestedRead: ReturnType<typeof listCanonicalEntitiesRuntime> | undefined;
  const owner = withCanonicalWriteLock(vaultRoot, async () => {
    markHeld();
    await rebuilding;
    nestedRead = readExperimentQuerySource(vaultRoot).then(() => listCanonicalEntitiesRuntime(vaultRoot));
    const result = await Promise.race([
      nestedRead.then(() => "read"),
      delay(1000).then(() => "blocked"),
    ]);
    assert.equal(result, "read", "The owner must not join a rebuild waiting for its lock.");
  });
  await held;
  const originalLock = core.withCanonicalWriteLock;
  const spy = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof originalLock>) => {
    markRebuilding();
    return originalLock(...args);
  });
  const reader = listCanonicalEntitiesRuntime(vaultRoot);
  try {
    await owner;
    await reader;
    assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, true);
  } finally {
    await Promise.allSettled([owner, reader]);
    await nestedRead?.catch(() => undefined);
    spy.mockRestore();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});


test("a source-health reader never joins a pending reader behind its reentrant lock owner", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-source-reentrant-"));
  await initializeVault({ vaultRoot });
  let markHeld!: () => void;
  const held = new Promise<void>(resolve => { markHeld = resolve; });
  let markWaiting!: () => void;
  const waiting = new Promise<void>(resolve => { markWaiting = resolve; });
  let nested: ReturnType<typeof summarizeWearableSourceHealthRuntime> | undefined;
  const owner = withCanonicalWriteLock(vaultRoot, async () => {
    markHeld();
    await waiting;
    nested = summarizeWearableSourceHealthRuntime(vaultRoot);
    assert.equal(await Promise.race([nested.then(() => "read"), delay(1000).then(() => "blocked")]), "read");
  });
  await held;
  const originalLock = core.withCanonicalWriteLock;
  const spy = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof originalLock>) => {
    markWaiting();
    return originalLock(...args);
  });
  const reader = summarizeWearableSourceHealthRuntime(vaultRoot);
  try {
    await owner;
    assert.deepEqual(await reader, []);
    assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, false);
  } finally {
    await Promise.allSettled([owner, reader]);
    await nested?.catch(() => undefined);
    spy.mockRestore();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
