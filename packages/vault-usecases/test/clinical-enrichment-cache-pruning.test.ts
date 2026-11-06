import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

import { pruneSupersededClinicalExtractionCaches } from "../src/clinical-enrichment.ts";

const relativeRoot = ".runtime/operations/clinical-records/enrichment";

test("obsolete cache cleanup stops between entries and resumes without changing the current cache", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cache-pruning-"));
  const root = path.join(vaultRoot, relativeRoot);
  const controller = new AbortController();
  const reason = new Error("synthetic maintenance interruption");
  let checks = 0;
  const check = controller.signal.throwIfAborted.bind(controller.signal);
  const spy = vi.spyOn(controller.signal, "throwIfAborted").mockImplementation(() => {
    if (++checks === 7) controller.abort(reason);
    check();
  });
  try {
    await mkdir(path.join(root, "extraction-v1"), { recursive: true });
    await mkdir(path.join(root, "extraction-v4"));
    await writeFile(path.join(root, "extraction-v4", "current.json"), "current");
    for (let index = 0; index < 10; index++) {
      await writeFile(path.join(root, "extraction-v1", `${index}.json`), "obsolete");
    }
    await assert.rejects(
      pruneSupersededClinicalExtractionCaches({ vaultRoot, signal: controller.signal }),
      (error) => error === reason,
    );
    const remaining = await readdir(path.join(root, "extraction-v1"));
    assert.ok(remaining.length > 0 && remaining.length < 10);
    await pruneSupersededClinicalExtractionCaches({ vaultRoot, signal: new AbortController().signal });
    await pruneSupersededClinicalExtractionCaches({ vaultRoot, signal: new AbortController().signal });
    assert.deepEqual(await readdir(root), ["extraction-v4"]);
    assert.equal(await readFile(path.join(root, "extraction-v4", "current.json"), "utf8"), "current");
  } finally {
    spy.mockRestore();
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("obsolete cache cleanup does not follow cache or parent symlinks", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cache-symlink-"));
  const outside = await mkdtemp(path.join(tmpdir(), "murph-cache-outside-"));
  const root = path.join(vaultRoot, relativeRoot);
  const signal = new AbortController().signal;
  try {
    await pruneSupersededClinicalExtractionCaches({ vaultRoot, signal });
    await mkdir(path.join(root, "extraction-v1"), { recursive: true });
    await writeFile(path.join(outside, "kept.json"), "outside");
    await symlink(outside, path.join(root, "extraction-v2"), "dir");
    await symlink(outside, path.join(root, "extraction-v1", "linked"), "dir");
    await writeFile(path.join(root, "extraction-v3"), "non-directory");
    await pruneSupersededClinicalExtractionCaches({ vaultRoot, signal });
    assert.equal(await readFile(path.join(outside, "kept.json"), "utf8"), "outside");
    assert.deepEqual((await readdir(root)).sort(), ["extraction-v2", "extraction-v3"]);
    await rm(root, { recursive: true });
    await symlink(outside, root, "dir");
    await assert.rejects(pruneSupersededClinicalExtractionCaches({ vaultRoot, signal }));
    assert.equal(await readFile(path.join(outside, "kept.json"), "utf8"), "outside");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});
