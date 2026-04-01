import type { HostedAssistantRuntimeConfig } from "@murphai/assistant-runtime";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime";
import {
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
} from "@murphai/hosted-execution";

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
  userEnv: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const forwardedEnv = { ...input.forwardedEnv };

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(forwardedEnv.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv,
    userEnv: filterHostedRunnerUserEnv(input.userEnv, forwardedEnv),
    webControlPlane: {
      deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      internalToken: null,
      schedulerToken: null,
      shareBaseUrl: DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL,
      shareToken: null,
      usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    },
  };
}
