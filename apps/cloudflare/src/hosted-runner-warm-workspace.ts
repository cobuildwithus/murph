import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";

const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

export async function clearHostedRunnerWarmLauncherRootsForTests(): Promise<void> {
  const roots = [...new Set(hostedRunnerWarmLauncherRoots.values())];
  hostedRunnerWarmLauncherRoots.clear();
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true })),
  );
}

export async function resolveHostedRunnerWarmLauncherRoot(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<string> {
  const root = resolveHostedRunnerWarmLauncherRootPath(job.request.userId);
  const workspaceId = path.basename(root);
  const cached = hostedRunnerWarmLauncherRoots.get(workspaceId);
  if (cached) {
    await mkdir(cached, { mode: 0o700, recursive: true });
    return cached;
  }

  await mkdir(root, { mode: 0o700, recursive: true });
  hostedRunnerWarmLauncherRoots.set(workspaceId, root);
  return root;
}

export function resolveHostedRunnerWarmWorkspaceVaultRoot(userId: string): string {
  return path.join(resolveHostedRunnerWarmLauncherRootPath(userId), "vault");
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
