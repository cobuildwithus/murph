import path from "node:path";

import {
  createHostedBrowserVaultReplicaForSnapshot,
  createHostedConversationMailboxImportItem,
  enqueueHostedSystemMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeConfig,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionLayeredSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionBundleRef,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionSnapshotRef,
  type HostedExecutionSystemWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  HostedAssistantRuntimeHotStateIncompleteError,
  HostedAssistantRuntimeHotStateBudgetExceededError,
  HostedWorkspaceSnapshotContinuityIncompleteError,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedExecutionContext,
  type HostedCodexHomeSnapshotDiagnostics,
} from "@murphai/runtime-state/node";

import {
  snapshotHostedRuntimeBridgeWorkspaceBundle,
  type HostedRuntimeBridgeCheckpointLease,
} from "./runtime-bridge-checkpoint.ts";
import {
  decryptHostedMailboxPayloadCiphertext,
  createHostedMailboxEncryptionEnvironmentFromIngressRootResolver,
  type HostedMailboxEncryptionEnvironment,
} from "./hosted-mailbox-encryption.ts";
import {
  readHostedExecutionWorkerEnvironment,
} from "./hosted-execution-worker-env.ts";
import {
  fetchHostedWorkerRuntimeRootByRootKeyId,
  type HostedWorkerCryptoEnv,
} from "./hosted-crypto/runtime-crypto-context.ts";
import {
  readHostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";
type HostedWorkspaceRuntimeBridgeImportItem =
  HostedWorkspaceRuntimeJobOptions["importItem"];
type HostedWorkspaceRuntimeBridgeImportItemInput =
  Parameters<HostedWorkspaceRuntimeBridgeImportItem>[0];
type HostedRuntimeBridgeReadCurrentLease = () =>
  | HostedRuntimeBridgeCheckpointLease
  | null
  | Promise<HostedRuntimeBridgeCheckpointLease | null>;
type HostedRuntimeBridgeNormalizedRuntime = Pick<
  ReturnType<typeof normalizeHostedAssistantRuntimeConfig>,
  "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
>;

export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  readEncryptionEnvironment?: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
  request: HostedWorkspaceInvocationRequest;
  runtime: HostedAssistantRuntimeConfig;
  vaultRoot: string;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
  webControlFetch?: typeof fetch;
}

export function createHostedWorkspaceRuntimeBridgeJobOptions(
  input: HostedWorkspaceRuntimeBridgeOptionsInput,
): HostedWorkspaceRuntimeJobOptions {
  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  const readCurrentLease = input.readCurrentLease
    ?? (() => createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.request));
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, input.platform);
  const readEncryptionEnvironment = input.readEncryptionEnvironment
    ?? createHostedMailboxEncryptionEnvironmentReader({
      runtime,
      webControlAllowHttpHosts: input.webControlAllowHttpHosts,
      webControlBaseUrl: input.webControlBaseUrl ?? null,
      webControlFetch: input.webControlFetch,
    });

  return {
    createCheckpointSnapshot: async (checkpointInput) => {
      return await createHostedWorkspaceBridgeCheckpointSnapshot({
        platform: input.platform,
        readCurrentLease,
        request: {
          attemptId: input.request.attemptId,
          expectedWorkspaceVersion: input.request.workspaceVersion,
          leaseGeneration: input.request.leaseGeneration,
          nextWakeAt: Object.hasOwn(checkpointInput, "nextWakeAt")
            ? checkpointInput.nextWakeAt ?? null
            : null,
          nextWakeReason: Object.hasOwn(checkpointInput, "nextWakeReason")
            ? checkpointInput.nextWakeReason ?? null
            : null,
          reason: checkpointInput.reason,
          redactedStatus: checkpointInput.redactedStatus ?? null,
          snapshotRef: null,
        },
        codexHomeSnapshotHashSecret: resolveHostedCodexHomeSnapshotHashSecret({
          forwardedEnv: runtime.forwardedEnv,
          platformEnv: runtime.platformEnv,
        }),
        userId: input.request.userId,
        vaultRoot,
      });
    },
    importItem: createHostedWorkspaceBridgeMailboxImporter({
      readEncryptionEnvironment,
      runtime,
      vaultRoot,
    }),
    platform: input.platform,
    vaultRoot,
  };
}

