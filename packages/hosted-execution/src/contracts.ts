import type {
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";
import type {
  HostedExecutionBundlePayloads,
  HostedExecutionBundleRefs,
} from "./bundles.ts";
import type { SharePack } from "@murphai/contracts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";

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
  "gateway.message.send",
] as const;

export type HostedExecutionEventKind =
  (typeof HOSTED_EXECUTION_EVENT_KINDS)[number];

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

export interface HostedExecutionTelegramMessageReceivedEvent extends HostedExecutionBaseEvent {
  botUserId: string | null;
  kind: "telegram.message.received";
  telegramUpdate: Record<string, unknown>;
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
  pack?: SharePack;
  shareId: string;
}

export interface HostedExecutionVaultShareAcceptedEvent extends HostedExecutionBaseEvent {
  kind: "vault.share.accepted";
  share: HostedExecutionShareReference;
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
  bundles: HostedExecutionBundlePayloads;
  dispatch: HostedExecutionDispatchRequest;
  run?: HostedExecutionRunContext | null;
}

export interface HostedExecutionRunnerResult {
  bundles: HostedExecutionBundlePayloads;
  result: {
    eventsHandled: number;
    nextWakeAt?: string | null;
    summary: string;
  };
}

export type HostedExecutionBundleRef = RuntimeHostedExecutionBundleRef;

export interface HostedExecutionUserStatus {
  backpressuredEventIds?: string[];
  bundleRefs: HostedExecutionBundleRefs;
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

export interface HostedExecutionUserEnvStatus {
  configuredUserEnvKeys: string[];
  userId: string;
}

export interface HostedExecutionUserEnvUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

export const HOSTED_EXECUTION_USER_ID_HEADER = "x-hosted-execution-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";

export interface HostedExecutionDeviceSyncConnectLinkResponse {
  authorizationUrl: string;
  expiresAt: string;
  provider: string;
  providerLabel: string;
}

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

export interface HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  connectionId?: string | null;
  provider?: string | null;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[];
  generatedAt: string;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionStateUpdate {
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  scopes?: string[];
  status?: "active" | "reauthorization_required" | "disconnected";
}

export interface HostedExecutionDeviceSyncRuntimeLocalStateUpdate {
  clearError?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastWebhookAt?: string | null;
  nextReconcileAt?: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  connectionId: string;
  connection?: HostedExecutionDeviceSyncRuntimeConnectionStateUpdate;
  localState?: HostedExecutionDeviceSyncRuntimeLocalStateUpdate;
  observedUpdatedAt?: string | null;
  observedTokenVersion?: number | null;
  tokenBundle?: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedExecutionDeviceSyncRuntimeApplyRequest {
  occurredAt?: string | null;
  updates: HostedExecutionDeviceSyncRuntimeConnectionUpdate[];
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeApplyEntry {
  connection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot["connection"] | null;
  connectionId: string;
  status: "missing" | "updated";
  tokenUpdate: "applied" | "cleared" | "missing" | "skipped_version_mismatch" | "unchanged";
}

export interface HostedExecutionDeviceSyncRuntimeApplyResponse {
  appliedAt: string;
  updates: HostedExecutionDeviceSyncRuntimeApplyEntry[];
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

export const HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATUSES = [
  "pending",
  "accepted",
  "completed",
  "failed",
] as const;

export type HostedExecutionDispatchLifecycleStatus =
  (typeof HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATUSES)[number];

export interface HostedExecutionDispatchLifecycle {
  lastError: string | null;
  status: HostedExecutionDispatchLifecycleStatus;
}

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

export function resolveHostedExecutionDispatchLifecycle(
  dispatchResult: HostedExecutionDispatchResult,
): HostedExecutionDispatchLifecycle {
  const {
    event,
    status,
  } = dispatchResult;

  switch (event.state) {
    case "completed":
    case "duplicate_consumed":
      return {
        lastError: null,
        status: "completed",
      };
    case "poisoned":
      return {
        lastError: event.lastError ?? status.lastError ?? "Hosted execution event was poisoned.",
        status: "failed",
      };
    case "backpressured":
      return {
        lastError: event.lastError ?? status.lastError,
        status: "pending",
      };
    case "queued":
    case "duplicate_pending":
      return {
        lastError:
          status.lastError === HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR
            ? status.lastError
            : event.lastError ?? status.lastError,
        status:
          status.lastError === HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR
            ? "pending"
            : "accepted",
      };
    default:
      return event.state satisfies never;
  }
}

export function resolveHostedDeviceSyncWakeContext(
  event: HostedExecutionDeviceSyncWakeEvent,
): {
  connectionId: string | null;
  hint: HostedExecutionDeviceSyncWakeEvent["hint"];
  provider: string | null;
} {
  return {
    connectionId: event.connectionId ?? null,
    hint: event.hint ?? null,
    provider: event.provider ?? null,
  };
}

export function normalizeHostedDeviceSyncJobHints(
  value: HostedExecutionDeviceSyncWakeEvent["hint"],
): HostedExecutionDeviceSyncJobHint[] {
  return Array.isArray(value?.jobs)
    ? value.jobs.map((job) => ({
        kind: job.kind,
        ...(job.availableAt ? { availableAt: job.availableAt } : {}),
        ...(job.dedupeKey !== undefined ? { dedupeKey: job.dedupeKey ?? null } : {}),
        ...(typeof job.maxAttempts === "number" ? { maxAttempts: job.maxAttempts } : {}),
        ...(job.payload ? { payload: { ...job.payload } } : {}),
        ...(typeof job.priority === "number" ? { priority: job.priority } : {}),
      }))
    : [];
}
