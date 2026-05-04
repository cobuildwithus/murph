import path from "node:path";

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
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  runHostedWorkspaceInvocationIsolatedDetailed,
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
      const webControlFetch = internalWorkerProxyToken && localInternalProxyBaseUrl
        ? createCloudflareHostedRuntimeFetch(
            boundUserId,
            internalWorkerProxyToken,
            localInternalProxyBaseUrl,
            fetch,
          )
        : undefined;
      const runtimeBridgeJobOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
        platform: runtimePlatform,
        readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
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
