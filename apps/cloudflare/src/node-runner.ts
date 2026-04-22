import {
  runHostedAssistantRuntimeJobInProcessDetailed,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
} from "./runner-env.ts";
import { isHostedRunnerProcessControlEnvKey } from "./hosted-env-policy.ts";
import {
  runHostedExecutionJobIsolatedDetailed,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  buildHostedExecutionRuntimePlatform,
} from "./runtime-platform.ts";
import { readHostedExecutionEnvironment } from "./env.ts";

const hostedExecutionChildControlEnvKeys = new Set([
  "HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES",
]);

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
    : stripChildProcessControlEnvKeys(requestedRuntime.forwardedEnv);
  const configSource = requestedRuntime.resolvedConfig
    ? undefined
    : requestedRuntime.forwardedEnv === undefined
      ? process.env
      : requestedRuntime.forwardedEnv;

  // The worker-owned runtime envelope is the source of truth when present.
  // The container only falls back to ambient env for local/manual callers that omit it entirely.
  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    configSource,
    forwardedEnv,
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

function stripChildProcessControlEnvKeys(
  forwardedEnv: HostedAssistantRuntimeConfig["forwardedEnv"],
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(forwardedEnv ?? {})) {
    if (
      hostedExecutionChildControlEnvKeys.has(key)
      || isHostedRunnerProcessControlEnvKey(key)
    ) {
      continue;
    }
    filtered[key] = value;
  }

  return filtered;
}
