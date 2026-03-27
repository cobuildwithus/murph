import {
  decodeHostedBundleBase64,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";
import {
  readHostedRunnerCommitTimeoutMs,
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobIsolated,
  type HostedAssistantRuntimeJobRequest,
} from "@healthybob/assistant-runtime";

import { buildHostedRunnerContainerEnv } from "./runner-env.js";
import { readHostedUserEnvFromAgentStateBundle } from "./user-env.js";

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
let hostedExecutionCallbackBaseUrlsForTests: {
  commitBaseUrl?: string | null;
  outboxBaseUrl?: string | null;
} | null = null;

export type HostedExecutionRunnerJobRequest = HostedAssistantRuntimeJobRequest;

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
  outboxBaseUrl?: string | null;
} | null): void {
  hostedExecutionCallbackBaseUrlsForTests = input;
}

export async function runHostedExecutionJob(
  input: HostedExecutionRunnerJobRequest,
): Promise<HostedExecutionRunnerResult> {
  hostedExecutionRunStartHookForTests?.();
  const callbackBaseUrls = hostedExecutionCallbackBaseUrlsForTests
    ?? readHostedExecutionCallbackBaseUrls(input.commit?.url ?? null);

  const runtime = {
    ...callbackBaseUrls,
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv: buildHostedRunnerContainerEnv(process.env),
    userEnv: readHostedUserEnvFromAgentStateBundle(
      decodeHostedBundleBase64(input.bundles.agentState),
      process.env,
    ),
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

function readHostedExecutionCallbackBaseUrls(url: string | null): {
  commitBaseUrl?: string;
  outboxBaseUrl?: string;
} | null {
  if (!url) {
    return null;
  }

  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  return {
    commitBaseUrl: baseUrl,
    outboxBaseUrl: baseUrl,
  };
}
