import { rm } from "node:fs/promises";
import path from "node:path";

import {
  HostedRuntimeCheckpointInterruptedByWakeError,
  type HostedWorkspaceRuntimeJobOptions,
} from "../hosted-runtime.ts";
import {
  pruneTerminalWriteOperationRecords,
  type PruneTerminalWriteOperationRecordsResult,
  withCanonicalWriteLock,
} from "@murphai/core";
import {
  pruneAssistantRuntimeResidue,
  type AssistantRuntimeResiduePruneResult,
} from "@murphai/assistant-engine/assistant-runtime-residue";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics,
  type HostedWorkspaceSnapshotArchiveEntry,
  type HostedWorkspaceSnapshotArchiveExtraPath,
  type HostedWorkspaceSnapshotSizeDiagnostics,
} from "@murphai/runtime-state/node";
import {
  compactHostedUnresolvedAssistantInputIds,
} from "./pending-input-index.ts";
import {
  hasHostedProviderCleanupRecoveryCompleted,
} from "./provider-cleanup.ts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  readHostedRuntimeSafeErrorText,
  redactHostedRuntimeDiagnosticText,
} from "@murphai/hosted-execution";
import {
  type HostedExecutionSnapshotRef,
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
} from "./checkpoint-bridge.ts";
import {
  createHostedWorkspaceBridgeMailboxImporter,
  type HostedWorkspaceMailboxPayloadDecoder,
} from "./snapshot-bridge-mailbox.ts";
import type {
  HostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  normalizeHostedAssistantRuntimeConfig,
} from "./environment.ts";
import type {
  HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
} from "./platform.ts";
import {
  classifyHostedWorkspaceSnapshotFailure,
  readHostedBundleArchiveValidationErrorDetails,
} from "./snapshot-failure-classification.ts";
import {
  pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks,
} from "./snapshot-cleanup.ts";
import {
  clearLegacyWorkspaceRefsForV2SnapshotMaterialization,
  materializeLegacyWorkspaceRefsForV2Snapshot,
  prepareLegacyWorkspaceRefsForV2SnapshotMaterialization,
} from "./legacy-snapshot-materialization.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
export type HostedRuntimeBridgeReadCurrentLease = () =>
  | HostedRuntimeBridgeCheckpointLease
  | null
  | Promise<HostedRuntimeBridgeCheckpointLease | null>;
type HostedWorkspaceSnapshotCheckpointRequest =
  HostedWorkspaceCheckpointRequest & {
    handledConversationFrontierSelected?: boolean;
    reason: "idle_shutdown";
  };

const HOSTED_WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_PATTERN = /^[a-f0-9]{64}$/u;

export type {
  HostedMailboxPayloadDecodeInput,
  HostedMailboxPayloadDecodeItemRef,
  HostedMailboxPayloadDecodeResult,
  HostedWorkspaceMailboxPayloadDecodeInput,
  HostedWorkspaceMailboxPayloadDecodeResult,
  HostedWorkspaceMailboxPayloadDecoder,
} from "./snapshot-bridge-mailbox.ts";

export interface HostedWorkspaceSnapshotArchiveBuilder {
  buildEncryptedSnapshot(input: {
    aad: HostedWorkspaceSnapshotV2Aad;
    archiveEntries: readonly HostedWorkspaceSnapshotArchiveEntry[];
    dataKey: string;
    durableRoot: string;
    ivBase64: string;
    maxEncryptedBytes: number;
    outputDir: string;
    signal?: AbortSignal | null;
  }): Promise<{
    compression: typeof HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION;
    encryptedByteSize: number;
    encryptedFilePath: string;
    encryptedObjectSha256: string;
    fileCount: number;
    plaintextArchiveSha256: string;
    temporaryDirectoryPath: string;
    totalPlainBytes: number;
  }>;
}

export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  decodeMailboxPayload?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceInvocationRequest;
  runtime: HostedAssistantRuntimeConfig;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  vaultRoot: string;
  waitForBackgroundAssistantWork(signal: AbortSignal | null): Promise<void>;
}

