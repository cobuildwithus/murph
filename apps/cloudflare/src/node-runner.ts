import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createHostedBrowserVaultReplicaForSourceState,
  readHostedBrowserVaultWarmSourceStateHash,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerPlatformEnv,
} from "./runner-env.ts";
import {
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  runHostedWorkspaceInvocationIsolatedDetailed,
  resolveHostedRunnerWarmWorkspaceVaultRoot,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedRuntimeFetch,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./runtime-platform.ts";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./runtime-bridge-workspace.ts";
import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "./runtime-bridge-mailbox-payload-decode.ts";
import type { HostedRuntimeBridgeCheckpointLease } from "./runtime-bridge-checkpoint.ts";
import {
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.ts";
import {
  LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
} from "./web-control-plane.ts";
import {
  readDashboardReplicaSourceStateHash,
} from "@murphai/hosted-execution/dashboard-replica";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  measureHostedBrowserVaultReplicaBytes,
} from "./browser-vault-limits.ts";

export type HostedWorkspaceInvocationMode = "in-process" | "isolated";

export interface HostedWorkspaceInvocationOptions {
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  signal?: AbortSignal;
}

export interface HostedWorkspaceInvocationRunnerDependencies {
  buildRuntime?: typeof buildHostedExecutionJobRuntime;
  buildRuntimePlatform?: typeof buildHostedExecutionRuntimePlatform;
  onBeforeRun?: () => void;
  runWorkspaceInProcess?: typeof runHostedWorkspaceRuntimeJobInProcess;
  runIsolated?: (
    input: HostedExecutionIsolatedRunnerInput,
    options?: { signal?: AbortSignal },
  ) => Promise<HostedAssistantWorkspaceRuntimeJobResult>;
  runMode?: HostedWorkspaceInvocationMode;
  readWorkspaceBridgeLease?: (
    input: HostedExecutionWorkspaceInvocationJobInput,
  ) =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
}

export interface HostedWorkspaceInvocationRunner {
  (
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
}

export interface HostedBrowserVaultReplicaRefreshInput {
  runtime?: HostedAssistantRuntimeConfig | null;
  sourceStateHash: string;
  userId: string;
}

export type HostedBrowserVaultReplicaRefreshResult =
  | {
      byteLength: number;
      replicaRef: HostedBrowserVaultReplicaRef;
      status: "written";
    }
  | {
      byteLength: number;
      maxBytes: number;
      status: "refresh_failed_too_large";
    }
  | {
      status: "already_fresh" | "stale_source" | "workspace_missing";
    };

export function buildHostedExecutionJobRuntime(
  requestedRuntime: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerAmbientEnv(process.env)
    : { ...requestedRuntime.forwardedEnv };
  const platformEnv = requestedRuntime.platformEnv === undefined
    ? requestedRuntime.forwardedEnv === undefined
      ? buildHostedRunnerPlatformEnv(process.env)
      : {}
    : { ...requestedRuntime.platformEnv };
  const configSource = requestedRuntime.forwardedEnv === undefined
    ? process.env
    : requestedRuntime.forwardedEnv;
  const parserToolchain = bindHostedExecutionJobParserToolchain(
    requestedRuntime.parserToolchain,
  );
  // Native parser paths are container-image facts. Do not trust or preserve
  // Worker-provided typed toolchain paths across the Worker -> container seam.

  // The worker-owned runtime envelope is the source of truth when present.
  // The container only falls back to ambient env for local/manual callers that omit it entirely.
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

function bindHostedExecutionJobParserToolchain(
  parserToolchain: HostedAssistantRuntimeConfig["parserToolchain"] | null | undefined,
): NonNullable<HostedAssistantRuntimeConfig["parserToolchain"]> {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  if (parserToolchain && isHostedRunnerLocalE2eParserToolchain(parserToolchain)) {
    return parserToolchain;
  }

  return createHostedRunnerNativeParserToolchain();
}

export function createHostedWorkspaceInvocationRunner(
  dependencies: HostedWorkspaceInvocationRunnerDependencies = {},
) {
  const buildRuntime = dependencies.buildRuntime ?? buildHostedExecutionJobRuntime;
  const buildRuntimePlatform =
    dependencies.buildRuntimePlatform ?? buildHostedExecutionRuntimePlatform;
  const onBeforeRun = dependencies.onBeforeRun;
  const runWorkspaceInProcess =
    dependencies.runWorkspaceInProcess ?? runHostedWorkspaceRuntimeJobInProcess;
  const runIsolated =
    dependencies.runIsolated ?? runHostedWorkspaceInvocationIsolatedDetailed;
  const runMode = dependencies.runMode ?? "isolated";

  async function runHostedWorkspaceInvocation(
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
  async function runHostedWorkspaceInvocation(
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
    onBeforeRun?.();
    const internalWorkerProxyToken = options?.internalWorkerProxyToken ?? null;
    const localInternalProxyBaseUrl = options?.localInternalProxyBaseUrl ?? null;
    const runtime = buildRuntime(input.runtime ?? {});
    const boundUserId = readHostedExecutionRunnerJobUserId(input);
    if (runMode === "in-process") {
      const workspaceCheckpointBridge = createHostedWorkspaceCheckpointBridgeAuthority({
        input,
        readWorkspaceBridgeLease: dependencies.readWorkspaceBridgeLease,
      });
      const runtimePlatform = buildRuntimePlatform({
        boundUserId,
        commitTimeoutMs: runtime.commitTimeoutMs,
        internalWorkerProxyToken,
        localInternalProxyBaseUrl,
        workspaceCheckpointBridge,
      });
      const webControlFetch = internalWorkerProxyToken
        ? createCloudflareHostedRuntimeFetch(
            boundUserId,
            internalWorkerProxyToken,
            localInternalProxyBaseUrl,
            fetch,
          )
        : undefined;
      const decodeMailboxPayload = webControlFetch
        ? createCloudflareHostedMailboxPayloadDecoder({
          fetchImpl: webControlFetch,
          readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
          timeoutMs: readHostedRunnerCommitTimeoutMs(runtime.commitTimeoutMs ?? null),
        })
        : undefined;
      const runtimeBridgeJobOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
        ...(decodeMailboxPayload ? { decodeMailboxPayload } : {}),
        platform: runtimePlatform,
        readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
        requireMailboxPayloadDecoder: Boolean(internalWorkerProxyToken),
        request: input.request,
        runtime,
        vaultRoot: resolveHostedWorkspaceInProcessVaultRoot(),
        ...(webControlFetch
          ? {
              webControlAllowHttpHosts: [
                CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
                ...LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
              ],
              webControlBaseUrl: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
              webControlFetch,
            }
          : {}),
      });

      return await runWorkspaceInProcess({
        request: input.request,
        runtime,
      }, runtimeBridgeJobOptions);
    }

    return await runIsolated({
      internalWorkerProxyToken: options?.internalWorkerProxyToken ?? null,
      localInternalProxyBaseUrl: options?.localInternalProxyBaseUrl ?? null,
      job: {
        ...input,
        runtime,
      },
    }, options);
  }
  return runHostedWorkspaceInvocation;
}

export const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner();

export async function refreshHostedBrowserVaultReplica(
  input: HostedBrowserVaultReplicaRefreshInput,
  options?: HostedWorkspaceInvocationOptions,
): Promise<HostedBrowserVaultReplicaRefreshResult> {
  const runtime = buildHostedExecutionJobRuntime(input.runtime ?? {});
  const internalWorkerProxyToken = options?.internalWorkerProxyToken ?? null;
  const localInternalProxyBaseUrl = options?.localInternalProxyBaseUrl ?? null;
  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId: input.userId,
    commitTimeoutMs: runtime.commitTimeoutMs,
    internalWorkerProxyToken,
    localInternalProxyBaseUrl,
    browserVaultRefreshSourceStateHash: input.sourceStateHash,
    workspaceCheckpointBridge: null,
  });
  const workspacePort = platform.workspacePort;
  if (!workspacePort?.read) {
    throw new TypeError("Hosted browser-vault refresh requires a workspace read port.");
  }
  if (!platform.browserVaultReplicaPort?.write) {
    throw new TypeError("Hosted browser-vault refresh requires a browser-vault replica write port.");
  }

  const workspaceRead = await workspacePort.read();
  const workspace = workspaceRead.workspace;
  if (!workspace) {
    return {
      status: "workspace_missing",
    };
  }

  const currentSourceStateHash = readDashboardReplicaSourceStateHash(workspace.snapshotRef);
  if (currentSourceStateHash !== input.sourceStateHash) {
    return {
      status: "stale_source",
    };
  }

  if (workspace.browserVaultReplicaRef?.sourceBundleHash === input.sourceStateHash) {
    return {
      status: "already_fresh",
    };
  }

  const warmResult = await tryRefreshHostedBrowserVaultReplicaFromWarmRoot({
    platform,
    sourceStateHash: input.sourceStateHash,
    userId: input.userId,
  });
  if (warmResult) {
    return warmResult;
  }

  const refreshRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
  try {
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      platform,
      vaultRoot: refreshRoot,
      workspace,
    });
    return await createAndWriteHostedBrowserVaultReplica({
      platform,
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
      vaultRoot: restored.vaultRoot,
    });
  } finally {
    await rm(refreshRoot, {
      force: true,
      recursive: true,
    });
  }
}

