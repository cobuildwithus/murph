import path from "node:path";

import {
  createHostedBrowserVaultReplicaForSourceState,
  createHostedConversationMailboxImportItem,
  enqueueHostedSystemMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeConfig,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionWorkingSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
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
  HostedWorkspaceSnapshotContinuityIncompleteError,
  HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
  HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  createHostedPortableWorkspaceManifestFromBundle,
  readHostedPortableWorkspaceDeltaManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  sha256HostedBundleHex,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedExecutionContext,
  type HostedBundleArtifactRef,
  type HostedBundleArtifactRestoreInput,
  type HostedBundleArtifactSnapshotInput,
  type HostedCodexHomeSnapshotDiagnostics,
  type HostedPortableWorkspaceDeltaManifest,
  type HostedPortableWorkspaceManifest,
  type HostedPortableWorkspaceManifestFile,
  type HostedWorkspaceArtifactPersistInput,
  type HostedWorkspaceSnapshotSizeDiagnostics,
} from "@murphai/runtime-state/node";

import {
  HostedRuntimeBridgeCheckpointLeaseError,
  snapshotHostedRuntimeBridgeWorkspaceBundle,
  type HostedRuntimeBridgeCheckpointLease,
  type HostedRuntimeBridgeCheckpointLeaseStage,
} from "./runtime-bridge-checkpoint.ts";
import type {
  HostedMailboxPayloadDecodeInput,
  HostedMailboxPayloadDecodeResult,
} from "./runtime-mailbox-payload-decode-contract.ts";
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
import {
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.ts";
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

export type HostedWorkspaceMailboxPayloadDecodeInput = HostedMailboxPayloadDecodeInput;
export type HostedWorkspaceMailboxPayloadDecodeResult = HostedMailboxPayloadDecodeResult;

export interface HostedWorkspaceMailboxPayloadDecoder {
  decode(
    input: HostedWorkspaceMailboxPayloadDecodeInput,
  ): Promise<HostedWorkspaceMailboxPayloadDecodeResult>;
}

export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  decodeMailboxPayload?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  readEncryptionEnvironment?: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
  requireMailboxPayloadDecoder?: boolean;
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
  if (input.requireMailboxPayloadDecoder && !input.decodeMailboxPayload) {
    throw new Error("Hosted mailbox payload decoder is required for this invocation.");
  }

  const decodeMailboxPayload = input.decodeMailboxPayload
    ?? createLegacyHostedMailboxPayloadDecoder({
      readEncryptionEnvironment: input.readEncryptionEnvironment
        ?? createHostedMailboxEncryptionEnvironmentReader({
          runtime,
          webControlAllowHttpHosts: input.webControlAllowHttpHosts,
          webControlBaseUrl: input.webControlBaseUrl ?? null,
          webControlFetch: input.webControlFetch,
        }),
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
      decodeMailboxPayload,
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

function createLegacyHostedMailboxPayloadDecoder(input: {
  readEncryptionEnvironment: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
}): HostedWorkspaceMailboxPayloadDecoder {
  return {
    async decode(decodeInput) {
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

      return {
        status: "decoded",
        wake: parseHostedExecutionWake(decodedPayload),
      };
    },
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
  const currentRefs = input.platform.workspacePort?.read
    ? await readHostedWorkspaceCurrentCheckpointRefs(input)
    : {
        baseSnapshotRef: null,
        browserVaultReplicaRef: null,
        snapshotRef: null,
      };
  const commitKind = resolveHostedWorkspaceCommitKind({
    currentSnapshotRef: currentRefs.snapshotRef,
    reason: input.request.reason,
  });

  if (commitKind === "working_commit") {
    return await createWorkingCommitSnapshot({
      ...input,
      currentRefs,
    });
  }

  const preservedState = input.request.reason === "idle_shutdown"
    ? await readHostedWorkspaceCurrentEffectivePreservedStateForCompaction(input)
    : await readHostedWorkspaceCurrentEffectivePreservedStateBestEffort(input);
  try {
    return commitKind === "full_compaction"
      ? await createFullCompactionSnapshot({
          ...input,
          preservedState,
        })
      : await createFullSeedSnapshot({
          ...input,
          preservedState,
        });
  } catch (error) {
    if (
      input.request.reason === "idle_shutdown"
      && error instanceof HostedWorkspaceSnapshotContinuityIncompleteError
    ) {
      return await createHostedWorkspaceBridgeIdleShutdownCheckpointSkip({
        ...input,
        error,
      });
    }
    throw error;
  }
}

class HostedWorkspaceWorkingCheckpointBaseUnavailableError extends Error {
  constructor() {
    super("Hosted workspace working checkpoint base bundle is missing.");
    this.name = "HostedWorkspaceWorkingCheckpointBaseUnavailableError";
  }
}

type HostedWorkspaceFullCheckpointCommitKind = Exclude<
  HostedWorkspaceCommitKind,
  "working_commit"
>;
type HostedWorkspaceBrowserVaultReplicaPolicy = "omit" | "publish";

async function createFullSeedSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionBundleRef;
}> {
  return await createFullSnapshot({
    ...input,
    browserVaultReplicaPolicy: "omit",
    commitKind: "full_seed",
  });
}

async function createFullCompactionSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionBundleRef;
}> {
  return await createFullSnapshot({
    ...input,
    browserVaultReplicaPolicy: "publish",
    commitKind: "full_compaction",
  });
}

interface HostedWorkspaceBridgeFullSnapshotInput {
  codexHomeSnapshotHashSecret: string | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  preservedState?: HostedWorkspaceEffectivePreservedState | null;
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}

async function createFullSnapshot(input: HostedWorkspaceBridgeFullSnapshotInput & {
  browserVaultReplicaPolicy: HostedWorkspaceBrowserVaultReplicaPolicy;
  commitKind: HostedWorkspaceFullCheckpointCommitKind;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionBundleRef;
}> {
  const startedAt = Date.now();
  let externalArtifactPutBytes = 0;
  let externalArtifactPutCount = 0;
  let bundlePutBytes = 0;
  let leaseCheckCount = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  const pendingArtifactPuts: HostedWorkspaceArtifactPersistInput[] = [];
  const snapshotRef = await snapshotHostedRuntimeBridgeWorkspaceBundle({
    readCurrentLease: async () => {
      leaseCheckCount += 1;
      return await input.readCurrentLease();
    },
    request: input.request,
    snapshotWorkspace: async () => {
      let snapshot: Awaited<ReturnType<typeof snapshotHostedExecutionContext>>;
      try {
        snapshot = await snapshotHostedExecutionContext({
          artifactRefProvider: input.preservedState?.artifactRefProvider,
          artifactSink: async (artifact) => {
            pendingArtifactPuts.push(artifact);
          },
          codexHomeSnapshotHashSecret: input.codexHomeSnapshotHashSecret,
          operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
          preservedArtifacts: input.preservedState?.preservedArtifacts,
          vaultRoot: input.vaultRoot,
          workspaceSnapshotSizeDiagnosticsSink: async (diagnostics) => {
            workspaceSnapshotSizeDiagnostics = diagnostics;
            await writeHostedCheckpointSnapshotSizeDiagnosticLog({
              diagnostics,
              mode: "full",
              platform: input.platform,
              request: input.request,
            });
          },
        });
      } catch (error) {
        await writeHostedCodexHomeSnapshotFailureLog({
          error,
          platform: input.platform,
          request: input.request,
          snapshotMode: "full",
        });
        throw error;
      }
      await writeHostedCodexHomeSnapshotDiagnosticLog({
        diagnostics: snapshot.codexHomeSnapshotDiagnostics,
        platform: input.platform,
        request: input.request,
      });
      workspaceSnapshotSizeDiagnostics = snapshot.workspaceSnapshotSizeDiagnostics;

      return snapshot.bundle;
    },
    userId: input.userId,
    writeBundle: async ({ bundle }) => {
      const hash = sha256HostedBundleHex(bundle);
      bundlePutBytes = bundle.byteLength;
      for (const artifact of pendingArtifactPuts) {
        externalArtifactPutCount += 1;
        externalArtifactPutBytes += artifact.bytes.byteLength;
        await input.platform.artifactStore.put({
          bytes: artifact.bytes,
          sha256: artifact.ref.sha256,
        });
      }
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

  const browserVaultReplica = input.browserVaultReplicaPolicy === "publish"
    ? await publishHostedWorkspaceBridgeBrowserVaultReplica({
        platform: input.platform,
        request: input.request,
        sourceRef: snapshotRef,
        vaultRoot: input.vaultRoot,
      })
    : {};

  await writeHostedCheckpointSnapshotMetricLog({
    bundlePutBytes,
    bundlePutCount: 1,
    browserVaultReplicaState: input.browserVaultReplicaPolicy === "publish"
      ? browserVaultReplica.browserVaultReplicaRef ? "written" : "degraded"
      : "omitted",
    commitKind: input.commitKind,
    externalArtifactPutBytes,
    externalArtifactPutCount,
    leaseCheckCount,
    mode: "full",
    platform: input.platform,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
    workspaceSnapshotSizeDiagnostics,
  });

  return {
    ...browserVaultReplica,
    snapshotRef,
  };
}

async function createWorkingCommitSnapshot(input: {
  codexHomeSnapshotHashSecret: string | null;
  currentRefs: {
    baseSnapshotRef: HostedExecutionBundleRef | null;
    browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"] | null;
    snapshotRef: HostedExecutionSnapshotRef | null;
  };
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const baseSnapshotRef = input.currentRefs.baseSnapshotRef;
  if (!baseSnapshotRef) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }
  const baseBundle = await input.platform.artifactStore.get(baseSnapshotRef.hash);
  if (!baseBundle) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseBundle)
      ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
  const preservedState = input.currentRefs.snapshotRef
    ? await readHostedWorkspaceEffectivePreservedState({
        platform: input.platform,
        snapshotRef: input.currentRefs.snapshotRef,
      })
    : createHostedWorkspaceEffectivePreservedStateFromManifest(baseManifest);

  const startedAt = Date.now();
  let externalArtifactPutBytes = 0;
  let externalArtifactPutCount = 0;
  let bundlePutBytes = 0;
  let leaseCheckCount = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  let workingDeltaUpsertCount = 0;
  let workingDeltaTombstoneCount = 0;
  const pendingArtifactPuts: HostedWorkspaceArtifactPersistInput[] = [];

  leaseCheckCount += 1;
  assertHostedWorkspaceBridgeCheckpointLease({
    lease: await input.readCurrentLease(),
    request: input.request,
    userId: input.userId,
    stage: "before_snapshot",
  });

  let snapshot: Awaited<ReturnType<typeof snapshotHostedPortableWorkspaceDelta>>;
  try {
    snapshot = await snapshotHostedPortableWorkspaceDelta({
      artifactRefProvider: preservedState.artifactRefProvider,
      artifactSink: async (artifact) => {
        pendingArtifactPuts.push(artifact);
      },
      baseManifest,
      baseSnapshotHash: baseSnapshotRef.hash,
      codexHomeSnapshotHashSecret: input.codexHomeSnapshotHashSecret,
      materializedArtifactPaths: createHostedWorkspaceBridgeMaterializedArtifactPathSet(
        preservedState.preservedArtifacts,
      ),
      operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
      preservedArtifacts: preservedState.preservedArtifacts,
      vaultRoot: input.vaultRoot,
      workspaceSnapshotSizeDiagnosticsSink: async (diagnostics) => {
        workspaceSnapshotSizeDiagnostics = diagnostics;
        await writeHostedCheckpointSnapshotSizeDiagnosticLog({
          diagnostics,
          mode: "working",
          platform: input.platform,
          request: input.request,
        });
      },
    });
  } catch (error) {
    await writeHostedCodexHomeSnapshotFailureLog({
      error,
      platform: input.platform,
      request: input.request,
      snapshotMode: "working",
    });
    throw error;
  }

  await writeHostedCodexHomeSnapshotDiagnosticLog({
    diagnostics: snapshot.codexHomeSnapshotDiagnostics,
    platform: input.platform,
    request: input.request,
  });
  workspaceSnapshotSizeDiagnostics = snapshot.workspaceSnapshotSizeDiagnostics;

  if (snapshot.kind === "unchanged") {
    await writeHostedCheckpointSnapshotMetricLog({
      bundlePutBytes,
      bundlePutCount: 0,
      browserVaultReplicaState: "omitted",
      commitKind: "working_commit",
      externalArtifactPutBytes,
      externalArtifactPutCount,
      leaseCheckCount,
      mode: "working",
      platform: input.platform,
      request: input.request,
      snapshotElapsedMs: Date.now() - startedAt,
      workingDeltaTombstoneCount,
      workingDeltaUpsertCount,
      workspaceSnapshotSizeDiagnostics,
    });

    return {
      snapshotRef: input.currentRefs.snapshotRef ?? baseSnapshotRef,
    };
  }

  workingDeltaUpsertCount = snapshot.manifest.upserts.length;
  workingDeltaTombstoneCount = snapshot.manifest.tombstones.length;

  leaseCheckCount += 1;
  assertHostedWorkspaceBridgeCheckpointLease({
    lease: await input.readCurrentLease(),
    request: input.request,
    userId: input.userId,
    stage: "before_bundle_write",
  });

  const deltaHash = sha256HostedBundleHex(snapshot.bundle);
  bundlePutBytes = snapshot.bundle.byteLength;
  for (const artifact of pendingArtifactPuts) {
    externalArtifactPutCount += 1;
    externalArtifactPutBytes += artifact.bytes.byteLength;
    await input.platform.artifactStore.put({
      bytes: artifact.bytes,
      sha256: artifact.ref.sha256,
    });
  }
  await input.platform.artifactStore.put({
    bytes: snapshot.bundle,
    sha256: deltaHash,
  });
  const deltaRef: HostedExecutionBundleRef = {
    hash: deltaHash,
    key: `cloudflare-workspace-deltas/${deltaHash}.bundle`,
    size: snapshot.bundle.byteLength,
    updatedAt: new Date().toISOString(),
  };

  await writeHostedCheckpointSnapshotMetricLog({
    bundlePutBytes,
    bundlePutCount: 1,
    browserVaultReplicaState: "omitted",
    commitKind: "working_commit",
    externalArtifactPutBytes,
    externalArtifactPutCount,
    leaseCheckCount,
    mode: "working",
    platform: input.platform,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
    workingDeltaTombstoneCount,
    workingDeltaUpsertCount,
    workspaceSnapshotSizeDiagnostics,
  });

  return {
    snapshotRef: buildHostedExecutionWorkingSnapshotRef({
      base: baseSnapshotRef,
      delta: deltaRef,
    }),
  };
}

async function publishHostedWorkspaceBridgeBrowserVaultReplica(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  sourceRef: HostedExecutionBundleRef;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
}> {
  let replica: Awaited<ReturnType<typeof createHostedBrowserVaultReplicaForSourceState>>;
  try {
    replica = await createHostedBrowserVaultReplicaForSourceState({
      generatedAt: input.sourceRef.updatedAt,
      sourceStateHash: input.sourceRef.hash,
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
    return {};
  }

  const browserVaultReplicaPort = input.platform.browserVaultReplicaPort;
  if (!browserVaultReplicaPort) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "replica-port-missing",
      platform: input.platform,
      request: input.request,
      sidecar: "browser-vault-replica",
    });
    return {};
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
    return {};
  }

  if (browserVaultReplicaRef.sourceBundleHash !== input.sourceRef.hash) {
    await writeHostedCheckpointOptionalSidecarDegradedLog({
      degradedBy: "replica-ref-mismatch",
      platform: input.platform,
      request: input.request,
      sidecar: "browser-vault-replica",
    });
    return {};
  }

  return {
    browserVaultReplicaRef,
  };
}

function createBaseManifestArtifactRefProvider(
  baseManifest: HostedPortableWorkspaceManifest,
): (artifact: HostedBundleArtifactSnapshotInput) => HostedBundleArtifactRef | null {
  const artifactFiles = new Map(
    baseManifest.files
      .filter((file) => file.artifact)
      .map((file) => [`${file.root}:${file.path}`, file] as const),
  );

  return (artifact) => {
    const baseFile = artifactFiles.get(`${artifact.root}:${artifact.path}`);
    if (!baseFile?.artifact || baseFile.size !== artifact.bytes.byteLength) {
      return null;
    }

    const liveHash = sha256HostedBundleHex(artifact.bytes);
    if (baseFile.sha256 !== liveHash || baseFile.artifact.sha256 !== liveHash) {
      return null;
    }

    return baseFile.artifact;
  };
}

function createBaseManifestPreservedArtifacts(
  baseManifest: HostedPortableWorkspaceManifest,
): HostedBundleArtifactRestoreInput[] {
  return baseManifest.files
    .flatMap((file) => file.artifact
      ? [{
          path: file.path,
          ref: file.artifact,
          root: file.root,
        }]
      : []);
}

function createHostedWorkspaceBridgeMaterializedArtifactPathSet(
  artifacts: readonly HostedBundleArtifactRestoreInput[],
): Set<string> {
  return new Set(
    artifacts
      .filter((artifact) => shouldRestoreHostedRuntimeBridgeEagerArtifact(artifact))
      .map((artifact) => `${artifact.root}:${artifact.path}`),
  );
}

function shouldRestoreHostedRuntimeBridgeEagerArtifact(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root === "operator-home") {
    return hasHostedRuntimeBridgeEagerArtifactPrefix(input.path, ".codex-hosted");
  }

  if (input.root !== "vault") {
    return false;
  }

  return (
    hasHostedRuntimeBridgeEagerArtifactPrefix(input.path, "raw/inbox")
    || hasHostedRuntimeBridgeEagerArtifactPrefix(input.path, "raw/assistant-input")
    || hasHostedRuntimeBridgeEagerArtifactPrefix(input.path, "derived/inbox")
    || hasHostedRuntimeBridgeEagerArtifactPrefix(input.path, "derived/assistant-input")
  );
}

function hasHostedRuntimeBridgeEagerArtifactPrefix(
  relativePath: string,
  prefix: string,
): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

interface HostedWorkspaceEffectivePreservedState {
  artifactRefProvider: (artifact: HostedBundleArtifactSnapshotInput) => HostedBundleArtifactRef | null;
  manifest: HostedPortableWorkspaceManifest;
  preservedArtifacts: HostedBundleArtifactRestoreInput[];
}

async function readHostedWorkspaceCurrentEffectivePreservedStateBestEffort(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
}): Promise<HostedWorkspaceEffectivePreservedState | null> {
  try {
    const currentRefs = await readHostedWorkspaceCurrentCheckpointRefs(input);
    if (!currentRefs.snapshotRef) {
      return null;
    }
    return await readHostedWorkspaceEffectivePreservedState({
      ...input,
      snapshotRef: currentRefs.snapshotRef,
    });
  } catch {
    return null;
  }
}

async function readHostedWorkspaceCurrentEffectivePreservedStateForCompaction(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
}): Promise<HostedWorkspaceEffectivePreservedState | null> {
  if (!input.platform.workspacePort?.read) {
    return null;
  }
  const currentRefs = await readHostedWorkspaceCurrentCheckpointRefs(input);
  if (!currentRefs.snapshotRef) {
    return null;
  }
  if (readHostedExecutionSnapshotDeltaRef(currentRefs.snapshotRef)) {
    return await readHostedWorkspaceEffectivePreservedState({
      ...input,
      snapshotRef: currentRefs.snapshotRef,
    });
  }
  try {
    return await readHostedWorkspaceEffectivePreservedState({
      ...input,
      snapshotRef: currentRefs.snapshotRef,
    });
  } catch {
    return null;
  }
}

async function readHostedWorkspaceEffectivePreservedState(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  snapshotRef: HostedExecutionSnapshotRef | null;
}): Promise<HostedWorkspaceEffectivePreservedState> {
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(input.snapshotRef);
  if (!baseSnapshotRef) {
    return createHostedWorkspaceEffectivePreservedStateFromManifest(
      createEmptyHostedPortableWorkspaceManifest(),
    );
  }

  const baseBundle = await input.platform.artifactStore.get(baseSnapshotRef.hash);
  if (!baseBundle) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseBundle)
      ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(input.snapshotRef);
  if (!deltaSnapshotRef) {
    const hotSnapshotRef = readHostedExecutionSnapshotHotRef(input.snapshotRef);
    if (hotSnapshotRef) {
      const hotBundle = await input.platform.artifactStore.get(hotSnapshotRef.hash);
      if (!hotBundle) {
        throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
      }
      const hotManifest = createHostedPortableWorkspaceManifestFromBundle(hotBundle);
      return createHostedWorkspaceEffectivePreservedStateFromManifest(
        createHostedWorkspaceBridgeOverlayManifest({
          baseManifest,
          overlayManifest: hotManifest,
        }),
      );
    }
    return createHostedWorkspaceEffectivePreservedStateFromManifest(baseManifest);
  }

  const deltaBundle = await input.platform.artifactStore.get(deltaSnapshotRef.hash);
  if (!deltaBundle) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }
  const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(deltaBundle);
  if (!deltaManifest) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }

  return createHostedWorkspaceEffectivePreservedStateFromManifest(
    createHostedWorkspaceEffectiveManifestFromDelta({
      baseManifest,
      deltaManifest,
    }),
  );
}

