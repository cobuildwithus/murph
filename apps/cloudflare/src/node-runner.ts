import {
  runHostedAssistantRuntimeJobInProcessDetailed,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
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
} from "./runtime-platform.ts";
import { readHostedExecutionEnvironment } from "./env.ts";

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
  runInProcess?: typeof runHostedAssistantRuntimeJobInProcessDetailed;
  runIsolated?: (
    input: HostedExecutionIsolatedRunnerInput,
    options?: { signal?: AbortSignal },
  ) => Promise<HostedAssistantRuntimeJobResult>;
  runMode?: HostedExecutionJobRunMode;
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
  const runInProcess =
    dependencies.runInProcess ?? runHostedAssistantRuntimeJobInProcessDetailed;
  const runIsolated =
    dependencies.runIsolated ?? runHostedExecutionJobIsolatedDetailed;
  const runMode = dependencies.runMode ?? "isolated";

  return async function runHostedExecutionJob(
    input: HostedAssistantRuntimeJobInput,
    options?: HostedExecutionJobOptions,
  ): Promise<HostedAssistantRuntimeJobResult> {
    onBeforeRun?.();
    const internalWorkerProxyToken = options?.internalWorkerProxyToken ?? null;
    const localInternalProxyBaseUrl = options?.localInternalProxyBaseUrl ?? null;
    const runtime = buildRuntime(input.runtime ?? {});
    const directHostedEnvironment = internalWorkerProxyToken
      ? null
      : readEnvironment();
    const runtimePlatform = buildRuntimePlatform({
      boundUserId: input.request.runDrain.userId,
      commitTimeoutMs: runtime.commitTimeoutMs,
      hostedRunId: input.request.run.runId,
      hostedRunToken: input.request.runToken ?? null,
      internalWorkerProxyToken,
      localInternalProxyBaseUrl,
      webCallbackSigning: directHostedEnvironment?.webCallbackSigning ?? null,
      webControlBaseUrl: directHostedEnvironment?.hostedWebBaseUrl ?? null,
    });

    if (runMode === "in-process") {
      return await runInProcess({
        request: input.request,
        runtime,
      }, {
        platform: runtimePlatform,
      });
    }

    return await runIsolated(
      {
        internalWorkerProxyToken: options?.internalWorkerProxyToken ?? null,
        localInternalProxyBaseUrl: options?.localInternalProxyBaseUrl ?? null,
        job: {
          request: input.request,
          runtime,
        },
      },
      options,
    );
  };
}

export const runHostedExecutionJob = createHostedExecutionJobRunner();
