import { createHmac } from "node:crypto";
import path from "node:path";

import {
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
  listHostedBundleInlineFiles,
  readHostedPortableWorkspaceDeltaManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  readHostedWorkspaceSkippedInlineFiles,
  sha256HostedBundleHex,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedExecutionContext,
  type HostedBundleArtifactRef,
  type HostedBundleArtifactRestoreInput,
  type HostedBundleArtifactSnapshotInput,
  type HostedBundleInlineLocation,
  type HostedCodexHomeSnapshotDiagnostics,
  type HostedPortableWorkspaceDeltaManifest,
  type HostedPortableWorkspaceManifest,
  type HostedPortableWorkspaceManifestFile,
  type HostedWorkspaceArtifactPersistInput,
  type HostedWorkspaceSkippedInlineFile,
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
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const currentRefs = input.platform.workspacePort?.read
    ? await readHostedWorkspaceCurrentCheckpointRefs(input)
    : {
        baseSnapshotRef: null,
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

  try {
    const preservedState = input.request.reason === "idle_shutdown"
      ? await readHostedWorkspaceCurrentEffectivePreservedStateForCompaction(input)
      : await readHostedWorkspaceCurrentEffectivePreservedStateBestEffort(input);
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
      && isHostedWorkspaceIdleShutdownCheckpointSkippableError(error)
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

class HostedWorkspaceIdleCompactionPreservedStateUnavailableError extends Error {
  constructor() {
    super("Hosted idle compaction skipped because current committed workspace state could not be read.");
    this.name = "HostedWorkspaceIdleCompactionPreservedStateUnavailableError";
  }
}

type HostedWorkspaceIdleShutdownCheckpointSkipError =
  | HostedWorkspaceIdleCompactionPreservedStateUnavailableError
  | HostedWorkspaceSnapshotContinuityIncompleteError;

function isHostedWorkspaceIdleShutdownCheckpointSkippableError(
  error: unknown,
): error is HostedWorkspaceIdleShutdownCheckpointSkipError {
  return (
    error instanceof HostedWorkspaceSnapshotContinuityIncompleteError
    || error instanceof HostedWorkspaceIdleCompactionPreservedStateUnavailableError
  );
}

type HostedWorkspaceFullCheckpointCommitKind = Exclude<
  HostedWorkspaceCommitKind,
  "working_commit"
>;
async function createFullSeedSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  snapshotRef: HostedExecutionBundleRef;
}> {
  return await createFullSnapshot({
    ...input,
    commitKind: "full_seed",
  });
}

async function createFullCompactionSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  snapshotRef: HostedExecutionBundleRef;
}> {
  return await createFullSnapshot({
    ...input,
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
  commitKind: HostedWorkspaceFullCheckpointCommitKind;
}): Promise<{
  snapshotRef: HostedExecutionBundleRef;
}> {
  const startedAt = Date.now();
  let externalArtifactPutBytes = 0;
  let externalArtifactPutCount = 0;
  let bundlePutBytes = 0;
  let leaseCheckCount = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  const pendingArtifactPuts: HostedWorkspaceArtifactPersistInput[] = [];
  const skippedInlineFiles = input.preservedState
    ? await readHostedWorkspaceSkippedInlineFilesBestEffort({
        vaultRoot: input.vaultRoot,
      })
    : [];
  const preservedArtifacts = input.preservedState
    ? [
        ...input.preservedState.preservedArtifacts,
        ...createHostedWorkspaceBridgePreservedInlineArtifacts({
          effectiveManifest: input.preservedState.manifest,
          inlineFiles: input.preservedState.inlineFiles,
          pendingArtifactPuts,
          skippedInlineFiles,
          vaultRoot: input.vaultRoot,
        }),
      ]
    : undefined;
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
          preservedArtifacts,
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

  await writeHostedCheckpointSnapshotMetricLog({
    bundlePutBytes,
    bundlePutCount: 1,
    browserVaultReplicaState: "omitted",
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
    snapshotRef,
  };
}

async function createWorkingCommitSnapshot(input: {
  codexHomeSnapshotHashSecret: string | null;
  currentRefs: {
    baseSnapshotRef: HostedExecutionBundleRef | null;
    snapshotRef: HostedExecutionSnapshotRef | null;
  };
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
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
        includeInlineFiles: false,
        platform: input.platform,
        snapshotRef: input.currentRefs.snapshotRef,
      })
    : createHostedWorkspaceEffectivePreservedStateFromManifest(baseManifest);
  const skippedInlineFiles = await readHostedWorkspaceSkippedInlineFilesBestEffort({
    vaultRoot: input.vaultRoot,
  });

  const startedAt = Date.now();
  let externalArtifactPutBytes = 0;
  let externalArtifactPutCount = 0;
  let bundlePutBytes = 0;
  let leaseCheckCount = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  let workingDeltaDiagnostics: HostedWorkingDeltaDiagnostics | null = null;
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
      preservedInlineManifestFiles: createHostedWorkspaceBridgePreservedInlineManifestFiles({
        effectiveManifest: preservedState.manifest,
        skippedInlineFiles,
      }),
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
      workingDeltaDiagnostics,
      workspaceSnapshotSizeDiagnostics,
    });

    return {
      snapshotRef: input.currentRefs.snapshotRef ?? baseSnapshotRef,
    };
  }

  workingDeltaUpsertCount = snapshot.manifest.upserts.length;
  workingDeltaTombstoneCount = snapshot.manifest.tombstones.length;
  workingDeltaDiagnostics = createHostedWorkingDeltaDiagnostics({
    baseManifest,
    deltaManifest: snapshot.manifest,
    hashSecret: input.codexHomeSnapshotHashSecret,
    previousEffectiveManifest: preservedState.manifest,
  });

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
    workingDeltaDiagnostics,
    workspaceSnapshotSizeDiagnostics,
  });

  return {
    snapshotRef: buildHostedExecutionWorkingSnapshotRef({
      base: baseSnapshotRef,
      delta: deltaRef,
    }),
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

async function readHostedWorkspaceSkippedInlineFilesBestEffort(input: {
  vaultRoot: string;
}): Promise<HostedWorkspaceSkippedInlineFile[]> {
  try {
    return await readHostedWorkspaceSkippedInlineFiles(input);
  } catch {
    return [];
  }
}

function createHostedWorkspaceBridgePreservedInlineManifestFiles(input: {
  effectiveManifest: HostedPortableWorkspaceManifest;
  skippedInlineFiles: readonly HostedWorkspaceSkippedInlineFile[];
}): HostedPortableWorkspaceManifestFile[] {
  const skippedFiles = new Map(
    input.skippedInlineFiles.map((file) => [`${file.root}:${file.path}`, file]),
  );
  const preservedFiles: HostedPortableWorkspaceManifestFile[] = [];
  for (const file of input.effectiveManifest.files) {
    if (!shouldPreserveHostedWorkspaceBridgeInlineManifestFile(file)) {
      continue;
    }
    const skippedFile = skippedFiles.get(`${file.root}:${file.path}`);
    if (skippedFile && (file.sha256 !== skippedFile.sha256 || file.size !== skippedFile.size)) {
      throw new Error("Hosted workspace skipped-inline manifest does not match the current workspace manifest.");
    }
    preservedFiles.push(file);
  }
  return preservedFiles;
}

function createHostedWorkspaceBridgePreservedInlineArtifacts(input: {
  effectiveManifest: HostedPortableWorkspaceManifest;
  inlineFiles: readonly HostedBundleInlineLocation[];
  pendingArtifactPuts: HostedWorkspaceArtifactPersistInput[];
  skippedInlineFiles: readonly HostedWorkspaceSkippedInlineFile[];
  vaultRoot: string;
}): HostedBundleArtifactRestoreInput[] {
  const inlineFiles = new Map(input.inlineFiles.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  const artifacts: HostedBundleArtifactRestoreInput[] = [];
  for (const file of createHostedWorkspaceBridgePreservedInlineManifestFiles({
    effectiveManifest: input.effectiveManifest,
    skippedInlineFiles: input.skippedInlineFiles,
  })) {
    const inlineFile = inlineFiles.get(`${file.root}:${file.path}`);
    if (!inlineFile) {
      throw new Error("Hosted workspace preserved inline file is missing from the committed snapshot.");
    }
    if (inlineFile.sha256 !== file.sha256 || inlineFile.size !== file.size) {
      throw new Error("Hosted workspace preserved inline file does not match the committed manifest.");
    }
    const ref = {
      byteSize: inlineFile.size,
      sha256: inlineFile.sha256,
    };
    artifacts.push({
      path: file.path,
      ref,
      root: file.root,
    });
    input.pendingArtifactPuts.push({
      absolutePath: path.join(input.vaultRoot, file.path),
      bytes: inlineFile.bytes,
      path: file.path,
      ref,
      root: file.root,
    });
  }
  return artifacts;
}

function shouldPreserveHostedWorkspaceBridgeInlineManifestFile(
  file: HostedPortableWorkspaceManifestFile,
): boolean {
  return (
    !file.artifact
    && file.root === "vault"
    && file.path.startsWith("raw/")
    && !shouldRestoreHostedRuntimeBridgeEagerArtifact({
      path: file.path,
      root: file.root,
    })
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
  inlineFiles: HostedBundleInlineLocation[];
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
      includeInlineFiles: false,
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
  try {
    return await readHostedWorkspaceEffectivePreservedState({
      includeInlineFiles: true,
      ...input,
      snapshotRef: currentRefs.snapshotRef,
    });
  } catch {
    throw new HostedWorkspaceIdleCompactionPreservedStateUnavailableError();
  }
}

async function readHostedWorkspaceEffectivePreservedState(input: {
  includeInlineFiles?: boolean;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  snapshotRef: HostedExecutionSnapshotRef | null;
}): Promise<HostedWorkspaceEffectivePreservedState> {
  const includeInlineFiles = input.includeInlineFiles === true;
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
  const baseInlineFiles = includeInlineFiles
    ? listHostedBundleInlineFiles({
        bytes: baseBundle,
        expectedKind: "vault",
      })
    : [];
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(input.snapshotRef);
  if (!deltaSnapshotRef) {
    const hotSnapshotRef = readHostedExecutionSnapshotHotRef(input.snapshotRef);
    if (hotSnapshotRef) {
      const hotBundle = await input.platform.artifactStore.get(hotSnapshotRef.hash);
      if (!hotBundle) {
        throw new HostedWorkspaceWorkingCheckpointBaseUnavailableError();
      }
      const hotManifest = createHostedPortableWorkspaceManifestFromBundle(hotBundle);
      const hotInlineFiles = includeInlineFiles
        ? listHostedBundleInlineFiles({
            bytes: hotBundle,
            expectedKind: "vault",
          })
        : [];
      return createHostedWorkspaceEffectivePreservedStateFromManifest(
        createHostedWorkspaceBridgeOverlayManifest({
          baseManifest,
          overlayManifest: hotManifest,
        }),
        createHostedWorkspaceBridgeOverlayInlineFiles({
          baseInlineFiles,
          overlayInlineFiles: hotInlineFiles,
        }),
      );
    }
    return createHostedWorkspaceEffectivePreservedStateFromManifest(baseManifest, baseInlineFiles);
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
    includeInlineFiles
      ? createHostedWorkspaceBridgeWorkingInlineFiles({
          baseInlineFiles,
          deltaBundle,
          deltaManifest,
        })
      : [],
  );
}

function createHostedWorkspaceEffectivePreservedStateFromManifest(
  manifest: HostedPortableWorkspaceManifest,
  inlineFiles: HostedBundleInlineLocation[] = [],
): HostedWorkspaceEffectivePreservedState {
  return {
    artifactRefProvider: createBaseManifestArtifactRefProvider(manifest),
    inlineFiles,
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

function createHostedWorkspaceBridgeOverlayInlineFiles(input: {
  baseInlineFiles: readonly HostedBundleInlineLocation[];
  overlayInlineFiles: readonly HostedBundleInlineLocation[];
}): HostedBundleInlineLocation[] {
  const files = new Map(input.baseInlineFiles.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const file of input.overlayInlineFiles) {
    files.set(`${file.root}:${file.path}`, file);
  }
  return [...files.values()];
}

function createHostedWorkspaceBridgeWorkingInlineFiles(input: {
  baseInlineFiles: readonly HostedBundleInlineLocation[];
  deltaBundle: Uint8Array | ArrayBuffer;
  deltaManifest: HostedPortableWorkspaceDeltaManifest;
}): HostedBundleInlineLocation[] {
  const files = new Map(input.baseInlineFiles.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const tombstone of input.deltaManifest.tombstones) {
    files.delete(`${tombstone.root}:${tombstone.path}`);
  }
  for (const file of listHostedBundleInlineFiles({
    bytes: input.deltaBundle,
    expectedKind: "vault",
  })) {
    files.set(`${file.root}:${file.path}`, file);
  }
  return [...files.values()];
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
    snapshotRef: currentWorkspace.workspace?.snapshotRef ?? null,
  };
}

async function createHostedWorkspaceBridgeIdleShutdownCheckpointSkip(input: {
  codexHomeSnapshotHashSecret: string | null;
  error: HostedWorkspaceIdleShutdownCheckpointSkipError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<{
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
    snapshotRef: currentRefs.snapshotRef,
  };
}

async function writeHostedCheckpointIdleShutdownSkippedLog(params: {
  error: HostedWorkspaceIdleShutdownCheckpointSkipError;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceCheckpointRequest;
}): Promise<void> {
  const continuityError = params.error instanceof HostedWorkspaceSnapshotContinuityIncompleteError
    ? params.error
    : null;
  console.warn("Hosted idle-shutdown checkpoint snapshot skipped.", {
    ...(continuityError ? { continuityReason: continuityError.reason } : {}),
    errorName: params.error.name,
  });
  if (!params.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: params.request.reason,
    errorMessage: redactHostedRuntimeDiagnosticText(params.error.message),
    errorName: params.error.name,
    skipReason: continuityError
      ? "codex_continuity_incomplete"
      : "preserved_state_unavailable",
    ...(continuityError ? { continuityReason: continuityError.reason } : {}),
  };
  if (continuityError) {
    appendHostedCodexHomeSnapshotDiagnostics(
      redactedJson,
      continuityError.codexHomeSnapshotDiagnostics,
    );
  }

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

interface HostedWorkingDeltaDiagnostics {
  workingDeltaBaseFileCount: number;
  workingDeltaCurrentFileCount: number;
  workingDeltaLargestUpserts: string[];
  workingDeltaTombstoneClassSummary: string[];
  workingDeltaUpsertBytes: number;
  workingDeltaUpsertExternalArtifactCount: number;
  workingDeltaUpsertPreviousStateSummary: string[];
  workingDeltaUpsertReasonSummary: string[];
}

interface HostedWorkingDeltaGroupMetrics {
  bytes: number;
  externalCount: number;
  files: number;
}

interface HostedWorkingDeltaLargestUpsertMetric {
  bytes: number;
  className: string;
  depth: number;
  externalized: boolean;
  extension: string;
  relHash: string;
  root: string;
}

const HOSTED_WORKING_DELTA_DIAGNOSTIC_LIST_LIMIT = 16;

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
  workingDeltaDiagnostics?: HostedWorkingDeltaDiagnostics | null;
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
  if (input.workingDeltaDiagnostics) {
    appendHostedWorkingDeltaDiagnostics(redactedJson, input.workingDeltaDiagnostics);
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

function createHostedWorkingDeltaDiagnostics(input: {
  baseManifest: HostedPortableWorkspaceManifest;
  deltaManifest: HostedPortableWorkspaceDeltaManifest;
  hashSecret: string | null;
  previousEffectiveManifest: HostedPortableWorkspaceManifest;
}): HostedWorkingDeltaDiagnostics {
  const baseFiles = createHostedPortableWorkspaceManifestFileMap(input.baseManifest);
  const previousEffectiveFiles = createHostedPortableWorkspaceManifestFileMap(
    input.previousEffectiveManifest,
  );
  const reasonMetrics = new Map<string, HostedWorkingDeltaGroupMetrics>();
  const previousStateMetrics = new Map<string, HostedWorkingDeltaGroupMetrics>();
  const tombstoneMetrics = new Map<string, HostedWorkingDeltaGroupMetrics>();
  const largestUpserts: HostedWorkingDeltaLargestUpsertMetric[] = [];
  const newPathUpsertCount = input.deltaManifest.upserts.filter((upsert) =>
    !baseFiles.has(createHostedWorkingDeltaManifestFileKey(upsert))
  ).length;
  let upsertBytes = 0;
  let upsertExternalArtifactCount = 0;

  for (const upsert of input.deltaManifest.upserts) {
    const key = createHostedWorkingDeltaManifestFileKey(upsert);
    const className = classifyHostedWorkingDeltaPath(upsert.root, upsert.path);
    const reason = classifyHostedWorkingDeltaUpsertReason({
      baseFile: baseFiles.get(key) ?? null,
      upsert,
    });
    const previousState = classifyHostedWorkingDeltaPreviousState({
      previousFile: previousEffectiveFiles.get(key) ?? null,
      upsert,
    });
    const externalized = Boolean(upsert.artifact);

    upsertBytes += upsert.size;
    if (externalized) {
      upsertExternalArtifactCount += 1;
    }
    incrementHostedWorkingDeltaGroup(reasonMetrics, reason, className, upsert);
    incrementHostedWorkingDeltaGroup(
      previousStateMetrics,
      previousState,
      className,
      upsert,
    );
    recordHostedWorkingDeltaLargestUpsert(largestUpserts, {
      bytes: upsert.size,
      className,
      depth: hostedWorkingDeltaPathDepth(upsert.path),
      externalized,
      extension: hostedWorkingDeltaSafeExtension(upsert.path),
      relHash: fingerprintHostedWorkingDeltaPath({
        hashSecret: input.hashSecret,
        path: upsert.path,
        root: upsert.root,
      }),
      root: sanitizeHostedWorkingDeltaRootForLog(upsert.root),
    });
  }

  for (const tombstone of input.deltaManifest.tombstones) {
    const key = createHostedWorkingDeltaManifestFileKey(tombstone);
    const baseFile = baseFiles.get(key);
    const className = classifyHostedWorkingDeltaPath(tombstone.root, tombstone.path);
    incrementHostedWorkingDeltaGroup(
      tombstoneMetrics,
      "deleted_from_base",
      className,
      baseFile ?? {
        path: tombstone.path,
        root: tombstone.root,
        sha256: "",
        size: 0,
      },
    );
  }

  return {
    workingDeltaBaseFileCount: input.baseManifest.files.length,
    workingDeltaCurrentFileCount:
      input.baseManifest.files.length
      - input.deltaManifest.tombstones.length
      + newPathUpsertCount,
    workingDeltaLargestUpserts:
      summarizeHostedWorkingDeltaLargestUpserts(largestUpserts),
    workingDeltaTombstoneClassSummary:
      summarizeHostedWorkingDeltaGroups(tombstoneMetrics, "reason"),
    workingDeltaUpsertBytes: upsertBytes,
    workingDeltaUpsertExternalArtifactCount: upsertExternalArtifactCount,
    workingDeltaUpsertPreviousStateSummary:
      summarizeHostedWorkingDeltaGroups(previousStateMetrics, "state"),
    workingDeltaUpsertReasonSummary:
      summarizeHostedWorkingDeltaGroups(reasonMetrics, "reason"),
  };
}

function recordHostedWorkingDeltaLargestUpsert(
  largestUpserts: HostedWorkingDeltaLargestUpsertMetric[],
  metric: HostedWorkingDeltaLargestUpsertMetric,
): void {
  largestUpserts.push(metric);
  largestUpserts.sort((left, right) => right.bytes - left.bytes);
  largestUpserts.splice(HOSTED_WORKING_DELTA_DIAGNOSTIC_LIST_LIMIT);
}

function appendHostedWorkingDeltaDiagnostics(
  redactedJson: HostedRuntimeRedactedJson,
  diagnostics: HostedWorkingDeltaDiagnostics,
): void {
  redactedJson.workingDeltaBaseFileCount = diagnostics.workingDeltaBaseFileCount;
  redactedJson.workingDeltaCurrentFileCount = diagnostics.workingDeltaCurrentFileCount;
  redactedJson.workingDeltaLargestUpserts = diagnostics.workingDeltaLargestUpserts;
  redactedJson.workingDeltaTombstoneClassSummary =
    diagnostics.workingDeltaTombstoneClassSummary;
  redactedJson.workingDeltaUpsertBytes = diagnostics.workingDeltaUpsertBytes;
  redactedJson.workingDeltaUpsertExternalArtifactCount =
    diagnostics.workingDeltaUpsertExternalArtifactCount;
  redactedJson.workingDeltaUpsertPreviousStateSummary =
    diagnostics.workingDeltaUpsertPreviousStateSummary;
  redactedJson.workingDeltaUpsertReasonSummary =
    diagnostics.workingDeltaUpsertReasonSummary;
}

function createHostedPortableWorkspaceManifestFileMap(
  manifest: HostedPortableWorkspaceManifest,
): Map<string, HostedPortableWorkspaceManifestFile> {
  return new Map(manifest.files.map((file) => [
    createHostedWorkingDeltaManifestFileKey(file),
    file,
  ]));
}

function createHostedWorkingDeltaManifestFileKey(
  file: Pick<HostedPortableWorkspaceManifestFile, "path" | "root">,
): string {
  return `${file.root}:${file.path}`;
}

function classifyHostedWorkingDeltaUpsertReason(input: {
  baseFile: HostedPortableWorkspaceManifestFile | null;
  upsert: HostedPortableWorkspaceManifestFile;
}): string {
  if (!input.baseFile) {
    return "new_path";
  }
  const hashChanged = input.baseFile.sha256 !== input.upsert.sha256;
  const sizeChanged = input.baseFile.size !== input.upsert.size;
  if (hashChanged && sizeChanged) {
    return "content_hash_and_size_changed";
  }
  if (hashChanged) {
    return "content_hash_changed";
  }
  if (sizeChanged) {
    return "size_changed";
  }
  if (!hostedWorkingDeltaManifestFileArtifactsEqual(
    input.baseFile.artifact ?? null,
    input.upsert.artifact ?? null,
  )) {
    return "representation_changed";
  }
  return "metadata_changed";
}

function classifyHostedWorkingDeltaPreviousState(input: {
  previousFile: HostedPortableWorkspaceManifestFile | null;
  upsert: HostedPortableWorkspaceManifestFile;
}): string {
  if (!input.previousFile) {
    return "new_since_previous_effective";
  }
  return hostedWorkingDeltaManifestFilesEqual(input.previousFile, input.upsert)
    ? "carried_forward_from_previous"
    : "changed_since_previous";
}

function hostedWorkingDeltaManifestFilesEqual(
  left: HostedPortableWorkspaceManifestFile,
  right: HostedPortableWorkspaceManifestFile,
): boolean {
  return left.root === right.root
    && left.path === right.path
    && left.sha256 === right.sha256
    && left.size === right.size
    && hostedWorkingDeltaManifestFileArtifactsEqual(left.artifact ?? null, right.artifact ?? null);
}

function hostedWorkingDeltaManifestFileArtifactsEqual(
  left: HostedBundleArtifactRef | null,
  right: HostedBundleArtifactRef | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.sha256 === right.sha256 && left.byteSize === right.byteSize;
}

function incrementHostedWorkingDeltaGroup(
  metrics: Map<string, HostedWorkingDeltaGroupMetrics>,
  group: string,
  className: string,
  file: Pick<HostedPortableWorkspaceManifestFile, "artifact" | "size">,
): void {
  const key = `${group}\0${className}`;
  const current = metrics.get(key) ?? {
    bytes: 0,
    externalCount: 0,
    files: 0,
  };
  current.bytes += file.size;
  current.externalCount += file.artifact ? 1 : 0;
  current.files += 1;
  metrics.set(key, current);
}

function summarizeHostedWorkingDeltaGroups(
  metrics: ReadonlyMap<string, HostedWorkingDeltaGroupMetrics>,
  groupLabel: "reason" | "state",
): string[] {
  return [...metrics.entries()]
    .map(([key, entry]) => {
      const [group, className] = key.split("\0", 2);
      return {
        bytes: entry.bytes,
        className: className ?? "unknown",
        externalCount: entry.externalCount,
        files: entry.files,
        group: group ?? "unknown",
      };
    })
    .sort((left, right) =>
      right.files - left.files
      || right.bytes - left.bytes
      || left.group.localeCompare(right.group)
      || left.className.localeCompare(right.className))
    .slice(0, HOSTED_WORKING_DELTA_DIAGNOSTIC_LIST_LIMIT)
    .map((entry) =>
      [
        `${groupLabel}=${entry.group}`,
        `class=${entry.className}`,
        `files=${entry.files}`,
        `bytes=${entry.bytes}`,
        `externalCount=${entry.externalCount}`,
      ].join(","));
}

function summarizeHostedWorkingDeltaLargestUpserts(
  upserts: readonly HostedWorkingDeltaLargestUpsertMetric[],
): string[] {
  return upserts
    .slice(0, HOSTED_WORKING_DELTA_DIAGNOSTIC_LIST_LIMIT)
    .map((entry) =>
      [
        `class=${entry.className}`,
        `root=${entry.root}`,
        `bytes=${entry.bytes}`,
        `external=${entry.externalized ? 1 : 0}`,
        `ext=${entry.extension}`,
        `depth=${entry.depth}`,
        `relHash=${entry.relHash}`,
      ].join(","));
}

function classifyHostedWorkingDeltaPath(root: string, relativePath: string): string {
  const normalizedPath = normalizeHostedWorkingDeltaRelativePath(relativePath);

  if (root === "operator-home") {
    if (hasHostedWorkingDeltaPathPrefix(normalizedPath, ".codex-hosted")) {
      return "operator-codex-home";
    }

    return "operator-home-other";
  }

  if (root !== "vault") {
    return "unknown-root";
  }

  if (hasHostedWorkingDeltaPathPrefix(normalizedPath, ".runtime/operations/assistant")) {
    return "runtime-assistant";
  }

  if (hasHostedWorkingDeltaPathPrefix(normalizedPath, ".runtime")) {
    return "runtime-other";
  }

  const firstSegment = normalizedPath.split(path.posix.sep).filter(Boolean)[0] ?? "root";
  switch (firstSegment) {
    case "bank":
    case "derived":
    case "journal":
    case "ledger":
    case "raw":
      return firstSegment;
    default:
      return "vault-canonical";
  }
}

function sanitizeHostedWorkingDeltaRootForLog(root: string): string {
  switch (root) {
    case "operator-home":
    case "vault":
      return root;
    default:
      return "unknown-root";
  }
}

function fingerprintHostedWorkingDeltaPath(input: {
  hashSecret: string | null;
  path: string;
  root: string;
}): string {
  if (!input.hashSecret) {
    return "disabled";
  }
  const normalizedPath = normalizeHostedWorkingDeltaRelativePath(input.path);
  const hash = createHmac("sha256", input.hashSecret)
    .update(`workspace_snapshot_rel:${input.root}:${normalizedPath}`, "utf8")
    .digest("hex");
  return `h1_${hash.slice(0, 24)}`;
}

function hasHostedWorkingDeltaPathPrefix(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function hostedWorkingDeltaPathDepth(relativePath: string): number {
  return normalizeHostedWorkingDeltaRelativePath(relativePath)
    .split(path.posix.sep)
    .filter(Boolean)
    .length;
}

function hostedWorkingDeltaSafeExtension(relativePath: string): string {
  const extension = path.posix.extname(normalizeHostedWorkingDeltaRelativePath(relativePath))
    .toLowerCase();
  return extension && /^[.][a-z0-9]{1,12}$/u.test(extension) ? extension : "none";
}

function normalizeHostedWorkingDeltaRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join(path.posix.sep);
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
