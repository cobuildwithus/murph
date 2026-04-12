import {
  runHostedAssistantRuntimeJobInProcessDetailed,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntime,
} from "./runner-env.ts";
import {
  runHostedExecutionJobIsolatedDetailed,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  buildHostedExecutionRuntimePlatform,
} from "./runtime-platform.ts";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
let hostedExecutionIsolatedRunnerForTests:
  | ((
    input: HostedExecutionIsolatedRunnerInput,
    options?: { signal?: AbortSignal },
  ) => Promise<HostedAssistantRuntimeJobResult>)
  | null = null;
const hostedExecutionChildControlEnvKeys = new Set([
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES",
]);

export function setHostedExecutionRunModeForTests(
  mode: "in-process" | "isolated" | null,
): void {
  hostedExecutionRunModeForTests = mode;
}

export function setHostedExecutionRunStartHookForTests(hook: (() => void) | null): void {
  hostedExecutionRunStartHookForTests = hook;
}

export function setHostedExecutionIsolatedRunnerForTests(
  runner:
    | ((
      input: HostedExecutionIsolatedRunnerInput,
      options?: { signal?: AbortSignal },
    ) => Promise<HostedAssistantRuntimeJobResult>)
    | null,
): void {
  hostedExecutionIsolatedRunnerForTests = runner;
}

export function buildHostedExecutionJobRuntimeForTests(
  requestedRuntime: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  return buildHostedExecutionJobRuntime(requestedRuntime);
}

export async function runHostedExecutionJob(
  input: HostedAssistantRuntimeJobInput,
  options?: {
    internalWorkerProxyToken?: string | null;
    signal?: AbortSignal;
  },
): Promise<HostedAssistantRuntimeJobResult> {
  hostedExecutionRunStartHookForTests?.();
  const runtime = buildHostedExecutionJobRuntime(input.runtime ?? {});
  const runtimePlatform = buildHostedExecutionRuntimePlatform({
    boundUserId: input.request.dispatch.event.userId,
    commitTimeoutMs: runtime.commitTimeoutMs,
    internalWorkerProxyToken: options?.internalWorkerProxyToken ?? null,
  });

  if (hostedExecutionRunModeForTests === "in-process") {
    return await runHostedAssistantRuntimeJobInProcessDetailed({
      request: input.request,
      runtime,
    }, {
      platform: runtimePlatform,
    });
  }

  const runIsolated =
    hostedExecutionIsolatedRunnerForTests ?? runHostedExecutionJobIsolatedDetailed;

  return await runIsolated(
    {
      internalWorkerProxyToken: options?.internalWorkerProxyToken ?? null,
      job: {
        request: input.request,
        runtime,
      },
    },
    options,
  );
}

function buildHostedExecutionJobRuntime(
  requestedRuntime: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerContainerEnv(process.env)
    : stripChildProcessControlEnvKeys(requestedRuntime.forwardedEnv);

  // The worker-owned runtime envelope is the source of truth when present.
  // The container only falls back to ambient env for local/manual callers that omit it entirely.
  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    forwardedEnv,
    resolvedConfig: requestedRuntime.resolvedConfig,
    userEnv: requestedRuntime.userEnv ?? {},
  });
}

function stripChildProcessControlEnvKeys(
  forwardedEnv: HostedAssistantRuntimeConfig["forwardedEnv"],
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(forwardedEnv ?? {})) {
    if (hostedExecutionChildControlEnvKeys.has(key)) {
      continue;
    }
    filtered[key] = value;
  }

  return filtered;
}
