import {
  readHostedRunnerCommitTimeoutMs,
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
  filterHostedRunnerUserEnv,
} from "./runner-env.ts";
import { normalizeHostedUserEnv } from "./user-env.ts";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;

export function setHostedExecutionRunModeForTests(
  mode: "in-process" | "isolated" | null,
): void {
  hostedExecutionRunModeForTests = mode;
}

export function setHostedExecutionRunStartHookForTests(hook: (() => void) | null): void {
  hostedExecutionRunStartHookForTests = hook;
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
    ...(requestedRuntime.forwardedEnv ?? {}),
  };
  const emailCapabilities = readHostedEmailCapabilities(forwardedEnv);
  const resolvedForwardedEnv: Record<string, string> = {
    ...forwardedEnv,
    HOSTED_EMAIL_INGRESS_READY: emailCapabilities.ingressReady ? "true" : "false",
    HOSTED_EMAIL_SEND_READY: emailCapabilities.sendReady ? "true" : "false",
  };

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(
        resolvedForwardedEnv.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "",
        10,
      ),
    ),
    forwardedEnv: resolvedForwardedEnv,
    internalWorkerProxyToken: requestedRuntime.internalWorkerProxyToken ?? null,
    userEnv: filterHostedRunnerUserEnv(
      normalizeHostedUserEnv(requestedRuntime.userEnv ?? {}, resolvedForwardedEnv),
      resolvedForwardedEnv,
    ),
  };
}
