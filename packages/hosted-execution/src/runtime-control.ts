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
} from "@murphai/runtime-state/node";
import type {
  AssistantUsageRecord,
} from "./assistant-usage.ts";
import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";
import {
  HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
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
  ...HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
] as const;

export type HostedMailboxKind = (typeof HOSTED_MAILBOX_KINDS)[number];

export const HOSTED_RUNTIME_CONTROL_MAILBOX_KINDS =
  HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS;

export type HostedRuntimeControlMailboxKind =
  (typeof HOSTED_RUNTIME_CONTROL_MAILBOX_KINDS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.5",
] as const;

export type HostedAiUsageAllowancePricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS = [
  ...HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
] as const;

export const HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA =
  "murph.hosted-ai-usage-allow-decision.v1";
export const HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG = "HMAC-SHA256";

export interface HostedAiUsageAllowDecisionBody {
  allowed: true;
  expiresAt: string;
  issuedAt: string;
  nonce: string;
  schema: typeof HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA;
  userId: string;
}

export interface HostedAiUsageAllowDecisionSignature {
  alg: typeof HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG;
  keyId: string;
  signature: string;
}

export interface HostedAiUsageAllowDecision
  extends HostedAiUsageAllowDecisionBody {
  signature: HostedAiUsageAllowDecisionSignature;
}

export type HostedRunnerNudgeRequest = Record<string, never>;

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
  const exact = normalizeHostedAiUsageAllowancePricedModelCandidate(normalized);
  if (exact) {
    return exact;
  }

  const providerScoped = normalized.split("/").at(-1) ?? normalized;
  const providerScopedExact =
    normalizeHostedAiUsageAllowancePricedModelCandidate(providerScoped);
  if (providerScopedExact) {
    return providerScopedExact;
  }

  const datedSnapshotBase = providerScoped.replace(/-\d{4}-\d{2}-\d{2}$/u, "");

  return normalizeHostedAiUsageAllowancePricedModelCandidate(datedSnapshotBase);
}

export async function signHostedAiUsageAllowDecision(input: {
  body: HostedAiUsageAllowDecisionBody;
  keyId?: string | null;
  secret: string;
}): Promise<HostedAiUsageAllowDecision> {
  const keyId = normalizeHostedAiUsageAllowDecisionText(input.keyId) ?? "v1";
  const signature = await signHostedAiUsageAllowDecisionPayload({
    payload: buildHostedAiUsageAllowDecisionSigningPayload(input.body),
    secret: input.secret,
  });

  return {
    ...input.body,
    signature: {
      alg: HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG,
      keyId,
      signature,
    },
  };
}

export async function verifyHostedAiUsageAllowDecision(input: {
  decision: HostedAiUsageAllowDecision;
  secret: string;
}): Promise<boolean> {
  const expected = await signHostedAiUsageAllowDecisionPayload({
    payload: buildHostedAiUsageAllowDecisionSigningPayload(input.decision),
    secret: input.secret,
  });

  return constantTimeStringEqual(expected, input.decision.signature.signature);
}

export function parseHostedAiUsageAllowDecision(
  value: unknown,
): HostedAiUsageAllowDecision {
  const record = requireHostedAiUsageAllowDecisionObject(value, "AI usage allow decision");
  const signature = requireHostedAiUsageAllowDecisionObject(
    record.signature,
    "AI usage allow decision signature",
  );

  return {
    allowed: requireHostedAiUsageAllowDecisionAllowed(record.allowed),
    expiresAt: requireHostedAiUsageAllowDecisionIsoDate(record.expiresAt, "expiresAt"),
    issuedAt: requireHostedAiUsageAllowDecisionIsoDate(record.issuedAt, "issuedAt"),
    nonce: requireHostedAiUsageAllowDecisionText(record.nonce, "nonce"),
    schema: requireHostedAiUsageAllowDecisionSchema(record.schema),
    signature: {
      alg: requireHostedAiUsageAllowDecisionSignatureAlg(signature.alg),
      keyId: requireHostedAiUsageAllowDecisionText(signature.keyId, "signature.keyId"),
      signature: requireHostedAiUsageAllowDecisionText(
        signature.signature,
        "signature.signature",
      ),
    },
    userId: requireHostedAiUsageAllowDecisionText(record.userId, "userId"),
  };
}

export function parseHostedRunnerNudgeRequest(value: unknown): HostedRunnerNudgeRequest {
  if (value === null || value === undefined) {
    return {};
  }

  const record = requireHostedAiUsageAllowDecisionObject(value, "runner nudge request");
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return {};
  }

  throw new TypeError("runner nudge request must not include legacy fields.");
}

export function buildHostedAiUsageAllowDecisionBody(input: {
  expiresAt: Date | string;
  issuedAt: Date | string;
  nonce: string;
  userId: string;
}): HostedAiUsageAllowDecisionBody {
  return {
    allowed: true,
    expiresAt: normalizeHostedAiUsageAllowDecisionDate(input.expiresAt, "expiresAt"),
    issuedAt: normalizeHostedAiUsageAllowDecisionDate(input.issuedAt, "issuedAt"),
    nonce: requireHostedAiUsageAllowDecisionText(input.nonce, "nonce"),
    schema: HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA,
    userId: requireHostedAiUsageAllowDecisionText(input.userId, "userId"),
  };
}

