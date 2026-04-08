import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import { ASSISTANT_STATE_FILE_MODE } from "../src/assistant-state-security.ts";
import { writeJsonFileAtomic, writeTextFileAtomic } from "../src/atomic-write.ts";

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "murph-atomic-write-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("writeTextFileAtomic appends a trailing newline and applies assistant-state file modes", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "vault", ".runtime", "operations", "assistant", "status.json");

    await writeTextFileAtomic(filePath, "hello", { trailingNewline: true });

    assert.equal(await readFile(filePath, "utf8"), "hello\n");
    assert.equal((await lstat(filePath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
  });
});

test("writeJsonFileAtomic defaults to newline-terminated JSON and respects explicit modes outside assistant state", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "plain", "record.json");

    await writeJsonFileAtomic(filePath, { ok: true }, { mode: 0o640 });

    assert.equal(await readFile(filePath, "utf8"), '{\n  "ok": true\n}\n');
    assert.equal((await lstat(filePath)).mode & 0o777, 0o640);
  });
});

test("writeTextFileAtomic removes temp files when the final rename fails", async () => {
  await withTempDir(async (root) => {
    const directoryPath = path.join(root, "target-dir");
    await mkdir(directoryPath, { recursive: true });

    await assert.rejects(
      writeTextFileAtomic(directoryPath, "will fail"),
    );

    const siblingEntries = await readdir(root);
    assert.deepEqual(siblingEntries, ["target-dir"]);
  });
});
