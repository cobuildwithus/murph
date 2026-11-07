import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

import { assertHostedVaultShareWorkerBuilt } from "./hosted-vault-share-worker-build.ts";

test("missing capture worker fails before projection with an actionable build command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "capture-worker-build-"));
  assert.throws(
    () => assertHostedVaultShareWorkerBuilt(pathToFileURL(path.join(root, "worker.js"))),
    /require the compiled capture worker\. Run pnpm --dir packages\/assistant-runtime build/,
  );
});

test("an existing capture worker admits the projection harness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "capture-worker-build-"));
  const workerPath = path.join(root, "worker.js");
  await writeFile(workerPath, "export {};\n");
  assert.doesNotThrow(() => assertHostedVaultShareWorkerBuilt(pathToFileURL(workerPath)));
});