function normalizeHostedAiUsageAllowancePricedModelCandidate(
  value: string,
): HostedAiUsageAllowancePricedModel | null {
  return isHostedAiUsageAllowancePricedModelId(value) ? value : null;
}

function buildHostedAiUsageAllowDecisionSigningPayload(
  body: HostedAiUsageAllowDecisionBody,
): ArrayBuffer {
  return encodeHostedAiUsageAllowDecisionUtf8(canonicalHostedAiUsageAllowDecisionJson({
    allowed: true,
    expiresAt: body.expiresAt,
    issuedAt: body.issuedAt,
    nonce: body.nonce,
    schema: body.schema,
    userId: body.userId,
  }));
}

async function signHostedAiUsageAllowDecisionPayload(input: {
  payload: ArrayBuffer;
  secret: string;
}): Promise<string> {
  const secret = requireHostedAiUsageAllowDecisionText(input.secret, "secret");
  const key = await crypto.subtle.importKey(
    "raw",
    encodeHostedAiUsageAllowDecisionUtf8(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, input.payload);
  return encodeHostedAiUsageAllowDecisionBase64Url(new Uint8Array(signature));
}

function canonicalHostedAiUsageAllowDecisionJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalHostedAiUsageAllowDecisionJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalHostedAiUsageAllowDecisionJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Cannot canonicalize unsupported JSON value.");
}

