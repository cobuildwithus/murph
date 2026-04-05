import {
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobIsolated,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime";
import {
  readHostedEmailCapabilities,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";

import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import { normalizeHostedUserEnv } from "./user-env.ts";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
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

export function buildHostedExecutionJobRuntimeForTests(
  requestedRuntime: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  return buildHostedExecutionJobRuntime(requestedRuntime);
}

export async function runHostedExecutionJob(
  input: HostedAssistantRuntimeJobInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedExecutionRunnerResult> {
  hostedExecutionRunStartHookForTests?.();
  const runtime = buildHostedExecutionJobRuntime(input.runtime ?? {});

  if (hostedExecutionRunModeForTests === "in-process") {
    return await runHostedAssistantRuntimeJobInProcess({
      request: input.request,
      runtime,
    });
  }

  return await runHostedAssistantRuntimeJobIsolated({
    request: input.request,
    runtime,
  }, options);
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
    internalWorkerProxyToken: requestedRuntime.internalWorkerProxyToken ?? null,
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
