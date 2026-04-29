import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  appendAssistantStateJsonLine,
  appendAssistantStateText,
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  ensureAssistantStateDir,
  repairAssistantStatePermissions,
  writeAssistantStateJson,
  writeAssistantStateText,
  writeAssistantStateVersionedJson,
} from "../src/assistant-state-fs.ts";

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-assistant-state-fs-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("assistant-state fs primitives create private directories and files", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const stateDirectory = path.join(assistantRoot, "state", "sessions");
    const jsonPath = path.join(stateDirectory, "session.json");
    const textPath = path.join(assistantRoot, "transcripts", "asst_123.jsonl");
    const versionedPath = path.join(assistantRoot, "hosted-mailbox.json");

    await ensureAssistantStateDir(stateDirectory);
    await writeAssistantStateJson(jsonPath, { ok: true });
    await appendAssistantStateText(textPath, "first\n");
    await appendAssistantStateJsonLine(textPath, { second: true });
    await writeAssistantStateText(path.join(assistantRoot, "status", "snapshot.json"), "{}\n");
    await writeAssistantStateVersionedJson({
      filePath: versionedPath,
      schema: "murph.test-state.v1",
      schemaVersion: 1,
      value: { imported: true },
    });

    assert.equal((await lstat(assistantRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(stateDirectory)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(jsonPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal((await lstat(textPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal((await lstat(versionedPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(textPath, "utf8"), "first\n{\"second\":true}\n");
  });
});

test("assistant-state append tightens permissive existing files before writing", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(
      root,
      "vault",
      ".runtime",
      "operations",
      "assistant",
      "transcripts",
      "asst_123.jsonl",
    );

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "existing\n", { mode: 0o644 });
    await chmod(filePath, 0o644);

    await appendAssistantStateText(filePath, "next\n");

    assert.equal((await lstat(filePath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(filePath, "utf8"), "existing\nnext\n");
  });
});

test("assistant-state fs primitives fail closed outside assistant runtime state", async () => {
  await withTempDir(async (root) => {
    const nonAssistantPath = path.join(root, "vault", ".runtime", "operations", "inbox", "state.json");

    await assert.rejects(
      writeAssistantStateJson(nonAssistantPath, { ok: false }),
      /Expected assistant runtime state path/u,
    );
  });
});

test("assistant-state fs primitives reject symlinked assistant ancestors", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const outsideRoot = path.join(root, "outside");
    const symlinkPath = path.join(assistantRoot, "state");

    await mkdir(assistantRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, symlinkPath);

    await assert.rejects(
      writeAssistantStateJson(path.join(symlinkPath, "session.json"), { ok: false }),
      /must not contain symlinks/u,
    );
  });
});

test("repairAssistantStatePermissions is the explicit mutation wrapper around audit repair", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const filePath = path.join(assistantRoot, "diagnostics", "snapshot.json");

    await writeAssistantStateJson(filePath, { ok: true });
    await import("node:fs/promises").then(async ({ chmod }) => {
      await chmod(assistantRoot, 0o755);
      await chmod(filePath, 0o644);
    });

    const repaired = await repairAssistantStatePermissions({ rootPath: assistantRoot });

    assert.equal(repaired.incorrectEntries, 2);
    assert.equal(repaired.repairedEntries, 2);
    assert.equal((await lstat(assistantRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(filePath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
  });
});
