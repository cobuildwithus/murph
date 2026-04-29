import {
  appendTextFileWithMode,
  assertAssistantStatePathHasNoSymlinks,
  auditAssistantStatePermissions,
  ensureAssistantStateDirectory,
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
