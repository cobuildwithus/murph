import path from "node:path";

import {
  clearHostedBrowserVaultWarmSourceStateHash,
  createCoalescingRuntimeWakeSignal,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  createHostedWorkspaceInvocationLease,
  runHostedWorkspaceInvocation as runPackageHostedWorkspaceInvocation,
} from "@murphai/assistant-runtime/hosted-invocation";
import type {
  HostedWorkspaceRestorePreparation,
} from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRuntimeOrchestrationLatencyDiagnostics,
  HostedRuntimeLatencyTraceStagedMilestones,
  HostedWorkspaceInvocationProcessingMode,
} from "@murphai/hosted-execution/runtime-control";

import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedTrustedInternalFetch,
  readCloudflareHostedProviderFetchBaseUrls,
} from "./runtime-platform.ts";
import { normalizeCloudflareWorkerFetch } from "./worker-fetch.ts";
import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "./runtime-bridge-mailbox-payload-decode.ts";
import {
  createCloudflareHostedWorkspaceSnapshotArchiveBuilder,
} from "./workspace-snapshot-archive-builder.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerContainerPlatformEnv,
  buildHostedRunnerJobRuntime,
} from "./runner-env.ts";
import {
  assertHostedExecutionRunnerJobResult,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv,
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
} from "./hosted-env-policy.ts";
import {
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  recordHostedRuntimeCompletionFromContainerBestEffort,
} from "./runtime-completion.ts";
import {
  prepareHostedRunnerWarmWorkspaceVaultRoot,
} from "./hosted-runner-warm-workspace.ts";
export {
  clearHostedRunnerWarmLauncherRootsForTests,
  resolveHostedRunnerWarmWorkspaceVaultRoot,
} from "./hosted-runner-warm-workspace.ts";

const HOSTED_ASSISTANT_RUNTIME_NAME = "cloudflare-hosted-runner";

type HostedWorkspaceInvocationRuntimeWakeInput =
  | number
  | {
      notifiedAtEpochMs?: number | null;
      orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
      requestedProcessingMode?: HostedWorkspaceInvocationProcessingMode | null;
    };

export interface HostedWorkspaceInvocationOptions {
  dispatch?: {
    invokeReceivedAtEpochMs?: number;
    containerEnsureReadyStartedAtEpochMs?: number;
  } | null;
  nodeStartupMs?: number | null;
  onConversationActivityObserved?: () => void;
  onRuntimeWakeReady?: (
    sendWake: (input?: HostedWorkspaceInvocationRuntimeWakeInput) => boolean
  ) => void;
  orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
  preparedWorkspaceRestore?: HostedWorkspaceRestorePreparation | null;
  runnerJobAcceptedAt?: string | null;
  releaseSha?: string | null;
  shutdownSignal?: AbortSignal | null;
  signal?: AbortSignal;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
  waitForBackgroundAssistantWork(signal: AbortSignal | null): Promise<void>;
}

function preserveAcceptedRuntimeWake(
  result: HostedAssistantWorkspaceRuntimeJobResult,
  acceptedRuntimeWake: boolean,
): HostedAssistantWorkspaceRuntimeJobResult {
  if (!acceptedRuntimeWake) {
    return result;
  }
  return { ...result, immediateRecheckRequested: true };
}

export function buildHostedExecutionJobRuntime(input: {
  requestedRuntime: HostedAssistantRuntimeConfig;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}): HostedAssistantRuntimeConfig {
  const requestedRuntime = input.requestedRuntime;
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerContainerEnv(input.supervisorEnv)
    : { ...requestedRuntime.forwardedEnv };
  const platformEnv = requestedRuntime.platformEnv === undefined
    ? requestedRuntime.forwardedEnv === undefined
      ? buildHostedRunnerContainerPlatformEnv(input.supervisorEnv)
      : {}
    : { ...requestedRuntime.platformEnv };
  const configSource = requestedRuntime.forwardedEnv === undefined
    ? input.supervisorEnv
    : requestedRuntime.forwardedEnv;
  const parserToolchain = bindHostedExecutionJobParserToolchain(
    requestedRuntime.parserToolchain,
    input.supervisorEnv,
  );

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    configSource,
    forwardedEnv,
    parserToolchain,
    platformEnv,
    resolvedConfig: requestedRuntime.resolvedConfig,
    runnerSecrets: requestedRuntime.userEnv ?? {},
  });
}

