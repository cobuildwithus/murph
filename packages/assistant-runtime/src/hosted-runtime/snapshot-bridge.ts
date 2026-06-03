import { rm } from "node:fs/promises";
import path from "node:path";

import {
  HostedRuntimeCheckpointInterruptedByWakeError,
  type HostedWorkspaceRuntimeJobOptions,
} from "../hosted-runtime.ts";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics,
  type HostedWorkspaceSnapshotArchiveEntry,
  type HostedWorkspaceSnapshotArchiveExtraPath,
  type HostedWorkspaceSnapshotSizeDiagnostics,
} from "@murphai/runtime-state/node";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
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
  readHostedRuntimeSafeErrorText,
  redactHostedRuntimeDiagnosticText,
} from "./diagnostic-redaction.ts";
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
type HostedWorkspaceIdleCheckpointRequest =
  HostedWorkspaceCheckpointRequest & { reason: "idle_shutdown" };

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
  consumePendingRuntimeWake?: () => boolean;
  decodeMailboxPayload?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceInvocationRequest;
  runtime: HostedAssistantRuntimeConfig;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  vaultRoot: string;
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
    createCheckpointSnapshot: async (checkpointInput) => {
      return await createHostedWorkspaceBridgeCheckpointSnapshot({
        platform: input.platform,
        consumePendingRuntimeWake: input.consumePendingRuntimeWake,
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
        snapshotArchiveBuilder: input.snapshotArchiveBuilder,
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
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

async function createHostedWorkspaceBridgeCheckpointSnapshot(input: {
  consumePendingRuntimeWake?: () => boolean;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
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
  consumePendingRuntimeWake?: () => boolean;
  legacyMaterialization: Awaited<
    ReturnType<typeof prepareLegacyWorkspaceRefsForV2SnapshotMaterialization>
  >;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceIdleCheckpointRequest;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret: string | null;
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
  let localWorkspaceCleanForWarmReuse = false;
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

    if (input.consumePendingRuntimeWake?.() === true) {
      throw new HostedRuntimeCheckpointInterruptedByWakeError();
    }

    leaseCheckCount += 1;
    assertHostedWorkspaceBridgeCheckpointLease({
      lease: await input.readCurrentLease(),
      request: input.request,
      stage: "before_web_checkpoint",
      userId: input.userId,
    });
    if (input.consumePendingRuntimeWake?.() === true) {
      throw new HostedRuntimeCheckpointInterruptedByWakeError();
    }

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
    localWorkspaceCleanForWarmReuse,
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
