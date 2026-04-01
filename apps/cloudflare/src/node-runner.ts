import {
  readHostedRunnerCommitTimeoutMs,
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobIsolated,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeJobInput,
} from "@murph/assistant-runtime";
import {
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
  readHostedExecutionWebControlPlaneEnvironment,
  readHostedEmailCapabilities,
  type HostedExecutionRunnerResult,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./runner-env.ts";
import { normalizeHostedUserEnv } from "./user-env.ts";

const HOSTED_RUNNER_DEVICE_SYNC_CONTROL_BASE_URL =
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL;
const HOSTED_RUNNER_SHARE_PACK_BASE_URL =
  DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL;
const HOSTED_RUNNER_USAGE_BASE_URL =
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL;

let hostedExecutionRunStartHookForTests: (() => void) | null = null;
let hostedExecutionRunModeForTests: "in-process" | "isolated" | null = null;
let hostedExecutionCallbackBaseUrlsForTests: {
  artifactsBaseUrl?: string | null;
  commitBaseUrl?: string | null;
  emailBaseUrl?: string | null;
  sharePackBaseUrl?: string | null;
  sharePackToken?: string | null;
  sideEffectsBaseUrl?: string | null;
  webControlPlane?: Partial<HostedExecutionWebControlPlaneEnvironment> | null;
} | null = null;

export function setHostedExecutionRunModeForTests(
  mode: "in-process" | "isolated" | null,
): void {
  hostedExecutionRunModeForTests = mode;
}

export function setHostedExecutionRunStartHookForTests(hook: (() => void) | null): void {
  hostedExecutionRunStartHookForTests = hook;
}

export function setHostedExecutionCallbackBaseUrlsForTests(input: {
  artifactsBaseUrl?: string | null;
  commitBaseUrl?: string | null;
  emailBaseUrl?: string | null;
  sharePackBaseUrl?: string | null;
  sharePackToken?: string | null;
  sideEffectsBaseUrl?: string | null;
  webControlPlane?: Partial<HostedExecutionWebControlPlaneEnvironment> | null;
} | null): void {
  hostedExecutionCallbackBaseUrlsForTests = input;
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
  const callbackBaseUrls = hostedExecutionCallbackBaseUrlsForTests;
  const emailCapabilities = readHostedEmailCapabilities(
    process.env as Readonly<Record<string, string | undefined>>,
  );
  const forwardedEnv = {
    ...buildHostedRunnerContainerEnv(process.env),
    HOSTED_EMAIL_INGRESS_READY: emailCapabilities.ingressReady ? "true" : "false",
    HOSTED_EMAIL_SEND_READY: emailCapabilities.sendReady ? "true" : "false",
  };

  return {
    ...requestedRuntime,
    ...(callbackBaseUrls?.artifactsBaseUrl === undefined ? {} : { artifactsBaseUrl: callbackBaseUrls.artifactsBaseUrl }),
    ...(callbackBaseUrls?.commitBaseUrl === undefined ? {} : { commitBaseUrl: callbackBaseUrls.commitBaseUrl }),
    ...(callbackBaseUrls?.emailBaseUrl === undefined ? {} : { emailBaseUrl: callbackBaseUrls.emailBaseUrl }),
    ...(callbackBaseUrls?.sideEffectsBaseUrl === undefined ? {} : { sideEffectsBaseUrl: callbackBaseUrls.sideEffectsBaseUrl }),
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv,
    internalWorkerProxyToken: requestedRuntime.internalWorkerProxyToken ?? null,
    userEnv: filterHostedRunnerUserEnv(
      normalizeHostedUserEnv(requestedRuntime.userEnv ?? {}, process.env),
      process.env,
    ),
    webControlPlane: {
      ...readHostedExecutionWebControlPlaneEnvironment(forwardedEnv),
      deviceSyncRuntimeBaseUrl: HOSTED_RUNNER_DEVICE_SYNC_CONTROL_BASE_URL,
      shareBaseUrl:
        callbackBaseUrls?.sharePackBaseUrl
        ?? HOSTED_RUNNER_SHARE_PACK_BASE_URL,
      shareToken:
        callbackBaseUrls?.sharePackToken
        ?? null,
      usageBaseUrl: HOSTED_RUNNER_USAGE_BASE_URL,
      ...(callbackBaseUrls?.webControlPlane ?? {}),
    },
  };
}
