import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createHostedConversationMailboxImportItem,
  enqueueHostedSystemMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  readHostedMaterializedArtifactPaths,
  type HostedAssistantRuntimeConfig,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
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
  HostedRuntimeLogEventCode,
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  HostedWorkspaceSnapshotContinuityIncompleteError,
  createHostedPortableWorkspaceManifestFromBundle,
  listHostedBundleInlineFiles,
  readHostedPortableWorkspaceDeltaManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  readHostedWorkspaceSkippedInlineFiles,
  sha256HostedBundleHex,
  type HostedBundleInlineLocation,
  type HostedCodexHomeSnapshotDiagnostics,
  type HostedPortableWorkspaceDeltaManifest,
  type HostedPortableWorkspaceManifest,
  type HostedWorkspaceSkippedInlineFile,
  type HostedWorkspaceSnapshotSizeDiagnostics,
} from "@murphai/runtime-state/node";

import {
  HostedRuntimeBridgeCheckpointLeaseError,
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
import {
  HostedBundleArchiveValidationError,
  isHostedBundleArchiveValidationFailure,
  readHostedBundleArchiveValidationErrorDetails,
} from "./hosted-bundle-validation.ts";
import {
  createEncryptedWorkspaceSnapshotFile,
} from "./workspace-snapshot-local.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
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
type HostedWorkspaceIdleCheckpointRequest =
  HostedWorkspaceCheckpointRequest & { reason: "idle_shutdown" };

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
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const request = requireHostedWorkspaceBridgeIdleCheckpointRequest(input.request);

  const currentRefs = input.platform.workspacePort?.read
    ? await readHostedWorkspaceCurrentCheckpointRefs(input)
    : {
        baseSnapshotRef: null,
        snapshotRef: null,
      };
  const preservedState = currentRefs.snapshotRef
    ? await readHostedWorkspaceEffectivePreservedState({
        platform: input.platform,
        snapshotRef: currentRefs.snapshotRef,
      })
    : null;
  await writeHostedCheckpointSnapshotLifecycleLog({
    details: {
      baseSnapshotRefPresent: currentRefs.baseSnapshotRef !== null,
      preservedStatePresent: preservedState !== null,
      snapshotRefPresent: currentRefs.snapshotRef !== null,
    },
    eventCode: "checkpoint.snapshot_plan",
    level: "info",
    platform: input.platform,
    request,
  });
  return currentRefs.baseSnapshotRef
    ? await createFullCompactionSnapshot({
        ...input,
        preservedState,
        request,
      })
    : await createFullSeedSnapshot({
        ...input,
        preservedState,
        request,
      });
}

function requireHostedWorkspaceBridgeIdleCheckpointRequest(
  request: HostedWorkspaceCheckpointRequest,
): HostedWorkspaceIdleCheckpointRequest {
  if (request.reason !== "idle_shutdown") {
    throw new Error("Hosted workspace snapshot construction is idle-shutdown only.");
  }

  return {
    ...request,
    reason: "idle_shutdown",
  };
}

class HostedWorkspaceCommittedStateUnavailableError extends Error {
  constructor() {
    super("Hosted workspace committed snapshot state is missing.");
    this.name = "HostedWorkspaceCommittedStateUnavailableError";
  }
}

type HostedWorkspaceFullCheckpointCommitKind =
  | "full_compaction"
  | "full_seed";
type HostedWorkspaceCheckpointCommitKind = HostedWorkspaceFullCheckpointCommitKind;
type HostedWorkspaceCheckpointSnapshotMode = "full" | "workspace_snapshot_v2";
type HostedWorkspaceCheckpointPolicy = "full";

async function createFullSeedSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}> {
  return await createFullSnapshot({
    ...input,
    commitKind: "full_seed",
  });
}

async function createFullCompactionSnapshot(
  input: HostedWorkspaceBridgeFullSnapshotInput,
): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
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
  request: HostedWorkspaceIdleCheckpointRequest;
  userId: string;
  vaultRoot: string;
}

