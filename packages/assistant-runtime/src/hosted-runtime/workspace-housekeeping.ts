import {
  compactLegacyWearableReceiptEnvelopes,
  detectLegacyWearableReceiptCompaction,
} from "@murphai/core";
import type {
  HostedRuntimeRedactedJson,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedMailboxImportCheckpointResult,
} from "./mailbox-checkpoint.ts";

export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON =
  "legacy-wearable-receipt-compaction-v1";
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_GRACE_MS = 5_000;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_DEADLINE_MS = 15_000;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_BYTES_READ =
  64 * 1024 * 1024;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_CANDIDATES_SCANNED = 25;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_ENVELOPES = 5;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_EVIDENCE_ARTIFACT_BYTES =
  16 * 1024 * 1024;
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_EVIDENCE_TOTAL_BYTES =
  32 * 1024 * 1024;

export interface HostedWorkspaceHousekeepingPhaseInput {
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  now?: () => string;
  rescheduleDelayMs: number;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}

export type HostedWorkspaceHousekeepingPhaseResult =
  | {
      handled: false;
    }
  | {
      bytesAfter: number;
      bytesBefore: number;
      compactedCount: number;
      handled: true;
      hasMore: boolean;
      mutated: boolean;
      nextWakeAt: string | null;
      nextWakeReason: string | null;
      oversizedEnvelopeSkippedCount: number;
      oversizedEvidenceSkippedCount: number;
      redactedStatus: HostedRuntimeRedactedJson;
      runtimeStateDirty: boolean;
      scannedCount: number;
      skippedCount: number;
    };

export interface HostedWorkspaceWakeProjection {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}

export interface ScheduleLegacyWearableReceiptCompactionWakeInput {
  idleCheckpointDelayMs: number;
  nowMs?: number;
  projection: HostedWorkspaceWakeProjection;
  vaultRoot: string;
}

export interface ScheduleLegacyWearableReceiptCompactionWakeResult {
  changed: boolean;
  hasWork: boolean;
  projection: HostedWorkspaceWakeProjection;
  scheduled: boolean;
}

export async function runHostedWorkspaceHousekeepingPhase(
  input: HostedWorkspaceHousekeepingPhaseInput,
): Promise<HostedWorkspaceHousekeepingPhaseResult> {
  const nowMs = readHostedHousekeepingNowMs(input.now);
  if (!isLegacyWearableReceiptCompactionWakeDue({
    nowMs,
    workspace: input.workspace,
  })) {
    return { handled: false };
  }

  if (hasFreshHostedHousekeepingConversationInput(input.initialMailboxImport)) {
    return { handled: false };
  }

  const compaction = await compactLegacyWearableReceiptEnvelopes({
    deadlineMs: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_DEADLINE_MS,
    maxBytesRead: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_BYTES_READ,
    maxCandidatesScanned:
      HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_CANDIDATES_SCANNED,
    maxEnvelopes: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_ENVELOPES,
    maxEvidenceArtifactBytes:
      HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_EVIDENCE_ARTIFACT_BYTES,
    maxEvidenceTotalBytes:
      HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_MAX_EVIDENCE_TOTAL_BYTES,
    now: new Date(nowMs),
    vaultRoot: input.vaultRoot,
  });
  const nextWakeAt = compaction.hasMore
    ? new Date(nowMs + Math.max(0, input.rescheduleDelayMs)).toISOString()
    : null;
  const nextWakeReason = nextWakeAt
    ? HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON
    : null;
  const runtimeStateDirty = compaction.mutated
    || (input.workspace?.nextWakeAt ?? null) !== nextWakeAt
    || (input.workspace?.nextWakeReason ?? null) !== nextWakeReason;

  return {
    bytesAfter: compaction.bytesAfter,
    bytesBefore: compaction.bytesBefore,
    compactedCount: compaction.compactedCount,
    handled: true,
    hasMore: compaction.hasMore,
    mutated: compaction.mutated,
    nextWakeAt,
    nextWakeReason,
    oversizedEnvelopeSkippedCount: compaction.oversizedEnvelopeSkippedCount,
    oversizedEvidenceSkippedCount: compaction.oversizedEvidenceSkippedCount,
    redactedStatus: {
      legacyWearableReceiptCompactionBytesAfter: compaction.bytesAfter,
      legacyWearableReceiptCompactionBytesBefore: compaction.bytesBefore,
      legacyWearableReceiptCompactionCompactedCount: compaction.compactedCount,
      legacyWearableReceiptCompactionHasMore: compaction.hasMore,
      legacyWearableReceiptCompactionMutated: compaction.mutated,
      legacyWearableReceiptCompactionOversizedEnvelopeSkippedCount:
        compaction.oversizedEnvelopeSkippedCount,
      legacyWearableReceiptCompactionOversizedEvidenceSkippedCount:
        compaction.oversizedEvidenceSkippedCount,
      legacyWearableReceiptCompactionScannedCount: compaction.scannedCount,
      legacyWearableReceiptCompactionSkippedCount: compaction.skippedCount,
    },
    runtimeStateDirty,
    scannedCount: compaction.scannedCount,
    skippedCount: compaction.skippedCount,
  };
}

