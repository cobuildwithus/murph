import { rm } from "node:fs/promises";
import path from "node:path";

import {
  createHostedConversationMailboxImportItem,
  enqueueHostedSystemMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeConfig,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics,
  type HostedWorkspaceSnapshotArchiveExtraPath,
  type HostedWorkspaceSnapshotSizeDiagnostics,
} from "@murphai/runtime-state/node";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
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
  pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks,
} from "./workspace-snapshot-cleanup.ts";
import {
  clearLegacyWorkspaceRefsForV2SnapshotMaterialization,
  materializeLegacyWorkspaceRefsForV2Snapshot,
  prepareLegacyWorkspaceRefsForV2SnapshotMaterialization,
} from "./legacy-workspace-snapshot-materialization.ts";
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

const HOSTED_WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_PATTERN = /^[a-f0-9]{64}$/u;

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
  snapshotDiagnosticsHashSecret?: string | null;
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
        snapshotDiagnosticsHashSecret:
          normalizeHostedWorkspaceSnapshotDiagnosticsHashSecret(
            input.snapshotDiagnosticsHashSecret,
          ),
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
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  snapshotDiagnosticsHashSecret?: string | null;
  userId: string;
  vaultRoot: string;
}): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const request = requireHostedWorkspaceBridgeIdleCheckpointRequest(input.request);
  const legacyMaterialization = await prepareLegacyWorkspaceRefsForV2SnapshotMaterialization({
    artifactStore: input.platform.artifactStore,
    platform: input.platform,
    vaultRoot: input.vaultRoot,
  });
  await writeHostedCheckpointSnapshotLifecycleLog({
    details: {
      currentSnapshotRefPresent: legacyMaterialization.currentSnapshotRefPresent,
      legacyBundleRefPresent: legacyMaterialization.legacyBundleRefPresent,
      preservedInlineFileCount: legacyMaterialization.preservedInlineFileCount,
      skippedInlineFileCount: legacyMaterialization.skippedInlineFileCount,
    },
    eventCode: "checkpoint.snapshot_plan",
    level: "info",
    platform: input.platform,
    request,
  });
  return await createHostedWorkspaceV2Snapshot({
    ...input,
    legacyMaterialization,
    request,
    snapshotDiagnosticsHashSecret: input.snapshotDiagnosticsHashSecret ?? null,
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

const HOSTED_WORKSPACE_V2_SNAPSHOT_MODE = "workspace_snapshot_v2";

interface HostedWorkspaceSnapshotTimingDetails
  extends HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails {
  snapshotArchiveBuildElapsedMs?: number;
  snapshotDirectR2UploadElapsedMs?: number;
}

interface HostedWorkspaceBridgeV2SnapshotInput {
  legacyMaterialization: Awaited<
    ReturnType<typeof prepareLegacyWorkspaceRefsForV2SnapshotMaterialization>
  >;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotDiagnosticsHashSecret: string | null;
  userId: string;
  vaultRoot: string;
}

async function createHostedWorkspaceV2Snapshot(
  input: HostedWorkspaceBridgeV2SnapshotInput,
): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}> {
  const startedAt = Date.now();
  let leaseCheckCount = 0;
  const workspaceSnapshotPort = input.platform.workspaceSnapshotPort;
  if (!workspaceSnapshotPort) {
    throw new Error("Hosted workspace snapshot port is required for v2 checkpoints.");
  }

  await writeHostedCheckpointSnapshotLifecycleLog({
    details: {
      checkpointReason: input.request.reason,
      legacyBundleRefPresent: input.legacyMaterialization.legacyBundleRefPresent,
      nextWakeAtPresent: input.request.nextWakeAt != null,
      nextWakeReasonPresent: input.request.nextWakeReason != null,
      preservedInlineFileCount: input.legacyMaterialization.preservedInlineFileCount,
      redactedStatusPresent: input.request.redactedStatus !== null,
      skippedInlineFileCount: input.legacyMaterialization.skippedInlineFileCount,
      snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
    },
    eventCode: "checkpoint.snapshot_started",
    level: "info",
    platform: input.platform,
    request: input.request,
  });

  let snapshotRef: HostedWorkspaceSnapshotV2Ref;
  let checkpoint: HostedWorkspaceCheckpointResponse | undefined;
  let encryptedByteSize = 0;
  let workspaceSnapshotFileCount = 0;
  let workspaceSnapshotPlainBytes = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  let encryptedTemporaryDirectoryPath: string | null = null;
  let snapshotSession: Awaited<ReturnType<NonNullable<HostedWorkspaceRuntimeJobOptions["platform"]["workspaceSnapshotPort"]>["startSnapshotSession"]>> | null = null;
  let checkpointAttempted = false;
  let prunedRuntimeSymlinkCount = 0;
  const snapshotTimings: HostedWorkspaceSnapshotTimingDetails = {};
  try {
    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_snapshot",
      userId: input.userId,
    });
    const durableRoot = resolveWorkspaceDurableRoot(input.vaultRoot);
    const operatorHomeRoot = resolveWorkspaceOperatorHomeRoot(input.vaultRoot);
    snapshotSession = await workspaceSnapshotPort.startSnapshotSession({
      expectedWorkspaceVersion: input.request.expectedWorkspaceVersion,
      nextWakeAt: input.request.nextWakeAt,
      nextWakeReason: input.request.nextWakeReason,
      reason: "idle_shutdown",
    });
    const activeSnapshotSession = snapshotSession;
    ({ prunedRuntimeSymlinkCount } = await pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks({
      durableRoot,
      operatorHomeRoot,
    }));
    if (prunedRuntimeSymlinkCount > 0) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          prunedRuntimeSymlinkCount,
          snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
        },
        level: "warn",
        message: "Hosted workspace snapshot pruned runtime-owned symlinks.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
    await materializeLegacyWorkspaceRefsForV2Snapshot({
      artifactStore: input.platform.artifactStore,
      operatorHomeRoot,
      plan: input.legacyMaterialization,
      vaultRoot: input.vaultRoot,
    });
    await clearLegacyWorkspaceRefsForV2SnapshotMaterialization({
      plan: input.legacyMaterialization,
      vaultRoot: input.vaultRoot,
    });
    const legacySnapshotExtraFiles: HostedWorkspaceSnapshotArchiveExtraPath[] = [];
    for (const file of input.legacyMaterialization.skippedInlineFiles) {
      if (file.root === "operator-home" || file.root === "vault") {
        legacySnapshotExtraFiles.push({
          path: file.path,
          root: file.root,
        });
      }
    }
    const encrypted = await runHostedWorkspaceSnapshotMeasuredStep({
      key: "snapshotArchiveBuildElapsedMs",
      run: async () => {
        const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
          codexHomeSnapshotHashSecret: input.snapshotDiagnosticsHashSecret,
          durableRoot,
          extraFiles: legacySnapshotExtraFiles,
          operatorHomeRoot,
          vaultRoot: input.vaultRoot,
        });
        workspaceSnapshotSizeDiagnostics =
          createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics({
            archivePlan,
            hashSecret: input.snapshotDiagnosticsHashSecret,
          });
        return await createEncryptedWorkspaceSnapshotFile({
          aad: activeSnapshotSession.encryption.aad,
          archiveEntries: archivePlan.entries,
          dataKey: activeSnapshotSession.encryption.dataKeyBase64,
          durableRoot,
          ivBase64: activeSnapshotSession.encryption.ivBase64,
          maxEncryptedBytes: Math.min(
            activeSnapshotSession.limits.maxSinglePartEncryptedBytes,
            HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
          ),
          outputDir: resolveWorkspaceScratchRoot(input.vaultRoot),
        });
      },
      timings: snapshotTimings,
    });
    encryptedTemporaryDirectoryPath = encrypted.temporaryDirectoryPath;
    encryptedByteSize = encrypted.encryptedByteSize;
    workspaceSnapshotFileCount = encrypted.fileCount;
    workspaceSnapshotPlainBytes = encrypted.totalPlainBytes;
    const warnEncryptedBytes = Math.min(
      activeSnapshotSession.limits.warnEncryptedBytes,
      HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
    );
    if (encryptedByteSize >= warnEncryptedBytes) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          encryptedByteSize,
          fileCount: encrypted.fileCount,
          maxSinglePartEncryptedBytes:
            activeSnapshotSession.limits.maxSinglePartEncryptedBytes,
          snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
          totalPlainBytes: encrypted.totalPlainBytes,
          warnEncryptedBytes,
          ...createHostedWorkspaceSnapshotSizeDiagnosticLogDetails(
            workspaceSnapshotSizeDiagnostics,
          ),
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
    const directUploadTimings = await runHostedWorkspaceSnapshotMeasuredStep({
      key: "snapshotDirectR2UploadElapsedMs",
      run: async () =>
        await workspaceSnapshotPort.putSnapshotObjectDirect({
          encryptedByteSize: encrypted.encryptedByteSize,
          encryptedObjectSha256: encrypted.encryptedObjectSha256,
          objectKey: activeSnapshotSession.objectKey,
          sourceFilePath: encrypted.encryptedFilePath,
          snapshotId: activeSnapshotSession.snapshotId,
        }),
      timings: snapshotTimings,
    });
    recordHostedWorkspaceSnapshotDirectUploadTimings(
      snapshotTimings,
      directUploadTimings,
    );

    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_web_checkpoint",
      userId: input.userId,
    });
    snapshotRef = {
      archive: {
        compression: encrypted.compression,
        encryptedByteSize: encrypted.encryptedByteSize,
        encryptedObjectSha256: encrypted.encryptedObjectSha256,
        fileCount: encrypted.fileCount,
        format: "tar",
        plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
        totalPlainBytes: encrypted.totalPlainBytes,
      },
      createdAt: new Date().toISOString(),
      encryption: {
        aad: activeSnapshotSession.encryption.aad,
        ivBase64: activeSnapshotSession.encryption.ivBase64,
        rootKeyId: activeSnapshotSession.encryption.rootKeyId,
        scheme: activeSnapshotSession.encryption.scheme,
        wrappedDataKey: activeSnapshotSession.encryption.wrappedDataKey,
      },
      objectKey: activeSnapshotSession.objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId: activeSnapshotSession.snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId: input.userId,
    };
    checkpointAttempted = true;
    const completed = await workspaceSnapshotPort.completeSnapshotSession({
      checkpointRequest: {
        ...input.request,
        snapshotRef,
      },
      ref: snapshotRef,
    });
    snapshotRef = completed.snapshotRef;
    checkpoint = completed.checkpoint;
    await clearLegacyWorkspaceRefsForV2SnapshotMaterialization({
      plan: input.legacyMaterialization,
      vaultRoot: input.vaultRoot,
    }).catch((clearError) => {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
        },
        error: clearError,
        level: "warn",
        message: "Hosted workspace legacy snapshot manifest cleanup failed.",
        phase: "checkpoint",
        userId: input.userId,
      });
    });
  } catch (error) {
    const classifiedError = classifyHostedWorkspaceSnapshotFailure(error);
    const abortedSnapshotSession = snapshotSession;
    if (abortedSnapshotSession && !checkpointAttempted) {
      try {
        await workspaceSnapshotPort.abortSnapshotSession({
          objectKey: abortedSnapshotSession.objectKey,
          snapshotId: abortedSnapshotSession.snapshotId,
        });
      } catch (abortError) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
          },
          error: abortError,
          level: "warn",
          message: "Hosted workspace snapshot session abort failed.",
          phase: "checkpoint",
          userId: input.userId,
        });
      }
    }
    await writeHostedCheckpointSnapshotLifecycleLog({
      details: {
        encryptedByteSize,
        leaseCheckCount,
        ...(prunedRuntimeSymlinkCount > 0
          ? {
              prunedRuntimeSymlinkCount,
              runtimeSymlinkPruneScope: "operator-home",
            }
          : {}),
        ...snapshotTimings,
        ...(workspaceSnapshotFileCount > 0
          ? { workspaceSnapshotFileCount }
          : {}),
        ...(workspaceSnapshotPlainBytes > 0
          ? { workspaceSnapshotPlainBytes }
          : {}),
        ...createHostedWorkspaceSnapshotSizeDiagnosticLogDetails(
          workspaceSnapshotSizeDiagnostics,
        ),
        snapshotElapsedMs: Date.now() - startedAt,
        snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
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
            snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
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
    encryptedByteSize,
    fileCount: workspaceSnapshotFileCount,
    leaseCheckCount,
    plainByteSize: workspaceSnapshotPlainBytes,
    platform: input.platform,
    prunedRuntimeSymlinkCount,
    request: input.request,
    snapshotElapsedMs: Date.now() - startedAt,
    snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
    sizeDiagnostics: workspaceSnapshotSizeDiagnostics,
    timingDetails: snapshotTimings,
  });

  return {
    ...(checkpoint ? { checkpoint } : {}),
    snapshotRef,
  };
}

