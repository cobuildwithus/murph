import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;
const HOSTED_RUNNER_WARM_LAUNCHER_DIRECTORY_NAMES = [
  "home",
  "cache",
  "tmp",
  "hf-home",
] as const;

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

export async function prepareHostedRunnerWarmWorkspaceVaultRoot(
  userId: string,
): Promise<string> {
  const root = resolveHostedRunnerWarmLauncherRootPath(userId);
  const workspaceId = path.basename(root);
  const cached = hostedRunnerWarmLauncherRoots.get(workspaceId);
  if (cached) {
    await ensureHostedRunnerWarmLauncherDirectories(cached);
    return path.join(cached, "durable", "vault");
  }

  await ensureHostedRunnerWarmLauncherDirectories(root);
  hostedRunnerWarmLauncherRoots.set(workspaceId, root);
  return path.join(root, "durable", "vault");
}

export async function clearHostedRunnerWarmLauncherRootsForTests(): Promise<void> {
  const roots = [...new Set(hostedRunnerWarmLauncherRoots.values())];
  hostedRunnerWarmLauncherRoots.clear();
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true })),
  );
}

export function resolveHostedRunnerWarmWorkspaceVaultRoot(userId: string): string {
  return path.join(resolveHostedRunnerWarmLauncherRootPath(userId), "durable", "vault");
}

async function ensureHostedRunnerWarmLauncherDirectories(root: string): Promise<void> {
  await ensureHostedRunnerWarmLauncherDirectory(path.dirname(root));
  await ensureHostedRunnerWarmLauncherDirectory(root);

  await Promise.all(
    HOSTED_RUNNER_WARM_LAUNCHER_DIRECTORY_NAMES.map((name) =>
      ensureHostedRunnerWarmLauncherDirectory(path.join(root, name))
    ),
  );
}

async function ensureHostedRunnerWarmLauncherDirectory(directory: string): Promise<void> {
  const existing = await readHostedRunnerWarmLauncherDirectoryEntry(directory);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    await rm(directory, { force: true, recursive: true });
  }

  const repaired = existing && existing.isDirectory() && !existing.isSymbolicLink()
    ? existing
    : null;
  if (!repaired) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isNodeErrorWithCode(error, "EEXIST")) {
        throw error;
      }
    }
  }

  const verified = await lstat(directory);
  if (!verified.isDirectory() || verified.isSymbolicLink()) {
    throw new Error("Hosted runner warm launcher path is not a real directory.");
  }
  await chmod(directory, 0o700);
}

async function readHostedRunnerWarmLauncherDirectoryEntry(directory: string) {
  try {
    return await lstat(directory);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return Reflect.get(error, "code") === code;
}

function resolveHostedRunnerWarmLauncherRootPath(userId: string): string {
  return path.join(
    tmpdir(),
    HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY,
    createHostedRunnerWarmWorkspaceId(userId),
  );
}

function createHostedRunnerWarmWorkspaceId(userId: string): string {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH);
}