export async function scheduleLegacyWearableReceiptCompactionWakeIfNeeded(
  input: ScheduleLegacyWearableReceiptCompactionWakeInput,
): Promise<ScheduleLegacyWearableReceiptCompactionWakeResult> {
  const detection = await detectLegacyWearableReceiptCompaction({
    vaultRoot: input.vaultRoot,
  });
  if (!detection.hasWork) {
    return {
      changed: false,
      hasWork: false,
      projection: input.projection,
      scheduled: false,
    };
  }

  return scheduleLegacyWearableReceiptCompactionWakeForDetection({
    idleCheckpointDelayMs: input.idleCheckpointDelayMs,
    nowMs: input.nowMs,
    projection: input.projection,
  });
}

export function scheduleLegacyWearableReceiptCompactionWakeForDetection(input: {
  idleCheckpointDelayMs: number;
  nowMs?: number;
  projection: HostedWorkspaceWakeProjection;
}): ScheduleLegacyWearableReceiptCompactionWakeResult {
  if (
    input.projection.nextWakeAt !== null
    && input.projection.nextWakeReason !== HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON
  ) {
    return {
      changed: false,
      hasWork: true,
      projection: input.projection,
      scheduled: false,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const earliestWakeAt = new Date(
    nowMs
      + Math.max(0, input.idleCheckpointDelayMs)
      + HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_GRACE_MS,
  ).toISOString();
  const existingWakeMs = input.projection.nextWakeAt
    ? Date.parse(input.projection.nextWakeAt)
    : null;
  if (
    input.projection.nextWakeReason === HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON
    && existingWakeMs !== null
    && Number.isFinite(existingWakeMs)
    && existingWakeMs >= Date.parse(earliestWakeAt)
  ) {
    return {
      changed: false,
      hasWork: true,
      projection: input.projection,
      scheduled: true,
    };
  }

  return {
    changed:
      input.projection.nextWakeAt !== earliestWakeAt
      || input.projection.nextWakeReason !== HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
    hasWork: true,
    projection: {
      nextWakeAt: earliestWakeAt,
      nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
    },
    scheduled: true,
  };
}

export function hasFreshHostedHousekeepingConversationInput(
  initialMailboxImport: HostedMailboxImportCheckpointResult,
): boolean {
  return (initialMailboxImport.importResult.assistantInputIds?.length ?? 0) > 0
    || (initialMailboxImport.importResult.conversationImportedCount ?? 0) > 0;
}

export function isLegacyWearableReceiptCompactionWakeDue(input: {
  nowMs?: number;
  workspace: HostedWorkspaceState | null;
}): boolean {
  if (
    input.workspace?.nextWakeReason !== HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON
    || !input.workspace.nextWakeAt
  ) {
    return false;
  }

  const nextWakeMs = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(nextWakeMs) && nextWakeMs <= (input.nowMs ?? Date.now());
}

function readHostedHousekeepingNowMs(now: (() => string) | undefined): number {
  if (!now) {
    return Date.now();
  }

  const parsedMs = Date.parse(now());
  return Number.isFinite(parsedMs) ? parsedMs : Date.now();
}