async function createFullSnapshot(input: HostedWorkspaceBridgeFullSnapshotInput & {
  commitKind: HostedWorkspaceFullCheckpointCommitKind;
}): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}> {
  const startedAt = Date.now();
  let leaseCheckCount = 0;
  if (!input.platform.workspaceSnapshotPort) {
    throw new Error("Hosted workspace snapshot port is required for v2 checkpoints.");
  }

  const skippedInlineFiles = await readHostedWorkspaceSkippedInlineFilesBestEffort({
    vaultRoot: input.vaultRoot,
  });
  await writeHostedCheckpointSnapshotLifecycleLog({
    commitKind: input.commitKind,
    details: {
      checkpointPolicy: "full",
      checkpointReason: input.request.reason,
      nextWakeAtPresent: input.request.nextWakeAt != null,
      nextWakeReasonPresent: input.request.nextWakeReason != null,
      preservedStatePresent: input.preservedState !== null && input.preservedState !== undefined,
      redactedStatusPresent: input.request.redactedStatus !== null,
      skippedInlineFileCount: skippedInlineFiles.length,
      snapshotMode: "workspace_snapshot_v2",
    },
    eventCode: "checkpoint.snapshot_started",
    level: "info",
    platform: input.platform,
    request: input.request,
  });

  let snapshotRef: HostedWorkspaceSnapshotV2Ref;
  let checkpoint: HostedWorkspaceCheckpointResponse | undefined;
  let encryptedByteSize = 0;
  let encryptedTemporaryDirectoryPath: string | null = null;
  let startedUpload: Awaited<ReturnType<NonNullable<HostedWorkspaceRuntimeJobOptions["platform"]["workspaceSnapshotPort"]>["startUpload"]>> | null = null;
  try {
    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_snapshot",
      userId: input.userId,
    });
    await materializeHostedWorkspaceSkippedInlineFilesForV2Snapshot({
      artifactStore: input.platform.artifactStore,
      files: skippedInlineFiles,
      preservedState: input.preservedState ?? null,
      operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
      vaultRoot: input.vaultRoot,
    });

    startedUpload = await input.platform.workspaceSnapshotPort.startUpload({
      expectedWorkspaceVersion: input.request.expectedWorkspaceVersion,
      nextWakeAt: input.request.nextWakeAt,
      nextWakeReason: input.request.nextWakeReason,
      reason: "idle_shutdown",
    });
    const encrypted = await createEncryptedWorkspaceSnapshotFile({
      aad: startedUpload.encryption.aad,
      dataKey: startedUpload.encryption.dataKeyBase64,
      durableRoot: resolveWorkspaceDurableRoot(input.vaultRoot),
      ivBase64: startedUpload.encryption.ivBase64,
      maxEncryptedBytes: Math.min(
        startedUpload.limits.maxSinglePartEncryptedBytes,
        HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      ),
      outputDir: resolveWorkspaceScratchRoot(input.vaultRoot),
    });
    encryptedTemporaryDirectoryPath = encrypted.temporaryDirectoryPath;
    encryptedByteSize = encrypted.encryptedByteSize;
    const warnEncryptedBytes = Math.min(
      startedUpload.limits.warnEncryptedBytes,
      HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
    );
    if (encryptedByteSize >= warnEncryptedBytes) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          encryptedByteSize,
          fileCount: encrypted.fileCount,
          maxSinglePartEncryptedBytes: startedUpload.limits.maxSinglePartEncryptedBytes,
          snapshotMode: "workspace_snapshot_v2",
          totalPlainBytes: encrypted.totalPlainBytes,
          warnEncryptedBytes,
        },
        level: "warn",
        message: "Hosted workspace snapshot exceeded the warning threshold.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }

    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_direct_r2_put",
      userId: input.userId,
    });
    await input.platform.workspaceSnapshotPort.directPutEncryptedObject({
      encryptedByteSize: encrypted.encryptedByteSize,
      putUrl: startedUpload.putUrl,
      sourceFilePath: encrypted.encryptedFilePath,
    });

    snapshotRef = {
      archive: {
        compression: encrypted.compression,
        encryptedByteSize: encrypted.encryptedByteSize,
        encryptedObjectSha256: encrypted.encryptedObjectSha256,
        fileCount: encrypted.fileCount,
        format: "tar",
        plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
      },
      createdAt: new Date().toISOString(),
      encryption: {
        aad: startedUpload.encryption.aad,
        ivBase64: startedUpload.encryption.ivBase64,
        rootKeyId: startedUpload.encryption.rootKeyId,
        scheme: startedUpload.encryption.scheme,
        wrappedDataKey: startedUpload.encryption.wrappedDataKey,
      },
      objectKey: startedUpload.objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId: startedUpload.snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId: input.userId,
    };
    const completed = await input.platform.workspaceSnapshotPort.completeUploadedSnapshot({
      checkpointRequest: {
        ...input.request,
        snapshotRef,
      },
      ref: snapshotRef,
    });
    snapshotRef = completed.snapshotRef;
    checkpoint = completed.checkpoint;
  } catch (error) {
    const classifiedError = classifyHostedWorkspaceSnapshotFailure(error);
    await writeHostedCheckpointSnapshotLifecycleLog({
      commitKind: input.commitKind,
      details: {
        checkpointPolicy: "full",
        encryptedByteSize,
        leaseCheckCount,
        snapshotElapsedMs: Date.now() - startedAt,
        snapshotMode: "workspace_snapshot_v2",
      },
      error: classifiedError,
      eventCode: "checkpoint.snapshot_failed",
      level: "error",
      platform: input.platform,
      request: input.request,
    });
    throw classifiedError;
  } finally {
    if (encryptedTemporaryDirectoryPath) {
      try {
        await rm(encryptedTemporaryDirectoryPath, {
          force: true,
          recursive: true,
        });
      } catch (cleanupError) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            snapshotMode: "workspace_snapshot_v2",
          },
          error: cleanupError,
          level: "warn",
          message: "Hosted workspace snapshot temporary directory cleanup failed.",
          phase: "checkpoint",
          userId: input.userId,
        });
      }
    }
  }

  await writeHostedCheckpointSnapshotMetricLog({
    checkpointPolicy: "full",
    commitKind: input.commitKind,
    encryptedByteSize,
    leaseCheckCount,
    platform: input.platform,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
    snapshotMode: "workspace_snapshot_v2",
  });

  return {
    ...(checkpoint ? { checkpoint } : {}),
    snapshotRef,
  };
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

