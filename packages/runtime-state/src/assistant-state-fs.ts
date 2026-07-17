import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  appendTextFileWithMode,
  ASSISTANT_STATE_FILE_MODE,
  assertAssistantStatePathHasNoSymlinks,
  auditAssistantStatePermissions,
  ensureAssistantStateDirectory,
  ensureAssistantStateParentDirectory,
  isAssistantStatePath,
  type AssistantStatePermissionAudit,
} from "./assistant-state-security.ts";
import {
  writeJsonFileAtomic,
  writeTextFileAtomic,
  type AtomicWriteOptions,
} from "./atomic-write.ts";
import {
  writeVersionedJsonStateFile,
} from "./versioned-json-files.ts";

export {
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  auditAssistantStatePermissions,
  type AssistantStatePermissionAudit,
  type AssistantStatePermissionIssue,
} from "./assistant-state-security.ts";
export { resolveAssistantStatePaths, type AssistantStatePaths } from "./assistant-state.ts";

export async function ensureAssistantStateDir(directoryPath: string): Promise<void> {
  assertAssistantStatePath(directoryPath);
  await ensureAssistantStateDirectory(directoryPath);
}

export async function adoptAssistantStateFile(filePath: string): Promise<void> {
  assertAssistantStatePath(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);

  const initialEntry = await lstat(filePath);
  assertRegularAssistantStateFile(filePath, initialEntry);

  await ensureAssistantStateParentDirectory(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);

  const entryBeforeOpen = await lstat(filePath);
  assertRegularAssistantStateFile(filePath, entryBeforeOpen);
  assertSameAssistantStateFile(filePath, initialEntry, entryBeforeOpen);

  // A swapped symlink must fail, while a swapped FIFO must not block adoption.
  const fileHandle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const openedEntry = await fileHandle.stat();
    assertRegularAssistantStateFile(filePath, openedEntry);
    assertSameAssistantStateFile(filePath, entryBeforeOpen, openedEntry);

    await fileHandle.chmod(ASSISTANT_STATE_FILE_MODE);

    const adoptedHandleEntry = await fileHandle.stat();
    assertRegularAssistantStateFile(filePath, adoptedHandleEntry);
    assertSameAssistantStateFile(filePath, openedEntry, adoptedHandleEntry);
    assertAssistantStateFileMode(filePath, adoptedHandleEntry.mode);

    await assertAssistantStatePathHasNoSymlinks(filePath);
    const adoptedPathEntry = await lstat(filePath);
    assertRegularAssistantStateFile(filePath, adoptedPathEntry);
    assertSameAssistantStateFile(filePath, adoptedHandleEntry, adoptedPathEntry);
    assertAssistantStateFileMode(filePath, adoptedPathEntry.mode);
  } finally {
    await fileHandle.close();
  }
}

export async function writeAssistantStateText(
  filePath: string,
  value: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  assertAssistantStatePath(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);
  await writeTextFileAtomic(filePath, value, options);
}

export async function writeAssistantStateJson(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  assertAssistantStatePath(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);
  await writeJsonFileAtomic(filePath, value, options);
}

export async function appendAssistantStateText(
  filePath: string,
  value: string,
): Promise<void> {
  assertAssistantStatePath(filePath);
  await appendTextFileWithMode(filePath, value);
}

export async function appendAssistantStateJsonLine(
  filePath: string,
  value: unknown,
): Promise<void> {
  await appendAssistantStateText(filePath, `${JSON.stringify(value)}\n`);
}

export async function writeAssistantStateVersionedJson<T>(
  input: {
    filePath: string;
    schema: string;
    schemaVersion: number;
    value: T;
  },
): Promise<void> {
  assertAssistantStatePath(input.filePath);
  await assertAssistantStatePathHasNoSymlinks(input.filePath);
  await writeVersionedJsonStateFile(input);
}

export async function repairAssistantStatePermissions(input: {
  rootPath: string;
}): Promise<AssistantStatePermissionAudit> {
  assertAssistantStatePath(input.rootPath);
  return await auditAssistantStatePermissions({
    repair: true,
    rootPath: input.rootPath,
  });
}

function assertAssistantStatePath(targetPath: string): void {
  if (!isAssistantStatePath(targetPath)) {
    throw new Error(`Expected assistant runtime state path under .runtime/operations/assistant: ${targetPath}`);
  }
}

function assertRegularAssistantStateFile(
  filePath: string,
  entry: Awaited<ReturnType<typeof lstat>>,
): void {
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Assistant state file must be a regular file: ${filePath}`);
  }
}

function assertSameAssistantStateFile(
  filePath: string,
  expected: Awaited<ReturnType<typeof lstat>>,
  actual: Awaited<ReturnType<typeof lstat>>,
): void {
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`Assistant state file changed while permissions were tightened: ${filePath}`);
  }
}

function assertAssistantStateFileMode(filePath: string, mode: number): void {
  if ((mode & 0o777) !== ASSISTANT_STATE_FILE_MODE) {
    throw new Error(`Assistant state file permissions were not tightened: ${filePath}`);
  }
}