function encodeHostedAiUsageAllowDecisionUtf8(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function encodeHostedAiUsageAllowDecisionBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function normalizeHostedAiUsageAllowDecisionText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireHostedAiUsageAllowDecisionObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireHostedAiUsageAllowDecisionText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`AI usage allow decision ${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireHostedAiUsageAllowDecisionIsoDate(value: unknown, label: string): string {
  const text = requireHostedAiUsageAllowDecisionText(value, label);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`AI usage allow decision ${label} must be an ISO date string.`);
  }
  return text;
}

function normalizeHostedAiUsageAllowDecisionDate(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`AI usage allow decision ${label} must be a valid date.`);
  }
  return date.toISOString();
}

function requireHostedAiUsageAllowDecisionAllowed(value: unknown): true {
  if (value !== true) {
    throw new TypeError("AI usage allow decision allowed must be true.");
  }
  return true;
}

function requireHostedAiUsageAllowDecisionSchema(
  value: unknown,
): typeof HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA {
  if (value !== HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA) {
    throw new TypeError("AI usage allow decision schema is invalid.");
  }
  return HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA;
}

function requireHostedAiUsageAllowDecisionSignatureAlg(
  value: unknown,
): typeof HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG {
  if (value !== HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG) {
    throw new TypeError("AI usage allow decision signature alg is invalid.");
  }
  return HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG;
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
  maxUpdatedAt?: string | null;
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

export interface HostedRuntimeUsageRecordRequest {
  usage: AssistantUsageRecord;
}

export interface HostedRuntimeUsageRecordResponse {
  recorded: boolean;
  usageId: string;
}

export interface HostedRuntimeIssueExportRequest {
  issues: AssistantRuntimeIssueRecord[];
}

export interface HostedRuntimeIssueExportResponse {
  issueIds: string[];
  recorded: number;
}

export const HOSTED_INGRESS_LATENCY_SOURCES = [
  "linq",
] as const;

export type HostedIngressLatencySource =
  (typeof HOSTED_INGRESS_LATENCY_SOURCES)[number];

export const HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS = 64;
export const HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES = 32 * 1024;
export const HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES = [
  "runner_job_accepted",
  "runtime_phase_started",
  "workspace_restore_done",
  "mailbox_import_done",
] as const;

export type HostedRuntimeLatencyTraceMilestone =
  (typeof HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES)[number];

export interface HostedRuntimeLatencyPhaseBreakdown {
  schemaVersion: number;
  restore?: {
    sizeGuardMs?: number;
    dataKeyUnwrapMs?: number;
    scratchPrepareMs?: number;
    presignGetMs?: number;
    objectFetchMs?: number;
    decryptMs?: number;
    extractMs?: number;
    encryptedBytes?: number;
    plainBytes?: number;
  };
  boot?: {
    nodeStartupMs?: number;
    restoreWasCold?: boolean;
  };
  provider?: {
    turnLockWaitMs?: number;
    sessionResolveMs?: number;
    promptBuildMs?: number;
    admissionMs?: number;
    preProviderSetupMs?: number;
  };
}

export interface HostedRuntimeLatencyTraceStagedMilestones {
  runnerJobAcceptedAt?: string | null;
  runtimePhaseStartedAt?: string | null;
  workspaceRestoreDoneAt?: string | null;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
}

export interface HostedRuntimeLatencyTraceAssistantInputStagedEvent
  extends HostedRuntimeLatencyTraceStagedMilestones {
  assistantInputId: string;
  at: string;
  mailboxItemId: string;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "assistant_input_staged";
}

export interface HostedRuntimeLatencyTraceProviderStartedEvent {
  assistantInputIds: string[];
  at: string;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
  providerRequestOrdinal: number;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "provider_started";
}

export interface HostedRuntimeLatencyTraceMilestoneEvent {
  at: string;
  milestone: HostedRuntimeLatencyTraceMilestone;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "runtime_milestone";
}

export type HostedRuntimeLatencyTraceEvent =
  | HostedRuntimeLatencyTraceAssistantInputStagedEvent
  | HostedRuntimeLatencyTraceProviderStartedEvent
  | HostedRuntimeLatencyTraceMilestoneEvent;

export interface HostedRuntimeLatencyTraceRequest {
  event: HostedRuntimeLatencyTraceEvent;
}

export interface HostedRuntimeLatencyTraceResponse {
  matchedCount: number;
  recorded: boolean;
  unmatchedCount: number;
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
  "outbox_sending",
  "outbox_receipt",
  "activation_bootstrap",
  "canonical_runtime_commit",
  "assistant_runtime_commit",
  "provider_cleanup",
  "system_mailbox_receipt",
  "idle_shutdown",
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

export interface HostedBrowserVaultReplicaPublishRequest {
  /**
   * @deprecated Compatibility-only source-hash guard for older refresh callers.
   * Active browser-vault publishes should omit this and update the latest ref.
   */
  expectedSourceStateHash?: string;
  replicaRef: HostedBrowserVaultReplicaRef;
}

export interface HostedBrowserVaultReplicaPublishResponse {
  published: boolean;
  workspace: HostedWorkspaceState | null;
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
  "restore",
] as const;

export type HostedRuntimeLogPhase = (typeof HOSTED_RUNTIME_LOG_PHASES)[number];

export const HOSTED_RUNTIME_LOG_EVENT_CODES = [
  "checkpoint.cas_conflict",
  "checkpoint.committed",
  "checkpoint.codex_continuity_missing_after_full_fallback",
  "checkpoint.hot_state_fallback",
  "checkpoint.idle_shutdown_snapshot_skipped",
  "checkpoint.optional_sidecar_degraded",
  "checkpoint.runtime_residue_deferred",
  "checkpoint.bundle_write_finished",
  "checkpoint.bundle_write_started",
  "checkpoint.snapshot_failed",
  "checkpoint.snapshot_finished",
  "checkpoint.snapshot_plan",
  "checkpoint.snapshot_size_progress",
  "checkpoint.snapshot_started",
  // Legacy input only: older runners may post this during deploy skew.
  "workspace.codex_continuity_repaired",
  "workspace.codex_home_snapshot_failed",
  "assistant.device_connect",
  "assistant.automation_detail",
  "assistant.pass_finished",
  "device-sync.dense_raw_retention",
  "device-sync.job_failed",
  "device-sync.legacy_platform_env_present",
  "device-sync.reconnect_notice_created",
  "device-sync.reconnect_notice_duplicate",
  "device-sync.reconnect_notice_skipped",
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
  "outbox.receipt_checkpointed",
  "runner.accepted_attempt_failed",
  "runner.error",
  "runner.idle",
  "runner.lease_superseded",
  "runner.provider_egress_diagnostic",
  "runner.started",
  "workspace.codex_home_snapshot",
] as const;

export type HostedRuntimeLogEventCode =
  (typeof HOSTED_RUNTIME_LOG_EVENT_CODES)[number];

export const HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES = 50;

export type HostedRuntimeRedactedScalar = boolean | null | number | string;
export type HostedRuntimeRedactedObject = Record<string, HostedRuntimeRedactedScalar>;
export type HostedRuntimeRedactedValue =
  | HostedRuntimeRedactedScalar
  | HostedRuntimeRedactedScalar[]
  | HostedRuntimeRedactedObject[];
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
  maxUpdatedAt?: string | null;
}

export interface HostedRunnerNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean;
  immediateDriveStarted?: boolean;
  inFlight: boolean;
  kind: "caught-up" | "processing-ensured" | "retry-scheduled";
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
  idleCheckpointDelayMs?: number | null;
  leaseGeneration: string;
  providerEgressToken?: string | null;
  userId: string;
  workspace?: HostedWorkspaceState | null;
  workspaceVersion: string;
}

export interface HostedWorkspaceInvocationResult {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  status: HostedWorkspaceInvocationStatus;
}

export interface HostedExpectedCodexRootProcess {
  commandLineDigest: string;
  owner: "codex-app-server";
  pid: number;
  processGroupId: number | null;
  startTimeTicksFromProcStat: string;
  uid: number | null;
}

export function isHostedMailboxLane(value: string): value is HostedMailboxLane {
  return HOSTED_MAILBOX_LANES.includes(value as HostedMailboxLane);
}

export function isHostedMailboxKind(value: string): value is HostedMailboxKind {
  return HOSTED_MAILBOX_KINDS.includes(value as HostedMailboxKind);
}
