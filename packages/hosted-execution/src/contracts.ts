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
import type {
  HostedExecutionLogLevel,
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
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

export const HOSTED_EXECUTION_WAKE_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "assistant.notification.requested",
  "device-sync.wake",
] as const;

export type HostedExecutionWakeKind =
  (typeof HOSTED_EXECUTION_WAKE_KINDS)[number];
export type HostedExecutionBaseWakeKind =
  | HostedExecutionWakeKind
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
  timeZone?: string | null;
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

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionMemberChannelsUpdatedEvent
  | HostedExecutionAssistantNotificationRequestedEvent
  | HostedExecutionDeviceSyncWakeEvent;

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

export interface HostedExecutionEmailAttachmentSummary {
  contentType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
}

export interface HostedExecutionEmailConversationMessagePayload {
  attachmentSummaries?: HostedExecutionEmailAttachmentSummary[];
  channel: "email";
  cc?: string[];
  from?: string | null;
  identityId: string | null;
  messageId?: string | null;
  rawMessageKey: string;
  selfAddress?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  threadKey?: string | null;
  threadTarget?: string | null;
  to?: string[];
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
  timeZone?: string | null;
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

export interface HostedExecutionRuntimeTimerWake extends HostedExecutionBaseWake {
  kind: "runtime.timer";
  triggerKind: HostedRuntimeTimerTriggerKind;
}

export type HostedExecutionWake =
  | HostedExecutionConversationMessageWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionAssistantNotificationRequestedWake
  | HostedExecutionDeviceSyncWake;

export type HostedRuntimeEvent =
  | HostedExecutionWake
  | HostedExecutionRuntimeTimerWake;

export type HostedExecutionSystemWake = Exclude<
  HostedExecutionWake,
  HostedExecutionConversationMessageWake
>;

export type HostedExecutionBundleKind = RuntimeHostedExecutionBundleKind;
export type HostedExecutionSnapshotRef = HostedExecutionBundleRefState;

export interface HostedExecutionRedactedLogEntry {
  component: string;
  eventId?: string | null;
  level: HostedExecutionLogLevel;
  message: string;
  phase: string;
  redacted?: Record<string, unknown> | null;
}

export type HostedExecutionBundleRef = RuntimeHostedExecutionBundleRef;

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

export const HOSTED_RUNTIME_TIMER_TRIGGER_KINDS = [
  "external_ingress",
  "runtime_timer",
  "manual_repair",
] as const;

export type HostedRuntimeTimerTriggerKind =
  (typeof HOSTED_RUNTIME_TIMER_TRIGGER_KINDS)[number];

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";

export type HostedExecutionDeviceSyncJobHint =
  DeviceSyncHostedExecutionDeviceSyncJobHint;

export type HostedExecutionDeviceSyncWakeHint =
  DeviceSyncHostedExecutionDeviceSyncWakeHint;

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

export function isHostedRuntimeTimerWake(
  wake: HostedRuntimeEvent,
): wake is HostedExecutionRuntimeTimerWake {
  return wake.kind === "runtime.timer";
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