async function runHostedWorkspaceSnapshotMeasuredStep<T>(input: {
  key: keyof HostedWorkspaceSnapshotTimingDetails;
  run: () => Promise<T>;
  timings: HostedWorkspaceSnapshotTimingDetails;
}): Promise<T> {
  const stepStartedAt = Date.now();
  try {
    return await input.run();
  } finally {
    recordHostedWorkspaceSnapshotStepTiming(input.timings, input.key, stepStartedAt);
  }
}

function recordHostedWorkspaceSnapshotStepTiming(
  timings: HostedWorkspaceSnapshotTimingDetails,
  key: keyof HostedWorkspaceSnapshotTimingDetails,
  stepStartedAt: number,
): void {
  const elapsedMs = Date.now() - stepStartedAt;
  timings[key] = Number.isSafeInteger(elapsedMs) && elapsedMs >= 0
    ? elapsedMs
    : 0;
}

function recordHostedWorkspaceSnapshotDirectUploadTimings(
  timings: HostedWorkspaceSnapshotTimingDetails,
  directUploadTimings: HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails | void,
): void {
  if (!directUploadTimings) {
    return;
  }

  recordHostedWorkspaceSnapshotOptionalTiming(
    timings,
    "snapshotDirectR2PresignElapsedMs",
    directUploadTimings.snapshotDirectR2PresignElapsedMs,
  );
  recordHostedWorkspaceSnapshotOptionalTiming(
    timings,
    "snapshotDirectR2PutElapsedMs",
    directUploadTimings.snapshotDirectR2PutElapsedMs,
  );
}

