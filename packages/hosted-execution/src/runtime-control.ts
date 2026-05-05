import type {
  HostedExecutionSnapshotRefState,
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
] as const;

export type HostedMailboxKind = (typeof HOSTED_MAILBOX_KINDS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.5",
] as const;

export type HostedAiUsageAllowancePricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS = [
  ...HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
  "openai/gpt-5.4-mini",
  "openai/gpt-5.5",
] as const;

export function isHostedAiUsageAllowancePricedModelId(
  value: string,
): value is HostedAiUsageAllowancePricedModel {
  return HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS.includes(
    value as HostedAiUsageAllowancePricedModel,
  );
}

export function normalizeHostedAiUsageAllowancePricedModelId(
  value: string,
): HostedAiUsageAllowancePricedModel | null {
  const normalized = value.trim().toLowerCase();
  const openAiModel = normalized.startsWith("openai/")
    ? normalized.slice("openai/".length)
    : normalized;

  return isHostedAiUsageAllowancePricedModelId(openAiModel) ? openAiModel : null;
}

export const HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA = "murph.hosted-mailbox-item.v1";
export const HOSTED_MAILBOX_PAYLOAD_SCHEMA = "murph.hosted-mailbox-payload.v1";

export const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
export const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";

export type HostedMailboxPayloadStorage = "inline" | "sidecar";

export interface HostedMailboxPayloadCryptoMetadata {
  dedupeKey: string;
  itemId: string;
  kind: string;
  lane: string;
  laneSeq: bigint | number | string;
  occurredAt: string;
  payloadSchema: string;
  payloadStorage: HostedMailboxPayloadStorage;
  userId: string;
}

function resolveHostedMailboxPayloadField(
  payloadStorage: HostedMailboxPayloadStorage,
): typeof HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD | typeof HOSTED_MAILBOX_REF_PAYLOAD_FIELD {
  switch (payloadStorage) {
    case "inline":
      return HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD;
    case "sidecar":
      return HOSTED_MAILBOX_REF_PAYLOAD_FIELD;
  }
}

function buildHostedMailboxPayloadAadObjectKey(
  input: Pick<
    HostedMailboxPayloadCryptoMetadata,
    | "dedupeKey"
    | "kind"
    | "lane"
    | "occurredAt"
    | "payloadSchema"
    | "payloadStorage"
  >,
): string {
  return JSON.stringify({
    dedupeKey: requireHostedMailboxPayloadAadString(input.dedupeKey, "dedupeKey"),
    kind: requireHostedMailboxPayloadAadString(input.kind, "kind"),
    lane: requireHostedMailboxPayloadAadString(input.lane, "lane"),
    occurredAt: requireHostedMailboxPayloadAadString(input.occurredAt, "occurredAt"),
    payloadSchema: requireHostedMailboxPayloadAadString(input.payloadSchema, "payloadSchema"),
    payloadStorage: input.payloadStorage,
  });
}

export type HostedMailboxPayloadField =
  typeof HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD | typeof HOSTED_MAILBOX_REF_PAYLOAD_FIELD;
export type HostedMailboxPayloadScope = `hosted-mailbox-payload:${HostedMailboxPayloadField}`;

export interface HostedMailboxPayloadSecureBoxAad {
  field: HostedMailboxPayloadField;
  objectKey: string;
  purpose: "hosted-mailbox-payload";
  rowId: string;
  sequence: HostedMailboxPayloadCryptoMetadata["laneSeq"];
  table: "hosted_mailbox_item";
}

export function buildHostedMailboxPayloadScope(
  payloadStorage: HostedMailboxPayloadStorage,
): HostedMailboxPayloadScope {
  return `hosted-mailbox-payload:${resolveHostedMailboxPayloadField(payloadStorage)}`;
}

export function buildHostedMailboxPayloadSecureBoxAad(
  input: HostedMailboxPayloadCryptoMetadata,
): HostedMailboxPayloadSecureBoxAad {
  return {
    field: resolveHostedMailboxPayloadField(input.payloadStorage),
    objectKey: buildHostedMailboxPayloadAadObjectKey(input),
    purpose: "hosted-mailbox-payload",
    rowId: input.itemId,
    sequence: input.laneSeq,
    table: "hosted_mailbox_item",
  };
}