async function materializeHostedWorkspaceSkippedInlineFilesForV2Snapshot(input: {
  artifactStore: HostedWorkspaceRuntimeJobOptions["platform"]["artifactStore"];
  files: readonly HostedWorkspaceSkippedInlineFile[];
  operatorHomeRoot: string;
  preservedState: HostedWorkspaceEffectivePreservedState | null;
  vaultRoot: string;
}): Promise<void> {
  const preservedInlineFiles = new Map(
    (input.preservedState?.inlineFiles ?? []).map((file) => [`${file.root}:${file.path}`, file]),
  );
  const materializedArtifactPaths = await readHostedMaterializedArtifactPaths({
    vaultRoot: input.vaultRoot,
  });
  for (const file of input.files) {
    const root = resolveHostedWorkspaceSkippedInlineFileRoot({
      operatorHomeRoot: input.operatorHomeRoot,
      root: file.root,
      vaultRoot: input.vaultRoot,
    });
    const targetPath = resolveSafeHostedWorkspaceSnapshotPath(root, file.path);
    if (
      materializedArtifactPaths.has(`${file.root}:${file.path}`)
      || await hostedWorkspaceSnapshotPathExists(targetPath)
    ) {
      continue;
    }
    const inlineFile = preservedInlineFiles.get(`${file.root}:${file.path}`);
    const bytes = inlineFile?.sha256 === file.sha256 && inlineFile.size === file.size
      ? inlineFile.bytes
      : await input.artifactStore.get(file.sha256);
    if (bytes === null) {
      throw new Error("Hosted workspace skipped-inline artifact is unavailable.");
    }
    if (bytes.byteLength !== file.size || sha256HostedBundleHex(bytes) !== file.sha256) {
      throw new Error("Hosted workspace skipped-inline artifact digest does not match its manifest.");
    }
    await mkdir(path.dirname(targetPath), { mode: 0o700, recursive: true });
    await writeFile(targetPath, bytes, { mode: 0o600 });
  }
}

async function hostedWorkspaceSnapshotPathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveHostedWorkspaceSkippedInlineFileRoot(input: {
  operatorHomeRoot: string;
  root: string;
  vaultRoot: string;
}): string {
  if (input.root === "vault") {
    return input.vaultRoot;
  }
  if (input.root === "operator-home") {
    return input.operatorHomeRoot;
  }
  throw new Error("Hosted workspace skipped-inline file root is unsupported.");
}

function resolveSafeHostedWorkspaceSnapshotPath(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root);
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Hosted workspace skipped-inline file path is invalid.");
  }
  const targetPath = path.resolve(
    normalizedRoot,
    ...relativePath.split(path.posix.sep),
  );
  const relativeToRoot = path.relative(normalizedRoot, targetPath);
  if (
    relativeToRoot === ""
    || relativeToRoot.startsWith("..")
    || path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Hosted workspace skipped-inline file path escapes its root.");
  }
  return targetPath;
}

interface HostedWorkspaceEffectivePreservedState {
  inlineFiles: HostedBundleInlineLocation[];
}

async function readHostedWorkspaceEffectivePreservedState(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  snapshotRef: HostedExecutionSnapshotRef | null;
}): Promise<HostedWorkspaceEffectivePreservedState> {
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(input.snapshotRef);
  if (!baseSnapshotRef) {
    return createHostedWorkspaceEffectivePreservedState();
  }

  const baseBundle = await input.platform.artifactStore.get(baseSnapshotRef.hash);
  if (!baseBundle) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseBundle)
      ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
  const baseInlineFiles = listHostedBundleInlineFiles({
    bytes: baseBundle,
    expectedKind: "vault",
  });
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(input.snapshotRef);
  if (!deltaSnapshotRef) {
    const hotSnapshotRef = readHostedExecutionSnapshotHotRef(input.snapshotRef);
    if (hotSnapshotRef) {
      const hotBundle = await input.platform.artifactStore.get(hotSnapshotRef.hash);
      if (!hotBundle) {
        throw new HostedWorkspaceCommittedStateUnavailableError();
      }
      const hotInlineFiles = listHostedBundleInlineFiles({
        bytes: hotBundle,
        expectedKind: "vault",
      });
      return createHostedWorkspaceEffectivePreservedState(
        createHostedWorkspaceBridgeOverlayInlineFiles({
          baseInlineFiles,
          overlayInlineFiles: hotInlineFiles,
        }),
      );
    }
    return createHostedWorkspaceEffectivePreservedState(baseInlineFiles);
  }

  const deltaBundle = await input.platform.artifactStore.get(deltaSnapshotRef.hash);
  if (!deltaBundle) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }
  const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(deltaBundle);
  if (!deltaManifest) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }

  if (deltaManifest.baseManifestHash !== baseManifest.manifestHash) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }

  return createHostedWorkspaceEffectivePreservedState(
    createHostedWorkspaceBridgeWorkingInlineFiles({
      baseInlineFiles,
      deltaBundle,
      deltaManifest,
    }),
  );
}

