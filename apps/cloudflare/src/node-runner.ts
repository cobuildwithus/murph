import {
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerPlatformEnv,
} from "./runner-env.ts";
import {
  runHostedExecutionJobIsolatedDetailed,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  buildHostedExecutionRuntimePlatform,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./runtime-platform.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./runtime-bridge-workspace.ts";
import type { HostedRuntimeBridgeCheckpointLease } from "./runtime-bridge-checkpoint.ts";
import {
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionWorkspaceRunJobInput,
} from "./runner-job-transport.ts";

export type HostedExecutionJobRunMode = "in-process" | "isolated";

export interface HostedExecutionJobOptions {
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  signal?: AbortSignal;
}

export interface HostedExecutionJobRunnerDependencies {
  buildRuntime?: typeof buildHostedExecutionJobRuntime;
  buildRuntimePlatform?: typeof buildHostedExecutionRuntimePlatform;
  onBeforeRun?: () => void;
  readEnvironment?: typeof readHostedExecutionEnvironment;
  runWorkspaceInProcess?: typeof runHostedWorkspaceRuntimeJobInProcess;
  runIsolated?: (
    input: HostedExecutionIsolatedRunnerInput,
    options?: { signal?: AbortSignal },
  ) => Promise<HostedAssistantWorkspaceRuntimeJobResult>;
  runMode?: HostedExecutionJobRunMode;
  readWorkspaceBridgeLease?: (
    input: HostedExecutionWorkspaceRunJobInput,
  ) =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
}

export interface HostedExecutionJobRunner {
  (
    input: HostedExecutionWorkspaceRunJobInput,
    options?: HostedExecutionJobOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
}

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

  // The worker-owned runtime envelope is the source of truth when present.
  // The container only falls back to ambient env for local/manual callers that omit it entirely.
  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    configSource,
    forwardedEnv,
    platformEnv,
    resolvedConfig: requestedRuntime.resolvedConfig,
    runnerSecrets: requestedRuntime.userEnv ?? {},
  });
}

export function createHostedExecutionJobRunner(
  dependencies: HostedExecutionJobRunnerDependencies = {},
) {
  const buildRuntime = dependencies.buildRuntime ?? buildHostedExecutionJobRuntime;
  const buildRuntimePlatform =
    dependencies.buildRuntimePlatform ?? buildHostedExecutionRuntimePlatform;
  const onBeforeRun = dependencies.onBeforeRun;
  const readEnvironment = dependencies.readEnvironment ?? readHostedExecutionEnvironment;
  const runWorkspaceInProcess =
    dependencies.runWorkspaceInProcess ?? runHostedWorkspaceRuntimeJobInProcess;
  const runIsolated =
    dependencies.runIsolated ?? runHostedExecutionJobIsolatedDetailed;
  const runMode = dependencies.runMode ?? "isolated";

  async function runHostedExecutionJob(
    input: HostedExecutionWorkspaceRunJobInput,
    options?: HostedExecutionJobOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
  async function runHostedExecutionJob(
    input: HostedExecutionWorkspaceRunJobInput,
    options?: HostedExecutionJobOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
    onBeforeRun?.();
    const internalWorkerProxyToken = options?.internalWorkerProxyToken ?? null;
    const localInternalProxyBaseUrl = options?.localInternalProxyBaseUrl ?? null;
    const runtime = buildRuntime(input.runtime ?? {});
    const boundUserId = readHostedExecutionRunnerJobUserId(input);
    const workspaceCheckpointBridge = createHostedWorkspaceCheckpointBridgeAuthority({
      input,
      readWorkspaceBridgeLease: dependencies.readWorkspaceBridgeLease,
    });
    const directHostedEnvironment = internalWorkerProxyToken
      ? null
      : readEnvironment();
    const runtimePlatform = buildRuntimePlatform({
      boundUserId,
      commitTimeoutMs: runtime.commitTimeoutMs,
      internalWorkerProxyToken,
      localInternalProxyBaseUrl,
      webCallbackSigning: directHostedEnvironment?.webCallbackSigning ?? null,
      webControlBaseUrl: directHostedEnvironment?.hostedWebBaseUrl ?? null,
      workspaceCheckpointBridge,
    });

    if (runMode === "in-process") {
      return await runWorkspaceInProcess({
        request: input.request,
        runtime,
      }, createHostedWorkspaceRuntimeBridgeJobOptions({
        platform: runtimePlatform,
        readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
        request: input.request,
        runtime,
      }));
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
  return runHostedExecutionJob;
}

export const runHostedExecutionJob = createHostedExecutionJobRunner();

function createHostedWorkspaceCheckpointBridgeAuthority(input: {
  input: HostedExecutionWorkspaceRunJobInput;
  readWorkspaceBridgeLease: HostedExecutionJobRunnerDependencies["readWorkspaceBridgeLease"];
}): HostedWorkspaceCheckpointBridgeAuthority {
  const staticLease = createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.input.request);
  return {
    readCurrentLease: async () =>
      await (input.readWorkspaceBridgeLease
        ? input.readWorkspaceBridgeLease(input.input)
        : staticLease),
  };
}
