import type {
  HostedExecutionBundleRefState,
} from "./bundles.ts";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  AssistantRuntimeIssueRecord,
  AssistantUsageRecord,
} from "@murphai/runtime-state/node";
import type {
  SharePack,
} from "@murphai/contracts";
import type {
  HostedBrowserVaultReplicaCursorRef,
} from "./contracts.ts";

export const HOSTED_MAILBOX_LANES = [
  "system",
  "conversation",
] as const;

export type HostedMailboxLane = (typeof HOSTED_MAILBOX_LANES)[number];

export const HOSTED_MAILBOX_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "assistant.notification.requested",
  "device-sync.wake",
  "vault.share.accepted",
  "vault.sync.import",
] as const;

export type HostedMailboxKind = (typeof HOSTED_MAILBOX_KINDS)[number];

export const HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA = "murph.hosted-mailbox-item.v1";
export const HOSTED_MAILBOX_PAYLOAD_SCHEMA = "murph.hosted-mailbox-payload.v1";
export const HOSTED_RUNTIME_SHARE_PAYLOAD_SCHEMA = "murph.hosted-share-payload.v1";
export const HOSTED_RUNTIME_VAULT_SYNC_PAYLOAD_SCHEMA =
  "murph.hosted-vault-sync-payload.v1";

export interface HostedMailboxItem {
  createdAt: string;
  dedupeKey: string;
  expiresAt?: string | null;
  id: string;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  laneSeq: string;
  occurredAt: string;
  payloadBytes?: number | null;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
  payloadSchema: string;
  updatedAt: string;
  userId: string;
}

export interface HostedMailboxPayload {
  createdAt: string;
  mailboxItemId: string;
  payloadCiphertext: string;
  payloadSchema: string;
  userId: string;
}

export const HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES = [
  "not_found",
  "expired",
  "gone",
] as const;

export type HostedRuntimeSideInputUnavailableCode =
  (typeof HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES)[number];

export interface HostedRuntimeSideInputUnavailable {
  code: HostedRuntimeSideInputUnavailableCode;
  retryable: boolean;
}

export interface HostedMailboxPayloadFetchRequest {
  dedupeKey: string;
  mailboxItemId: string;
  payloadRef?: string | null;
  requestId: string;
}

export interface HostedMailboxPayloadFetchResponse {
  fetchedAt: string;
  payload: HostedMailboxPayload | null;
  unavailable?: HostedRuntimeSideInputUnavailable | null;
}

export interface HostedMailboxLaneCounterState {
  lane: HostedMailboxLane;
  nextSeq: string;
  updatedAt: string;
  userId: string;
}

export interface HostedMailboxLaneCursor {
  importedSeq: string;
  lane: HostedMailboxLane;
}

export interface HostedMailboxFetchRequest {
  lanes: HostedMailboxLaneCursor[];
  limitPerLane: number;
  requestId: string;
}

export interface HostedMailboxLaneHighWater {
  lane: HostedMailboxLane;
  maxSeq: string;
}

export interface HostedMailboxFetchResponse {
  fetchedAt: string;
  items: HostedMailboxItem[];
  maxSeqByLane: HostedMailboxLaneHighWater[];
  userId: string;
}

export interface HostedRuntimeSharePayload {
  ownerUserId: string;
  pack: SharePack;
  payloadSchema: typeof HOSTED_RUNTIME_SHARE_PAYLOAD_SCHEMA;
  shareId: string;
}

export interface HostedRuntimeSharePayloadFetchRequest {
  ownerUserId: string;
  requestId: string;
  shareId: string;
}

export interface HostedRuntimeSharePayloadFetchResponse {
  fetchedAt: string;
  payload: HostedRuntimeSharePayload | null;
  unavailable?: HostedRuntimeSideInputUnavailable | null;
}

export const HOSTED_RUNTIME_SHARE_IMPORT_STATUSES = [
  "imported",
  "quarantined",
  "skipped",
] as const;

export type HostedRuntimeShareImportStatus =
  (typeof HOSTED_RUNTIME_SHARE_IMPORT_STATUSES)[number];

export interface HostedRuntimeShareImportRequest {
  errorCode?: string | null;
  importedAt: string;
  ownerUserId: string;
  shareId: string;
  status: HostedRuntimeShareImportStatus;
}

export interface HostedRuntimeShareImportResponse {
  recorded: boolean;
  shareId: string;
  status: HostedRuntimeShareImportStatus;
}