function recordHostedWorkspaceSnapshotOptionalTiming(
  timings: HostedWorkspaceSnapshotTimingDetails,
  key: keyof HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  elapsedMs: number | undefined,
): void {
  if (elapsedMs === undefined) {
    return;
  }

  timings[key] = Number.isSafeInteger(elapsedMs) && elapsedMs >= 0
    ? elapsedMs
    : 0;
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
  details?: HostedRuntimeRedactedJson;
  error?: unknown;
  eventCode: HostedRuntimeLogEventCode;
  level: "error" | "info" | "warn";
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceIdleCheckpointRequest;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }
  const eventCode = input.eventCode;

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    ...(input.details ?? {}),
  };
  appendHostedCheckpointSnapshotFailureDiagnostics(redactedJson, input.error);

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
  if (safeDiagnosticDetail) {
    redactedJson.safeErrorDetail = safeDiagnosticDetail;
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

function normalizeHostedWorkspaceSnapshotDiagnosticsHashSecret(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return HOSTED_WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_PATTERN.test(normalized)
    ? normalized
    : null;
}

function createHostedWorkspaceSnapshotSizeDiagnosticLogDetails(
  diagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null,
): HostedRuntimeRedactedJson {
  if (!diagnostics) {
    return {};
  }

  return {
    workspaceSnapshotClassSummary: diagnostics.workspaceSnapshotClassSummary,
    workspaceSnapshotExternalArtifactBytes:
      diagnostics.workspaceSnapshotExternalArtifactBytes,
    workspaceSnapshotExternalArtifactCount:
      diagnostics.workspaceSnapshotExternalArtifactCount,
    workspaceSnapshotFingerprintStatus: diagnostics.workspaceSnapshotFingerprintStatus,
    workspaceSnapshotIncludedFileCount: diagnostics.workspaceSnapshotIncludedFileCount,
    workspaceSnapshotInlineBytes: diagnostics.workspaceSnapshotInlineBytes,
    workspaceSnapshotLargestFiles: diagnostics.workspaceSnapshotLargestFiles,
    workspaceSnapshotMaxFileBytes: diagnostics.workspaceSnapshotMaxFileBytes,
    workspaceSnapshotMaxFileClass: diagnostics.workspaceSnapshotMaxFileClass,
  };
}

async function writeHostedCheckpointSnapshotMetricLog(input: {
  encryptedByteSize: number;
  fileCount: number;
  leaseCheckCount: number;
  plainByteSize: number;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  prunedRuntimeSymlinkCount: number;
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotElapsedMs: number;
  snapshotMode: typeof HOSTED_WORKSPACE_V2_SNAPSHOT_MODE;
  sizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null;
  timingDetails: HostedWorkspaceSnapshotTimingDetails;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    browserVaultReplicaState: "omitted",
    checkpointReason: input.request.reason,
    leaseCheckCount: input.leaseCheckCount,
    ...(input.prunedRuntimeSymlinkCount > 0
      ? {
          prunedRuntimeSymlinkCount: input.prunedRuntimeSymlinkCount,
          runtimeSymlinkPruneScope: "operator-home",
        }
      : {}),
    ...input.timingDetails,
    snapshotElapsedMs: input.snapshotElapsedMs,
    workspaceSnapshotEncryptedBytes: input.encryptedByteSize,
    workspaceSnapshotFileCount: input.fileCount,
    workspaceSnapshotPlainBytes: input.plainByteSize,
    ...createHostedWorkspaceSnapshotSizeDiagnosticLogDetails(input.sizeDiagnostics),
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