export function createHostedWorkspaceRuntimeBridgeJobOptions(
  input: HostedWorkspaceRuntimeBridgeOptionsInput,
): HostedWorkspaceRuntimeJobOptions {
  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  const readCurrentLease = input.readCurrentLease
    ?? (() => createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.request));
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, input.platform);
  const decodeMailboxPayload = input.decodeMailboxPayload;
  if (!decodeMailboxPayload) {
    throw new Error("Hosted mailbox payload decoder is required for this invocation.");
  }

  return {
    createCheckpointSnapshot: async (checkpointInput, context) => {
      await input.waitForBackgroundAssistantWork(context?.signal ?? null);
      return await createHostedWorkspaceBridgeCheckpointSnapshot({
        platform: input.platform,
        readCurrentLease,
        request: {
          attemptId: input.request.attemptId,
          expectedWorkspaceVersion:
            checkpointInput.expectedWorkspaceVersion ?? input.request.workspaceVersion,
          ...(checkpointInput.handledConversationFrontierSelected === undefined
            ? {}
            : {
                handledConversationFrontierSelected:
                  checkpointInput.handledConversationFrontierSelected,
              }),
          ...(checkpointInput.handledConversationMailboxItemIds === undefined
            ? {}
            : {
                handledConversationMailboxItemIds:
                  [...checkpointInput.handledConversationMailboxItemIds],
              }),
          inboxMediaRetentionWakeAt: Object.hasOwn(checkpointInput, "inboxMediaRetentionWakeAt")
            ? checkpointInput.inboxMediaRetentionWakeAt ?? null
            : input.request.workspace?.inboxMediaRetentionWakeAt ?? null,
          leaseGeneration: input.request.leaseGeneration,
          nextWakeAt: Object.hasOwn(checkpointInput, "nextWakeAt")
            ? checkpointInput.nextWakeAt ?? null
            : null,
          nextWakeReason: Object.hasOwn(checkpointInput, "nextWakeReason")
            ? checkpointInput.nextWakeReason ?? null
            : null,
          reason: checkpointInput.reason,
          redactedStatus: checkpointInput.redactedStatus ?? null,
          ...(checkpointInput.idleCheckpointTrigger
            ? { idleCheckpointTrigger: checkpointInput.idleCheckpointTrigger }
            : {}),
          ...(checkpointInput.runtimeWakePendingAtCheckpoint === undefined
            ? {}
            : {
                runtimeWakePendingAtCheckpoint:
                  checkpointInput.runtimeWakePendingAtCheckpoint,
              }),
          snapshotRef: null,
        },
        previousWorkspaceCheckpointedAt: input.request.workspace?.checkpointedAt ?? null,
        snapshotDiagnosticsHashSecret:
          normalizeHostedWorkspaceSnapshotDiagnosticsHashSecret(
            input.snapshotDiagnosticsHashSecret,
          ),
        snapshotArchiveBuilder: input.snapshotArchiveBuilder,
        signal: context?.signal ?? null,
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

export function createHostedRuntimeBridgeLeaseFromWorkspaceRequest(
  request: HostedWorkspaceInvocationRequest,
): HostedRuntimeBridgeCheckpointLease {
  return {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    providerEgressToken: request.providerEgressToken ?? null,
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

async function createHostedWorkspaceBridgeCheckpointSnapshot(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  previousWorkspaceCheckpointedAt: string | null;
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest & {
    handledConversationFrontierSelected?: boolean;
  };
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  signal: AbortSignal | null;
  userId: string;
  vaultRoot: string;
}): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const request = requireHostedWorkspaceBridgeSnapshotCheckpointRequest(input.request);
  return await withCanonicalWriteLock(input.vaultRoot, async () => {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const legacyMaterialization = await prepareLegacyWorkspaceRefsForV2SnapshotMaterialization({
      artifactStore: input.platform.artifactStore,
      platform: input.platform,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
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
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    return await createHostedWorkspaceV2Snapshot({
      ...input,
      legacyMaterialization,
      request,
      snapshotDiagnosticsHashSecret: input.snapshotDiagnosticsHashSecret ?? null,
    });
  });
}

function requireHostedWorkspaceBridgeSnapshotCheckpointRequest(
  request: HostedWorkspaceCheckpointRequest,
): HostedWorkspaceSnapshotCheckpointRequest {
  const reason = request.reason;
  if (reason !== "idle_shutdown") {
    throw new Error("Hosted workspace snapshot construction is idle-shutdown only.");
  }

  return {
    ...request,
    reason,
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
  previousWorkspaceCheckpointedAt: string | null;
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceSnapshotCheckpointRequest;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret: string | null;
  signal: AbortSignal | null;
  userId: string;
  vaultRoot: string;
}

async function createHostedWorkspaceV2Snapshot(
  input: HostedWorkspaceBridgeV2SnapshotInput,
): Promise<{
  checkpoint?: HostedWorkspaceCheckpointResponse;
  localWorkspaceCleanForWarmReuse: boolean;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}> {
  const startedAt = Date.now();
  let leaseCheckCount = 0;
  const workspaceSnapshotPort = input.platform.workspaceSnapshotPort;
  if (!workspaceSnapshotPort) {
    throw new Error("Hosted workspace snapshot port is required for v2 checkpoints.");
  }

  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
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
    signal: input.signal,
  });
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);

  let snapshotRef: HostedWorkspaceSnapshotV2Ref;
  let checkpoint: HostedWorkspaceCheckpointResponse | undefined;
  let encryptedByteSize = 0;
  let workspaceSnapshotFileCount = 0;
  let workspaceSnapshotPlainBytes = 0;
  let workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null = null;
  let encryptedTemporaryDirectoryPath: string | null = null;
  let snapshotSession: Awaited<ReturnType<NonNullable<HostedWorkspaceRuntimeJobOptions["platform"]["workspaceSnapshotPort"]>["startSnapshotSession"]>> | null = null;
  let checkpointAttempted = false;
  let localWorkspaceCleanForWarmReuse = false;
  let prunedRuntimeSymlinkCount = 0;
  let terminalWriteOperationPruneResult: PruneTerminalWriteOperationRecordsResult | null = null;
  let assistantRuntimeResiduePruneResult: AssistantRuntimeResiduePruneResult | null = null;
  const snapshotTimings: HostedWorkspaceSnapshotTimingDetails = {};
  try {
    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_snapshot",
      userId: input.userId,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const durableRoot = resolveWorkspaceDurableRoot(input.vaultRoot);
    const operatorHomeRoot = resolveWorkspaceOperatorHomeRoot(input.vaultRoot);
    snapshotSession = await workspaceSnapshotPort.startSnapshotSession({
      expectedWorkspaceVersion: input.request.expectedWorkspaceVersion,
      inboxMediaRetentionWakeAt: input.request.inboxMediaRetentionWakeAt,
      nextWakeAt: input.request.nextWakeAt,
      nextWakeReason: input.request.nextWakeReason,
      reason: input.request.reason,
      signal: input.signal,
    });
    const activeSnapshotSession = snapshotSession;
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    ({ prunedRuntimeSymlinkCount } = await pruneHostedWorkspaceSnapshotRuntimeOwnedSymlinks({
      durableRoot,
      operatorHomeRoot,
      signal: input.signal,
    }));
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
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
    try {
      terminalWriteOperationPruneResult = await pruneTerminalWriteOperationRecords({
        checkpointedAfter: input.previousWorkspaceCheckpointedAt,
        signal: input.signal,
        vaultRoot: input.vaultRoot,
      });
      if (hasTerminalWriteOperationPrunedFiles(terminalWriteOperationPruneResult)) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            ...createTerminalWriteOperationPruneLogDetails(
              terminalWriteOperationPruneResult,
            ),
            snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
          },
          level: "info",
          message: "Hosted workspace snapshot pruned terminal write-operation records.",
          phase: "checkpoint",
          userId: input.userId,
        });
      }
    } catch (cleanupError) {
      assertHostedWorkspaceSnapshotConstructionLive(input.signal);
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
          terminalWriteOperationPruneFailed: true,
        },
        error: cleanupError,
        level: "warn",
        message: "Hosted workspace terminal write-operation cleanup failed.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    try {
      const pendingInputIds = await compactHostedUnresolvedAssistantInputIds({
        signal: input.signal,
        vaultRoot: input.vaultRoot,
      });
      assertHostedWorkspaceSnapshotConstructionLive(input.signal);
      assistantRuntimeResiduePruneResult = await pruneAssistantRuntimeResidue({
        generatedDeliveryFilesQuiescent: true,
        now: new Date(),
        pendingInputIds,
        protectPendingProviderCleanupEvidence:
          !(await hasHostedProviderCleanupRecoveryCompleted(input.vaultRoot)),
        signal: input.signal,
        vault: input.vaultRoot,
      });
      if (
        hasAssistantRuntimeResiduePrunedFiles(
          assistantRuntimeResiduePruneResult,
        ) ||
        assistantRuntimeResiduePruneResult
          .generatedDeliveryCleanupSkippedUntrustedOutbox
      ) {
        const generatedDeliveryCleanupSkipped =
          assistantRuntimeResiduePruneResult
            .generatedDeliveryCleanupSkippedUntrustedOutbox;
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            ...createAssistantRuntimeResiduePruneLogDetails(
              assistantRuntimeResiduePruneResult,
            ),
            snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
          },
          level: generatedDeliveryCleanupSkipped ? "warn" : "info",
          message: generatedDeliveryCleanupSkipped
            ? "Hosted workspace generated-delivery cleanup retained files because outbox inventory was untrusted."
            : "Hosted workspace snapshot pruned assistant runtime residue.",
          phase: "checkpoint",
          userId: input.userId,
        });
      }
    } catch (cleanupError) {
      assertHostedWorkspaceSnapshotConstructionLive(input.signal);
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          assistantRuntimeResiduePruneFailed: true,
          snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
        },
        error: cleanupError,
        level: "warn",
        message: "Hosted workspace assistant runtime residue cleanup failed.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    await materializeLegacyWorkspaceRefsForV2Snapshot({
      artifactStore: input.platform.artifactStore,
      operatorHomeRoot,
      plan: input.legacyMaterialization,
      scratchRoot: resolveWorkspaceScratchRoot(input.vaultRoot),
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
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
          signal: input.signal,
          vaultRoot: input.vaultRoot,
        });
        assertHostedWorkspaceSnapshotConstructionLive(input.signal);
        workspaceSnapshotSizeDiagnostics =
          createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics({
            archivePlan,
            hashSecret: input.snapshotDiagnosticsHashSecret,
          });
        if (archivePlan.totalPlainBytes >= HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES) {
          throw new RangeError("Hosted workspace snapshot exceeds the total plain size limit.");
        }
        return await input.snapshotArchiveBuilder.buildEncryptedSnapshot({
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
          signal: input.signal,
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
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const directUploadTimings = await runHostedWorkspaceSnapshotMeasuredStep({
      key: "snapshotDirectR2UploadElapsedMs",
      run: async () =>
        await workspaceSnapshotPort.putSnapshotObjectDirect({
          encryptedByteSize: encrypted.encryptedByteSize,
          encryptedObjectSha256: encrypted.encryptedObjectSha256,
          objectKey: activeSnapshotSession.objectKey,
          signal: input.signal,
          sourceFilePath: encrypted.encryptedFilePath,
          snapshotId: activeSnapshotSession.snapshotId,
        }),
      timings: snapshotTimings,
    });
    recordHostedWorkspaceSnapshotDirectUploadTimings(
      snapshotTimings,
      directUploadTimings,
    );
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);

    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_web_checkpoint",
      userId: input.userId,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
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
    const checkpointRequest = { ...input.request };
    delete checkpointRequest.handledConversationFrontierSelected;
    const completed = await workspaceSnapshotPort.completeSnapshotSession({
      checkpointRequest: {
        ...checkpointRequest,
        snapshotRef,
      },
      ref: snapshotRef,
    });
    snapshotRef = completed.snapshotRef;
    checkpoint = completed.checkpoint;
    try {
      await clearLegacyWorkspaceRefsForV2SnapshotMaterialization({
        plan: input.legacyMaterialization,
        vaultRoot: input.vaultRoot,
      });
      localWorkspaceCleanForWarmReuse = true;
    } catch (clearError) {
      localWorkspaceCleanForWarmReuse = false;
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
    }
  } catch (error) {
    const activeInterruptionError = input.signal?.aborted === true
      ? input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("Hosted workspace snapshot construction was interrupted.")
      : null;
    const interruptedBeforeCommit = activeInterruptionError !== null && !checkpointAttempted;
    const controlInterruptionError = interruptedBeforeCommit
      ? activeInterruptionError
      : activeInterruptionError instanceof HostedRuntimeCheckpointInterruptedByWakeError
        ? activeInterruptionError
        : null;
    const interruptionCausedFailure = interruptedBeforeCommit
      && error === input.signal?.reason;
    const reportedError = interruptionCausedFailure
      ? activeInterruptionError
      : classifyHostedWorkspaceSnapshotFailure(error);
    // Preserve the abort reason for control flow, but classify only the exact
    // caught runtime-wake abort as expected preemption. A real failure that
    // merely races with a wake remains actionable.
    const classifiedError = controlInterruptionError ?? reportedError;
    const expectedRuntimeWakePreemption = interruptionCausedFailure
      && classifiedError instanceof HostedRuntimeCheckpointInterruptedByWakeError;
    const abortedSnapshotSession = snapshotSession;
    if (abortedSnapshotSession && !checkpointAttempted) {
      const abortSnapshotSession = async () => {
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
      };
      if (interruptedBeforeCommit) {
        // Server-side current-session replacement and orphan alarms are the
        // durability fallback. Foreground work must not wait on this DELETE.
        void abortSnapshotSession();
      } else {
        await abortSnapshotSession();
      }
    }
    const snapshotFailureLog = writeHostedCheckpointSnapshotLifecycleLog({
      details: {
        encryptedByteSize,
        leaseCheckCount,
        ...(prunedRuntimeSymlinkCount > 0
          ? {
              prunedRuntimeSymlinkCount,
              runtimeSymlinkPruneScope: "operator-home",
            }
          : {}),
        ...createTerminalWriteOperationPruneLogDetails(
          terminalWriteOperationPruneResult,
        ),
        ...createAssistantRuntimeResiduePruneLogDetails(
          assistantRuntimeResiduePruneResult,
        ),
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
        ...(interruptedBeforeCommit
          ? { snapshotInterruptedBeforeCommit: true }
          : {}),
        ...(expectedRuntimeWakePreemption
          ? {
              errorCode: "runtime_wake_during_checkpoint",
              snapshotOutcomeKind: "expected_preemption",
              snapshotPreemptionKind: "runtime_wake",
            }
          : {}),
        snapshotElapsedMs: Date.now() - startedAt,
        snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
      },
      ...(!expectedRuntimeWakePreemption ? { error: reportedError } : {}),
      eventCode: expectedRuntimeWakePreemption
        ? "checkpoint.snapshot_preempted"
        : "checkpoint.snapshot_failed",
      level: expectedRuntimeWakePreemption
        ? "info"
        : interruptedBeforeCommit
          ? "warn"
          : "error",
      platform: input.platform,
      request: input.request,
      signal: null,
    });
    if (interruptedBeforeCommit) {
      void snapshotFailureLog;
    } else {
      await snapshotFailureLog;
    }
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
    assistantRuntimeResiduePruneResult,
    encryptedByteSize,
    fileCount: workspaceSnapshotFileCount,
    leaseCheckCount,
    plainByteSize: workspaceSnapshotPlainBytes,
    platform: input.platform,
    prunedRuntimeSymlinkCount,
    terminalWriteOperationPruneResult,
    request: input.request,
    signal: input.signal,
    snapshotElapsedMs: Date.now() - startedAt,
    snapshotMode: HOSTED_WORKSPACE_V2_SNAPSHOT_MODE,
    sizeDiagnostics: workspaceSnapshotSizeDiagnostics,
    timingDetails: snapshotTimings,
    webCheckpointAccepted: checkpoint?.checkpointed === true,
  });

  return {
    ...(checkpoint ? { checkpoint } : {}),
    localWorkspaceCleanForWarmReuse,
    snapshotRef,
  };
}

function assertHostedWorkspaceSnapshotConstructionLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot construction was interrupted.");
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

async function writeHostedCheckpointSnapshotLifecycleLog(input: {
  details?: HostedRuntimeRedactedJson;
  error?: unknown;
  eventCode: HostedRuntimeLogEventCode;
  level: "error" | "info" | "warn";
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  request: HostedWorkspaceSnapshotCheckpointRequest;
  signal: AbortSignal | null;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }
  const eventCode = input.eventCode;

  const redactedJson: HostedRuntimeRedactedJson = {
    checkpointReason: input.request.reason,
    handledConversationFrontierSelected:
      input.request.handledConversationFrontierSelected ?? false,
    handledConversationMailboxItemCount:
      input.request.handledConversationMailboxItemIds?.length ?? 0,
    ...(input.request.idleCheckpointTrigger
      ? { idleCheckpointTrigger: input.request.idleCheckpointTrigger }
      : {}),
    ...(input.request.runtimeWakePendingAtCheckpoint === undefined
      ? {}
      : {
          runtimeWakePendingAtCheckpoint:
            input.request.runtimeWakePendingAtCheckpoint,
        }),
    ...(input.details ?? {}),
  };
  appendHostedCheckpointSnapshotFailureDiagnostics(redactedJson, input.error);
  const errorCode = typeof redactedJson.errorCode === "string"
    ? redactedJson.errorCode
    : null;

  try {
    await input.platform.logPort.write(
      {
        entries: [
          {
            at: new Date().toISOString(),
            attemptId: input.request.attemptId,
            component: "workspace",
            ...(errorCode ? { errorCode } : {}),
            eventCode,
            leaseGeneration: input.request.leaseGeneration,
            level: input.level,
            phase: "checkpoint",
            redactedJson,
            workspaceVersion: input.request.expectedWorkspaceVersion,
          },
        ],
      },
      { signal: input.signal },
    );
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
      redactedJson.safeErrorMessage = redactHostedRuntimeDiagnosticText(
        diagnostics.errorMessage,
      );
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
  const safeErrorCause = readHostedRuntimeSafeErrorText(error);
  if (safeErrorCause && safeErrorCause !== safeDiagnosticDetail) {
    redactedJson.safeErrorCause = safeErrorCause;
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

function createTerminalWriteOperationPruneLogDetails(
  result: PruneTerminalWriteOperationRecordsResult | null,
): HostedRuntimeRedactedJson {
  if (!hasTerminalWriteOperationPrunedFiles(result)) {
    return {};
  }

  return {
    prunedTerminalWriteOperationBytes: result.prunedByteCount,
    prunedTerminalWriteOperationCount: result.prunedCount,
    prunedTerminalWriteOperationFileCount: result.prunedFileCount,
    terminalWriteOperationPruneErroredCount: result.retainedErroredTerminalCount,
    terminalWriteOperationPruneInvalidCount: result.invalidCount,
    terminalWriteOperationPruneNewestRetainedCount: result.retainedNewestTerminalCount,
    terminalWriteOperationPruneScannedCount: result.scannedCount,
    terminalWriteOperationPrunedStageDirectoryCount: result.prunedStageDirectoryCount,
    terminalWriteOperationPruneStageDirectoryCount: result.retainedStageDirectoryCount,
  };
}

function hasTerminalWriteOperationPrunedFiles(
  result: PruneTerminalWriteOperationRecordsResult | null,
): result is PruneTerminalWriteOperationRecordsResult {
  return !!result
    && (
      result.prunedCount > 0
      || result.prunedStageDirectoryCount > 0
    );
}

function hasAssistantRuntimeResiduePrunedFiles(
  result: AssistantRuntimeResiduePruneResult | null,
): boolean {
  return countAssistantRuntimeResiduePrunedFiles(result) > 0;
}

function countAssistantRuntimeResiduePrunedFiles(
  result: AssistantRuntimeResiduePruneResult | null,
): number {
  if (!result) {
    return 0;
  }
  return (
    result.acceptedTurnInputJournalsPruned +
    result.autoReplyEvidenceFilesPruned +
    result.autoReplyIntentProvenancePruned +
    result.generatedDeliveryFilesPruned +
    result.hostedMailboxInputItemMappingsPruned +
    result.inputEventsPruned +
    result.receiptsPruned
  );
}

function createAssistantRuntimeResiduePruneLogDetails(
  result: AssistantRuntimeResiduePruneResult | null,
): HostedRuntimeRedactedJson {
  if (
    !result ||
    (
      !hasAssistantRuntimeResiduePrunedFiles(result) &&
      !result.generatedDeliveryCleanupSkippedUntrustedOutbox
    )
  ) {
    return {};
  }
  return {
    prunedAssistantRuntimeAcceptedTurnInputJournalCount:
      result.acceptedTurnInputJournalsPruned,
    prunedAssistantRuntimeAutoReplyEvidenceFileCount:
      result.autoReplyEvidenceFilesPruned,
    prunedAssistantRuntimeAutoReplyEvidenceGroupCount:
      result.autoReplyEvidenceGroupsPruned,
    prunedAssistantRuntimeAutoReplyIntentProvenanceCount:
      result.autoReplyIntentProvenancePruned,
    prunedAssistantRuntimeGeneratedDeliveryBytes:
      result.generatedDeliveryBytesPruned,
    prunedAssistantRuntimeGeneratedDeliveryFileCount:
      result.generatedDeliveryFilesPruned,
    assistantRuntimeGeneratedDeliveryCleanupSkippedUntrustedOutbox:
      result.generatedDeliveryCleanupSkippedUntrustedOutbox,
    prunedAssistantRuntimeHostedMailboxInputItemMappingCount:
      result.hostedMailboxInputItemMappingsPruned,
    prunedAssistantRuntimeInputEventCount: result.inputEventsPruned,
    prunedAssistantRuntimeReceiptCount: result.receiptsPruned,
    prunedAssistantRuntimeResidueFileCount:
      countAssistantRuntimeResiduePrunedFiles(result),
  };
}

async function writeHostedCheckpointSnapshotMetricLog(input: {
  assistantRuntimeResiduePruneResult: AssistantRuntimeResiduePruneResult | null;
  encryptedByteSize: number;
  fileCount: number;
  leaseCheckCount: number;
  plainByteSize: number;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  prunedRuntimeSymlinkCount: number;
  terminalWriteOperationPruneResult: PruneTerminalWriteOperationRecordsResult | null;
  request: HostedWorkspaceSnapshotCheckpointRequest;
  signal: AbortSignal | null;
  snapshotElapsedMs: number;
  snapshotMode: typeof HOSTED_WORKSPACE_V2_SNAPSHOT_MODE;
  sizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics | null;
  timingDetails: HostedWorkspaceSnapshotTimingDetails;
  webCheckpointAccepted: boolean;
}): Promise<void> {
  if (!input.platform.logPort) {
    return;
  }

  const redactedJson: HostedRuntimeRedactedJson = {
    browserVaultReplicaState: "omitted",
    checkpointReason: input.request.reason,
    handledConversationFrontierSelected:
      input.request.handledConversationFrontierSelected ?? false,
    handledConversationMailboxItemCount:
      input.request.handledConversationMailboxItemIds?.length ?? 0,
    ...(input.request.idleCheckpointTrigger
      ? { idleCheckpointTrigger: input.request.idleCheckpointTrigger }
      : {}),
    ...(input.request.runtimeWakePendingAtCheckpoint === undefined
      ? {}
      : {
          runtimeWakePendingAtCheckpoint:
            input.request.runtimeWakePendingAtCheckpoint,
        }),
    leaseCheckCount: input.leaseCheckCount,
    ...(input.prunedRuntimeSymlinkCount > 0
      ? {
          prunedRuntimeSymlinkCount: input.prunedRuntimeSymlinkCount,
          runtimeSymlinkPruneScope: "operator-home",
        }
      : {}),
    ...createTerminalWriteOperationPruneLogDetails(
      input.terminalWriteOperationPruneResult,
    ),
    ...createAssistantRuntimeResiduePruneLogDetails(
      input.assistantRuntimeResiduePruneResult,
    ),
    ...input.timingDetails,
    snapshotElapsedMs: input.snapshotElapsedMs,
    workspaceSnapshotEncryptedBytes: input.encryptedByteSize,
    workspaceSnapshotFileCount: input.fileCount,
    workspaceSnapshotPlainBytes: input.plainByteSize,
    ...createHostedWorkspaceSnapshotSizeDiagnosticLogDetails(input.sizeDiagnostics),
    snapshotMode: input.snapshotMode,
    webCheckpointAccepted: input.webCheckpointAccepted,
  };

  try {
    await input.platform.logPort.write(
      {
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
      },
      { signal: input.signal },
    );
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
  if (input.lease.workspaceVersion !== input.request.expectedWorkspaceVersion) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_workspace_version", stage);
  }
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
