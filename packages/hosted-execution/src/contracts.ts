import type {
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";
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
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
  "gateway.message.send",
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

export const HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS = [
  "member.activated",
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "device-sync.wake",
  "gateway.message.send",
] as const satisfies readonly HostedExecutionEventKind[];

export const HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS = [
  "assistant.cron.tick",
  "vault.share.accepted",
] as const satisfies readonly HostedExecutionEventKind[];

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  firstContact?: HostedExecutionFirstContactTarget | null;
  kind: "member.activated";
}

export interface HostedExecutionFirstContactTarget {
  channel: "email" | "linq" | "telegram";
  identityId: string;
  threadId: string;
  threadIsDirect: boolean;
}

export interface HostedExecutionLinqMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "linq.message.received";
  linqEvent: Record<string, unknown>;
  phoneLookupKey: string;
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
  schema: typeof HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA;
  text?: string | null;
  threadId: string;
}

export interface HostedExecutionTelegramMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "telegram.message.received";
  telegramMessage: HostedExecutionTelegramMessage;
}

export interface HostedExecutionEmailMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "email.message.received";
  identityId: string;
  rawMessageKey: string;
  selfAddress?: string | null;
}
export interface HostedExecutionAssistantCronTickEvent extends HostedExecutionBaseEvent {
  kind: "assistant.cron.tick";
  reason: "alarm" | "manual" | "device-sync";
}

export interface HostedExecutionDeviceSyncJobHint {
  availableAt?: string;
  dedupeKey?: string | null;
  kind: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  priority?: number;
}

export interface HostedExecutionDeviceSyncWakeHint {
  eventType?: string | null;
  jobs?: HostedExecutionDeviceSyncJobHint[];
  nextReconcileAt?: string | null;
  occurredAt?: string | null;
  reason?: string | null;
  resourceCategory?: string | null;
  revokeWarning?: {
    code: string;
    message: string;
  } | null;
  scopes?: string[];
  traceId?: string | null;
}

export interface HostedExecutionDeviceSyncWakeEvent extends HostedExecutionBaseEvent {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  reason: "connected" | "webhook_hint" | "disconnected" | "reauthorization_required";
  runtimeSnapshot?: HostedExecutionDeviceSyncRuntimeSnapshotResponse | null;
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

export interface HostedExecutionGatewayMessageSendEvent extends HostedExecutionBaseEvent {
  clientRequestId: string | null;
  kind: "gateway.message.send";
  replyToMessageId: string | null;
  sessionKey: string;
  text: string;
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionLinqMessageReceivedEvent
  | HostedExecutionTelegramMessageReceivedEvent
  | HostedExecutionEmailMessageReceivedEvent
  | HostedExecutionAssistantCronTickEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionVaultShareAcceptedEvent
  | HostedExecutionGatewayMessageSendEvent;

export interface HostedExecutionDispatchRequest {
  event: HostedExecutionEvent;
  eventId: string;
  occurredAt: string;
}

export type HostedExecutionBundleKind = RuntimeHostedExecutionBundleKind;

export interface HostedExecutionRunnerRequest {
  bundle: HostedExecutionBundlePayload;
  dispatch: HostedExecutionDispatchRequest;
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
  backpressuredEventIds?: string[];
  bundleRef: HostedExecutionBundleRefState;
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingEventCount: number;
  poisonedEventIds: string[];
  run?: HostedExecutionRunStatus | null;
  retryingEventId: string | null;
  timeline?: HostedExecutionTimelineEntry[];
  userId: string;
}

export const HOSTED_EXECUTION_EVENT_DISPATCH_STATES = [
  "queued",
  "duplicate_pending",
  "duplicate_consumed",
  "backpressured",
  "completed",
  "poisoned",
] as const;

export type HostedExecutionEventDispatchState =
  (typeof HOSTED_EXECUTION_EVENT_DISPATCH_STATES)[number];

export interface HostedExecutionEventDispatchStatus {
  eventId: string;
  lastError: string | null;
  state: HostedExecutionEventDispatchState;
  userId: string;
}

export interface HostedExecutionDispatchResult {
  event: HostedExecutionEventDispatchStatus;
  status: HostedExecutionUserStatus;
}

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";

export interface HostedExecutionDeviceSyncRuntimeTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot {
  accessTokenExpiresAt: string | null;
  connectedAt: string;
  createdAt: string;
  displayName: string | null;
  externalAccountId: string;
  id: string;
  metadata: Record<string, unknown>;
  provider: string;
  scopes: string[];
  status: "active" | "reauthorization_required" | "disconnected";
  updatedAt?: string;
}

export interface HostedExecutionDeviceSyncRuntimeLocalStateSnapshot {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncStartedAt: string | null;
  lastWebhookAt: string | null;
  nextReconcileAt: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  connection: HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;
  localState: HostedExecutionDeviceSyncRuntimeLocalStateSnapshot;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[];
  generatedAt: string;
  userId: string;
}

export interface HostedExecutionDispatchStateSnapshot {
  backpressured: boolean;
  consumed: boolean;
  lastError: string | null;
  pending: boolean;
  poisoned: boolean;
}

export const HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR =
  "Hosted execution dispatch is not configured.";

export function resolveHostedExecutionDispatchOutcomeState(input: {
  initialState: HostedExecutionDispatchStateSnapshot;
  nextState: HostedExecutionDispatchStateSnapshot;
}): HostedExecutionDispatchResult["event"]["state"] {
  if (input.nextState.poisoned) {
    return "poisoned";
  }

  if (input.nextState.backpressured) {
    return "backpressured";
  }

  if (input.initialState.consumed) {
    return "duplicate_consumed";
  }

  if (input.initialState.pending) {
    return "duplicate_pending";
  }

  if (input.nextState.consumed) {
    return "completed";
  }

  return "queued";
}
