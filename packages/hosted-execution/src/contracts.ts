import type {
  HostedDataKeyEnvelopeV1,
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";
import type {
  HostedExecutionDeviceSyncJobHint as DeviceSyncHostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncWakeHint as DeviceSyncHostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  AssistantPersonaId,
  AssistantPersonalitySettingId,
  AssistantTonePreference,
  AssistantVoiceOptionId,
  MemberActionRequestV1,
  MemberActionOutcomeV1,
} from "@murphai/contracts";
import {
  BROWSER_VAULT_METRIC_BUCKET_COUNT,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  type BrowserVaultMetricBucketId,
  BROWSER_VAULT_REPLICA_SCHEMA,
} from "@murphai/contracts/browser-vault";
import type {
  HostedExecutionBundlePayload,
  HostedExecutionLayeredSnapshotRef as SharedHostedExecutionLayeredSnapshotRef,
  HostedExecutionSnapshotRefState,
  HostedExecutionWorkingSnapshotRef as SharedHostedExecutionWorkingSnapshotRef,
} from "./bundles.ts";
import type {
  HostedExecutionLogLevel,
} from "./observability.ts";

export const HOSTED_EXECUTION_SIGNATURE_HEADER = "x-hosted-execution-signature";
export const HOSTED_EXECUTION_TIMESTAMP_HEADER = "x-hosted-execution-timestamp";
export const HOSTED_EXECUTION_NONCE_HEADER = "x-hosted-execution-nonce";
export const HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER =
  "x-hosted-execution-signing-key-id";

export const HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS = [
  "runtime.manual-requested",
  "runtime.pending-effects-reconcile-requested",
  "runtime.maintenance-requested",
  "runtime.browser-vault-refresh-requested",
  "runtime.codex-auth-requested",
  "runtime.device-sync-recovery-requested",
  "runtime.mailbox-lag-observed",
] as const;

export type HostedExecutionRuntimeControlWakeKind =
  (typeof HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS)[number];

export const HOSTED_CODEX_AUTH_ACTIONS = [
  "connect",
  "disconnect",
] as const;

export type HostedCodexAuthAction =
  (typeof HOSTED_CODEX_AUTH_ACTIONS)[number];

export type HostedExecutionPlainRuntimeControlWakeKind = Exclude<
  HostedExecutionRuntimeControlWakeKind,
  "runtime.codex-auth-requested" | "runtime.pending-effects-reconcile-requested"
>;

export const HOSTED_EXECUTION_EVENT_KINDS = [
  "member.activated",
  "member.channels.updated",
  "member.preferences.updated",
  "assistant.notification.requested",
  "assistant.ask.requested",
  "assistant.ask.completed",
  "clinical-records.sync-requested",
  "device-sync.wake",
  "member.action.requested",
  "member.action.completed",
  ...HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

import type {
  HostedVaultShareDeliveryPayload,
  HostedVaultShareRevokePayload,
} from "./vault-share.ts";

export const HOSTED_EXECUTION_WAKE_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "member.preferences.updated",
  "assistant.notification.requested",
  "assistant.ask.requested",
  "assistant.ask.completed",
  "clinical-records.sync-requested",
  "device-sync.wake",
  "environment-interview.completed",
  "environment-voice.captured",
  "health.daily-metric.reported",
  "meal-photo.captured",
  "member.action.requested",
  "member.action.completed",
  "vault-share.delivery",
  "vault-share.revoke",
  ...HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
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

export type HostedExecutionExternalThreadRouteChannel = Extract<
  HostedExecutionConversationMessageChannel,
  "email" | "linq" | "telegram"
>;

export interface HostedExecutionExternalThreadRouteAuthority {
  accountLookupKey?: string | null;
  channel: HostedExecutionExternalThreadRouteChannel;
  containerMemberId: string;
  threadId: string;
}

export type HostedExecutionLinqExternalThreadRouteAuthority =
  HostedExecutionExternalThreadRouteAuthority & {
    channel: "linq";
  };

export type HostedExecutionTelegramExternalThreadRouteAuthority =
  HostedExecutionExternalThreadRouteAuthority & {
    channel: "telegram";
  };

/**
 * Ephemeral, send-time Linq route authority resolved by the hosted Web control
 * plane. Raw provider coordinates must never be copied into durable runtime
 * state, prompts, logs, or outbox payloads.
 */
export interface HostedExecutionResolvedLinqDeliveryRoute {
  conversationThreadId: string | null;
  directRecipientPhoneNumber: string | null;
  fromPhoneNumber: string | null;
  target: string;
  targetKind: "participant" | "thread";
  threadIsDirect: boolean;
}

/**
 * Provider-authenticated sender evidence for one exact accepted group message.
 * The assistant runtime derives this after reloading the opaque assistant
 * input id; the model never supplies a canonical member id.
 */
export interface HostedExecutionAcceptedGroupMessageParticipant {
  assistantInputId: string;
  senderHandle: string;
  source: "linq" | "telegram";
}

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberChannels {
  email: boolean;
  linq: boolean;
  telegram: boolean;
}

export interface HostedExecutionMemberActivationSignupWelcome {
  route: HostedExecutionAssistantNotificationRoute;
  text: string;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  initialGroupRoomModelMarkdown?: string | null;
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
  signupWelcome?: HostedExecutionMemberActivationSignupWelcome | null;
  timeZone?: string | null;
}

export interface HostedExecutionMemberChannelsUpdatedEvent extends HostedExecutionBaseEvent {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

/**
 * Sparse personality-dial delta: only dials the member changed in the
 * originating request appear, so applying one dial never clobbers a sibling
 * dial the member set elsewhere (for example conversationally through the
 * assistant CLI). `null` clears the member's override back to the product
 * default.
 */
export type HostedExecutionMemberPersonalityPreferences = {
  [TSetting in AssistantPersonalitySettingId]?: number | null;
};

export interface HostedExecutionMemberPreferences {
  persona?: AssistantPersonaId;
  personality?: HostedExecutionMemberPersonalityPreferences;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export interface HostedExecutionMemberPreferencesUpdatedEvent
  extends HostedExecutionBaseEvent {
  causalOrigin?: "event" | "turn";
  kind: "member.preferences.updated";
  preferenceCausalSeq?: string;
  preferences: HostedExecutionMemberPreferences;
  requestedFields?: Array<"persona" | "tone" | "voice">;
}

export type HostedExecutionAssistantNotificationDeliveryDispatchMode =
  | "immediate"
  | "queue-only";

export const HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES = [
  "context-handoff",
  "creative-response",
  "creative-response-text",
] as const;

export type HostedExecutionAssistantNotificationPromptProfile =
  (typeof HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES)[number];

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

export interface HostedExecutionPrivateAssistantAskCompletionNotification {
  expiresAt: string;
  requestId: string;
}

export interface HostedExecutionGroupContextHandoffNotification {
  membershipId: string;
  originAssistantInputId: string;
}

export interface HostedExecutionAssistantNotificationRequestedPayload {
  deliveryDedupeToken?: string | null;
  deliveryDispatchMode?: HostedExecutionAssistantNotificationDeliveryDispatchMode | null;
  deliveryIdempotencyKey?: string | null;
  externalThreadRouteAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  firstContact?: HostedExecutionAssistantNotificationFirstContactPolicy | null;
  groupContextHandoff?: HostedExecutionGroupContextHandoffNotification;
  instructions: string;
  notificationPromptProfile?: HostedExecutionAssistantNotificationPromptProfile | null;
  privateAssistantAskCompletion?: HostedExecutionPrivateAssistantAskCompletionNotification;
  responsePolicy?: HostedExecutionAssistantNotificationResponsePolicy | null;
  route: HostedExecutionAssistantNotificationRoute;
}

export interface HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority {
  answeredMailboxItemIds: readonly string[];
  assistantAskCompletionExpiresAt: string;
  idempotencyKey: string;
  responseTextDigest: string;
  route: HostedExecutionAssistantNotificationRoute;
}

export interface HostedExecutionAssistantNotificationRequestedEvent
  extends HostedExecutionBaseEvent {
  kind: "assistant.notification.requested";
  notification: HostedExecutionAssistantNotificationRequestedPayload;
}

export const HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS = 1_200;
export const HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS = 4_000;
export const HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS = 120;
export const HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS = 1_000;
export const HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS = 10 * 60 * 1_000;

export interface HostedExecutionAssistantAskJoinedGroupTarget {
  kind: "joined_group";
  membershipId: string;
  requestedLabel: string | null;
}

export interface HostedExecutionAssistantAskConsentedMemberTarget {
  grantId: string;
  kind: "consented_member";
  membershipId: string;
  permissionDigest: string;
}

/**
 * Fixed one-time permissions selected by Web from the exact source message
 * before personal-model work. The outgoing reviewer may only allow or deny the
 * answer for this already-persisted audience.
 */
export const HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT =
  "The owner of this personal Murph authored the exact incoming group question and may authorize one answer to that same group. Answer only when that question clearly asks Murph to share information about the owner. Treat first-person references as the owner, disclose only the owner's information directly requested by the question, and disclose nothing about anyone else. This authorization applies once to this question and grants no future, scheduled, or broader access.";

export const HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT =
  "The owner of this personal Murph authored the exact incoming group request and explicitly asked Murph to answer them privately. Answer as one direct private message to the owner. You may use only the owner's personal Murph context needed for this request. Do not disclose anyone else's private information, do not post anything back to the group, and do not perform actions. This authorization applies once to this request and grants no future, scheduled, or broader access.";

/** The one personal context resolved from the exact current group sender. */
export interface HostedExecutionAssistantAskCurrentSenderPersonalTarget {
  groupRuntimeMemberId: string;
  kind: "current_sender_personal";
  permissionDigest: string;
}

/**
 * Drain-only target shapes written by the former audience-coupled protocol.
 * New requests must use current_sender_personal plus resultDestination.
 */
export type HostedExecutionAssistantAskLegacyGroupSenderTarget = {
  groupRuntimeMemberId: string;
  permissionDigest: string;
} & (
  | { kind: "group_sender" }
  | { kind: "group_sender_private" }
);

export type HostedExecutionAssistantAskCurrentSenderTarget =
  | HostedExecutionAssistantAskCurrentSenderPersonalTarget
  | HostedExecutionAssistantAskLegacyGroupSenderTarget;

export type HostedExecutionAssistantAskResultDestination =
  | { kind: "origin_context" }
  | {
      channel: "linq" | "telegram";
      kind: "requester_direct";
    };

export type HostedExecutionAssistantAskTarget =
  | HostedExecutionAssistantAskJoinedGroupTarget
  | HostedExecutionAssistantAskConsentedMemberTarget
  | HostedExecutionAssistantAskCurrentSenderTarget;

export function isHostedExecutionAssistantAskCurrentSenderTarget(
  target: HostedExecutionAssistantAskTarget,
): target is HostedExecutionAssistantAskCurrentSenderTarget {
  return target.kind === "current_sender_personal"
    || target.kind === "group_sender"
    || target.kind === "group_sender_private";
}

export interface HostedExecutionAssistantAskAcceptedInputOrigin {
  assistantInputId: string;
  kind: "accepted_input";
  sessionId: string;
}

export interface HostedExecutionAssistantAskAutomationOccurrenceOrigin {
  automationId: string;
  kind: "automation_occurrence";
  occurrenceAt: string;
}

export type HostedExecutionAssistantAskOrigin =
  | HostedExecutionAssistantAskAcceptedInputOrigin
  | HostedExecutionAssistantAskAutomationOccurrenceOrigin;

export type HostedExecutionAssistantAskResult =
  | {
      answer: string;
      outcome: "answered";
    }
  | {
      answer: string | null;
      outcome: "cannot_answer";
    };

export interface HostedExecutionAssistantAskJoinedGroupRequestedPayload {
  expiresAt: string;
  originAssistantInputId: string;
  originSessionId: string;
  question: string;
  target: HostedExecutionAssistantAskJoinedGroupTarget;
}

export interface HostedExecutionAssistantAskConsentedMemberRequestedPayload {
  expiresAt: string;
  origin: HostedExecutionAssistantAskOrigin;
  question: string;
  target: HostedExecutionAssistantAskConsentedMemberTarget;
}

export interface HostedExecutionAssistantAskCurrentSenderRequestedPayload {
  expiresAt: string;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  question: string;
  resultDestination: HostedExecutionAssistantAskResultDestination;
  target: HostedExecutionAssistantAskCurrentSenderPersonalTarget;
}

export interface HostedExecutionAssistantAskLegacyGroupSenderRequestedPayload {
  expiresAt: string;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  question: string;
  target: HostedExecutionAssistantAskLegacyGroupSenderTarget;
}

export type HostedExecutionAssistantAskRequestedPayload =
  | HostedExecutionAssistantAskJoinedGroupRequestedPayload
  | HostedExecutionAssistantAskConsentedMemberRequestedPayload
  | HostedExecutionAssistantAskCurrentSenderRequestedPayload
  | HostedExecutionAssistantAskLegacyGroupSenderRequestedPayload;

export interface HostedExecutionAssistantAskJoinedGroupCompletedPayload {
  expiresAt: string;
  originAssistantInputId: string;
  originSessionId: string;
  question: string;
  requestId: string;
  result: HostedExecutionAssistantAskResult;
  targetLabel: string | null;
}

export interface HostedExecutionAssistantAskConsentedMemberCompletedPayload {
  expiresAt: string;
  origin: HostedExecutionAssistantAskOrigin;
  question: string;
  requestId: string;
  result: HostedExecutionAssistantAskResult;
  targetLabel: null;
}

export type HostedExecutionAssistantAskCompletedPayload =
  | HostedExecutionAssistantAskJoinedGroupCompletedPayload
  | HostedExecutionAssistantAskConsentedMemberCompletedPayload;

export interface HostedExecutionAssistantAskRequestedEvent
  extends HostedExecutionBaseEvent {
  ask: HostedExecutionAssistantAskRequestedPayload;
  kind: "assistant.ask.requested";
}

export interface HostedExecutionAssistantAskCompletedEvent
  extends HostedExecutionBaseEvent {
  ask: HostedExecutionAssistantAskCompletedPayload;
  kind: "assistant.ask.completed";
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
  /**
   * Sending Telegram user id. Group attribution authority, mirroring the Linq
   * `from` handle. Present only on route-authorized non-direct inbound whose
   * sender already resolved to exactly one active linked member.
   */
  from?: string | null;
  mediaGroupId?: string | null;
  messageId: string;
  replyContextPreview?: string | null;
  /** Exact Telegram message id targeted by the sender's native reply. */
  replyToMessageId?: string;
  schema: typeof HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA;
  /**
   * Presentation-only display name from trusted Telegram ingress. Never
   * identity, membership, routing, or effect authority.
   */
  senderDisplayName?: string | null;
  /**
   * Sending Telegram `@username`, carried only so the assistant can address
   * participants by name. Never identity authority: usernames are optional,
   * user-mutable, and re-registerable once released.
   */
  senderUsername?: string | null;
  text?: string | null;
  threadId: string;
  threadIsDirect?: boolean;
}

export interface HostedExecutionDeviceSyncWakeEvent extends HostedExecutionBaseEvent {
  connectionId?: string | null;
  expectedConnectedAt?: string;
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

export interface HostedExecutionClinicalRecordsSyncRequestedEvent
  extends HostedExecutionBaseEvent {
  generation: number;
  kind: "clinical-records.sync-requested";
  runId: string;
}

export interface HostedExecutionMemberActionRequestedEvent
  extends HostedExecutionBaseEvent {
  kind: "member.action.requested";
  request: MemberActionRequestV1;
}

export interface HostedExecutionMemberActionCompletedEvent
  extends HostedExecutionBaseEvent {
  kind: "member.action.completed";
  outcome: MemberActionOutcomeV1;
}

export type HostedExecutionDirectRoute =
  | {
      channel: "linq" | "telegram";
      threadId: string;
    }
  | {
      channel: "email";
      deliveryTarget: string;
    };

export type HostedExecutionDirectRouteChannel =
  HostedExecutionDirectRoute["channel"];

export interface HostedExecutionPlainRuntimeControlRequestedEvent
  extends HostedExecutionBaseEvent {
  kind: HostedExecutionPlainRuntimeControlWakeKind;
}

export interface HostedExecutionPendingEffectsReconcileRequestedEvent
  extends HostedExecutionBaseEvent {
  effectId: string;
  kind: "runtime.pending-effects-reconcile-requested";
}

export interface HostedExecutionCodexAuthRequestedEvent
  extends HostedExecutionBaseEvent {
  action: HostedCodexAuthAction;
  attemptId: string;
  kind: "runtime.codex-auth-requested";
}

export type HostedExecutionRuntimeControlRequestedEvent =
  | HostedExecutionPlainRuntimeControlRequestedEvent
  | HostedExecutionPendingEffectsReconcileRequestedEvent
  | HostedExecutionCodexAuthRequestedEvent;

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionMemberChannelsUpdatedEvent
  | HostedExecutionMemberPreferencesUpdatedEvent
  | HostedExecutionAssistantNotificationRequestedEvent
  | HostedExecutionAssistantAskRequestedEvent
  | HostedExecutionAssistantAskCompletedEvent
  | HostedExecutionClinicalRecordsSyncRequestedEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionMemberActionRequestedEvent
  | HostedExecutionMemberActionCompletedEvent
  | HostedExecutionRuntimeControlRequestedEvent;

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
  affirmativeReaction?: true;
  chatId: string;
  editedSourceInputId?: string;
  editedTextPartIndex?: number;
  from: string;
  isFromMe: boolean;
  messageId: string;
  parts: HostedExecutionLinqConversationMessagePart[];
  reactionEligible?: boolean | null;
  replyToMessageId?: string | null;
  replyToPartIndex?: number | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
}

export const HOSTED_EXECUTION_LINQ_CONVERSATION_CONTACT_KINDS = [
  "email",
  "phone",
] as const;

export type HostedExecutionLinqConversationContactKind =
  (typeof HOSTED_EXECUTION_LINQ_CONVERSATION_CONTACT_KINDS)[number];

export const HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS = 10;
export const HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS = 512;
// Ten max-size entries plus the nine newline separators in the consumed hint.
export const HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS =
  (HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS
    * HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS)
  + HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS - 1;

interface HostedExecutionLinqConversationMessagePayloadBase {
  accountLookupKey?: string | null;
  channel: "linq";
  groupParticipantAdded?: true;
  groupReactionContext?: string;
  linqMessage: HostedExecutionLinqConversationMessage;
  routeAuthority?: HostedExecutionLinqExternalThreadRouteAuthority | null;
  senderMemberId?: string;
}

export type HostedExecutionLinqConversationMessagePayload =
  HostedExecutionLinqConversationMessagePayloadBase
  & (
    | {
        contactKind: HostedExecutionLinqConversationContactKind;
        contactLookupKey: string;
        phoneLookupKey?: string | null;
      }
    | {
        contactKind?: undefined;
        contactLookupKey?: undefined;
        phoneLookupKey: string;
      }
  );

export function readHostedLinqConversationMessageContact(
  payload: HostedExecutionLinqConversationMessagePayload,
): {
  kind: HostedExecutionLinqConversationContactKind;
  lookupKey: string;
} {
  if (
    typeof payload.contactLookupKey === "string"
    && isHostedLinqConversationContactKind(payload.contactKind)
  ) {
    return {
      kind: payload.contactKind,
      lookupKey: payload.contactLookupKey,
    };
  }

  if (typeof payload.phoneLookupKey === "string" && payload.phoneLookupKey.length > 0) {
    return {
      kind: "phone",
      lookupKey: payload.phoneLookupKey,
    };
  }

  throw new TypeError("Hosted Linq conversation message requires a contact lookup key.");
}

export function readHostedLinqConversationMessageAccountLookupKey(
  payload: HostedExecutionLinqConversationMessagePayload,
): string {
  return typeof payload.accountLookupKey === "string" && payload.accountLookupKey.trim()
    ? payload.accountLookupKey
    : readHostedLinqConversationMessageContact(payload).lookupKey;
}

export interface HostedExecutionTelegramConversationMessagePayload {
  channel: "telegram";
  routeAuthority?: HostedExecutionTelegramExternalThreadRouteAuthority | null;
  senderMemberId?: string;
  telegramMessage: HostedExecutionTelegramMessage;
}

export interface HostedExecutionEmailAttachmentSummary {
  contentType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
}

export interface HostedExecutionEmailConversationMessagePayload {
  assistantStyleSettingsAuthorized?: boolean;
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
  threadIsDirect?: boolean | null;
  threadTarget?: string | null;
  to?: string[];
}

export type HostedExecutionConversationMessagePayload =
  | HostedExecutionLinqConversationMessagePayload
  | HostedExecutionTelegramConversationMessagePayload
  | HostedExecutionEmailConversationMessagePayload;

/**
 * Returns only the human-authored text represented by a conversation wake.
 * It performs no truncation so callers can either preserve the exact text or
 * reject it at their own authorization boundary.
 */
export function readHostedExecutionConversationMessageText(
  payload: HostedExecutionConversationMessagePayload,
): string | null {
  const text = payload.channel === "linq"
    ? payload.linqMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.value)
      .join("\n")
    : payload.channel === "telegram"
      ? payload.telegramMessage.text ?? ""
      : "";
  const normalized = text.trim();
  return normalized.length > 0 ? normalized : null;
}

export interface HostedExecutionConversationMessageWake extends HostedExecutionBaseWake {
  kind: "conversation.message";
  message: HostedExecutionConversationMessagePayload;
}

export interface HostedExecutionMemberActivatedWake extends HostedExecutionBaseWake {
  initialGroupRoomModelMarkdown?: string | null;
  kind: "member.activated";
  memberChannels: HostedExecutionMemberChannels;
  signupWelcome?: HostedExecutionMemberActivationSignupWelcome | null;
  timeZone?: string | null;
}

export interface HostedExecutionAssistantNotificationRequestedWake
  extends HostedExecutionBaseWake {
  kind: "assistant.notification.requested";
  notification: HostedExecutionAssistantNotificationRequestedPayload;
}

export interface HostedExecutionAssistantAskRequestedWake
  extends HostedExecutionBaseWake {
  ask: HostedExecutionAssistantAskRequestedPayload;
  kind: "assistant.ask.requested";
}

export interface HostedExecutionAssistantAskCompletedWake
  extends HostedExecutionBaseWake {
  ask: HostedExecutionAssistantAskCompletedPayload;
  kind: "assistant.ask.completed";
}

export interface HostedExecutionMemberChannelsUpdatedWake extends HostedExecutionBaseWake {
  kind: "member.channels.updated";
  memberChannels: HostedExecutionMemberChannels;
}

export interface HostedExecutionMemberPreferencesUpdatedWake
  extends HostedExecutionBaseWake {
  causalOrigin?: "event" | "turn";
  kind: "member.preferences.updated";
  preferenceCausalSeq?: string;
  preferences: HostedExecutionMemberPreferences;
  requestedFields?: Array<"persona" | "tone" | "voice">;
}

export interface HostedExecutionVaultShareDeliveryWake extends HostedExecutionBaseWake {
  delivery: HostedVaultShareDeliveryPayload;
  kind: "vault-share.delivery";
}

export interface HostedExecutionVaultShareRevokeWake extends HostedExecutionBaseWake {
  kind: "vault-share.revoke";
  revoke: HostedVaultShareRevokePayload;
}

export interface HostedExecutionDeviceSyncWake extends HostedExecutionBaseWake {
  connectionId?: string | null;
  expectedConnectedAt?: string;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
}

export interface HostedExecutionClinicalRecordsSyncRequestedWake
  extends HostedExecutionBaseWake {
  generation: number;
  kind: "clinical-records.sync-requested";
  runId: string;
}

export const HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES = 3 * 1024 * 1024;

export const HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES = [
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
] as const;

export type HostedExecutionEnvironmentVoiceContentType =
  (typeof HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES)[number];

export interface HostedExecutionEnvironmentVoiceCapturedPayload {
  audioKey: string;
  byteLength: number;
  captureId: string;
  capturedAt: string;
  contentType: HostedExecutionEnvironmentVoiceContentType;
  durationMs: number;
  sha256: string;
}

export interface HostedExecutionEnvironmentVoiceCapturedWake
  extends HostedExecutionBaseWake {
  environmentVoice: HostedExecutionEnvironmentVoiceCapturedPayload;
  kind: "environment-voice.captured";
}

export const HOSTED_EXECUTION_DAILY_METRIC_MAX_METRIC_LENGTH = 120;
export const HOSTED_EXECUTION_DAILY_METRIC_MAX_UNIT_LENGTH = 80;

export interface HostedExecutionDailyMetricReportedPayload {
  date: string;
  metric: string;
  unit: string;
  value: number;
}

export interface HostedExecutionDailyMetricReportedWake
  extends HostedExecutionBaseWake {
  dailyMetric: HostedExecutionDailyMetricReportedPayload;
  kind: "health.daily-metric.reported";
}

export interface HostedExecutionEnvironmentInterviewTopicCompletion {
  answers: Array<{
    aspectId: string;
    indicatorId: string;
    note?: string | null;
    value: string | number | boolean;
  }>;
  topicId: string;
}

export interface HostedExecutionEnvironmentInterviewCompletedPayload {
  completedAt: string;
  completionId: string;
  topics: HostedExecutionEnvironmentInterviewTopicCompletion[];
}

export interface HostedExecutionEnvironmentInterviewCompletedWake
  extends HostedExecutionBaseWake {
  environmentInterview: HostedExecutionEnvironmentInterviewCompletedPayload;
  kind: "environment-interview.completed";
}

export const HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export interface HostedExecutionMealPhotoCapturedPayload {
  byteLength: number;
  captureId: string;
  capturedAt: string;
  mealPhotoKey: string;
  sha256: string;
}

export interface HostedExecutionMealPhotoCapturedWake extends HostedExecutionBaseWake {
  directRoute: HostedExecutionDirectRoute;
  kind: "meal-photo.captured";
  mealPhoto: HostedExecutionMealPhotoCapturedPayload;
}

export interface HostedExecutionMemberActionRequestedWake
  extends HostedExecutionBaseWake {
  kind: "member.action.requested";
  request: MemberActionRequestV1;
}

export interface HostedExecutionMemberActionCompletedWake
  extends HostedExecutionBaseWake {
  kind: "member.action.completed";
  outcome: MemberActionOutcomeV1;
}

export interface HostedExecutionPlainRuntimeControlWake extends HostedExecutionBaseWake {
  kind: HostedExecutionPlainRuntimeControlWakeKind;
}

export interface HostedExecutionPendingEffectsReconcileRequestedWake
  extends HostedExecutionBaseWake {
  effectId: string;
  kind: "runtime.pending-effects-reconcile-requested";
}

export interface HostedExecutionCodexAuthRequestedWake extends HostedExecutionBaseWake {
  action: HostedCodexAuthAction;
  attemptId: string;
  kind: "runtime.codex-auth-requested";
}

export type HostedExecutionRuntimeControlWake =
  | HostedExecutionPlainRuntimeControlWake
  | HostedExecutionPendingEffectsReconcileRequestedWake
  | HostedExecutionCodexAuthRequestedWake;

export interface HostedExecutionRuntimeTimerWake extends HostedExecutionBaseWake {
  kind: "runtime.timer";
  triggerKind: HostedRuntimeTimerTriggerKind;
}

export type HostedExecutionWake =
  | HostedExecutionConversationMessageWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionMemberPreferencesUpdatedWake
  | HostedExecutionAssistantNotificationRequestedWake
  | HostedExecutionAssistantAskRequestedWake
  | HostedExecutionAssistantAskCompletedWake
  | HostedExecutionClinicalRecordsSyncRequestedWake
  | HostedExecutionDeviceSyncWake
  | HostedExecutionEnvironmentInterviewCompletedWake
  | HostedExecutionEnvironmentVoiceCapturedWake
  | HostedExecutionDailyMetricReportedWake
  | HostedExecutionMealPhotoCapturedWake
  | HostedExecutionMemberActionRequestedWake
  | HostedExecutionMemberActionCompletedWake
  | HostedExecutionVaultShareDeliveryWake
  | HostedExecutionVaultShareRevokeWake
  | HostedExecutionRuntimeControlWake;

export type HostedRuntimeEvent =
  | HostedExecutionWake
  | HostedExecutionRuntimeTimerWake;

export type HostedExecutionSystemWake = Exclude<
  HostedExecutionWake,
  HostedExecutionConversationMessageWake
>;

export type HostedExecutionBundleKind = RuntimeHostedExecutionBundleKind;
export type HostedExecutionLayeredSnapshotRef = SharedHostedExecutionLayeredSnapshotRef;
export type HostedExecutionWorkingSnapshotRef = SharedHostedExecutionWorkingSnapshotRef;
export type HostedExecutionSnapshotRef = HostedExecutionSnapshotRefState;

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

export const HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA =
  "murph.hosted-browser-vault-replica-shards.v1";

export const HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS = [
  "core",
  "labs",
  "metricsIndex",
] as const;

export type HostedBrowserVaultReplicaShardKind =
  (typeof HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS)[number];

export const HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT =
  BROWSER_VAULT_METRIC_BUCKET_COUNT;
export const HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS =
  BROWSER_VAULT_METRIC_BUCKET_IDS;
export const HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA =
  "murph.hosted-browser-vault-replica-metric-buckets.v1";

export type HostedBrowserVaultReplicaMetricBucketId =
  BrowserVaultMetricBucketId;

export type HostedBrowserVaultReplicaContentEncoding = "gzip" | "identity";

export interface HostedBrowserVaultReplicaShardRef {
  byteLength: number;
  contentEncoding: HostedBrowserVaultReplicaContentEncoding;
  encodedByteLength: number;
  objectKey: string;
}

export type HostedBrowserVaultReplicaMetricBucketRef =
  HostedBrowserVaultReplicaShardRef;

export interface HostedBrowserVaultReplicaShardSetRef {
  core: HostedBrowserVaultReplicaShardRef;
  labs: HostedBrowserVaultReplicaShardRef;
  metricsIndex: HostedBrowserVaultReplicaShardRef;
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA;
}

export interface HostedBrowserVaultReplicaMetricBucketSetRef {
  bucketCount: typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT;
  buckets: Record<
    HostedBrowserVaultReplicaMetricBucketId,
    HostedBrowserVaultReplicaMetricBucketRef
  >;
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA;
}

export interface HostedBrowserVaultReplicaRef {
  byteLength: number;
  dataKeyEnvelope?: HostedDataKeyEnvelopeV1;
  dataVersion: string;
  generatedAt: string;
  /** Absent only on legacy refs produced before generation-aware freshness. */
  generation?: number;
  keyId: string;
  objectKey: string;
  replicaSchema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  runtimeRootKeyId: string;
  schema: typeof HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA;
  /** Absent together with shards on legacy refs created before route-aware children shipped. */
  metricBuckets?: HostedBrowserVaultReplicaMetricBucketSetRef;
  /** Absent together with metricBuckets on legacy refs created before route-aware children shipped. */
  shards?: HostedBrowserVaultReplicaShardSetRef;
  sourceBundleHash: string;
}

export type HostedBrowserVaultReplicaCursorRef = HostedBrowserVaultReplicaRef | null;

export function getHostedBrowserVaultReplicaStorageKeyId(
  ref: HostedBrowserVaultReplicaRef,
): string {
  return ref.dataKeyEnvelope?.dataKeyId ?? ref.keyId;
}

export const HOSTED_RUNTIME_TIMER_TRIGGER_KINDS = [
  "external_ingress",
  "runtime_timer",
  "manual_repair",
] as const;

export type HostedRuntimeTimerTriggerKind =
  (typeof HOSTED_RUNTIME_TIMER_TRIGGER_KINDS)[number];

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS = 10_000;
export const HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS = 1_000;
export const MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS =
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS + 1;
export const HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-timeout-ms";
export const HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-activity-started-at-ms";
export const HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-request-started-at-ms";
export const HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-token-acquire-started-at-ms";
export const HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-token-acquired-at-ms";
export const HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER =
  "x-hosted-runtime-ensure-processing-direct-request-started-at-ms";

export function assertHostedRuntimeProcessingTimeoutMs(
  value: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(value)
    || value < MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS
  ) {
    throw new TypeError(
      `${label} must be greater than ${HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS}.`,
    );
  }
}

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

export function isHostedLinqConversationContactKind(
  kind: unknown,
): kind is HostedExecutionLinqConversationContactKind {
  return HOSTED_EXECUTION_LINQ_CONVERSATION_CONTACT_KINDS.includes(
    kind as HostedExecutionLinqConversationContactKind,
  );
}

export function isHostedConversationMessageWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionConversationMessageWake {
  return wake.kind === "conversation.message";
}

export function isHostedExecutionAssistantAskRequestedWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionAssistantAskRequestedWake {
  return wake.kind === "assistant.ask.requested";
}

export function isHostedExecutionAssistantAskCompletedWake(
  wake: HostedExecutionWake,
): wake is HostedExecutionAssistantAskCompletedWake {
  return wake.kind === "assistant.ask.completed";
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