function createHostedWorkspaceEffectivePreservedState(
  inlineFiles: HostedBundleInlineLocation[] = [],
): HostedWorkspaceEffectivePreservedState {
  return {
    inlineFiles,
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

function classifyHostedWorkspaceSnapshotFailure(error: unknown): unknown {
  if (
    readHostedBundleArchiveValidationErrorDetails(error) !== null
    || !isHostedBundleArchiveValidationFailure(error)
  ) {
    return error;
  }

  return new HostedBundleArchiveValidationError({
    cause: error,
    operation: "runner-output",
    ref: null,
  });
}

async function writeHostedCheckpointSnapshotLifecycleLog(input: {
  commitKind?: HostedWorkspaceCheckpointCommitKind;
  details?: HostedRuntimeRedactedJson;
  error?: unknown;
  eventCode: HostedRuntimeLogEventCode;
  level: "error" | "info" | "warn";
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceIdleCheckpointRequest;
  workspaceSnapshotSizeDiagnostics?: HostedWorkspaceSnapshotSizeDiagnostics | null;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }
  const eventCode = input.eventCode;

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    ...(input.commitKind ? { commitKind: input.commitKind } : {}),
    ...(input.details ?? {}),
  };
  appendHostedCheckpointSnapshotFailureDiagnostics(redactedJson, input.error);
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
          eventCode,
          leaseGeneration: input.request.leaseGeneration,
          level: input.level,
          phase: "checkpoint",
          redactedJson,
          workspaceVersion: input.request.expectedWorkspaceVersion,
        },
      ],
    });
  } catch (error) {
    console.warn("Hosted checkpoint snapshot lifecycle log write failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
      eventCode,
    });
  }
}

function appendHostedCheckpointSnapshotFailureDiagnostics(
  redactedJson: HostedRuntimeRedactedJson,
  error: unknown,
): void {
  if (error === undefined) {
    return;
  }

  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  let safeDiagnosticDetail: string | null = null;
  if (diagnostics) {
    if (typeof diagnostics.errorCode === "string") {
      redactedJson.errorCode = diagnostics.errorCode;
    }
    if (typeof diagnostics.errorMessage === "string") {
      redactedJson.safeErrorMessage = diagnostics.errorMessage;
    }
    if (typeof diagnostics.errorName === "string") {
      redactedJson.errorName = diagnostics.errorName;
    }
    if (typeof diagnostics.errorStatus === "number") {
      redactedJson.errorStatus = diagnostics.errorStatus;
    }
    if (typeof diagnostics.errorCodeDetail === "string") {
      redactedJson.errorCodeDetail = redactHostedRuntimeDiagnosticText(
        diagnostics.errorCodeDetail,
      );
    }
    if (typeof diagnostics.errorDetail === "string") {
      safeDiagnosticDetail = redactHostedRuntimeDiagnosticText(
        diagnostics.errorDetail,
      );
    }
    redactedJson.errorDetailPresent = typeof diagnostics.errorDetail === "string";
    redactedJson.errorCausePresent = typeof diagnostics.errorCause === "string";
  }

  const bundleValidation = readHostedBundleArchiveValidationErrorDetails(error);
  if (bundleValidation) {
    redactedJson.bundleArchiveOperation = bundleValidation.operation;
    redactedJson.bundleRefKeyPresent = bundleValidation.refKeyPresent;
    redactedJson.bundleRefPresent = bundleValidation.refHash !== null
      || bundleValidation.refKeyPresent
      || bundleValidation.refSize !== null;
    if (bundleValidation.refSize !== null) {
      redactedJson.bundleRefSize = bundleValidation.refSize;
    }
    if (bundleValidation.validationCause) {
      redactedJson.bundleArchiveValidationCause = bundleValidation.validationCause;
    }
    const validationDetail = bundleValidation.validationMessage
      ? redactHostedRuntimeDiagnosticText(bundleValidation.validationMessage)
      : safeDiagnosticDetail;
    if (validationDetail) {
      redactedJson.safeErrorDetail = validationDetail;
      redactedJson.bundleArchiveValidationDetail = validationDetail;
    }
  }
}