function createHostedWorkspaceEffectivePreservedStateFromManifest(
  manifest: HostedPortableWorkspaceManifest,
): HostedWorkspaceEffectivePreservedState {
  return {
    artifactRefProvider: createBaseManifestArtifactRefProvider(manifest),
    manifest,
    preservedArtifacts: createBaseManifestPreservedArtifacts(manifest),
  };
}

function createEmptyHostedPortableWorkspaceManifest(): HostedPortableWorkspaceManifest {
  const body = {
    files: [],
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  } as const;
  return {
    files: [],
    manifestHash: sha256HostedBundleHex(Buffer.from(JSON.stringify(body))),
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  };
}

function createHostedWorkspaceEffectiveManifestFromDelta(input: {
  baseManifest: HostedPortableWorkspaceManifest;
  deltaManifest: HostedPortableWorkspaceDeltaManifest;
}): HostedPortableWorkspaceManifest {
  if (input.deltaManifest.baseManifestHash !== input.baseManifest.manifestHash) {
    throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
  }
  const files = new Map(input.baseManifest.files.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const tombstone of input.deltaManifest.tombstones) {
    files.delete(`${tombstone.root}:${tombstone.path}`);
  }
  for (const upsert of input.deltaManifest.upserts) {
    files.set(`${upsert.root}:${upsert.path}`, upsert);
  }

  return {
    files: [...files.values()].sort((left, right) =>
      `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`)
    ),
    manifestHash: input.deltaManifest.effectiveManifestHash,
    policyVersion: input.baseManifest.policyVersion,
    schema: input.baseManifest.schema,
  };
}

