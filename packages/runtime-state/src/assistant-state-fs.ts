import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import path from "node:path";

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
  await adoptAssistantStateFileMatching(filePath);
}

async function adoptAssistantStateFileMatching(
  filePath: string,
  expectedEntry?: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  assertAssistantStatePath(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);

  const initialEntry = await lstat(filePath);
  assertRegularAssistantStateFile(filePath, initialEntry);
  if (expectedEntry) {
    assertSameAssistantStateFile(filePath, expectedEntry, initialEntry);
  }
  assertAssistantStateFileLinkCount(filePath, initialEntry, 1);

  await ensureAssistantStateParentDirectory(filePath);
  await assertAssistantStatePathHasNoSymlinks(filePath);

  const entryBeforeOpen = await lstat(filePath);
  assertRegularAssistantStateFile(filePath, entryBeforeOpen);
  assertSameAssistantStateFile(filePath, initialEntry, entryBeforeOpen);
  assertAssistantStateFileLinkCount(filePath, entryBeforeOpen, 1);

  // A swapped symlink must fail, while a swapped FIFO must not block adoption.
  const fileHandle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const openedEntry = await fileHandle.stat();
    assertRegularAssistantStateFile(filePath, openedEntry);
    assertSameAssistantStateFile(filePath, entryBeforeOpen, openedEntry);
    assertAssistantStateFileLinkCount(filePath, openedEntry, 1);

    await fileHandle.chmod(ASSISTANT_STATE_FILE_MODE);

    const adoptedHandleEntry = await fileHandle.stat();
    assertRegularAssistantStateFile(filePath, adoptedHandleEntry);
    assertSameAssistantStateFile(filePath, openedEntry, adoptedHandleEntry);
    assertAssistantStateFileLinkCount(filePath, adoptedHandleEntry, 1);
    assertAssistantStateFileMode(filePath, adoptedHandleEntry.mode);

    await assertAssistantStatePathHasNoSymlinks(filePath);
    const adoptedPathEntry = await lstat(filePath);
    assertRegularAssistantStateFile(filePath, adoptedPathEntry);
    assertSameAssistantStateFile(filePath, adoptedHandleEntry, adoptedPathEntry);
    assertAssistantStateFileLinkCount(filePath, adoptedPathEntry, 1);
    assertAssistantStateFileMode(filePath, adoptedPathEntry.mode);
  } finally {
    await fileHandle.close();
  }
}

export async function adoptAssistantStateFileIntoExclusiveName(
  sourcePath: string,
  targetPath: string,
): Promise<"adopted" | "target_exists"> {
  assertAssistantStatePath(targetPath);
  if (path.dirname(sourcePath) !== path.dirname(targetPath)) {
    throw new Error(
      `Assistant state file adoption must stay inside one directory: ${targetPath}`,
    );
  }
  if (sourcePath === targetPath) {
    throw new Error(
      `Assistant state file adoption requires a distinct exclusive name: ${targetPath}`,
    );
  }

  if (await completeInterruptedAssistantStateLinkTransfer(
    sourcePath,
    targetPath,
  )) {
    return "adopted";
  }

  try {
    await adoptAssistantStateFile(targetPath);
    return "target_exists";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  assertAssistantStatePath(sourcePath);
  await assertAssistantStatePathHasNoSymlinks(sourcePath);
  const initialSourceEntry = await lstat(sourcePath);
  assertRegularAssistantStateFile(sourcePath, initialSourceEntry);
  assertAssistantStateFileLinkCount(sourcePath, initialSourceEntry, 1);

  await ensureAssistantStateParentDirectory(sourcePath);
  await assertAssistantStatePathHasNoSymlinks(sourcePath);
  const sourceEntryBeforeLink = await lstat(sourcePath);
  assertRegularAssistantStateFile(sourcePath, sourceEntryBeforeLink);
  assertSameAssistantStateFile(
    sourcePath,
    initialSourceEntry,
    sourceEntryBeforeLink,
  );
  assertAssistantStateFileLinkCount(sourcePath, sourceEntryBeforeLink, 1);

  try {
    await link(sourcePath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await adoptAssistantStateFile(targetPath);
      return "target_exists";
    }
    throw error;
  }

  let linkedTargetEntry: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    linkedTargetEntry = await lstat(targetPath);
    await finishAssistantStateLinkTransfer(
      sourcePath,
      targetPath,
      sourceEntryBeforeLink,
    );
  } catch (error) {
    if (linkedTargetEntry) {
      await unlinkAssistantStateLinkTargetBestEffort(
        targetPath,
        linkedTargetEntry,
      );
    }
    throw error;
  }
  return "adopted";
}

