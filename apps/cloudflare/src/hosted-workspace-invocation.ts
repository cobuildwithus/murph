import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clearHostedBrowserVaultWarmSourceStateHash,
  createCoalescingRuntimeWakeSignal,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  createHostedWorkspaceInvocationLease,
  runHostedWorkspaceInvocation as runPackageHostedWorkspaceInvocation,
} from "@murphai/assistant-runtime/hosted-invocation";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeLatencyTraceStagedMilestones,
} from "@murphai/hosted-execution/runtime-control";

import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedTrustedInternalFetch,
  readCloudflareHostedProviderFetchBaseUrls,
} from "./runtime-platform.ts";
import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "./runtime-bridge-mailbox-payload-decode.ts";
import {
  createCloudflareHostedWorkspaceSnapshotArchiveBuilder,
} from "./workspace-snapshot-archive-builder.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerContainerPlatformEnv,
  buildHostedRunnerJobRuntime,
} from "./runner-env.ts";
import {
  assertHostedExecutionRunnerJobResult,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv,
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
} from "./hosted-env-policy.ts";
import {
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;
const HOSTED_RUNNER_WARM_LAUNCHER_DIRECTORY_NAMES = [
  "home",
  "cache",
  "tmp",
  "hf-home",
] as const;

export interface HostedWorkspaceInvocationOptions {
  nodeStartupMs?: number | null;
  onRuntimeWakeReady?: (sendWake: () => boolean) => void;
  runnerJobAcceptedAt?: string | null;
  signal?: AbortSignal;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}

export function buildHostedExecutionJobRuntime(input: {
  requestedRuntime: HostedAssistantRuntimeConfig;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}): HostedAssistantRuntimeConfig {
  const requestedRuntime = input.requestedRuntime;
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerContainerEnv(input.supervisorEnv)
    : { ...requestedRuntime.forwardedEnv };
  const platformEnv = requestedRuntime.platformEnv === undefined
    ? requestedRuntime.forwardedEnv === undefined
      ? buildHostedRunnerContainerPlatformEnv(input.supervisorEnv)
      : {}
    : { ...requestedRuntime.platformEnv };
  const configSource = requestedRuntime.forwardedEnv === undefined
    ? input.supervisorEnv
    : requestedRuntime.forwardedEnv;
  const parserToolchain = bindHostedExecutionJobParserToolchain(
    requestedRuntime.parserToolchain,
    input.supervisorEnv,
  );

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    configSource,
    forwardedEnv,
    parserToolchain,
    platformEnv,
    resolvedConfig: requestedRuntime.resolvedConfig,
    runnerSecrets: requestedRuntime.userEnv ?? {},
  });
}

