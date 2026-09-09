import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { test } from "vitest";
import { initializeVault } from "@murphai/core";
import { createWorkspaceSourceImportExecOptions } from "../../../config/workspace-source-resolution.js";
import { listCanonicalEntitiesRuntime, getQueryProjectionStatus } from "../src/query-projection.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const outcome of ["commit", "rollback"] as const) {
  test(`a separate canonical writer's ${outcome} completes before a query publishes its snapshot`, async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-write-"));
    await initializeVault({ vaultRoot });
    const options = createWorkspaceSourceImportExecOptions(packageDir);
    const child = spawn(process.execPath, [
      "--import", "tsx/esm", "--input-type=module", "--eval", `
        import { once } from "node:events";
        import { addMeal, withHostedCanonicalWritePort } from "@murphai/core";
        const [vaultRoot, outcome] = process.argv.slice(1);
        try {
          await withHostedCanonicalWritePort({
            async persistCanonicalWrite() {
              const release = once(process.stdin, "data");
              process.stdout.write("persistence-pending\\n");
              await release;
              if (outcome === "rollback") throw new Error("injected persistence failure");
            },
          }, () => addMeal({
            vaultRoot,
            occurredAt: "2026-09-01T12:00:00.000Z",
            note: "Concurrent snapshot fixture",
          }));
        } catch (error) {
          if (outcome !== "rollback" || !String(error).includes("injected persistence failure")) throw error;
        }
        process.stdin.pause();
      `, vaultRoot, outcome,
    ], { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const exited = once(child, "exit");
    let query: ReturnType<typeof listCanonicalEntitiesRuntime> | null = null;
    try {
      const ready = once(child.stdout, "data");
      const started = await Promise.race([
        ready.then(([chunk]) => String(chunk)),
        exited.then(() => { throw new Error(`Writer exited before persistence: ${stderr}`); }),
      ]);
      assert.match(started, /persistence-pending/u);
      query = listCanonicalEntitiesRuntime(vaultRoot);
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
      const meals = rows.filter((row) => row.family === "event" && row.kind === "meal");
      assert.equal(meals.length, outcome === "commit" ? 1 : 0);
      assert.equal((await getQueryProjectionStatus(vaultRoot)).fresh, true);
    } finally {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      await exited;
      await query?.catch(() => undefined);
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
}