export interface HostedRuntimeVaultSyncImportPayload {
  bundleBase64: string;
  localManifestHash?: string | null;
  payloadSchema: typeof HOSTED_RUNTIME_VAULT_SYNC_PAYLOAD_SCHEMA;
  sessionId: string;
  sourceSchemaVersion?: string | null;
}

export interface HostedRuntimeVaultSyncPayloadFetchRequest {
  requestId: string;
  sessionId: string;
}

export interface HostedRuntimeVaultSyncPayloadFetchResponse {
  fetchedAt: string;
  payload: HostedRuntimeVaultSyncImportPayload | null;
  unavailable?: HostedRuntimeSideInputUnavailable | null;
}

export const HOSTED_RUNTIME_VAULT_SYNC_IMPORT_STATUSES = [
  "imported",
  "imported_with_conflicts",
  "failed",
] as const;

export type HostedRuntimeVaultSyncImportStatus =
  (typeof HOSTED_RUNTIME_VAULT_SYNC_IMPORT_STATUSES)[number];

export interface HostedRuntimeVaultSyncImportSummary {
  conflictCount: number;
  importedJsonlRecords: number;
  importedRawFiles: number;
  importedTextFiles: number;
  skippedDuplicates: number;
  skippedExcludedFiles: number;
}

export interface HostedRuntimeVaultSyncImportRequest {
  errorCode?: string | null;
  importedAt: string;
  sessionId: string;
  status: HostedRuntimeVaultSyncImportStatus;
  summary: HostedRuntimeVaultSyncImportSummary;
}

export interface HostedRuntimeVaultSyncImportResponse {
  recorded: boolean;
  sessionId: string;
  status: HostedRuntimeVaultSyncImportStatus;
}

export const HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS = [
  "device-sync.wake",
  "device-sync.snapshot",
  "device-sync.apply",
] as const;

export type HostedRuntimeDeviceSyncBridgeKind =
  (typeof HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS)[number];

export interface HostedRuntimeDeviceSyncWakeBridgeEnvelope {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  requestId: string;
}

export interface HostedRuntimeDeviceSyncSnapshotBridgeEnvelope {
  kind: "device-sync.snapshot";
  request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  requestId: string;
}

export interface HostedRuntimeDeviceSyncApplyBridgeEnvelope {
  kind: "device-sync.apply";
  request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  requestId: string;
}

export type HostedRuntimeDeviceSyncBridgeEnvelope =
  | HostedRuntimeDeviceSyncWakeBridgeEnvelope
  | HostedRuntimeDeviceSyncSnapshotBridgeEnvelope
  | HostedRuntimeDeviceSyncApplyBridgeEnvelope;

export interface HostedRuntimeUsageExportRequest {
  usage: AssistantUsageRecord[];
}

export interface HostedRuntimeUsageExportResponse {
  recorded: number;
  usageIds: string[];
}

export interface HostedRuntimeIssueExportRequest {
  issues: AssistantRuntimeIssueRecord[];
}

export interface HostedRuntimeIssueExportResponse {
  issueIds: string[];
  recorded: number;
}

export interface HostedWorkspaceState {
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  checkpointedAt?: string | null;
  createdAt: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  snapshotRef: HostedExecutionBundleRefState;
  updatedAt: string;
  userId: string;
  version: string;
}

export interface HostedWorkspaceReadResponse {
  fetchedAt: string;
  workspace: HostedWorkspaceState | null;
}

export const HOSTED_WORKSPACE_CHECKPOINT_REASONS = [
  "import",
  "before_delivery_refresh",
  "outbox_intent",
  "outbox_receipt",
  "maintenance",
  "idle",
  "budget_exhausted",
  "error",
] as const;

export type HostedWorkspaceCheckpointReason =
  (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number];

export interface HostedWorkspaceCheckpointRequest {
  attemptId: string;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  expectedWorkspaceVersion: string;
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  snapshotRef: HostedExecutionBundleRefState;
}

export interface HostedWorkspaceCheckpointResponse {
  checkpointed: boolean;
  workspace: HostedWorkspaceState;
}

export const HOSTED_RUNTIME_LOG_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type HostedRuntimeLogLevel = (typeof HOSTED_RUNTIME_LOG_LEVELS)[number];

export const HOSTED_RUNTIME_LOG_COMPONENTS = [
  "assistant",
  "device-sync",
  "mailbox",
  "outbox",
  "runner",
  "runtime",
  "share",
  "vault-sync",
  "workspace",
] as const;

export type HostedRuntimeLogComponent =
  (typeof HOSTED_RUNTIME_LOG_COMPONENTS)[number];