function createHostedMailboxEncryptionEnvironmentReader(input: {
  runtime: Pick<HostedRuntimeBridgeNormalizedRuntime, "platformEnv">;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
  webControlFetch?: typeof fetch;
}): (readerInput: { userId: string }) => Promise<HostedMailboxEncryptionEnvironment> {
  const environmentsByUserId = new Map<string, Promise<HostedMailboxEncryptionEnvironment>>();
  return ({ userId }) => {
    const existing = environmentsByUserId.get(userId);
    if (existing) {
      return existing;
    }
    const created = readHostedMailboxEncryptionEnvironmentFromRuntime({
      platformEnv: input.runtime.platformEnv,
      userId,
      webControlAllowHttpHosts: input.webControlAllowHttpHosts,
      webControlBaseUrl: input.webControlBaseUrl ?? null,
      webControlFetch: input.webControlFetch,
    });
    environmentsByUserId.set(userId, created);
    return created;
  };
}

export function createHostedRuntimeBridgeLeaseFromWorkspaceRequest(
  request: HostedWorkspaceInvocationRequest,
): HostedRuntimeBridgeCheckpointLease {
  return {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

async function createHostedWorkspaceBridgeCheckpointSnapshot(input: {
  codexHomeSnapshotHashSecret: string | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const mode = resolveHostedWorkspaceCheckpointSnapshotMode(input.request.reason);
  return mode === "hot"
    ? await createHostedWorkspaceBridgeHotCheckpointSnapshotOrFullFallback(input)
    : await createHostedWorkspaceBridgeFullCheckpointSnapshot(input);
}

async function createHostedWorkspaceBridgeHotCheckpointSnapshotOrFullFallback(input: {
  codexHomeSnapshotHashSecret: string | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  let currentRefs: Awaited<ReturnType<typeof readHostedWorkspaceCurrentCheckpointRefs>>;
  try {
    currentRefs = await readHostedWorkspaceCurrentCheckpointRefs(input);
  } catch (error) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "current-ref-read",
      error,
      platform: input.platform,
      request: input.request,
      sidecar: "hot-checkpoint-base",
    });
    return await createHostedWorkspaceBridgeFullCheckpointSnapshot(input);
  }

  if (
    !currentRefs.baseSnapshotRef
    || !currentRefs.browserVaultReplicaRef
    || currentRefs.browserVaultReplicaRef.sourceBundleHash !== currentRefs.baseSnapshotRef.hash
  ) {
    return await createHostedWorkspaceBridgeFullCheckpointSnapshot(input);
  }

  try {
    return await createHostedWorkspaceBridgeHotCheckpointSnapshot({
      ...input,
      baseSnapshotRef: currentRefs.baseSnapshotRef,
      browserVaultReplicaRef: currentRefs.browserVaultReplicaRef,
    });
  } catch (error) {
    if (
      error instanceof HostedAssistantRuntimeHotStateBudgetExceededError
      || error instanceof HostedAssistantRuntimeHotStateIncompleteError
    ) {
      await writeHostedCheckpointHotStateFallbackLog({
        error,
        platform: input.platform,
        request: input.request,
      });
      try {
        return await createHostedWorkspaceBridgeFullCheckpointSnapshot(input);
      } catch (fullError) {
        if (fullError instanceof HostedWorkspaceSnapshotContinuityIncompleteError) {
          await writeHostedCheckpointFullFallbackContinuityFailedLog({
            error: fullError,
            platform: input.platform,
            request: input.request,
          });
        }
        throw fullError;
      }
    }
    throw error;
  }
}

async function createHostedWorkspaceBridgeFullCheckpointSnapshot(input: {
  codexHomeSnapshotHashSecret: string | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionBundleRef;
}> {
  const startedAt = Date.now();
  let externalArtifactPutBytes = 0;
  let externalArtifactPutCount = 0;
  let bundlePutBytes = 0;
  let leaseCheckCount = 0;
  const snapshotRef = await snapshotHostedRuntimeBridgeWorkspaceBundle({
    readCurrentLease: async () => {
      leaseCheckCount += 1;
      return await input.readCurrentLease();
    },
    request: input.request,
    snapshotWorkspace: async () => {
      const snapshot = await snapshotHostedExecutionContext({
        artifactSink: async (artifact) => {
          externalArtifactPutCount += 1;
          externalArtifactPutBytes += artifact.bytes.byteLength;
          await input.platform.artifactStore.put({
            bytes: artifact.bytes,
            sha256: artifact.ref.sha256,
          });
        },
        codexHomeSnapshotHashSecret: input.codexHomeSnapshotHashSecret,
        operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
        vaultRoot: input.vaultRoot,
      });
      await writeHostedCodexHomeSnapshotDiagnosticLog({
        diagnostics: snapshot.codexHomeSnapshotDiagnostics,
        platform: input.platform,
        request: input.request,
      });

      return snapshot.bundle;
    },
    userId: input.userId,
    writeBundle: async ({ bundle }) => {
      const hash = sha256HostedBundleHex(bundle);
      bundlePutBytes = bundle.byteLength;
      await input.platform.artifactStore.put({
        bytes: bundle,
        sha256: hash,
      });

      return {
        hash,
        key: `cloudflare-workspace-snapshots/${hash}.bundle`,
        size: bundle.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  });

  await writeHostedCheckpointSnapshotMetricLog({
    bundlePutBytes,
    bundlePutCount: 1,
    externalArtifactPutBytes,
    externalArtifactPutCount,
    hotStateBundleBytes: null,
    hotStateFileCount: null,
    hotStateInlineBytes: null,
    leaseCheckCount,
    mode: "full",
    platform: input.platform,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
  });

  let replica: Awaited<ReturnType<typeof createHostedBrowserVaultReplicaForSnapshot>>;
  try {
    replica = await createHostedBrowserVaultReplicaForSnapshot({
      generatedAt: snapshotRef.updatedAt,
      snapshotRef,
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "replica-create",
      error,
      platform: input.platform,
      request: input.request,
      sidecar: "browser-vault-replica",
    });
    return {
      browserVaultReplicaRef: null,
      snapshotRef,
    };
  }

  if (!replica) {
    return {
      browserVaultReplicaRef: null,
      snapshotRef,
    };
  }

  const browserVaultReplicaPort = input.platform.browserVaultReplicaPort;
  if (!browserVaultReplicaPort) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "replica-port-missing",
      platform: input.platform,
      request: input.request,
      sidecar: "browser-vault-replica",
    });
    return {
      browserVaultReplicaRef: null,
      snapshotRef,
    };
  }

  let browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  try {
    browserVaultReplicaRef = await browserVaultReplicaPort.write({ replica });
  } catch (error) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "replica-write",
      error,
      platform: input.platform,
      request: input.request,
      sidecar: "browser-vault-replica",
    });
    return {
      browserVaultReplicaRef: null,
      snapshotRef,
    };
  }

  if (browserVaultReplicaRef.sourceBundleHash !== snapshotRef.hash) {
    throw new TypeError(
      "Hosted workspace runtime bridge published a browser-vault replica for a different snapshot.",
    );
  }

  return {
    browserVaultReplicaRef,
    snapshotRef,
  };
}