async function completeInterruptedAssistantStateLinkTransfer(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  let sourceEntry: Awaited<ReturnType<typeof lstat>>;
  let targetEntry: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceEntry = await lstat(sourcePath);
    targetEntry = await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  if (
    sourceEntry.isSymbolicLink() ||
    targetEntry.isSymbolicLink() ||
    !sourceEntry.isFile() ||
    !targetEntry.isFile() ||
    sourceEntry.dev !== targetEntry.dev ||
    sourceEntry.ino !== targetEntry.ino ||
    sourceEntry.nlink !== 2 ||
    targetEntry.nlink !== 2
  ) {
    return false;
  }

  await finishAssistantStateLinkTransfer(sourcePath, targetPath, targetEntry);
  return true;
}

async function assertAssistantStateLinkPair(
  sourcePath: string,
  targetPath: string,
  expectedEntry: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  await assertAssistantStatePathHasNoSymlinks(sourcePath);
  await assertAssistantStatePathHasNoSymlinks(targetPath);
  const sourceEntry = await lstat(sourcePath);
  const targetEntry = await lstat(targetPath);
  for (const [filePath, entry] of [
    [sourcePath, sourceEntry],
    [targetPath, targetEntry],
  ] as const) {
    assertRegularAssistantStateFile(filePath, entry);
    assertSameAssistantStateFile(filePath, expectedEntry, entry);
    assertAssistantStateFileLinkCount(filePath, entry, 2);
  }
}

async function finishAssistantStateLinkTransfer(
  sourcePath: string,
  targetPath: string,
  expectedEntry: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  await assertAssistantStateLinkPair(sourcePath, targetPath, expectedEntry);
  // Drop the friendly link before chmod so adoption only changes a
  // single-link runtime-owned inode.
  await unlink(sourcePath);
  await adoptAssistantStateFileMatching(targetPath, expectedEntry);

  await assertAssistantStatePathHasNoSymlinks(targetPath);
  const finalTargetEntry = await lstat(targetPath);
  assertRegularAssistantStateFile(targetPath, finalTargetEntry);
  assertSameAssistantStateFile(targetPath, expectedEntry, finalTargetEntry);
  assertAssistantStateFileLinkCount(targetPath, finalTargetEntry, 1);
  assertAssistantStateFileMode(targetPath, finalTargetEntry.mode);
}

async function unlinkAssistantStateLinkTargetBestEffort(
  targetPath: string,
  expectedEntry: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  try {
    const currentEntry = await lstat(targetPath);
    if (
      !currentEntry.isSymbolicLink() &&
      currentEntry.isFile() &&
      currentEntry.dev === expectedEntry.dev &&
      currentEntry.ino === expectedEntry.ino &&
      currentEntry.nlink >= 2
    ) {
      await unlink(targetPath);
    }
  } catch {
    // Preserve the validation error; a later checkpoint still fails closed.
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
    throw new Error(`Assistant state file changed during adoption: ${filePath}`);
  }
}

function assertAssistantStateFileLinkCount(
  filePath: string,
  entry: Awaited<ReturnType<typeof lstat>>,
  expected: number,
): void {
  if (entry.nlink !== expected) {
    throw new Error(
      `Assistant state file must have exactly ${expected} hard link(s): ${filePath}`,
    );
  }
}

function assertAssistantStateFileMode(filePath: string, mode: number): void {
  if ((mode & 0o777) !== ASSISTANT_STATE_FILE_MODE) {
    throw new Error(`Assistant state file permissions were not tightened: ${filePath}`);
  }
}