export async function runHostedWorkspaceInvocation(
  input: HostedExecutionWorkspaceInvocationJobInput,
  options: HostedWorkspaceInvocationOptions,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Hosted runner job aborted before direct invocation.");
  }

  const vaultRoot = options.preparedWorkspaceRestore?.vaultRoot
    ?? await prepareHostedRunnerWarmWorkspaceVaultRoot(input.request.userId);
  await clearHostedBrowserVaultWarmSourceStateHash({
    vaultRoot,
  });

  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(input.runtime?.forwardedEnv ?? {});
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(input.runtime?.userEnv ?? {});

  const runtime = buildHostedExecutionJobRuntime({
    requestedRuntime: input.runtime ?? {},
    supervisorEnv: options.supervisorEnv,
  });
  const job = {
    ...input,
    runtime,
  };
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  let acceptingRuntimeWakes = true;
  options.onRuntimeWakeReady?.((wakeInput?: HostedWorkspaceInvocationRuntimeWakeInput) => {
    if (!acceptingRuntimeWakes) {
      return false;
    }
    runtimeWakeSignal.notify(wakeInput);
    return true;
  });

  try {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: buildHostedDirectRuntimeDiagnostics(job),
      message: "Hosted container prepared direct workspace invocation.",
      phase: "runtime.starting",
      userId: readHostedExecutionRunnerJobUserId(job),
    });

    let currentLease = createHostedWorkspaceInvocationLease(job);
    const boundUserId = readHostedExecutionRunnerJobUserId(job);
    const providerFetchBaseUrlSource = {
      ...options.supervisorEnv,
      ...(job.runtime?.forwardedEnv ?? {}),
      ...(job.runtime?.platformEnv ?? {}),
    };
    const providerFetchBaseUrls = readCloudflareHostedProviderFetchBaseUrls(
      providerFetchBaseUrlSource,
    );
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId,
      commitTimeoutMs: job.runtime?.commitTimeoutMs ?? null,
      physicalNotesEnabled:
        job.runtime?.platformEnv?.HOSTED_PHYSICAL_NOTES_ENABLED
          ?.trim()
          .toLowerCase() === "true",
      privateMediaDeliveryOrigin:
        job.runtime?.platformEnv?.CF_PUBLIC_BASE_URL ?? null,
      preparedSnapshotRestore: job.preparedSnapshotRestore ?? null,
      providerFetchBaseUrlSource,
      providerFetchBaseUrls,
      proxyBoundUserIdHeader: true,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint: ({ workspaceVersion }) => {
          currentLease = {
            ...currentLease,
            workspaceVersion,
          };
        },
      },
    });
    const webControlFetch = createCloudflareHostedTrustedInternalFetch(
      boundUserId,
      normalizeCloudflareWorkerFetch(),
      {
        injectBoundUserIdHeader: true,
      },
    );
    const decodeMailboxPayload = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl: webControlFetch,
      readCurrentLease: () => currentLease,
      timeoutMs: readHostedRunnerCommitTimeoutMs(job.runtime?.commitTimeoutMs ?? null),
    });

    const nodeStartupMs = options.nodeStartupMs;
    const hasNodeStartup = nodeStartupMs !== null && nodeStartupMs !== undefined;
    const hasDispatch = options.dispatch !== null
      && options.dispatch !== undefined
      && Object.keys(options.dispatch).length > 0;
    const hasOrchestration = options.orchestration !== null
      && options.orchestration !== undefined
      && Object.keys(options.orchestration).length > 0;
    const latencyMilestones: HostedRuntimeLatencyTraceStagedMilestones = {
      ...(options.runnerJobAcceptedAt
        ? { runnerJobAcceptedAt: options.runnerJobAcceptedAt }
        : {}),
      ...(hasNodeStartup || hasDispatch || hasOrchestration
        ? {
            phaseBreakdown: {
              schemaVersion: 1,
              ...(hasOrchestration ? { orchestration: { ...options.orchestration } } : {}),
              ...(hasDispatch ? { dispatch: { ...options.dispatch } } : {}),
              ...(nodeStartupMs === null || nodeStartupMs === undefined
                ? {}
                : { boot: { nodeStartupMs } }),
            },
          }
        : {}),
    };
    const result = await runPackageHostedWorkspaceInvocation({
      job,
      ...(Object.keys(latencyMilestones).length > 0 ? { latencyMilestones } : {}),
      mailboxPayloadDecoder: decodeMailboxPayload,
      onConversationActivityObserved: options.onConversationActivityObserved,
      platform,
      preparedWorkspaceRestore: options.preparedWorkspaceRestore ?? null,
      readCurrentLease: () => currentLease,
      runtimeIssueProvenance: {
        releaseSha: options.releaseSha ?? null,
        runtimeName: HOSTED_ASSISTANT_RUNTIME_NAME,
      },
      runtimeWakeSignal,
      shutdownSignal: options.shutdownSignal ?? null,
      snapshotArchiveBuilder: createCloudflareHostedWorkspaceSnapshotArchiveBuilder(),
      snapshotDiagnosticsHashSecret:
        job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
      signal: options.signal ?? null,
      vaultRoot,
      waitForBackgroundAssistantWork: options.waitForBackgroundAssistantWork,
    });
    acceptingRuntimeWakes = false;
    const completedResult = assertHostedExecutionRunnerJobResult(
      preserveAcceptedRuntimeWake(
        result,
        runtimeWakeSignal.consumePending() !== null,
      ),
      job,
    );
    await recordHostedRuntimeCompletionFromContainerBestEffort({
      lease: currentLease,
      result: completedResult,
    });
    return completedResult;
  } finally {
    acceptingRuntimeWakes = false;
  }
}

function bindHostedExecutionJobParserToolchain(
  parserToolchain: HostedAssistantRuntimeConfig["parserToolchain"] | null | undefined,
  supervisorEnv: Readonly<Record<string, string | undefined>>,
): NonNullable<HostedAssistantRuntimeConfig["parserToolchain"]> {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  if (
    parserToolchain &&
    (isHostedRunnerLocalE2eParserToolchain(parserToolchain) ||
      isHostedRunnerNativeParserToolchain(parserToolchain))
  ) {
    return parserToolchain;
  }

  return createHostedRunnerNativeParserToolchain(supervisorEnv);
}

function buildHostedDirectRuntimeDiagnostics(
  input: HostedExecutionWorkspaceInvocationJobInput,
): Record<string, boolean | number | string | null> {
  const forwardedEnv = input.runtime?.forwardedEnv ?? {};
  const userEnv = input.runtime?.userEnv ?? {};

  return {
    forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
    hostedAssistantModelConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_MODEL === "string",
    hostedAssistantOpenAiConfigured:
      isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
    hostedAssistantProviderConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string",
    linqApiConfigured:
      typeof forwardedEnv.LINQ_API_TOKEN === "string",
    modelCredentialConfigured:
      hasHostedRunnerModelCredential({
        forwardedEnv,
        userEnv,
      }),
    nodeEnvConfigured:
      typeof forwardedEnv.NODE_ENV === "string"
      && forwardedEnv.NODE_ENV.length > 0,
  };
}