async function createHostedWorkspaceBridgeHotCheckpointSnapshot(input: {
  baseSnapshotRef: HostedExecutionBundleRef;
  browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  codexHomeSnapshotHashSecret: string | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const startedAt = Date.now();
  let bundlePutBytes = 0;
  let hotStateBundleBytes = 0;
  let hotStateFileCount = 0;
  let hotStateInlineBytes = 0;
  let leaseCheckCount = 0;
  const hot = await snapshotHostedRuntimeBridgeWorkspaceBundle({
    readCurrentLease: async () => {
      leaseCheckCount += 1;
      return await input.readCurrentLease();
    },
    request: input.request,
    snapshotWorkspace: async () => {
      const snapshot = await snapshotHostedAssistantRuntimeHotState({
        codexHomeSnapshotHashSecret: input.codexHomeSnapshotHashSecret,
        operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
        vaultRoot: input.vaultRoot,
      });
      hotStateBundleBytes = snapshot.bundleBytes;
      hotStateFileCount = snapshot.fileCount;
      hotStateInlineBytes = snapshot.inlineBytes;
      await writeHostedCodexHomeSnapshotDiagnosticLog({
        diagnostics: snapshot.codexHomeSnapshotDiagnostics,
        platform: input.platform,
        request: input.request,
      });
      return snapshot.bundle;
    },
    userId: input.userId,
    writeBundle: async ({ bundle }) => {
      const hash = sha256HostedBundleHex(bundle);
      bundlePutBytes = bundle.byteLength;
      await input.platform.artifactStore.put({
        bytes: bundle,
        sha256: hash,
      });

      return {
        hash,
        key: `cloudflare-workspace-hot-state/${hash}.bundle`,
        size: bundle.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  });

  await writeHostedCheckpointSnapshotMetricLog({
    bundlePutBytes,
    bundlePutCount: 1,
    externalArtifactPutBytes: 0,
    externalArtifactPutCount: 0,
    hotStateBundleBytes,
    hotStateFileCount,
    hotStateInlineBytes,
    leaseCheckCount,
    mode: "hot",
    platform: input.platform,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
  });

  return {
    browserVaultReplicaRef: input.browserVaultReplicaRef,
    snapshotRef: buildHostedExecutionLayeredSnapshotRef({
      base: input.baseSnapshotRef,
      hot,
    }),
  };
}

async function readHostedWorkspaceCurrentCheckpointRefs(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
}): Promise<{
  baseSnapshotRef: HostedExecutionBundleRef | null;
  browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"] | null;
}> {
  if (!input.platform.workspacePort?.read) {
    throw new TypeError(
      "Hosted workspace runtime bridge requires workspace read support for hot checkpoints.",
    );
  }

  const currentWorkspace = await input.platform.workspacePort.read();
  return {
    baseSnapshotRef: readHostedExecutionSnapshotBaseRef(currentWorkspace.workspace?.snapshotRef ?? null),
    browserVaultReplicaRef: currentWorkspace.workspace?.browserVaultReplicaRef ?? null,
  };
}

async function writeHostedCheckpointOptionalSidecarDegradedLog(params: {
  degradedBy: "current-ref-read" | "replica-create" | "replica-port-missing" | "replica-write";
  error?: unknown;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  sidecar: "browser-vault-replica" | "hot-checkpoint-base";
}): Promise<void> {
  const errorName = params.error instanceof Error
    ? params.error.name
    : params.error === undefined
      ? null
      : typeof params.error;
  console.warn("Hosted checkpoint optional sidecar degraded.", {
    degradedBy: params.degradedBy,
    errorName,
    sidecar: params.sidecar,
  });

  if (!params.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: params.request.reason,
    degradedBy: params.degradedBy,
    errorName,
    sidecar: params.sidecar,
  };

  try {
    await params.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: params.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.optional_sidecar_degraded",
          leaseGeneration: params.request.leaseGeneration,
          level: "warn",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: params.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (logError) {
    console.warn("Hosted checkpoint optional sidecar degradation log write failed.", {
      errorName: logError instanceof Error ? logError.name : typeof logError,
    });
  }
}

async function writeHostedCheckpointHotStateFallbackLog(input: {
  error: HostedAssistantRuntimeHotStateBudgetExceededError | HostedAssistantRuntimeHotStateIncompleteError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  console.warn("Hosted checkpoint hot-state fallback triggered.", {
    errorName: input.error.name,
  });
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    errorName: input.error.name,
    fallbackReason:
      input.error instanceof HostedAssistantRuntimeHotStateBudgetExceededError
        ? "budget_exceeded"
        : "continuity_incomplete",
    ...(input.error instanceof HostedAssistantRuntimeHotStateBudgetExceededError
      ? {
          budgetActual: input.error.actual,
          budgetClass: input.error.budget,
          budgetLimit: input.error.limit,
        }
      : {
          continuityReason: input.error.reason,
        }),
  };

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.hot_state_fallback",
          leaseGeneration: input.request.leaseGeneration,
          level: "warn",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted checkpoint hot-state fallback log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function writeHostedCheckpointFullFallbackContinuityFailedLog(input: {
  error: HostedWorkspaceSnapshotContinuityIncompleteError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  console.warn("Hosted checkpoint full fallback continuity failed.", {
    continuityReason: input.error.reason,
  });
  if (!input.platform.logPort) {
    return;
  }

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.codex_continuity_missing_after_full_fallback",
          leaseGeneration: input.request.leaseGeneration,
          level: "error",
          phase: "checkpoint",
          redactedJson: {
            checkpointReason: input.request.reason,
            continuityReason: input.error.reason,
            errorName: input.error.name,
          },
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted checkpoint full fallback continuity failure log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

type HostedWorkspaceCheckpointSnapshotMode = "full" | "hot";

function resolveHostedWorkspaceCheckpointSnapshotMode(
  reason: HostedWorkspaceCheckpointRequest["reason"],
): HostedWorkspaceCheckpointSnapshotMode {
  return reason === "maintenance" || reason === "system_mailbox_receipt" ? "full" : "hot";
}

async function writeHostedCheckpointSnapshotMetricLog(input: {
  bundlePutBytes: number;
  bundlePutCount: number;
  externalArtifactPutBytes: number;
  externalArtifactPutCount: number;
  hotStateBundleBytes: number | null;
  hotStateFileCount: number | null;
  hotStateInlineBytes: number | null;
  leaseCheckCount: number;
  mode: HostedWorkspaceCheckpointSnapshotMode;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  snapshotElapsedMs: number;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    bundlePutBytes: input.bundlePutBytes,
    bundlePutCount: input.bundlePutCount,
    checkpointPolicy: input.mode,
    checkpointReason: input.request.reason,
    externalArtifactPutBytes: input.externalArtifactPutBytes,
    externalArtifactPutCount: input.externalArtifactPutCount,
    hotStateBundleBytes: input.hotStateBundleBytes,
    hotStateFileCount: input.hotStateFileCount,
    hotStateInlineBytes: input.hotStateInlineBytes,
    leaseCheckCount: input.leaseCheckCount,
    snapshotElapsedMs: input.snapshotElapsedMs,
    snapshotMode: input.mode === "hot" ? "hot-state" : "full",
  };

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.snapshot_finished",
          leaseGeneration: input.request.leaseGeneration,
          level: "info",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted checkpoint snapshot metric log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function writeHostedCodexHomeSnapshotDiagnosticLog(input: {
  diagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  if (!input.diagnostics || !input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    codexHomeIncludedRelHashes: input.diagnostics.codexHomeIncludedRelHashes,
    codexHomeSnapshotCandidateCount:
      input.diagnostics.codexHomeSnapshotCandidateCount,
    codexHomeSnapshotExcludedClassSummary:
      input.diagnostics.codexHomeSnapshotExcludedClassSummary,
    codexHomeSnapshotIncludedCount:
      input.diagnostics.codexHomeSnapshotIncludedCount,
  };

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "workspace.codex_home_snapshot",
          leaseGeneration: input.request.leaseGeneration,
          level: "info",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted Codex home snapshot diagnostic log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function resolveHostedCodexHomeSnapshotHashSecret(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv: Readonly<Record<string, string>>;
}): string | null {
  return normalizeHostedRuntimeBridgeString(
    input.forwardedEnv.HOSTED_LOG_FINGERPRINT_SECRET
      ?? input.platformEnv.HOSTED_LOG_FINGERPRINT_SECRET,
  );
}

function normalizeHostedRuntimeBridgeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

async function readHostedMailboxEncryptionEnvironmentFromRuntime(input: {
  platformEnv: Readonly<Record<string, string>>;
  userId: string;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
  webControlFetch?: typeof fetch;
}): Promise<HostedMailboxEncryptionEnvironment> {
  if (Object.keys(input.platformEnv).length === 0) {
    throw new Error(
      "Hosted runtime platformEnv is required for hosted mailbox payload decrypt.",
    );
  }
  const workerEnv = readHostedExecutionWorkerEnvironment(input.platformEnv, {
    allowHostedWebHttpHosts: input.webControlAllowHttpHosts,
  });
  const cryptoEnv = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
      workerEnv.hostedCryptoAuthoritySignKeyVersion,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
      workerEnv.hostedCryptoAuthoritySignPublicKeyPem,
    ...(workerEnv.hostedCryptoAuthorityVerifyKeyringJson
      ? {
          HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON:
            workerEnv.hostedCryptoAuthorityVerifyKeyringJson,
        }
      : {}),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      workerEnv.hostedCryptoCloudflareAutomationKeyId,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      workerEnv.hostedCryptoCloudflareAutomationPrivateJwk,
    ...(workerEnv.hostedCryptoCloudflareAutomationPrivateKeyringJson
      ? {
          HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
            workerEnv.hostedCryptoCloudflareAutomationPrivateKeyringJson,
        }
      : {}),
    HOSTED_CRYPTO_ENV: workerEnv.hostedCryptoEnv,
    ...(input.platformEnv.NODE_ENV ? { NODE_ENV: input.platformEnv.NODE_ENV } : {}),
    ...(input.platformEnv.VERCEL_ENV ? { VERCEL_ENV: input.platformEnv.VERCEL_ENV } : {}),
  } satisfies HostedWorkerCryptoEnv;
  const rootsById = new Map<string, Promise<{ rootKey: Uint8Array; rootKeyId: string }>>();

  return createHostedMailboxEncryptionEnvironmentFromIngressRootResolver({
    readIngressRoot(rootKeyId) {
      const existing = rootsById.get(rootKeyId);
      if (existing) {
        return existing;
      }
      const created = fetchHostedWorkerRuntimeRootByRootKeyId({
        baseUrl: input.webControlBaseUrl ?? workerEnv.hostedWebBaseUrl,
        callbackSigning: readHostedWebCallbackSigningEnvironment(input.platformEnv),
        cryptoEnv,
        domain: "ingress",
        allowHttpHosts: input.webControlAllowHttpHosts,
        fetchImpl: input.webControlFetch,
        rootKeyId,
        timeoutMs: workerEnv.webControlTimeoutMs,
        userId: input.userId,
      }).then((root) => ({
        rootKey: root.rootKey,
        rootKeyId: root.envelope.rootKeyId,
      }));
      rootsById.set(rootKeyId, created);
      return created;
    },
  });
}

function createHostedWorkspaceBridgeMailboxImporter(input: {
  readEncryptionEnvironment: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  } & Pick<HostedRuntimeBridgeNormalizedRuntime, "commitTimeoutMs" | "resolvedConfig" | "userEnv">;
  vaultRoot: string;
}): HostedWorkspaceRuntimeBridgeImportItem {
  return async (item, context) => {
    const importConversationItem = createHostedConversationMailboxImportItem({
      decodePayload: {
        decode: async (decodeInput) => {
          const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
            ciphertext: decodeInput.payloadCiphertext,
            environment: await input.readEncryptionEnvironment({
              userId: decodeInput.itemRef.userId,
            }),
            metadata: {
              dedupeKey: decodeInput.itemRef.dedupeKey,
              itemId: decodeInput.itemRef.id,
              kind: decodeInput.itemRef.kind,
              lane: decodeInput.itemRef.lane,
              laneSeq: decodeInput.itemRef.laneSeq,
              occurredAt: decodeInput.itemRef.occurredAt,
              payloadSchema: decodeInput.payloadSchema,
              payloadStorage: decodeInput.payloadSource === "inline" ? "inline" : "sidecar",
              userId: decodeInput.itemRef.userId,
            },
          });
          const wake = parseHostedExecutionWake(decodedPayload);
          if (wake.kind !== "conversation.message") {
            return {
              reasonCode: "payload.decode_mismatch",
              retryable: false,
              status: "blocked",
            };
          }

          return {
            status: "decoded",
            wake,
          };
        },
      },
      onDecodedConversationWake: (wake) => {
        context?.recordMessagingReturnTarget?.(
          resolveHostedCliBridgeMessagingReturnTarget(wake),
        );
      },
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });

    return importHostedWorkspaceBridgeMailboxItem({
      ...input,
      importConversationItem,
      item,
    });
  };
}

async function importHostedWorkspaceBridgeMailboxItem(input: {
  importConversationItem: (item: HostedWorkspaceRuntimeBridgeImportItemInput) =>
    ReturnType<HostedWorkspaceRuntimeBridgeImportItem>;
  item: HostedWorkspaceRuntimeBridgeImportItemInput;
  readEncryptionEnvironment: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  } & Pick<HostedRuntimeBridgeNormalizedRuntime, "commitTimeoutMs" | "resolvedConfig" | "userEnv">;
  vaultRoot: string;
}): ReturnType<HostedWorkspaceRuntimeBridgeImportItem> {
  if (
    input.item.route.action === "import-conversation-message"
    && input.item.item.kind === "conversation.message"
  ) {
    return await input.importConversationItem(input.item);
  }

  if (
    input.item.route.action === "import-conversation-message"
    || input.item.item.kind === "conversation.message"
  ) {
    return {
      reasonCode: "cloudflare_bridge.unhandled_mailbox_route",
      status: "deferred",
    };
  }

  const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
    ciphertext: input.item.payload.payloadCiphertext,
    environment: await input.readEncryptionEnvironment({
      userId: input.item.item.userId,
    }),
    metadata: {
      dedupeKey: input.item.item.dedupeKey,
      itemId: input.item.item.id,
      kind: input.item.item.kind,
      lane: input.item.item.lane,
      laneSeq: input.item.item.laneSeq,
      occurredAt: input.item.item.occurredAt,
      payloadSchema: input.item.payload.payloadSchema,
      payloadStorage: input.item.payload.source === "inline" ? "inline" : "sidecar",
      userId: input.item.item.userId,
    },
  });
  const wake = parseHostedExecutionWake(decodedPayload);

  if (!decodedSystemWakeMatchesMailboxItem(wake, input.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  return await enqueueHostedSystemMailboxItem({
    item: input.item,
    vaultRoot: input.vaultRoot,
    wake,
  });
}

function resolveHostedCliBridgeMessagingReturnTarget(
  wake: HostedExecutionConversationMessageWake,
): HostedRuntimeDeviceSyncMessagingReturnTarget | null {
  if (isHostedTelegramConversationMessageWake(wake)) {
    return "telegram";
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    return "imessage";
  }

  return null;
}

function decodedSystemWakeMatchesMailboxItem(
  wake: HostedExecutionWake,
  item: HostedWorkspaceRuntimeBridgeImportItemInput,
): wake is HostedExecutionSystemWake {
  return wake.kind !== "conversation.message"
    && wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey
    && wake.kind === item.item.kind;
}

function resolveWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  return path.join(path.dirname(vaultRoot), `${path.basename(vaultRoot)}-operator-home`);
}

function normalizeVaultRoot(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new TypeError("Hosted workspace runtime bridge requires an explicit vault root.");
  }

  if (!path.isAbsolute(normalized)) {
    throw new TypeError("Hosted workspace runtime bridge vault root must be absolute.");
  }

  return normalized;
}