function createHostedWorkspaceBridgeOverlayManifest(input: {
  baseManifest: HostedPortableWorkspaceManifest;
  overlayManifest: HostedPortableWorkspaceManifest;
}): HostedPortableWorkspaceManifest {
  const files = new Map(input.baseManifest.files.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const file of input.overlayManifest.files) {
    files.set(`${file.root}:${file.path}`, file);
  }

  return finalizeHostedWorkspaceBridgePortableManifest([...files.values()]);
}

function finalizeHostedWorkspaceBridgePortableManifest(
  files: HostedPortableWorkspaceManifestFile[],
): HostedPortableWorkspaceManifest {
  const manifestBody: Omit<HostedPortableWorkspaceManifest, "manifestHash"> = {
    files: files
      .map(canonicalizeHostedWorkspaceBridgePortableManifestFile)
      .sort((left, right) => `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`)),
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  };
  return {
    ...manifestBody,
    manifestHash: sha256HostedBundleHex(Buffer.from(JSON.stringify(manifestBody))),
  };
}

function canonicalizeHostedWorkspaceBridgePortableManifestFile(
  file: HostedPortableWorkspaceManifestFile,
): HostedPortableWorkspaceManifestFile {
  return {
    ...(file.artifact
      ? {
          artifact: {
            byteSize: file.artifact.byteSize,
            sha256: file.artifact.sha256,
          },
        }
      : {}),
    path: file.path,
    root: file.root,
    sha256: file.sha256,
    size: file.size,
  };
}

