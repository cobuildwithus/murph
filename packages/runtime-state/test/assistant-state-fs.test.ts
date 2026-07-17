import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test, vi } from "vitest";

const assistantStateOpenRace = vi.hoisted(() => ({
  beforeNextOpen: null as null | (() => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    async open(filePath: string, flags: number) {
      const beforeNextOpen = assistantStateOpenRace.beforeNextOpen;
      assistantStateOpenRace.beforeNextOpen = null;
      await beforeNextOpen?.();
      return await actual.open(filePath, flags);
    },
  };
});

import {
  adoptAssistantStateFile,
  adoptAssistantStateFileIntoExclusiveName,
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

test("adoptAssistantStateFile tightens its assistant-state parents and exact file", async () => {
  await withTempDir(async (root) => {
    const vaultRoot = path.join(root, "vault");
    const runtimeRoot = path.join(vaultRoot, ".runtime");
    const operationsRoot = path.join(runtimeRoot, "operations");
    const assistantRoot = path.join(operationsRoot, "assistant");
    const deliveryDirectory = path.join(assistantRoot, "generated-deliveries");
    const filePath = path.join(deliveryDirectory, "report.pdf");

    await mkdir(deliveryDirectory, { mode: 0o755, recursive: true });
    await chmod(vaultRoot, 0o755);
    await chmod(runtimeRoot, 0o755);
    await chmod(operationsRoot, 0o755);
    await chmod(assistantRoot, 0o755);
    await chmod(deliveryDirectory, 0o777);
    await writeFile(filePath, "generated report", { mode: 0o666 });
    await chmod(filePath, 0o666);

    await adoptAssistantStateFile(filePath);

    assert.equal((await lstat(vaultRoot)).mode & 0o777, 0o755);
    assert.equal((await lstat(runtimeRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(operationsRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(assistantRoot)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(deliveryDirectory)).mode & 0o777, ASSISTANT_STATE_DIRECTORY_MODE);
    assert.equal((await lstat(filePath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(filePath, "utf8"), "generated report");
  });
});

test("adoptAssistantStateFileIntoExclusiveName renames the adopted file without clobbering", async () => {
  await withTempDir(async (root) => {
    const deliveryDirectory = path.join(
      root,
      "vault",
      ".runtime",
      "operations",
      "assistant",
      "generated-deliveries",
    );
    const sourcePath = path.join(deliveryDirectory, "report.pdf");
    const targetPath = path.join(deliveryDirectory, "report-owned.pdf");

    await mkdir(deliveryDirectory, { recursive: true });
    await writeFile(sourcePath, "generated report", { mode: 0o666 });
    await chmod(sourcePath, 0o666);

    await adoptAssistantStateFileIntoExclusiveName(sourcePath, targetPath);

    await assert.rejects(lstat(sourcePath), /ENOENT/u);
    assert.equal((await lstat(targetPath)).mode & 0o777, ASSISTANT_STATE_FILE_MODE);
    assert.equal(await readFile(targetPath, "utf8"), "generated report");

    await writeFile(sourcePath, "second report", { mode: 0o666 });
    await assert.rejects(
      adoptAssistantStateFileIntoExclusiveName(sourcePath, targetPath),
      /already in use/u,
    );
    assert.equal(await readFile(targetPath, "utf8"), "generated report");
    assert.equal(await readFile(sourcePath, "utf8"), "second report");
  });
});

test("adoptAssistantStateFileIntoExclusiveName rejects cross-directory and symlink sources", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(
      root,
      "vault",
      ".runtime",
      "operations",
      "assistant",
    );
    const deliveryDirectory = path.join(assistantRoot, "generated-deliveries");
    await mkdir(deliveryDirectory, { recursive: true });

    const outsideSource = path.join(assistantRoot, "report.pdf");
    await writeFile(outsideSource, "outside", { mode: 0o600 });
    await assert.rejects(
      adoptAssistantStateFileIntoExclusiveName(
        outsideSource,
        path.join(deliveryDirectory, "report-owned.pdf"),
      ),
      /one directory/u,
    );

    const samePath = path.join(deliveryDirectory, "same.pdf");
    await writeFile(samePath, "same", { mode: 0o600 });
    await assert.rejects(
      adoptAssistantStateFileIntoExclusiveName(samePath, samePath),
      /distinct exclusive name/u,
    );

    const linkTargetPath = path.join(deliveryDirectory, "real.pdf");
    const symlinkPath = path.join(deliveryDirectory, "link.pdf");
    await writeFile(linkTargetPath, "real", { mode: 0o600 });
    await symlink(linkTargetPath, symlinkPath);
    await assert.rejects(
      adoptAssistantStateFileIntoExclusiveName(
        symlinkPath,
        path.join(deliveryDirectory, "link-owned.pdf"),
      ),
    );
    assert.equal(await readFile(linkTargetPath, "utf8"), "real");
  });
});

test("adoptAssistantStateFile rejects symlinks and non-regular entries", async () => {
  await withTempDir(async (root) => {
    const assistantRoot = path.join(root, "vault", ".runtime", "operations", "assistant");
    const deliveryDirectory = path.join(assistantRoot, "generated-deliveries");
    const outsidePath = path.join(root, "outside.pdf");
    const symlinkPath = path.join(deliveryDirectory, "linked.pdf");
    const directoryPath = path.join(deliveryDirectory, "directory.pdf");

    await mkdir(deliveryDirectory, { recursive: true });
    await writeFile(outsidePath, "outside", { mode: 0o644 });
    await chmod(outsidePath, 0o644);
    await symlink(outsidePath, symlinkPath);
    await mkdir(directoryPath);

    await assert.rejects(
      adoptAssistantStateFile(symlinkPath),
      /must not contain symlinks/u,
    );
    await assert.rejects(
      adoptAssistantStateFile(directoryPath),
      /must be a regular file/u,
    );

    assert.equal((await lstat(outsidePath)).mode & 0o777, 0o644);
    assert.equal(await readFile(outsidePath, "utf8"), "outside");
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
    assert.equal((await lstat(directoryPath)).isDirectory(), true);
  });
});

test("adoptAssistantStateFile rejects a symlink replacement between lstat and open", async () => {
  await withTempDir(async (root) => {
    const deliveryDirectory = path.join(
      root,
      "vault",
      ".runtime",
      "operations",
      "assistant",
      "generated-deliveries",
    );
    const filePath = path.join(deliveryDirectory, "report.pdf");
    const outsidePath = path.join(root, "outside.pdf");

    await mkdir(deliveryDirectory, { recursive: true });
    await writeFile(filePath, "generated report", { mode: 0o666 });
    await writeFile(outsidePath, "outside", { mode: 0o644 });
    await chmod(filePath, 0o666);
    await chmod(outsidePath, 0o644);

    assistantStateOpenRace.beforeNextOpen = async () => {
      await rm(filePath);
      await symlink(outsidePath, filePath);
    };

    try {
      await assert.rejects(adoptAssistantStateFile(filePath), /ELOOP/u);
    } finally {
      assistantStateOpenRace.beforeNextOpen = null;
    }

    assert.equal((await lstat(outsidePath)).mode & 0o777, 0o644);
    assert.equal(await readFile(outsidePath, "utf8"), "outside");
    assert.equal((await lstat(filePath)).isSymbolicLink(), true);
  });
});

test("adoptAssistantStateFile fails before mutating paths outside assistant state or missing files", async () => {
  await withTempDir(async (root) => {
    const outsidePath = path.join(root, "vault", "exports", "report.pdf");
    const missingAssistantPath = path.join(
      root,
      "vault",
      ".runtime",
      "operations",
      "assistant",
      "generated-deliveries",
      "missing.pdf",
    );

    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(outsidePath, "ordinary vault data", { mode: 0o666 });
    await chmod(outsidePath, 0o666);

    await assert.rejects(
      adoptAssistantStateFile(outsidePath),
      /Expected assistant runtime state path/u,
    );
    await assert.rejects(adoptAssistantStateFile(missingAssistantPath), /ENOENT/u);

    assert.equal((await lstat(outsidePath)).mode & 0o777, 0o666);
    await assert.rejects(lstat(path.dirname(missingAssistantPath)), /ENOENT/u);
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