function requireHostedMailboxPayloadAadString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError(`Hosted mailbox payload AAD ${label} must be a non-empty string.`);
  }

  return normalized;
}

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
  snapshotRef: HostedExecutionSnapshotRefState;
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
  "active_turn_input",
  "active_turn_acceptance",
  "outbox_intent",
  "outbox_sending",
  "outbox_receipt",
  "system_mailbox_sending",
  "system_mailbox_receipt",
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
  snapshotRef: HostedExecutionSnapshotRefState;
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
  "workspace",
] as const;

export type HostedRuntimeLogComponent =
  (typeof HOSTED_RUNTIME_LOG_COMPONENTS)[number];

export const HOSTED_RUNTIME_LOG_PHASES = [
  "active_turn_input",
  "checkpoint",
  "error",
  "fetch",
  "idle",
  "import",
  "outbox",
  "invoke",
] as const;

export type HostedRuntimeLogPhase = (typeof HOSTED_RUNTIME_LOG_PHASES)[number];

export const HOSTED_RUNTIME_LOG_EVENT_CODES = [
  "checkpoint.cas_conflict",
  "checkpoint.committed",
  "checkpoint.optional_sidecar_degraded",
  "checkpoint.snapshot_finished",
  "assistant.device_connect",
  "assistant.automation_detail",
  "assistant.pass_finished",
  "device-sync.job_failed",
  "mailbox.appended",
  "mailbox.dedupe_conflict",
  "mailbox.imported",
  "mailbox.linq_attachment_download_finished",
  "mailbox.parser_drain_failed",
  "mailbox.parser_jobs_failed",
  "mailbox.post_checkpoint_effects_finished",
  "mailbox.system_processed",
  "mailbox.quarantined",
  "mailbox.retryable_payload_missing",
  "outbox.ambiguous",
  "outbox.delivery_finished",
  "outbox.intent_checkpointed",
  "outbox.receipt_checkpointed",
  "runner.error",
  "runner.idle",
  "runner.lease_superseded",
  "runner.started",
  "runtime.usage_export_finished",
  "workspace.codex_home_snapshot",
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
  nextAlarmAt?: string | null;
}

export interface HostedRunnerStatusResponse {
  heartbeatAt?: string | null;
  inFlight: boolean;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastInvocationAt?: string | null;
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

export const HOSTED_WORKSPACE_INVOCATION_REASONS = [
  "nudge",
  "alarm",
  "retry",
  "manual",
] as const;

export type HostedWorkspaceInvocationReason = (typeof HOSTED_WORKSPACE_INVOCATION_REASONS)[number];

export const HOSTED_WORKSPACE_INVOCATION_STATUSES = [
  "idle",
  "budget_exhausted",
  "scheduled",
  "failed",
] as const;

export type HostedWorkspaceInvocationStatus = (typeof HOSTED_WORKSPACE_INVOCATION_STATUSES)[number];

export interface HostedWorkspaceInvocationBudget {
  maxMailboxItems?: number | null;
  maxRuntimeMs?: number | null;
}

export interface HostedWorkspaceInvocationRequest {
  attemptId: string;
  budget?: HostedWorkspaceInvocationBudget | null;
  leaseGeneration: string;
  reason: HostedWorkspaceInvocationReason;
  userId: string;
  workspaceVersion: string;
}

export interface HostedWorkspaceInvocationResult {
  nextWakeAt?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  status: HostedWorkspaceInvocationStatus;
}

export function isHostedMailboxLane(value: string): value is HostedMailboxLane {
  return HOSTED_MAILBOX_LANES.includes(value as HostedMailboxLane);
}

export function isHostedMailboxKind(value: string): value is HostedMailboxKind {
  return HOSTED_MAILBOX_KINDS.includes(value as HostedMailboxKind);
}