async function readHostedWorkspaceCurrentCheckpointRefs(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
}): Promise<{
  baseSnapshotRef: HostedExecutionBundleRef | null;
  browserVaultReplicaRef: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"] | null;
  snapshotRef: HostedExecutionSnapshotRef | null;
}> {
  if (!input.platform.workspacePort?.read) {
    throw new TypeError(
      "Hosted workspace runtime bridge requires workspace read support for layered checkpoints.",
    );
  }

  const currentWorkspace = await input.platform.workspacePort.read();
  return {
    baseSnapshotRef: readHostedExecutionSnapshotBaseRef(currentWorkspace.workspace?.snapshotRef ?? null),
    browserVaultReplicaRef: currentWorkspace.workspace?.browserVaultReplicaRef ?? null,
    snapshotRef: currentWorkspace.workspace?.snapshotRef ?? null,
  };
}

async function createHostedWorkspaceBridgeIdleShutdownCheckpointSkip(input: {
  codexHomeSnapshotHashSecret: string | null;
  error: HostedWorkspaceSnapshotContinuityIncompleteError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const currentRefs = await readHostedWorkspaceCurrentCheckpointRefs(input);
  if (!currentRefs.snapshotRef) {
    throw input.error;
  }

  await writeHostedCheckpointIdleShutdownSkippedLog({
    error: input.error,
    platform: input.platform,
    request: input.request,
  });

  return {
    browserVaultReplicaRef: currentRefs.browserVaultReplicaRef,
    snapshotRef: currentRefs.snapshotRef,
  };
}

async function writeHostedCheckpointOptionalSidecarDegradedLog(params: {
  degradedBy:
    | "current-ref-read"
    | "replica-create"
    | "replica-port-missing"
    | "replica-ref-mismatch"
    | "replica-write";
  error?: unknown;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  sidecar: "browser-vault-replica" | "working-checkpoint-base";
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

async function writeHostedCheckpointIdleShutdownSkippedLog(params: {
  error: HostedWorkspaceSnapshotContinuityIncompleteError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  console.warn("Hosted idle-shutdown checkpoint snapshot skipped.", {
    continuityReason: params.error.reason,
    errorName: params.error.name,
  });
  if (!params.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: params.request.reason,
    continuityReason: params.error.reason,
    errorMessage: redactHostedRuntimeDiagnosticText(params.error.message),
    errorName: params.error.name,
    skipReason: "codex_continuity_incomplete",
  };
  appendHostedCodexHomeSnapshotDiagnostics(
    redactedJson,
    params.error.codexHomeSnapshotDiagnostics,
  );

  try {
    await params.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: params.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.idle_shutdown_snapshot_skipped",
          leaseGeneration: params.request.leaseGeneration,
          level: "warn",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: params.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted idle-shutdown checkpoint skip log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function writeHostedCodexHomeSnapshotFailureLog(input: {
  error: unknown;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  snapshotMode: HostedWorkspaceCheckpointSnapshotMode;
}): Promise<void> {
  if (!(input.error instanceof HostedWorkspaceSnapshotContinuityIncompleteError)) {
    return;
  }
  const diagnostics = input.error.codexHomeSnapshotDiagnostics;
  const errorMessage = redactHostedRuntimeDiagnosticText(readHostedSnapshotErrorMessage(input.error));
  const errorName = input.error.name;
  const { snapshotMode } = input;

  console.warn("Hosted Codex home snapshot failed.", {
    errorName,
    snapshotMode,
  });
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    errorMessage,
    errorName,
    snapshotMode,
  };
  appendHostedCodexHomeSnapshotDiagnostics(redactedJson, diagnostics);

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "workspace.codex_home_snapshot_failed",
          leaseGeneration: input.request.leaseGeneration,
          level: "error",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted Codex home snapshot failure log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

type HostedWorkspaceCommitKind =
  | "full_compaction"
  | "full_seed"
  | "working_commit";
type HostedWorkspaceCheckpointSnapshotMode = "full" | "working";

function resolveHostedWorkspaceCommitKind(input: {
  currentSnapshotRef: HostedExecutionSnapshotRef | null;
  reason: HostedWorkspaceCheckpointRequest["reason"];
}): HostedWorkspaceCommitKind {
  if (!readHostedExecutionSnapshotBaseRef(input.currentSnapshotRef)) {
    return "full_seed";
  }

  if (input.reason === "idle_shutdown") {
    return "full_compaction";
  }

  return "working_commit";
}

async function writeHostedCheckpointSnapshotMetricLog(input: {
  browserVaultReplicaState: "degraded" | "omitted" | "written";
  bundlePutBytes: number;
  bundlePutCount: number;
  commitKind: HostedWorkspaceCommitKind;
  externalArtifactPutBytes: number;
  externalArtifactPutCount: number;
  leaseCheckCount: number;
  mode: HostedWorkspaceCheckpointSnapshotMode;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
  snapshotElapsedMs: number;
  workingDeltaTombstoneCount?: number;
  workingDeltaUpsertCount?: number;
  workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    browserVaultReplicaState: input.browserVaultReplicaState,
    bundlePutBytes: input.bundlePutBytes,
    bundlePutCount: input.bundlePutCount,
    checkpointPolicy: input.mode,
    checkpointReason: input.request.reason,
    commitKind: input.commitKind,
    externalArtifactPutBytes: input.externalArtifactPutBytes,
    externalArtifactPutCount: input.externalArtifactPutCount,
    leaseCheckCount: input.leaseCheckCount,
    snapshotElapsedMs: input.snapshotElapsedMs,
    snapshotMode: input.mode,
  };
  if (input.workingDeltaTombstoneCount !== undefined) {
    redactedJson.workingDeltaTombstoneCount = input.workingDeltaTombstoneCount;
  }
  if (input.workingDeltaUpsertCount !== undefined) {
    redactedJson.workingDeltaUpsertCount = input.workingDeltaUpsertCount;
  }
  if (input.workspaceSnapshotSizeDiagnostics) {
    appendHostedWorkspaceSnapshotSizeDiagnostics(
      redactedJson,
      input.workspaceSnapshotSizeDiagnostics,
    );
  }

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

async function writeHostedCheckpointSnapshotSizeDiagnosticLog(input: {
  diagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
  mode: HostedWorkspaceCheckpointSnapshotMode;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointPolicy: input.mode,
    checkpointReason: input.request.reason,
    snapshotMode: input.mode,
  };
  appendHostedWorkspaceSnapshotSizeDiagnostics(redactedJson, input.diagnostics);

  try {
    await input.platform.logPort.write({
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.request.attemptId,
          component: "workspace",
          eventCode: "checkpoint.snapshot_size_progress",
          leaseGeneration: input.request.leaseGeneration,
          level: "info",
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted checkpoint snapshot size diagnostic log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function appendHostedWorkspaceSnapshotSizeDiagnostics(
  redactedJson: HostedRuntimeRedactedJson,
  diagnostics: HostedWorkspaceSnapshotSizeDiagnostics,
): void {
  redactedJson.workspaceSnapshotClassSummary =
    diagnostics.workspaceSnapshotClassSummary;
  redactedJson.workspaceSnapshotExternalArtifactBytes =
    diagnostics.workspaceSnapshotExternalArtifactBytes;
  redactedJson.workspaceSnapshotExternalArtifactCount =
    diagnostics.workspaceSnapshotExternalArtifactCount;
  redactedJson.workspaceSnapshotFingerprintStatus =
    diagnostics.workspaceSnapshotFingerprintStatus;
  redactedJson.workspaceSnapshotIncludedFileCount =
    diagnostics.workspaceSnapshotIncludedFileCount;
  redactedJson.workspaceSnapshotInlineBytes =
    diagnostics.workspaceSnapshotInlineBytes;
  redactedJson.workspaceSnapshotLargestFiles =
    diagnostics.workspaceSnapshotLargestFiles;
  redactedJson.workspaceSnapshotMaxFileBytes =
    diagnostics.workspaceSnapshotMaxFileBytes;
  redactedJson.workspaceSnapshotMaxFileClass =
    diagnostics.workspaceSnapshotMaxFileClass;
}

function appendHostedCodexHomeSnapshotDiagnostics(
  redactedJson: HostedRuntimeRedactedJson,
  diagnostics: HostedCodexHomeSnapshotDiagnostics | null,
): void {
  if (!diagnostics) {
    return;
  }

  redactedJson.codexResumeArchivedUnsupportedCount =
    diagnostics.codexResumeArchivedUnsupportedCount;
  redactedJson.codexResumeFlushFailed =
    diagnostics.codexResumeFlushFailed;
  redactedJson.codexResumeInvalidPathCount =
    diagnostics.codexResumeInvalidPathCount;
  redactedJson.codexResumeMissingRolloutCount =
    diagnostics.codexResumeMissingRolloutCount;
  redactedJson.codexResumeRolloutBytes =
    diagnostics.codexResumeRolloutBytes;
  redactedJson.codexResumeRolloutFileBytes =
    diagnostics.codexResumeRolloutFileBytes;
  redactedJson.codexResumeRolloutRelHashes =
    diagnostics.codexResumeRolloutRelHashes;
  redactedJson.codexResumeThreadCount =
    diagnostics.codexResumeThreadCount;
}

async function writeHostedCodexHomeSnapshotDiagnosticLog(input: {
  diagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  if (!input.diagnostics || !input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {};
  appendHostedCodexHomeSnapshotDiagnostics(redactedJson, input.diagnostics);

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

function readHostedSnapshotErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
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

function assertHostedWorkspaceBridgeCheckpointLease(input: {
  lease: HostedRuntimeBridgeCheckpointLease | null;
  request: HostedWorkspaceCheckpointRequest;
  stage?: HostedRuntimeBridgeCheckpointLeaseStage;
  userId: string;
}): void {
  const stage = input.stage ?? "before_snapshot";
  if (!input.lease) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("missing_lease", stage);
  }
  if (input.lease.userId !== input.userId) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_user", stage);
  }
  if (input.lease.attemptId !== input.request.attemptId) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_attempt", stage);
  }
  if (input.lease.leaseGeneration !== input.request.leaseGeneration) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_lease_generation", stage);
  }
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
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
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
          const decoded = await input.decodeMailboxPayload.decode({
            itemRef: decodeInput.itemRef,
            payloadCiphertext: decodeInput.payloadCiphertext,
            payloadRequestId: decodeInput.payloadRequestId,
            payloadSchema: decodeInput.payloadSchema,
            payloadSource: decodeInput.payloadSource,
          });

          if (decoded.status === "blocked") {
            return decoded;
          }

          if (decoded.wake.kind !== "conversation.message") {
            return {
              reasonCode: "payload.decode_mismatch",
              retryable: false,
              status: "blocked",
            };
          }

          return {
            status: "decoded",
            wake: decoded.wake,
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
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
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

  const decoded = await input.decodeMailboxPayload.decode({
    itemRef: {
      dedupeKey: input.item.item.dedupeKey,
      id: input.item.item.id,
      kind: input.item.item.kind,
      lane: input.item.item.lane,
      laneSeq: input.item.item.laneSeq,
      occurredAt: input.item.item.occurredAt,
      userId: input.item.item.userId,
    },
    payloadCiphertext: input.item.payload.payloadCiphertext,
    payloadRequestId: input.item.payload.requestId,
    payloadSchema: input.item.payload.payloadSchema,
    payloadSource: input.item.payload.source,
  });

  if (decoded.status === "blocked") {
    return decoded;
  }

  const wake = decoded.wake;

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
