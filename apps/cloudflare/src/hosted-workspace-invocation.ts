import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clearHostedBrowserVaultWarmSourceStateHash,
  createCoalescingRuntimeWakeSignal,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedProviderFetch,
  readCloudflareHostedProviderFetchBaseUrls,
} from "./runtime-platform.ts";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./runtime-bridge-workspace.ts";
import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "./runtime-bridge-mailbox-payload-decode.ts";
import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerPlatformEnv,
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
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.ts";
import {
  LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
} from "./web-control-plane.ts";

const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;

export interface HostedWorkspaceInvocationOptions {
  onRuntimeWakeReady?: (sendWake: () => boolean) => void;
  signal?: AbortSignal;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}

export function buildHostedExecutionJobRuntime(input: {
  requestedRuntime: HostedAssistantRuntimeConfig;
  supervisorEnv: Readonly<Record<string, string | undefined>>;
}): HostedAssistantRuntimeConfig {
  const requestedRuntime = input.requestedRuntime;
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerAmbientEnv(input.supervisorEnv)
    : { ...requestedRuntime.forwardedEnv };
  const platformEnv = requestedRuntime.platformEnv === undefined
    ? requestedRuntime.forwardedEnv === undefined
      ? buildHostedRunnerPlatformEnv(input.supervisorEnv)
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
  const warmRoot = await resolveHostedRunnerWarmLauncherRoot(input);
  await clearHostedBrowserVaultWarmSourceStateHash({
    vaultRoot: resolveHostedRunnerWarmWorkspaceVaultRoot(input.request.userId),
  });

  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Hosted runner job aborted before direct invocation.");
  }

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
  options.onRuntimeWakeReady?.(() => {
    runtimeWakeSignal.notify();
    return true;
  });

  emitHostedExecutionStructuredLog({
    component: "container",
    details: buildHostedDirectRuntimeDiagnostics(job),
    message: "Hosted container prepared direct workspace invocation.",
    phase: "runtime.starting",
    userId: readHostedExecutionRunnerJobUserId(job),
  });

  let currentLease = createHostedRuntimeBridgeLeaseFromWorkspaceRequest(job.request);
  const boundUserId = readHostedExecutionRunnerJobUserId(job);
  const providerFetchBaseUrls = readCloudflareHostedProviderFetchBaseUrls({
    ...options.supervisorEnv,
    ...(job.runtime?.forwardedEnv ?? {}),
    ...(job.runtime?.platformEnv ?? {}),
  });
  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId,
    commitTimeoutMs: job.runtime?.commitTimeoutMs ?? null,
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
  const webControlFetch = createCloudflareHostedProviderFetch(
    boundUserId,
    fetch,
    {
      injectBoundUserIdHeader: true,
      readCurrentLease: () => currentLease,
    },
  );
  const decodeMailboxPayload = createCloudflareHostedMailboxPayloadDecoder({
    fetchImpl: webControlFetch,
    readCurrentLease: () => currentLease,
    timeoutMs: readHostedRunnerCommitTimeoutMs(job.runtime?.commitTimeoutMs ?? null),
  });

  const jobOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
    consumePendingRuntimeWake: () => runtimeWakeSignal.consumePending(),
    decodeMailboxPayload,
    platform,
    requireMailboxPayloadDecoder: true,
    request: job.request,
    runtime: job.runtime ?? {},
    snapshotDiagnosticsHashSecret:
      job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
    vaultRoot: path.join(warmRoot, "durable", "vault"),
    webControlAllowHttpHosts: [
      CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
      ...LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
    ],
    webControlBaseUrl: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
    webControlFetch,
  });

  const result = await runHostedWorkspaceRuntimeJobInProcess(job, {
    ...jobOptions,
    runtimeWakeSignal,
  });
  return assertHostedExecutionRunnerJobResult(result, job);
}

export async function clearHostedRunnerWarmLauncherRootsForTests(): Promise<void> {
  const roots = [...new Set(hostedRunnerWarmLauncherRoots.values())];
  hostedRunnerWarmLauncherRoots.clear();
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true })),
  );
}

export function resolveHostedRunnerWarmWorkspaceVaultRoot(userId: string): string {
  return path.join(resolveHostedRunnerWarmLauncherRootPath(userId), "durable", "vault");
}

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

async function resolveHostedRunnerWarmLauncherRoot(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<string> {
  const root = resolveHostedRunnerWarmLauncherRootPath(job.request.userId);
  const workspaceId = path.basename(root);
  const cached = hostedRunnerWarmLauncherRoots.get(workspaceId);
  if (cached) {
    await mkdir(cached, { mode: 0o700, recursive: true });
    return cached;
  }

  await mkdir(root, { mode: 0o700, recursive: true });
  hostedRunnerWarmLauncherRoots.set(workspaceId, root);
  return root;
}

function resolveHostedRunnerWarmLauncherRootPath(userId: string): string {
  return path.join(
    tmpdir(),
    HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY,
    createHostedRunnerWarmWorkspaceId(userId),
  );
}

function createHostedRunnerWarmWorkspaceId(userId: string): string {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH);
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

  if (parserToolchain && isHostedRunnerLocalE2eParserToolchain(parserToolchain)) {
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