async function tryRefreshHostedBrowserVaultReplicaFromWarmRoot(input: {
  platform: ReturnType<typeof buildHostedExecutionRuntimePlatform>;
  sourceStateHash: string;
  userId: string;
}): Promise<HostedBrowserVaultReplicaRefreshResult | null> {
  const warmVaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(input.userId);
  const warmSourceStateHash = await readHostedBrowserVaultWarmSourceStateHash({
    vaultRoot: warmVaultRoot,
  });
  if (warmSourceStateHash !== input.sourceStateHash) {
    return null;
  }

  try {
    return await createAndWriteHostedBrowserVaultReplica({
      platform: input.platform,
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
      vaultRoot: warmVaultRoot,
    });
  } catch {
    return null;
  }
}

async function createAndWriteHostedBrowserVaultReplica(input: {
  platform: ReturnType<typeof buildHostedExecutionRuntimePlatform>;
  sourceStateHash: string;
  userId: string;
  vaultRoot: string;
}): Promise<Extract<HostedBrowserVaultReplicaRefreshResult, { status: "written" | "refresh_failed_too_large" }>> {
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: new Date().toISOString(),
    sourceStateHash: input.sourceStateHash,
    vaultRoot: input.vaultRoot,
  });
  const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
  if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    return {
      byteLength,
      maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
      status: "refresh_failed_too_large",
    };
  }

  const replicaRef = await input.platform.browserVaultReplicaPort!.write({ replica });
  return {
    byteLength: replicaRef.byteLength,
    replicaRef,
    status: "written",
  };
}

function resolveHostedWorkspaceInProcessVaultRoot(): string {
  const vaultRoot = process.env.VAULT?.trim();
  if (!vaultRoot) {
    throw new TypeError("Hosted workspace in-process runner requires an explicit VAULT path.");
  }

  if (!path.isAbsolute(vaultRoot)) {
    throw new TypeError("Hosted workspace in-process runner VAULT path must be absolute.");
  }

  return vaultRoot;
}

function createHostedWorkspaceCheckpointBridgeAuthority(input: {
  input: HostedExecutionWorkspaceInvocationJobInput;
  readWorkspaceBridgeLease: HostedWorkspaceInvocationRunnerDependencies["readWorkspaceBridgeLease"];
}): HostedWorkspaceCheckpointBridgeAuthority {
  let currentLease = createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.input.request);
  return {
    readCurrentLease: async () =>
      await (input.readWorkspaceBridgeLease
        ? input.readWorkspaceBridgeLease(input.input)
        : currentLease),
    recordCheckpoint: ({ workspaceVersion }) => {
      currentLease = {
        ...currentLease,
        workspaceVersion,
      };
    },
  };
}
