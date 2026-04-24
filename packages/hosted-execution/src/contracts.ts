import type {
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";
import type {
  HostedExecutionDeviceSyncJobHint as DeviceSyncHostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncWakeHint as DeviceSyncHostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionBundleRefState,
} from "./bundles.ts";
import type { SharePack } from "@murphai/contracts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";

export const HOSTED_EXECUTION_SIGNATURE_HEADER = "x-hosted-execution-signature";
export const HOSTED_EXECUTION_TIMESTAMP_HEADER = "x-hosted-execution-timestamp";
export const HOSTED_EXECUTION_NONCE_HEADER = "x-hosted-execution-nonce";
export const HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER =
  "x-hosted-execution-signing-key-id";

export const HOSTED_EXECUTION_EVENT_KINDS = [
  "member.activated",
  "member.channels.updated",
  "assistant.notification.requested",
  "device-sync.wake",
  "vault.share.accepted",
  "vault.sync.import",
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

export const HOSTED_EXECUTION_WAKE_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "assistant.notification.requested",
  "device-sync.wake",
  "vault.share.accepted",
  "vault.sync.import",
] as const;

export type HostedIngressKind =
  (typeof HOSTED_EXECUTION_WAKE_KINDS)[number];
export type HostedExecutionBaseWakeKind =
  | HostedIngressKind
  | "runtime.timer";

export const HOSTED_EXECUTION_CONVERSATION_MESSAGE_CHANNELS = [
  "linq",
  "telegram",
  "email",
] as const;

export type HostedExecutionConversationMessageChannel =
  (typeof HOSTED_EXECUTION_CONVERSATION_MESSAGE_CHANNELS)[number];

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberChannels {
  email: boolean;
  linq: boolean;
  telegram: boolean;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionMemberChannelsUpdatedEvent extends HostedExecutionBaseEvent {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

export type HostedExecutionAssistantNotificationDeliveryDispatchMode =
  | "immediate"
  | "queue-only";

export type HostedExecutionAssistantNotificationResponsePolicy =
  | { kind: "allow_send_or_skip" }
  | { kind: "require_send" }
  | { kind: "require_send_exact_text"; text: string };

export interface HostedExecutionAssistantNotificationDeliverySource {
  fromPhoneNumber: string;
  kind: "linq";
}

export interface HostedExecutionAssistantNotificationDelivery {
  kind: "explicit" | "participant" | "thread";
  source?: HostedExecutionAssistantNotificationDeliverySource | null;
  target: string;
}

export interface HostedExecutionAssistantNotificationRoute {
  actorId: string | null;
  channel: HostedExecutionConversationMessageChannel;
  delivery: HostedExecutionAssistantNotificationDelivery;
  identityId: string | null;
  threadId: string | null;
  threadIsDirect: boolean | null;
}

export interface HostedExecutionAssistantNotificationFirstContactPolicy {
  markSeenOnDeliveryAccepted: boolean;
}

export interface HostedExecutionAssistantNotificationRequestedPayload {
  deliveryDedupeToken?: string | null;
  deliveryDispatchMode?: HostedExecutionAssistantNotificationDeliveryDispatchMode | null;
  deliveryIdempotencyKey?: string | null;
  firstContact?: HostedExecutionAssistantNotificationFirstContactPolicy | null;
  instructions: string;
  responsePolicy?: HostedExecutionAssistantNotificationResponsePolicy | null;
  route: HostedExecutionAssistantNotificationRoute;
}

export interface HostedExecutionAssistantNotificationRequestedEvent
  extends HostedExecutionBaseEvent {
  kind: "assistant.notification.requested";
  notification: HostedExecutionAssistantNotificationRequestedPayload;
}

export const HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA =
  "murph.hosted-telegram-message.v1";

export interface HostedExecutionTelegramAttachment {
  fileId: string;
  fileName?: string | null;
  fileSize?: number | null;
  fileUniqueId?: string | null;
  height?: number | null;
  kind: "animation" | "audio" | "document" | "photo" | "sticker" | "video" | "video_note" | "voice";
  mimeType?: string | null;
  width?: number | null;
}

export interface HostedExecutionTelegramMessage {
  attachments?: HostedExecutionTelegramAttachment[];
  mediaGroupId?: string | null;
  messageId: string;
  replyContextPreview?: string | null;
  schema: typeof HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA;
  text?: string | null;
  threadId: string;
}

export interface HostedExecutionDeviceSyncWakeEvent extends HostedExecutionBaseEvent {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  reason:
    | "connected"
    | "webhook_hint"
    | "disconnected"
    | "reauthorization_required"
    | "reconcile_due";
}

export interface HostedExecutionShareReference {
  ownerUserId: string;
  shareId: string;
}

export interface HostedExecutionVaultShareAcceptedEvent extends HostedExecutionBaseEvent {
  kind: "vault.share.accepted";
  share: HostedExecutionShareReference;
}

export interface HostedExecutionVaultSyncImportReference {
  localManifestHash: string;
  sessionId: string;
  sourceSchemaVersion?: string | null;
  sourceVaultId?: string | null;
  sourceVaultTitle?: string | null;
}

export interface HostedExecutionVaultSyncImportEvent extends HostedExecutionBaseEvent {
  kind: "vault.sync.import";
  vaultSync: HostedExecutionVaultSyncImportReference;
}

export interface HostedExecutionRunnerSharePack {
  ownerUserId: string;
  pack: SharePack;
  shareId: string;
}

export interface HostedExecutionRunnerVaultSyncImport {
  bundleBase64: string;
  sessionId: string;
  sourceSchemaVersion?: string | null;
}

export interface HostedRuntimeDrainEvent {
  ingressEventId: string;
  seq: string;
  sharePack?: HostedExecutionRunnerSharePack | null;
  vaultSyncImport?: HostedExecutionRunnerVaultSyncImport | null;
  wake: HostedRuntimeEvent;
}

export interface HostedRuntimeDrainRequest {
  acquiredAt: string;
  committedResult?: HostedExecutionRunnerResult | null;
  events: HostedRuntimeDrainEvent[];
  inputCommittedSeq: string;
  inputCursorVersion: string;
  resumeFinalize?: boolean | null;
  runId: string;
  triggerKind: HostedRunTriggerKind;
  userId: string;
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionMemberChannelsUpdatedEvent
  | HostedExecutionAssistantNotificationRequestedEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionVaultShareAcceptedEvent
  | HostedExecutionVaultSyncImportEvent;

export interface HostedExecutionBaseWake {
  eventId: string;
  kind: HostedExecutionBaseWakeKind;
  occurredAt: string;
  userId: string;
}

export interface HostedExecutionLinqConversationTextPart {
  type: "text";
  value: string;
}

export interface HostedExecutionLinqConversationLinkPart {
  type: "link";
  value: string;
}

export interface HostedExecutionLinqConversationMediaPart {
  attachmentId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  type: "media" | "voice_memo";
  url?: string | null;
}

export type HostedExecutionLinqConversationMessagePart =
  | HostedExecutionLinqConversationTextPart
  | HostedExecutionLinqConversationLinkPart
  | HostedExecutionLinqConversationMediaPart;

export interface HostedExecutionLinqConversationMessage {
  chatId: string;
  from: string;
  isFromMe: boolean;
  messageId: string;
  parts: HostedExecutionLinqConversationMessagePart[];
  replyToMessageId?: string | null;
  replyToPartIndex?: number | null;
  service?: string | null;
}

export interface HostedExecutionLinqConversationMessagePayload {
  channel: "linq";
  linqMessage: HostedExecutionLinqConversationMessage;
  phoneLookupKey: string;
}

export interface HostedExecutionTelegramConversationMessagePayload {
  channel: "telegram";
  telegramMessage: HostedExecutionTelegramMessage;
}

export interface HostedExecutionEmailConversationMessagePayload {
  channel: "email";
  identityId: string | null;
  rawMessageKey: string;
  selfAddress?: string | null;
}

export type HostedExecutionConversationMessagePayload =
  | HostedExecutionLinqConversationMessagePayload
  | HostedExecutionTelegramConversationMessagePayload
  | HostedExecutionEmailConversationMessagePayload;

export interface HostedExecutionConversationMessageWake extends HostedExecutionBaseWake {
  kind: "conversation.message";
  message: HostedExecutionConversationMessagePayload;
}

export interface HostedExecutionMemberActivatedWake extends HostedExecutionBaseWake {
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionAssistantNotificationRequestedWake
  extends HostedExecutionBaseWake {
  kind: "assistant.notification.requested";
  notification: HostedExecutionAssistantNotificationRequestedPayload;
}

export interface HostedExecutionMemberChannelsUpdatedWake extends HostedExecutionBaseWake {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionDeviceSyncWake extends HostedExecutionBaseWake {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
}

export interface HostedExecutionVaultShareAcceptedWake extends HostedExecutionBaseWake {
  kind: "vault.share.accepted";
  share: HostedExecutionShareReference;
}

export interface HostedExecutionVaultSyncImportWake extends HostedExecutionBaseWake {
  kind: "vault.sync.import";
  vaultSync: HostedExecutionVaultSyncImportReference;
}

export interface HostedExecutionRuntimeTimerWake extends HostedExecutionBaseWake {
  kind: "runtime.timer";
  triggerKind: HostedRunTriggerKind;
}

export type HostedIngressEnvelope =
  | HostedExecutionConversationMessageWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionAssistantNotificationRequestedWake
  | HostedExecutionDeviceSyncWake
  | HostedExecutionVaultShareAcceptedWake
  | HostedExecutionVaultSyncImportWake;

export type HostedRuntimeEvent =
  | HostedIngressEnvelope
  | HostedExecutionRuntimeTimerWake;

export type HostedExecutionWake = HostedIngressEnvelope;
export type HostedIngressSystemEnvelope = Exclude<
  HostedIngressEnvelope,
  HostedExecutionConversationMessageWake
>;

export type HostedExecutionBundleKind = RuntimeHostedExecutionBundleKind;
export type HostedIngressSnapshotRef = HostedExecutionBundleRefState;

export interface HostedExecutionRunnerRequest {
  bundle: HostedExecutionBundlePayload;
  currentBundleRef?: HostedIngressSnapshotRef | null;
  run: HostedExecutionRunContext;
  runDrain: HostedRuntimeDrainRequest;
}

export interface HostedExecutionRedactedLogEntry {
  component: string;
  eventId?: string | null;
  level: HostedExecutionRunLevel;
  message: string;
  phase: string;
  redacted?: Record<string, unknown> | null;
}

export interface HostedExecutionRunnerResult {
  bundle: HostedExecutionBundlePayload;
  result: {
    adoptedCleanupTargets?: HostedRunCleanupTarget[];
    adoptedEventResults?: HostedRunEventResult[];
    eventsHandled: number;
    nextWakeAt?: string | null;
    redactedDetails?: Record<string, unknown> | null;
    redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
    summary: string;
  };
}

export type HostedExecutionBundleRef = RuntimeHostedExecutionBundleRef;

export interface HostedExecutionUserStatus {
  bundleRef: HostedExecutionBundleRefState;
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingIngressEventCount: number;
  run?: HostedExecutionRunStatus | null;
  timeline?: HostedExecutionTimelineEntry[];
  userId: string;
}

export interface HostedRunDrainResult {
  committedSeq: string;
  requestedTargetSeq: string | null;
  targetReached: boolean;
}

export interface HostedRunNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean;
  alreadyRunning: boolean;
}

export const HOSTED_INGRESS_LIFECYCLE_STATES = [
  "queued",
  "backpressured",
  "completed",
  "replaced",
  "quarantined",
] as const;

export type HostedIngressLifecycleState =
  (typeof HOSTED_INGRESS_LIFECYCLE_STATES)[number];

export const HOSTED_INGRESS_BEHAVIORS = [
  "ordered",
  "coalescing",
] as const;

export type HostedIngressBehavior =
  (typeof HOSTED_INGRESS_BEHAVIORS)[number];

export const HOSTED_INGRESS_PAYLOAD_SCHEMA = "murph.hosted-ingress-execution.v1";

export const HOSTED_INGRESS_PAYLOAD_SCHEMAS = [
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
] as const;

export type HostedIngressPayloadSchema =
  (typeof HOSTED_INGRESS_PAYLOAD_SCHEMAS)[number];


export const HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA = "murph.hosted-browser-vault-replica-ref.v1";

export interface HostedBrowserVaultReplicaRef {
  byteLength: number;
  dataVersion: string;
  generatedAt: string;
  keyId: string;
  objectKey: string;
  replicaSchema: "murph.browser-vault-replica.v1";
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA;
  sourceBundleHash: string;
}

export type HostedBrowserVaultReplicaCursorRef = HostedBrowserVaultReplicaRef | null;

export interface HostedExecutionCursorState {
  committedSeq: string;
  createdAt: string;
  nextSeq: string;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  snapshotRef: HostedIngressSnapshotRef;
  updatedAt: string;
  userId: string;
  version: string;
}

interface HostedIngressEventBase {
  behavior: HostedIngressBehavior;
  coalescingKey?: string | null;
  createdAt: string;
  dedupeKey?: string | null;
  id: string;
  occurredAt: string;
  payloadBytes?: number | null;
  payloadCiphertext?: string | null;
  quarantineCode?: string | null;
  quarantinedAt?: string | null;
  seq: string;
  updatedAt: string;
  userId: string;
}

export interface HostedConversationMessageWakeRecord extends HostedIngressEventBase {
  kind: "conversation.message";
  payloadSchema: typeof HOSTED_INGRESS_PAYLOAD_SCHEMA;
}

export interface HostedSystemWakeRecord extends HostedIngressEventBase {
  kind: HostedIngressSystemEnvelope["kind"];
  payloadSchema: typeof HOSTED_INGRESS_PAYLOAD_SCHEMA;
}

export type HostedIngressEvent =
  | HostedConversationMessageWakeRecord
  | HostedSystemWakeRecord;

export interface HostedIngressAppendResponse {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedIngressEvent;
}

export const HOSTED_RUN_STATUSES = [
  "acquired",
  "running",
  "finalizing",
  "committed_needs_finalize",
  "finalized",
  "failed",
  "superseded",
] as const;

export type HostedRunStatus = (typeof HOSTED_RUN_STATUSES)[number];

export const HOSTED_RUN_TRIGGER_KINDS = [
  "external_ingress",
  "runtime_timer",
  "manual_repair",
  "retry_finalize",
] as const;

export type HostedRunTriggerKind = (typeof HOSTED_RUN_TRIGGER_KINDS)[number];

export const HOSTED_RUN_EXECUTOR_KINDS = [
  "cloudflare-container",
  "tee",
  "local-replay",
] as const;

export type HostedRunExecutorKind = (typeof HOSTED_RUN_EXECUTOR_KINDS)[number];

export const HOSTED_RUN_LOG_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type HostedRunLogLevel = (typeof HOSTED_RUN_LOG_LEVELS)[number];

export interface HostedRunRecord {
  acquiredAt: string;
  attempt: number;
  committedAt?: string | null;
  createdAt: string;
  errorClass?: string | null;
  errorCode?: string | null;
  eventCount: number;
  eventKinds: string[];
  eventSeqs: string[];
  executorKind: HostedRunExecutorKind;
  executorCodeDigest?: string | null;
  attestationRef?: string | null;
  signedResultRef?: string | null;
  failedAt?: string | null;
  finalSnapshotRef?: HostedIngressSnapshotRef;
  finalizedAt?: string | null;
  id: string;
  inputCommittedSeq: string;
  inputCursorVersion: string;
  inputSnapshotRef?: HostedIngressSnapshotRef;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq?: string | null;
  outputCursorVersion?: string | null;
  preparedAt?: string | null;
  preparedSnapshotRef?: HostedIngressSnapshotRef;
  redactedSummary?: unknown | null;
  startedAt?: string | null;
  status: HostedRunStatus;
  triggerKind: HostedRunTriggerKind;
  updatedAt: string;
  userId: string;
  ingressEventIds: string[];
}

export interface HostedRunLogRecord {
  at: string;
  component: string;
  createdAt: string;
  id: string;
  level: HostedRunLogLevel;
  message: string;
  phase: string;
  redacted?: unknown | null;
  runId: string;
  userId: string;
}

export interface HostedRunAcquireRequest {
  executorKind?: HostedRunExecutorKind | null;
  executorCodeDigest?: string | null;
  attestationRef?: string | null;
  signedResultRef?: string | null;
  limit?: number | null;
  now?: string | null;
  triggerKind?: HostedRunTriggerKind | null;
}

export interface HostedRunAcquireResponse {
  acquired: boolean;
  cursor: HostedExecutionCursorState;
  events: HostedIngressEvent[];
  pendingIngressEventCount: number;
  resumeFinalize: boolean;
  run: HostedRunRecord | null;
  runToken?: string | null;
}

export interface HostedRunTurnInputPeekRequest {
  afterSeq?: string | null;
  limit?: number | null;
  runId: string;
  runToken: string;
}

export interface HostedRunTurnInputPeekResponse {
  events: HostedIngressEvent[];
  run: HostedRunRecord | null;
}

export interface HostedRunTurnInputAdoptRequest {
  afterSeq?: string | null;
  ingressEventIds: string[];
  runId: string;
  runToken: string;
}

export interface HostedRunTurnInputAdoptResponse {
  adopted: boolean;
  events: HostedIngressEvent[];
  run: HostedRunRecord | null;
}

export interface HostedRunEventResult {
  ingressEventId: string;
  quarantineCode?: string | null;
  state: "completed" | "quarantined";
}

export type HostedRunCleanupTarget =
  | {
      channel: "email";
      eventId: string;
      rawMessageKey: string;
      userId: string;
    }
  | {
      channel: "linq";
      messageId: string;
    }
  | {
      channel: "telegram";
      messageId: string;
      target: string;
    };

export interface HostedRunCommitRequest {
  eventResults?: HostedRunEventResult[];
  expectedCursorVersion: string;
  failureClass?: string | null;
  failureCode?: string | null;
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq: string;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  preparedSnapshotRef?: HostedIngressSnapshotRef;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
}

export interface HostedRunCommitResponse {
  committed: boolean;
  cursor: HostedExecutionCursorState;
  needsFinalize: boolean;
  run: HostedRunRecord | null;
}

export interface HostedRunFinalizeRequest {
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  finalSnapshotRef: HostedIngressSnapshotRef;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
}

export interface HostedRunFinalizeResponse {
  cursor: HostedExecutionCursorState;
  finalized: boolean;
  run: HostedRunRecord | null;
}

export interface HostedRunReleaseFinalizeRequest {
  failureClass?: string | null;
  failureCode?: string | null;
  runId: string;
  runToken: string;
}

export interface HostedRunReleaseFinalizeResponse {
  cursor: HostedExecutionCursorState;
  released: boolean;
  run: HostedRunRecord | null;
}

export interface HostedRunLogRequest {
  at?: string | null;
  component: string;
  level: HostedRunLogLevel;
  message: string;
  phase: string;
  redacted?: unknown | null;
  runId: string;
  runToken: string;
}

export interface HostedRunLogResponse {
  logged: boolean;
  log: HostedRunLogRecord | null;
}

export interface HostedRunStatusRequest {
  includeLogs?: boolean | null;
  limit?: number | null;
  runId?: string | null;
}

export interface HostedRunStatusResponse {
  cursor: HostedExecutionCursorState;
  logs?: HostedRunLogRecord[];
  pendingIngressEventCount: number;
  run: HostedRunRecord | null;
  runs?: HostedRunRecord[];
}

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";

export type HostedExecutionDeviceSyncJobHint =
  DeviceSyncHostedExecutionDeviceSyncJobHint;

export type HostedExecutionDeviceSyncWakeHint =
  DeviceSyncHostedExecutionDeviceSyncWakeHint;

export const HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR =
  "Hosted execution wake handling is not configured.";

export function isHostedIngressKind(
  kind: string,
): kind is HostedIngressKind {
  return HOSTED_EXECUTION_WAKE_KINDS.includes(kind as HostedIngressKind);
}

export function isHostedConversationMessageChannel(
  channel: string,
): channel is HostedExecutionConversationMessageChannel {
  return HOSTED_EXECUTION_CONVERSATION_MESSAGE_CHANNELS.includes(
    channel as HostedExecutionConversationMessageChannel,
  );
}

export function isHostedConversationMessageWake(
  wake: HostedIngressEnvelope,
): wake is HostedExecutionConversationMessageWake {
  return wake.kind === "conversation.message";
}

export function isHostedRuntimeTimerWake(
  wake: HostedRuntimeEvent,
): wake is HostedExecutionRuntimeTimerWake {
  return wake.kind === "runtime.timer";
}

export function isHostedSystemWake(
  wake: HostedIngressEnvelope,
): wake is HostedIngressSystemEnvelope {
  return wake.kind !== "conversation.message";
}

export function isHostedLinqConversationMessageWake(
  wake: HostedIngressEnvelope,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "linq";
}

export function isHostedTelegramConversationMessageWake(
  wake: HostedIngressEnvelope,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionTelegramConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "telegram";
}

export function isHostedEmailConversationMessageWake(
  wake: HostedIngressEnvelope,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionEmailConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "email";
}