export async function runHostedWorkspaceInvocation(
  input: HostedExecutionWorkspaceInvocationJobInput,
  options: HostedWorkspaceInvocationOptions,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Hosted runner job aborted before direct invocation.");
  }

  const warmRoot = await resolveHostedRunnerWarmLauncherRoot(input);
  await clearHostedBrowserVaultWarmSourceStateHash({
    vaultRoot: resolveHostedRunnerWarmWorkspaceVaultRoot(input.request.userId),
  });

  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(input.runtime?.forwardedEnv ?? {});
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(input.runtime?.userEnv ?? {});

  const runtime = buildHostedExecutionJobRuntime({
    requestedRuntime: input.runtime ?? {},
    supervisorEnv: options.supervisorEnv,
  });
  const job = {
    ...input,
    runtime,
  };
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  let acceptingRuntimeWakes = true;
  options.onRuntimeWakeReady?.(() => {
    if (!acceptingRuntimeWakes) {
      return false;
    }
    runtimeWakeSignal.notify();
    return true;
  });

  try {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: buildHostedDirectRuntimeDiagnostics(job),
      message: "Hosted container prepared direct workspace invocation.",
      phase: "runtime.starting",
      userId: readHostedExecutionRunnerJobUserId(job),
    });

    let currentLease = createHostedWorkspaceInvocationLease(job);
    const boundUserId = readHostedExecutionRunnerJobUserId(job);
    const providerFetchBaseUrlSource = {
      ...options.supervisorEnv,
      ...(job.runtime?.forwardedEnv ?? {}),
      ...(job.runtime?.platformEnv ?? {}),
    };
    const providerFetchBaseUrls = readCloudflareHostedProviderFetchBaseUrls(
      providerFetchBaseUrlSource,
    );
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId,
      commitTimeoutMs: job.runtime?.commitTimeoutMs ?? null,
      providerFetchBaseUrlSource,
      providerFetchBaseUrls,
      proxyBoundUserIdHeader: true,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint: ({ workspaceVersion }) => {
          currentLease = {
            ...currentLease,
            workspaceVersion,
          };
        },
      },
    });
    const webControlFetch = createCloudflareHostedTrustedInternalFetch(
      boundUserId,
      fetch,
      {
        injectBoundUserIdHeader: true,
      },
    );
    const decodeMailboxPayload = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl: webControlFetch,
      readCurrentLease: () => currentLease,
      timeoutMs: readHostedRunnerCommitTimeoutMs(job.runtime?.commitTimeoutMs ?? null),
    });

    const latencyMilestones: HostedRuntimeLatencyTraceStagedMilestones = {
      ...(options.runnerJobAcceptedAt
        ? { runnerJobAcceptedAt: options.runnerJobAcceptedAt }
        : {}),
      ...(options.nodeStartupMs === null || options.nodeStartupMs === undefined
        ? {}
        : {
            phaseBreakdown: {
              schemaVersion: 1,
              boot: { nodeStartupMs: options.nodeStartupMs },
            },
          }),
    };
    const result = await runPackageHostedWorkspaceInvocation({
      job,
      ...(Object.keys(latencyMilestones).length > 0 ? { latencyMilestones } : {}),
      mailboxPayloadDecoder: decodeMailboxPayload,
      platform,
      readCurrentLease: () => currentLease,
      runtimeWakeSignal,
      snapshotArchiveBuilder: createCloudflareHostedWorkspaceSnapshotArchiveBuilder(),
      snapshotDiagnosticsHashSecret:
        job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
      signal: options.signal ?? null,
      vaultRoot: path.join(warmRoot, "durable", "vault"),
    });
    return assertHostedExecutionRunnerJobResult(result, job);
  } finally {
    acceptingRuntimeWakes = false;
  }
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

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

async function resolveHostedRunnerWarmLauncherRoot(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<string> {
  const root = resolveHostedRunnerWarmLauncherRootPath(job.request.userId);
  const workspaceId = path.basename(root);
  const cached = hostedRunnerWarmLauncherRoots.get(workspaceId);
  if (cached) {
    await ensureHostedRunnerWarmLauncherDirectories(cached);
    return cached;
  }

  await ensureHostedRunnerWarmLauncherDirectories(root);
  hostedRunnerWarmLauncherRoots.set(workspaceId, root);
  return root;
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

function bindHostedExecutionJobParserToolchain(
  parserToolchain: HostedAssistantRuntimeConfig["parserToolchain"] | null | undefined,
  supervisorEnv: Readonly<Record<string, string | undefined>>,
): NonNullable<HostedAssistantRuntimeConfig["parserToolchain"]> {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  if (parserToolchain && isHostedRunnerLocalE2eParserToolchain(parserToolchain)) {
    return parserToolchain;
  }

  return createHostedRunnerNativeParserToolchain(supervisorEnv);
}

function buildHostedDirectRuntimeDiagnostics(
  input: HostedExecutionWorkspaceInvocationJobInput,
): Record<string, boolean | number | string | null> {
  const forwardedEnv = input.runtime?.forwardedEnv ?? {};
  const userEnv = input.runtime?.userEnv ?? {};

  return {
    forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
    hostedAssistantModelConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_MODEL === "string",
    hostedAssistantOpenAiConfigured:
      isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
    hostedAssistantProviderConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string",
    linqApiConfigured:
      typeof forwardedEnv.LINQ_API_TOKEN === "string",
    modelCredentialConfigured:
      hasHostedRunnerModelCredential({
        forwardedEnv,
        userEnv,
      }),
    nodeEnvConfigured:
      typeof forwardedEnv.NODE_ENV === "string"
      && forwardedEnv.NODE_ENV.length > 0,
  };
}
