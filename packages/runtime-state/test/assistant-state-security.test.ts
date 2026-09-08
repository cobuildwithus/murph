import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test, vi } from "vitest";

import {
  appendTextFileWithMode,
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  auditAssistantStatePermissions,
  ensureAssistantStateDirectory,
  isAssistantStatePath,
  resolveAssistantStateFileMode,
} from "../src/assistant-state-security.ts";

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "murph-assistant-state-security-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("assistant-state path helpers recognize only assistant runtime paths and default file modes there", async () => {
  await withTempDir(async (root) => {
    const assistantDirectory = path.join(root, "vault", ".runtime", "operations", "assistant", "sessions");
    const nonAssistantDirectory = path.join(root, "vault", ".runtime", "operations", "inbox");

    assert.equal(isAssistantStatePath(assistantDirectory), true);
    assert.equal(isAssistantStatePath(nonAssistantDirectory), false);
    assert.equal(
      resolveAssistantStateFileMode(path.join(assistantDirectory, "session.json")),
      ASSISTANT_STATE_FILE_MODE,
    );
    assert.equal(resolveAssistantStateFileMode(path.join(nonAssistantDirectory, "state.json")), undefined);
    assert.equal(resolveAssistantStateFileMode(path.join(assistantDirectory, "session.json"), 0o644), 0o644);
  });
});

test("ensureAssistantStateDirectory and appendTextFileWithMode enforce assistant-state permissions only under the assistant root", async () => {
  await withTempDir(async (root) => {
    const assistantDirectory = path.join(root, "vault", ".runtime", "operations", "assistant", "journals");
    const assistantFile = path.join(assistantDirectory, "events.jsonl");
    const nonAssistantDirectory = path.join(root, "vault", ".runtime", "operations", "inbox");
    const nonAssistantFile = path.join(nonAssistantDirectory, "state.json");

    await ensureAssistantStateDirectory(assistantDirectory);
    await appendTextFileWithMode(assistantFile, "first\n");
    await appendTextFileWithMode(nonAssistantFile, "outside\n", { mode: 0o640 });

    const assistantStats = await lstat(assistantDirectory);
    const assistantFileStats = await lstat(assistantFile);
    const nonAssistantFileStats = await lstat(nonAssistantFile);

    assert.equal(assistantStats.mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal(assistantFileStats.mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(nonAssistantFileStats.mode & 0o777, 0o640);
    assert.equal(await readFile(assistantFile, "utf8"), "first\n");
    assert.equal(await readFile(nonAssistantFile, "utf8"), "outside\n");
  });
});

test("auditAssistantStatePermissions reports missing roots, detects other entries, and repairs file and directory modes", async () => {
  await withTempDir(async (root) => {
    const missingAudit = await auditAssistantStatePermissions({
      rootPath: path.join(root, "missing"),
    });
    assert.deepEqual(missingAudit, {
      incorrectEntries: 0,
      issues: [],
      repairedEntries: 0,
      scannedDirectories: 0,
      scannedFiles: 0,
      scannedOtherEntries: 0,
    });

    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const nestedDirectory = path.join(assistantRoot, "diagnostics");
    const nestedFile = path.join(nestedDirectory, "events.jsonl");
    const otherEntry = path.join(assistantRoot, "latest");

    await mkdir(nestedDirectory, { recursive: true });
    await appendTextFileWithMode(nestedFile, "line\n");
    await chmod(assistantRoot, 0o755);
    await chmod(nestedDirectory, 0o755);
    await chmod(nestedFile, 0o644);
    await symlink(nestedFile, otherEntry);

    const beforeRepair = await auditAssistantStatePermissions({
      rootPath: assistantRoot,
    });

    assert.equal(beforeRepair.incorrectEntries, 4);
    assert.equal(beforeRepair.repairedEntries, 0);
    assert.equal(beforeRepair.scannedDirectories, 2);
    assert.equal(beforeRepair.scannedFiles, 1);
    assert.equal(beforeRepair.scannedOtherEntries, 1);
    assert.deepEqual(
      beforeRepair.issues.map((issue) => issue.entryKind).sort(),
      ["directory", "directory", "file", "other"],
    );
    assert.equal(beforeRepair.issues.some((issue) => issue.repaired), false);

    const repaired = await auditAssistantStatePermissions({
      repair: true,
      rootPath: assistantRoot,
    });

    assert.equal(repaired.incorrectEntries, 4);
    assert.equal(repaired.repairedEntries, 3);
    assert.equal((await lstat(assistantRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(nestedDirectory)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(nestedFile)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);

    const repairedOtherEntry = repaired.issues.find((issue) => issue.entryKind === "other");
    assert.ok(repairedOtherEntry);
    assert.equal(repairedOtherEntry.repaired, false);
    assert.equal(repairedOtherEntry.actualMode, null);
    assert.equal(repairedOtherEntry.expectedMode, null);
  });
});

test("warm assistant directory validation leaves private directories unchanged and still repairs later permission changes", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const directory = path.join(assistantRoot, "sessions");
    await ensureAssistantStateDirectory(directory);
    const before = await lstat(directory, { bigint: true });
    await ensureAssistantStateDirectory(directory);
    assert.equal((await lstat(directory, { bigint: true })).ctimeNs, before.ctimeNs);

    await chmod(assistantRoot, 0o755);
    await chmod(directory, 0o750);
    await ensureAssistantStateDirectory(directory);
    assert.equal((await lstat(assistantRoot)).mode & 0o7777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(directory)).mode & 0o7777, ASSISTANT_STATE_DIRECTORY_MODE);

    await rm(directory, { recursive: true });
    const outside = path.join(root, "outside");
    await mkdir(outside, { mode: 0o755 });
    await symlink(outside, directory);
    await assert.rejects(ensureAssistantStateDirectory(directory), /must not contain symlinks/);
    assert.equal((await lstat(outside)).mode & 0o777, 0o755);
  });
});


test("existing private ancestry needs no directory creation while missing private paths still recover", async () => {
  const mkdirSpy = vi.fn(mkdir);
  vi.resetModules();
  vi.doMock("node:fs/promises", async () => ({
    ...await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
    mkdir: mkdirSpy,
  }));
  try {
    const security = await import("../src/assistant-state-security.ts");
    await withTempDir(async (root) => {
      const vault = path.join(root, "nested", "vault");
      const runtime = path.join(vault, ".runtime");
      const directory = path.join(runtime, "operations", "assistant", "sessions");
      await security.ensureAssistantStateDirectory(directory);
      assert.equal((await lstat(directory)).mode & 0o7777, ASSISTANT_STATE_DIRECTORY_MODE);
      mkdirSpy.mockClear();
      await security.ensureAssistantStateDirectory(directory);
      assert.equal(mkdirSpy.mock.calls.length, 0);

      await rm(directory, { recursive: true });
      await security.ensureAssistantStateDirectory(directory);
      assert.deepEqual(mkdirSpy.mock.calls, [[directory, { mode: ASSISTANT_STATE_DIRECTORY_MODE }]]);
      mkdirSpy.mockClear();
      await rm(runtime, { recursive: true });
      await security.ensureAssistantStateDirectory(directory);
      assert.deepEqual(mkdirSpy.mock.calls[0], [vault, { recursive: true }]);
      assert.equal((await lstat(runtime)).mode & 0o7777, ASSISTANT_STATE_DIRECTORY_MODE);
      assert.equal((await lstat(directory)).mode & 0o7777, ASSISTANT_STATE_DIRECTORY_MODE);
    });
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});
