import type { HostedAssistantRuntimeConfig } from "@murphai/assistant-runtime";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntimeConfig(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  runtimeConfigSource?: Readonly<Record<string, string | undefined>>;
  userEnvSource?: Readonly<Record<string, string | undefined>>;
  userEnv: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const forwardedEnv = { ...input.forwardedEnv };
  const runtimeConfigSource = input.runtimeConfigSource ?? forwardedEnv;

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(runtimeConfigSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv,
    userEnv: filterHostedRunnerUserEnv(
      input.userEnv,
      input.userEnvSource ?? runtimeConfigSource,
    ),
  };
}
