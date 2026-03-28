import type { SharePack } from "@murph/contracts";

export const HOSTED_EXECUTION_SIGNATURE_HEADER = "x-hosted-execution-signature";
export const HOSTED_EXECUTION_TIMESTAMP_HEADER = "x-hosted-execution-timestamp";

export const HOSTED_EXECUTION_EVENT_KINDS = [
  "member.activated",
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  kind: "member.activated";
}

export interface HostedExecutionLinqMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "linq.message.received";
  linqEvent: Record<string, unknown>;
  normalizedPhoneNumber: string;
}

export interface HostedExecutionTelegramMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "telegram.message.received";
  telegramUpdate: Record<string, unknown>;
}

export interface HostedExecutionEmailMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "email.message.received";
  envelopeFrom: string | null;
  envelopeTo: string | null;
  identityId: string;
  rawMessageKey: string;
  threadTarget: string | null;
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
}

export interface HostedExecutionShareReference {
  shareCode: string;
  shareId: string;
}

export interface HostedExecutionVaultShareAcceptedEvent extends HostedExecutionBaseEvent {
  kind: "vault.share.accepted";
  share: HostedExecutionShareReference;
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionLinqMessageReceivedEvent
  | HostedExecutionTelegramMessageReceivedEvent
  | HostedExecutionEmailMessageReceivedEvent
  | HostedExecutionAssistantCronTickEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionVaultShareAcceptedEvent;

export interface HostedExecutionDispatchRequest {
  event: HostedExecutionEvent;
  eventId: string;
  occurredAt: string;
}

export type HostedExecutionBundleKind = "vault" | "agent-state";

export interface HostedExecutionRunnerRequest {
  bundles: {
    agentState: string | null;
    vault: string | null;
  };
  dispatch: HostedExecutionDispatchRequest;
}

export interface HostedExecutionRunnerResult {
  bundles: {
    agentState: string | null;
    vault: string | null;
  };
  result: {
    eventsHandled: number;
    nextWakeAt?: string | null;
    summary: string;
  };
}

export interface HostedExecutionBundleRef {
  hash: string;
  key: string;
  size: number;
  updatedAt: string;
}

export interface HostedExecutionUserStatus {
  backpressuredEventIds?: string[];
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  inFlight: boolean;
  lastError: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingEventCount: number;
  poisonedEventIds: string[];
  retryingEventId: string | null;
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

export interface HostedExecutionUserEnvStatus {
  configuredUserEnvKeys: string[];
  userId: string;
}

export interface HostedExecutionUserEnvUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

export interface HostedExecutionSharePackResponse {
  pack: SharePack;
  shareId: string;
}