async function writeHostedCodexHomeSnapshotFailureLog(input: {
  error: unknown;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotMode?: HostedWorkspaceCheckpointSnapshotMode;
}): Promise<void> {
  if (!(input.error instanceof HostedWorkspaceSnapshotContinuityIncompleteError)) {
    return;
  }
  const diagnostics = input.error.codexHomeSnapshotDiagnostics;
  const safeErrorMessage = redactHostedRuntimeDiagnosticText(readHostedSnapshotErrorMessage(input.error));
  const errorName = input.error.name;
  const snapshotMode = input.snapshotMode ?? "full";

  console.warn("Hosted Codex home snapshot failed.", {
    errorName,
    snapshotMode,
  });
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    errorName,
    safeErrorMessage,
    snapshotMode,
  };
  if (input.error instanceof HostedWorkspaceSnapshotContinuityIncompleteError) {
    redactedJson.continuityReason = input.error.reason;
  }
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

async function writeHostedCheckpointSnapshotMetricLog(input: {
  checkpointPolicy: HostedWorkspaceCheckpointPolicy;
  commitKind: HostedWorkspaceCheckpointCommitKind;
  encryptedByteSize: number;
  leaseCheckCount: number;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotElapsedMs: number;
  snapshotMode: HostedWorkspaceCheckpointSnapshotMode;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    browserVaultReplicaState: "omitted",
    checkpointPolicy: input.checkpointPolicy,
    checkpointReason: input.request.reason,
    commitKind: input.commitKind,
    leaseCheckCount: input.leaseCheckCount,
    snapshotElapsedMs: input.snapshotElapsedMs,
    workspaceSnapshotEncryptedBytes: input.encryptedByteSize,
    snapshotMode: input.snapshotMode,
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

async function writeHostedCheckpointSnapshotSizeDiagnosticLog(input: {
  checkpointPolicy: HostedWorkspaceCheckpointPolicy;
  diagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotMode: HostedWorkspaceCheckpointSnapshotMode;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointPolicy: input.checkpointPolicy,
    checkpointReason: input.request.reason,
    snapshotMode: input.snapshotMode,
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
  if (diagnostics.workspaceSnapshotArchiveArtifactCount !== null) {
    redactedJson.workspaceSnapshotArchiveArtifactCount =
      diagnostics.workspaceSnapshotArchiveArtifactCount;
  }
  if (diagnostics.workspaceSnapshotArchiveFileCount !== null) {
    redactedJson.workspaceSnapshotArchiveFileCount =
      diagnostics.workspaceSnapshotArchiveFileCount;
  }
  if (diagnostics.workspaceSnapshotArchiveInlineFileCount !== null) {
    redactedJson.workspaceSnapshotArchiveInlineFileCount =
      diagnostics.workspaceSnapshotArchiveInlineFileCount;
  }
  if (diagnostics.workspaceSnapshotArchivePreservedArtifactCandidateCount !== null) {
    redactedJson.workspaceSnapshotArchivePreservedArtifactCandidateCount =
      diagnostics.workspaceSnapshotArchivePreservedArtifactCandidateCount;
  }
  if (diagnostics.workspaceSnapshotArchivePreservedArtifactIncludedCount !== null) {
    redactedJson.workspaceSnapshotArchivePreservedArtifactIncludedCount =
      diagnostics.workspaceSnapshotArchivePreservedArtifactIncludedCount;
  }
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
  request: HostedWorkspaceIdleCheckpointRequest;
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

function resolveWorkspaceDurableRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault") {
    return path.dirname(resolvedVaultRoot);
  }
  return resolvedVaultRoot;
}

function resolveWorkspaceScratchRoot(vaultRoot: string): string {
  const durableRoot = resolveWorkspaceDurableRoot(vaultRoot);
  if (path.basename(durableRoot) === "durable") {
    return path.join(path.dirname(durableRoot), "scratch");
  }
  return path.join(path.dirname(durableRoot), `${path.basename(durableRoot)}-scratch`);
}

function resolveWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const parent = path.dirname(resolvedVaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault" && path.basename(parent) === "durable") {
    return path.join(parent, "home");
  }
  return path.join(parent, `${path.basename(resolvedVaultRoot)}-operator-home`);
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
