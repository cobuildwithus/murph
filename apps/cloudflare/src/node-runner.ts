import {
  type HostedExecutionRunnerResult,
} from "@murph/runtime-state";
import {
  readHostedRunnerCommitTimeoutMs,
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobIsolated,
  type HostedAssistantRuntimeJobRequest,
} from "@murph/assistant-runtime";

import { buildHostedRunnerContainerEnv } from "./runner-env.ts";
import { normalizeHostedUserEnv } from "./user-env.ts";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
let hostedExecutionCallbackBaseUrlsForTests: {
  commitBaseUrl?: string | null;
  emailBaseUrl?: string | null;
  outboxBaseUrl?: string | null;
  sharePackBaseUrl?: string | null;
  sharePackToken?: string | null;
  sideEffectsBaseUrl?: string | null;
} | null = null;

export interface HostedExecutionRunnerJobRequest extends HostedAssistantRuntimeJobRequest {
  userEnv?: Record<string, string> | null;
}

export function setHostedExecutionRunModeForTests(
  mode: "in-process" | "isolated" | null,
): void {
  hostedExecutionRunModeForTests = mode;
}

export function setHostedExecutionRunStartHookForTests(hook: (() => void) | null): void {
  hostedExecutionRunStartHookForTests = hook;
}

export function setHostedExecutionCallbackBaseUrlsForTests(input: {
  commitBaseUrl?: string | null;
  emailBaseUrl?: string | null;
  outboxBaseUrl?: string | null;
  sharePackBaseUrl?: string | null;
  sharePackToken?: string | null;
  sideEffectsBaseUrl?: string | null;
} | null): void {
  hostedExecutionCallbackBaseUrlsForTests = input;
}

export async function runHostedExecutionJob(
  input: HostedExecutionRunnerJobRequest,
): Promise<HostedExecutionRunnerResult> {
  hostedExecutionRunStartHookForTests?.();
  const callbackBaseUrls = hostedExecutionCallbackBaseUrlsForTests;

  const runtime = {
    ...callbackBaseUrls,
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv: buildHostedRunnerContainerEnv(process.env),
    userEnv: normalizeHostedUserEnv(input.userEnv ?? {}, process.env),
  };

  if (hostedExecutionRunModeForTests === "in-process") {
    return await runHostedAssistantRuntimeJobInProcess({
      request: input,
      runtime,
    });
  }

  return await runHostedAssistantRuntimeJobIsolated({
    request: input,
    runtime,
  });
}
