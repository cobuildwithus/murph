import {
  runHostedAssistantRuntimeJobInProcessDetailed,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import { readHostedEmailCapabilities } from "@murphai/hosted-execution";

import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import {
  runHostedExecutionJobIsolatedDetailed,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  buildHostedExecutionRuntimePlatform,
} from "./runtime-platform.ts";
import { normalizeHostedUserEnv } from "./user-env.ts";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
let hostedExecutionIsolatedRunnerForTests:
  | ((
    input: HostedExecutionIsolatedRunnerInput,
    options?: { signal?: AbortSignal },
  ) => Promise<HostedAssistantRuntimeJobResult>)
  | null = null;
const hostedExecutionWorkerOnlyRuntimeEnvKeys = new Set([
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
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
  const forwardedEnv: Record<string, string> = {
    ...buildHostedRunnerContainerEnv(process.env),
    ...stripWorkerOnlyRuntimeEnvKeys(requestedRuntime.forwardedEnv),
  };
  const runtimeConfigSource = buildHostedExecutionRuntimeConfigSource(requestedRuntime, forwardedEnv);
  const emailCapabilities = readHostedEmailCapabilities(forwardedEnv);
  const resolvedForwardedEnv: Record<string, string> = {
    ...forwardedEnv,
    HOSTED_EMAIL_INGRESS_READY: emailCapabilities.ingressReady ? "true" : "false",
    HOSTED_EMAIL_SEND_READY: emailCapabilities.sendReady ? "true" : "false",
  };

  return {
    ...buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: resolvedForwardedEnv,
      runtimeConfigSource,
      userEnv: normalizeHostedUserEnv(requestedRuntime.userEnv ?? {}, runtimeConfigSource),
      userEnvSource: runtimeConfigSource,
    }),
  };
}

function stripWorkerOnlyRuntimeEnvKeys(
  forwardedEnv: HostedAssistantRuntimeConfig["forwardedEnv"],
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(forwardedEnv ?? {})) {
    if (hostedExecutionWorkerOnlyRuntimeEnvKeys.has(key)) {
      continue;
    }
    filtered[key] = value;
  }

  return filtered;
}

function buildHostedExecutionRuntimeConfigSource(
  requestedRuntime: HostedAssistantRuntimeConfig,
  forwardedEnv: Readonly<Record<string, string>>,
): Readonly<Record<string, string | undefined>> {
  const requestedAllowedUserEnvKeys =
    typeof requestedRuntime.forwardedEnv?.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS === "string"
      ? requestedRuntime.forwardedEnv.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS
      : undefined;
  const requestedCommitTimeout =
    typeof requestedRuntime.forwardedEnv?.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS === "string"
      ? requestedRuntime.forwardedEnv.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS
      : undefined;

  return {
    ...forwardedEnv,
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS:
      requestedCommitTimeout ?? process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS:
      requestedAllowedUserEnvKeys ?? process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS,
  };
}