export const HOSTED_RUNTIME_LOG_PHASES = [
  "before_delivery",
  "checkpoint",
  "error",
  "fetch",
  "idle",
  "import",
  "outbox",
  "run",
] as const;

export type HostedRuntimeLogPhase = (typeof HOSTED_RUNTIME_LOG_PHASES)[number];

export const HOSTED_RUNTIME_LOG_EVENT_CODES = [
  "checkpoint.cas_conflict",
  "checkpoint.committed",
  "mailbox.dedupe_conflict",
  "mailbox.imported",
  "mailbox.quarantined",
  "mailbox.retryable_payload_missing",
  "outbox.ambiguous",
  "outbox.intent_checkpointed",
  "outbox.receipt_checkpointed",
  "runner.error",
  "runner.idle",
  "runner.lease_superseded",
  "runner.started",
] as const;

export type HostedRuntimeLogEventCode =
  (typeof HOSTED_RUNTIME_LOG_EVENT_CODES)[number];

export const HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES = 50;

export type HostedRuntimeRedactedScalar = boolean | null | number | string;
export type HostedRuntimeRedactedValue =
  | HostedRuntimeRedactedScalar
  | HostedRuntimeRedactedScalar[];
export type HostedRuntimeRedactedJson = Record<string, HostedRuntimeRedactedValue>;

export interface HostedRuntimeLogEntry {
  at: string;
  attemptId?: string | null;
  checkpointVersion?: string | null;
  component: HostedRuntimeLogComponent;
  errorCode?: string | null;
  eventCode: HostedRuntimeLogEventCode;
  leaseGeneration?: string | null;
  level: HostedRuntimeLogLevel;
  mailboxLane?: HostedMailboxLane | null;
  mailboxSeqEnd?: string | null;
  mailboxSeqStart?: string | null;
  outboxIntentRef?: string | null;
  phase: HostedRuntimeLogPhase;
  redactedJson?: HostedRuntimeRedactedJson | null;
  workspaceVersion?: string | null;
}

export interface HostedRuntimeLogRequest {
  entries: HostedRuntimeLogEntry[];
}

export interface HostedRuntimeLogResponse {
  loggedCount: number;
}

export interface HostedMailboxLaneLag {
  importedSeq: string;
  lag: string;
  lane: HostedMailboxLane;
  maxSeq: string;
}

export interface HostedRunnerNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean;
  alreadyRunning: boolean;
  inFlight: boolean;
  leaseGeneration: string;
  nextAlarmAt?: string | null;
}

export interface HostedRunnerStatusResponse {
  heartbeatAt?: string | null;
  inFlight: boolean;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastRunAt?: string | null;
  leaseGeneration: string;
  mailboxLag: HostedMailboxLaneLag[];
  nextAlarmAt?: string | null;
  recentLogs?: HostedRuntimeLogEntry[];
  userId: string;
  workspace: HostedWorkspaceState | null;
}

export interface HostedRuntimeWebStatusResponse {
  mailboxLag: HostedMailboxLaneLag[];
  recentLogs?: HostedRuntimeLogEntry[];
  userId: string;
  workspace: HostedWorkspaceState | null;
}

export const HOSTED_WORKSPACE_RUN_REASONS = [
  "nudge",
  "alarm",
  "retry",
  "manual",
] as const;

export type HostedWorkspaceRunReason = (typeof HOSTED_WORKSPACE_RUN_REASONS)[number];

export const HOSTED_WORKSPACE_RUN_STATUSES = [
  "idle",
  "budget_exhausted",
  "scheduled",
  "failed",
] as const;

export type HostedWorkspaceRunStatus = (typeof HOSTED_WORKSPACE_RUN_STATUSES)[number];

export interface HostedWorkspaceRunBudget {
  maxMailboxItems?: number | null;
  maxRuntimeMs?: number | null;
}

export interface HostedWorkspaceRunRequest {
  attemptId: string;
  budget?: HostedWorkspaceRunBudget | null;
  leaseGeneration: string;
  reason: HostedWorkspaceRunReason;
  userId: string;
  workspaceVersion: string;
}

export interface HostedWorkspaceRunResult {
  nextWakeAt?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  status: HostedWorkspaceRunStatus;
}

export function isHostedMailboxLane(value: string): value is HostedMailboxLane {
  return HOSTED_MAILBOX_LANES.includes(value as HostedMailboxLane);
}

export function isHostedMailboxKind(value: string): value is HostedMailboxKind {
  return HOSTED_MAILBOX_KINDS.includes(value as HostedMailboxKind);
}
