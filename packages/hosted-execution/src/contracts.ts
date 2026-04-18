import type {
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";
import type {
  HostedExecutionDeviceSyncJobHint as DeviceSyncHostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot as DeviceSyncHostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot as DeviceSyncHostedExecutionDeviceSyncRuntimeConnectionStateSnapshot,
  HostedExecutionDeviceSyncRuntimeLocalStateSnapshot as DeviceSyncHostedExecutionDeviceSyncRuntimeLocalStateSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse as DeviceSyncHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncRuntimeTokenBundle as DeviceSyncHostedExecutionDeviceSyncRuntimeTokenBundle,
  HostedExecutionDeviceSyncWakeHint as DeviceSyncHostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionBundleRefState,
} from "./bundles.ts";
import type { SharePack } from "@murphai/contracts";
import type {
  HostedExecutionRunContext,
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
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

export const HOSTED_EXECUTION_WAKE_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
] as const;

export type HostedExecutionWakeKind =
  (typeof HOSTED_EXECUTION_WAKE_KINDS)[number];

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
  firstContact?: HostedExecutionFirstContactTarget | null;
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionMemberChannelsUpdatedEvent extends HostedExecutionBaseEvent {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionThreadFirstContactTarget {
  channel: "email" | "linq" | "telegram";
  identityId: string | null;
  kind?: "thread";
  threadId: string;
  threadIsDirect: boolean;
}

export interface HostedExecutionLinqMaterializeHomeThreadFirstContactTarget {
  channel: "linq";
  fromPhoneNumber: string;
  identityId: string;
  kind: "linq-materialize-home-thread";
  toPhoneNumber: string;
}

export type HostedExecutionFirstContactTarget =
  | HostedExecutionThreadFirstContactTarget
  | HostedExecutionLinqMaterializeHomeThreadFirstContactTarget;

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
  schema: typeof HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA;
  text?: string | null;
  threadId: string;
}

export interface HostedExecutionAssistantCronTickEvent extends HostedExecutionBaseEvent {
  kind: "assistant.cron.tick";
  reason: "alarm" | "manual" | "device-sync";
}

export interface HostedExecutionDeviceSyncWakeEvent extends HostedExecutionBaseEvent {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  reason: "connected" | "webhook_hint" | "disconnected" | "reauthorization_required";
}

export interface HostedExecutionShareReference {
  ownerUserId: string;
  shareId: string;
}

export interface HostedExecutionVaultShareAcceptedEvent extends HostedExecutionBaseEvent {
  kind: "vault.share.accepted";
  share: HostedExecutionShareReference;
}

export interface HostedExecutionRunnerSharePack {
  ownerUserId: string;
  pack: SharePack;
  shareId: string;
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionMemberChannelsUpdatedEvent
  | HostedExecutionAssistantCronTickEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionVaultShareAcceptedEvent;

export interface HostedExecutionBaseWake {
  eventId: string;
  kind: HostedExecutionWakeKind;
  occurredAt: string;
  userId: string;
}

export interface HostedExecutionLinqConversationMessagePayload {
  channel: "linq";
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
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
  firstContact?: HostedExecutionFirstContactTarget | null;
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionMemberChannelsUpdatedWake extends HostedExecutionBaseWake {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionAssistantCronTickWake extends HostedExecutionBaseWake {
  kind: "assistant.cron.tick";
  reason: HostedExecutionAssistantCronTickEvent["reason"];
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

export type HostedExecutionWake =
  | HostedExecutionConversationMessageWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionAssistantCronTickWake
  | HostedExecutionDeviceSyncWake
  | HostedExecutionVaultShareAcceptedWake;

export type HostedExecutionSystemWake = Exclude<
  HostedExecutionWake,
  HostedExecutionConversationMessageWake
>;

export type HostedExecutionBundleKind = RuntimeHostedExecutionBundleKind;

export interface HostedExecutionRunnerRequest {
  bundle: HostedExecutionBundlePayload;
  wake: HostedExecutionWake;
  run?: HostedExecutionRunContext | null;
  sharePack?: HostedExecutionRunnerSharePack | null;
}

export interface HostedExecutionRunnerResult {
  bundle: HostedExecutionBundlePayload;
  result: {
    eventsHandled: number;
    nextWakeAt?: string | null;
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
  pendingWakeCount: number;
  run?: HostedExecutionRunStatus | null;
  timeline?: HostedExecutionTimelineEntry[];
  userId: string;
}

export const HOSTED_WAKE_LIFECYCLE_STATES = [
  "queued",
  "backpressured",
  "completed",
  "poisoned",
] as const;

export type HostedWakeLifecycleState =
  (typeof HOSTED_WAKE_LIFECYCLE_STATES)[number];

export interface HostedWakeStatus {
  eventId: string;
  lastError: string | null;
  state: HostedWakeLifecycleState;
  userId: string;
}

export interface HostedWakeExecutionResult {
  event: HostedWakeStatus;
  status: HostedExecutionUserStatus;
}

export const HOSTED_WAKE_BEHAVIORS = [
  "ordered",
  "coalescing",
  "edge_triggered",
] as const;

export type HostedWakeBehavior =
  (typeof HOSTED_WAKE_BEHAVIORS)[number];

export const HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA =
  "murph.hosted-wake-conversation-message.v1";
export const HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA = "murph.hosted-wake-system.v1";

export const HOSTED_WAKE_PAYLOAD_SCHEMAS = [
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
] as const;

export type HostedWakePayloadSchema =
  (typeof HOSTED_WAKE_PAYLOAD_SCHEMAS)[number];

export interface HostedExecutionCursorState {
  committedSeq: string;
  createdAt: string;
  nextSeq: string;
  snapshotRef: unknown | null;
  updatedAt: string;
  userId: string;
  version: string;
}

interface HostedWakeRecordBase {
  behavior: HostedWakeBehavior;
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

export interface HostedConversationMessageWakeRecord extends HostedWakeRecordBase {
  kind: "conversation.message";
  payloadSchema: typeof HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA;
}

export interface HostedSystemWakeRecord extends HostedWakeRecordBase {
  kind: HostedExecutionSystemWake["kind"];
  payloadSchema: typeof HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA;
}

export type HostedWakeRecord =
  | HostedConversationMessageWakeRecord
  | HostedSystemWakeRecord;

export interface HostedWakeFetchRequest {
  afterSeq?: string | null;
  limit?: number | null;
}

export interface HostedWakeFetchResponse {
  cursor: HostedExecutionCursorState;
  wakes: HostedWakeRecord[];
}

export interface HostedWakeCommitRequest {
  committedSeq: string;
  expectedVersion: string;
  snapshotRef?: unknown | null;
}

export interface HostedWakeCommitResponse {
  committed: boolean;
  cursor: HostedExecutionCursorState;
}

export interface HostedExecutionWakeAppendRequest {
  wake: HostedExecutionWake;
}

export type HostedWakeAppendRequest = HostedExecutionWakeAppendRequest;

export interface HostedWakeAppendResponse {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedWakeRecord;
}

export interface HostedWakeQuarantineRequest {
  quarantineCode: string;
  wakeId: string;
}

export interface HostedWakeQuarantineResponse {
  quarantined: boolean;
}

export interface HostedWakeStatusRequest {
  eventId?: string | null;
}

export interface HostedWakeStatusResponse {
  cursor: HostedExecutionCursorState;
  wakeState?: HostedWakeLifecycleState | null;
  pendingWakeCount: number;
}

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";

export type HostedExecutionDeviceSyncJobHint =
  DeviceSyncHostedExecutionDeviceSyncJobHint;

export type HostedExecutionDeviceSyncWakeHint =
  DeviceSyncHostedExecutionDeviceSyncWakeHint;

export type HostedExecutionDeviceSyncRuntimeTokenBundle =
  DeviceSyncHostedExecutionDeviceSyncRuntimeTokenBundle;

export type HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot =
  DeviceSyncHostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;

export type HostedExecutionDeviceSyncRuntimeLocalStateSnapshot =
  DeviceSyncHostedExecutionDeviceSyncRuntimeLocalStateSnapshot;

export type HostedExecutionDeviceSyncRuntimeConnectionSnapshot =
  DeviceSyncHostedExecutionDeviceSyncRuntimeConnectionSnapshot;

export type HostedExecutionDeviceSyncRuntimeSnapshotResponse =
  DeviceSyncHostedExecutionDeviceSyncRuntimeSnapshotResponse;

export const HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR =
  "Hosted execution wake handling is not configured.";

export function isHostedExecutionWakeKind(
  kind: string,
): kind is HostedExecutionWakeKind {
  return HOSTED_EXECUTION_WAKE_KINDS.includes(kind as HostedExecutionWakeKind);
}

export function isHostedConversationMessageChannel(
  channel: string,
): channel is HostedExecutionConversationMessageChannel {
  return HOSTED_EXECUTION_CONVERSATION_MESSAGE_CHANNELS.includes(
    channel as HostedExecutionConversationMessageChannel,
  );
}

export function isHostedConversationMessageWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionConversationMessageWake {
  return wake.kind === "conversation.message";
}

export function isHostedSystemWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionSystemWake {
  return wake.kind !== "conversation.message";
}

export function isHostedLinqConversationMessageWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "linq";
}

export function isHostedTelegramConversationMessageWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionTelegramConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "telegram";
}

export function isHostedEmailConversationMessageWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionConversationMessageWake & {
  message: HostedExecutionEmailConversationMessagePayload;
} {
  return wake.kind === "conversation.message" && wake.message.channel === "email";
}
