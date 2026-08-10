import { COMPANION_HRV_RMSSD_RESOURCE } from "@murphai/contracts";

import { sanitizeStoredDeviceSyncMetadata } from "./metadata.ts";
import {
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
  mergeGuardedJunctionHistoricalBackfillMetadata,
  mergeHostedJunctionHistoricalBackfillMetadata,
  readJunctionHistoricalBackfillProgress,
  readJunctionHistoricalBackfillStatus,
} from "./junction-historical-backfill-progress.ts";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
} from "./companion-health-metadata.ts";
import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
} from "./client.ts";

export {
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
  mergeGuardedJunctionHistoricalBackfillMetadata,
  readJunctionHistoricalBackfillProgress,
  readJunctionHistoricalBackfillStatus,
};

export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH =
  "/api/internal/device-sync/runtime/snapshot";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH =
  "/api/internal/device-sync/runtime/apply";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH =
  "/api/internal/device-sync/runtime/dirty-pending";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH =
  "/api/internal/device-sync/runtime/dirty-ack";
export const HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH =
  "/api/internal/device-sync/reconcile";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT = 100;
export const HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT = 200;
export const HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT = 5_000;

const HOSTED_RUNTIME_ERROR_CODE_MAX_LENGTH = 128;
const HOSTED_RUNTIME_ERROR_TEXT_MAX_LENGTH = 2048;
const HOSTED_RUNTIME_DIAGNOSTIC_TEXT_MAX_LENGTH = 512;
const HOSTED_RUNTIME_ERROR_CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]+/gu;
const HOSTED_RUNTIME_ERROR_WHITESPACE_PATTERN = /\s+/gu;
const HOSTED_RUNTIME_ERROR_INLINE_BEARER_PATTERN =
  /\bBearer\s+(?=\S{8,})[^\s,;]+/giu;
const HOSTED_RUNTIME_ERROR_AUTH_HEADER_PATTERN =
  /\b((?:proxy-)?authorization)\b(\s*:\s*)[^\r\n]*/giu;
const HOSTED_RUNTIME_ERROR_JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu;
const HOSTED_RUNTIME_ERROR_QUERY_SECRET_PATTERN =
  /([?&](?:access_token|refresh_token|id_token|token|apikey|api_key|client_secret|session|session_token|code|state)=)[^&#\s]+/giu;
const HOSTED_RUNTIME_ERROR_NAMED_SECRET_PATTERN =
  /\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session(?:[_-]?(?:token|id))?|cookie|set-cookie|password)\b(\s*[:=]\s*)((?:Bearer\s+)?[^\s,;]+)/giu;
const HOSTED_RUNTIME_ERROR_FILE_URL_PATTERN = /\bfile:\/\/[^\s)"']+/giu;
const HOSTED_RUNTIME_ERROR_POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:Users|home|root|tmp|var|private|mnt)\/[^\s)"']+/gu;
const HOSTED_RUNTIME_ERROR_WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s)"']+/gu;
const HOSTED_RUNTIME_ERROR_URL_PATTERN = /\bhttps?:\/\/[^\s)"']+/giu;
const HOSTED_RUNTIME_ERROR_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const HOSTED_RUNTIME_ERROR_PHONE_PATTERN = /(?:\+\d[\d().\s-]{7,}\d|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/gu;
// Braces, primitive arrays, quoted-key colons, and structured-looking bracket
// regions signal a raw structured payload dump or validation suffix that can
// carry arbitrary values under keys the span redactors do not know; those stay
// fail-closed. Bare square brackets around prose are allowed.
const HOSTED_RUNTIME_DIAGNOSTIC_JSON_FRAGMENT_PATTERN =
  /[{}]|\[\s*(?:["']|\d|(?:true|false|null)\b)|["'][A-Za-z0-9_.:-]{1,80}["']\s*:/u;
// Default-ignorable format characters (zero-width spaces/joiners, soft
// hyphens, BOM) can split an identifier visually without changing how it
// renders; strip them before span matching so they cannot defeat the masks.
const HOSTED_RUNTIME_DIAGNOSTIC_FORMAT_CHAR_PATTERN =
  /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
const HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_DELIMITED_PATTERN =
  /\b((?:api[_\s-]?key|client[_\s-]?secret|(?:access|id|refresh|session)\s+token|token)\b\s*[:=]\s*["']?)[^'",;\]\s]+/giu;
const HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_PATTERN =
  /\b((?:api[_\s-]?key|client[_\s-]?secret|(?:access|id|refresh|session)\s+token|token)\s+["']?)([A-Za-z0-9._~+/=-]{6,})/giu;
const HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_SAFE_WORD_PATTERN =
  /^(?:absent|disabled|expired|invalid|missing|required|request|revoked|unavailable)$/iu;
const HOSTED_RUNTIME_DIAGNOSTIC_DIRECT_IDENTIFIER_COLON_ASSIGNMENT_PATTERN =
  /\b((?:account|client|external|member|owner|patient|provider[_\s-]?account|subject|team|user)\b\s*:\s*)(?:"[^"]*"|'[^']*'|[^,;\]\[]+)/giu;
const HOSTED_RUNTIME_DIAGNOSTIC_IDENTIFIER_COLON_ASSIGNMENT_PATTERN =
  /\b((?:account|client|external|member|owner|patient|provider[_\s-]?account|subject|team|user)(?:[_\s-]?id|[_\s-]?identifier)?\b\s*:\s*)(?:"[^"]*"|'[^']*'|[A-Za-z0-9._~+/:=-]+)/giu;
const HOSTED_RUNTIME_DIAGNOSTIC_ASSIGNMENT_TAIL_PATTERN =
  /(?:[A-Za-z_][A-Za-z0-9_-]*\s*=\s*\S|(?:^|[\s,;])\s*(?!(?:account|client|external|member|owner|patient|provider[_-]?account|subject|team|user)(?:[_-]?(?:id|identifier))?\s*:)(?:display[_-]?name|first[_-]?name|last[_-]?name|full[_-]?name|user[_-]?name|email|phone|[A-Za-z_][A-Za-z0-9_-]*[_-][A-Za-z0-9_-]*)\s*:\s*\S)/iu;
// Identifier values also appear as bare phrases ("user hbm_abc123xyz",
// 'user id "hbm_abc123xyz"'); mask the value when it looks id-shaped
// (contains a digit or underscore) so plain words ("user profile") stay
// readable.
const HOSTED_RUNTIME_DIAGNOSTIC_IDENTIFIER_PHRASE_PATTERN =
  /\b((?:account|client|external|member|owner|patient|subject|team|user)(?:\s+(?:id|identifier))?\s+["']?)(?=[A-Za-z0-9._~+/:-]*[\d_])[A-Za-z0-9._~+/:-]{6,}\b/giu;
const HOSTED_RUNTIME_DIAGNOSTIC_IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/gu;
const HOSTED_RUNTIME_DIAGNOSTIC_UNLABELED_NAME_ACTION_PATTERN =
  /\b[A-Z][a-z][A-Za-z'-]*\s+[A-Z][a-z][A-Za-z'-]*\s+(?:can(?:not| not)|could|denied|does|failed|has|is|must|not\s+found|should|was|would)\b/u;
const HOSTED_RUNTIME_DIAGNOSTIC_BARE_NAME_PATTERN =
  /^(?:[a-z][a-z0-9_-]{0,40}\s*:\s*)?[A-Z][a-z][A-Za-z'-]*\s+[A-Z][a-z][A-Za-z'-]*$/u;
const HOSTED_RUNTIME_DIAGNOSTIC_SAFE_BARE_TITLE_PATTERN =
  /^(?:Bad Request|Not Found|Request Timeout|Connect Timeout|Gateway Timeout)$/u;
// The catch-all for id-shaped values in any remaining context (quoted,
// bracketed, mid-prose): a token of six or more characters containing a digit
// is masked unless it is a recognizably safe shape — a small plain number, a
// dotted number (versions), or an ISO-8601 date/datetime. This makes leak
// safety depend on the value's own shape rather than on enumerating every
// surrounding context.
const HOSTED_RUNTIME_DIAGNOSTIC_DIGIT_TOKEN_PATTERN =
  /\b(?=[A-Za-z0-9._~+/:=-]*\d)[A-Za-z0-9._~+/:=-]{6,}\b/gu;
const HOSTED_RUNTIME_DIAGNOSTIC_SAFE_DIGIT_TOKEN_PATTERN =
  /^(?:\d{1,4}|[vV]?\d+(?:\.\d+){1,2}|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?)$/u;
const HOSTED_RUNTIME_DIAGNOSTIC_LONG_TOKEN_PATTERN =
  /\b(?=[A-Za-z0-9._~+/=-]{32,}\b)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+\b/gu;
const HOSTED_DEVICE_SYNC_CREDENTIAL_METADATA_BLOCKED_KEY_SUBSTRINGS = [
  "secret",
  "authorization",
  "authheader",
  "bearer",
  "token",
  "apikey",
  "clientsecret",
  "hmac",
  "webhook",
] as const;
const HOSTED_DEVICE_SYNC_CREDENTIAL_METADATA_SECRET_VALUE_PATTERN =
  /\b(?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|hmac|webhook[_-]?secret)\b|\bBearer\s+\S+/iu;

export function mergeHostedDeviceSyncConnectionMetadata(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown> | null | undefined;
}): { metadata: Record<string, unknown>; preservedLocalProgress: boolean } {
  return mergeHostedJunctionHistoricalBackfillMetadata({
    hostedMetadata: input.hostedMetadata,
    localConnectionStateUnpublished: input.localConnectionStateUnpublished,
    localMetadata: input.localMetadata ?? {},
  });
}

export interface HostedExecutionDeviceSyncConnectLinkResponse {
  authorizationUrl: string;
  connectUrl: string;
  expiresAt: string;
  provider: string;
  providerLabel: string;
}

export interface HostedExecutionDeviceSyncReconcileRequest {
  connectionId: string;
}

export interface HostedExecutionDeviceSyncReconcileResponse {
  connectionId: string;
  occurredAt: string;
  status: "queued";
}

export interface HostedExecutionDeviceSyncRuntimeTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
}

export type HostedExecutionDeviceSyncRuntimeCredentialSnapshot =
  | {
      kind: "oauth_tokens";
      tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle;
    }
  | {
      kind: "oauth_tokens_redacted";
      credentialMetadata: Record<string, unknown>;
      tokenVersion: number | null;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      credentialMetadata: Record<string, unknown>;
    }
  | {
      kind: "none";
      credentialMetadata: Record<string, unknown>;
    };

export type HostedExecutionDeviceSyncRuntimeWritableCredentialSnapshot =
  Exclude<HostedExecutionDeviceSyncRuntimeCredentialSnapshot, { kind: "oauth_tokens_redacted" }>;

export type HostedExecutionDeviceSyncRuntimeCredentialUpdate =
  | HostedExecutionDeviceSyncRuntimeWritableCredentialSnapshot
  | {
      clearTokens: true;
      kind: "oauth_tokens";
    };

export type HostedExecutionDeviceSyncRuntimeConnectionStatus =
  | "active"
  | "reauthorization_required"
  | "disconnected";

export type HostedExecutionDeviceSyncRuntimeSetupPhase =
  | "pending_link"
  | "link_returned"
  | "source_confirmed"
  | "failed";

export function sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);
  const credentialMetadata: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(sanitized)) {
    if (
      !isBlockedHostedDeviceSyncCredentialMetadataKey(key)
      && !isBlockedHostedDeviceSyncCredentialMetadataValue(key, entry)
    ) {
      credentialMetadata[key] = entry;
    }
  }

  return credentialMetadata;
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
  setupExpiresAt?: string | null;
  setupPhase?: HostedExecutionDeviceSyncRuntimeSetupPhase | null;
  status: HostedExecutionDeviceSyncRuntimeConnectionStatus;
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

export interface HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot {
  sourceInstanceKey?: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceCount: number;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last inbound payload carrying this source's data; null until one has. */
  lastDataAt: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  connection: HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;
  credential: HostedExecutionDeviceSyncRuntimeCredentialSnapshot;
  localState: HostedExecutionDeviceSyncRuntimeLocalStateSnapshot;
  sources?: HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot[];
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotCapabilities {
  connectionSourceApply?: boolean;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionSeed {
  connection: HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;
  credential: HostedExecutionDeviceSyncRuntimeWritableCredentialSnapshot;
  localState: HostedExecutionDeviceSyncRuntimeLocalStateSnapshot;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  connectionId?: string | null;
  includeCredentialMaterial: boolean;
  limit?: number | null;
  provider?: string | null;
  sourceProviderSlug?: string | null;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  capabilities?: HostedExecutionDeviceSyncRuntimeSnapshotCapabilities;
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[];
  generatedAt: string;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionStateUpdate {
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  scopes?: string[];
  setupExpiresAt?: string | null;
  setupPhase?: HostedExecutionDeviceSyncRuntimeSetupPhase | null;
  status?: HostedExecutionDeviceSyncRuntimeConnectionStatus;
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

export interface HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate {
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  observedLastSeenAt: string | null;
  displayName?: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt: string;
  lastDataAt?: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails {
  failureCauseCode?: string;
  failureCauseName?: string;
  failureErrorCause?: string;
  failureErrorName?: string;
  providerHttpStatus?: number;
  providerHttpStatusText?: string;
  providerRequestAuthKind?: string;
  providerRequestAuthPlacement?: string;
  providerRequestBodyFieldCount?: number;
  providerRequestBodyFieldNames?: string;
  providerRequestBodyKind?: string;
  providerRequestContentType?: string;
  providerRequestCredentialPresent?: boolean;
  providerRequestEndpointKind?: string;
  providerRequestMethod?: string;
  providerRequestQueryParameterCount?: number;
  providerRequestQueryParameterNames?: string;
  providerResponseErrorCode?: string;
  providerResponseErrorDescription?: string;
  providerResponseErrorDescriptionFieldPresent?: boolean;
  providerResponseErrorFieldPresent?: boolean;
  providerResponseShapeKind?: string;
  providerOAuthErrorCode?: string;
  providerOAuthErrorDescription?: string;
  providerOAuthGrantType?: string;
  providerOAuthRequestBodyBuilderKind?: string;
  providerOAuthRequestClientAuthPlacement?: string;
  providerOAuthRequestClientCredentialPresent?: boolean;
  providerOAuthRequestClientIdPresent?: boolean;
  providerOAuthRequestContentType?: string;
  providerOAuthRequestDuplicateParameterCount?: number;
  providerOAuthRequestEncodingKind?: string;
  providerOAuthRequestHasDuplicateParameters?: boolean;
  providerOAuthRequestMethod?: string;
  providerOAuthRequestOfflineScopePresent?: boolean;
  providerOAuthRequestParameterCount?: number;
  providerOAuthRequestParameterNames?: string;
  providerOAuthRequestRefreshCredentialPresent?: boolean;
  providerOAuthRequestScopeCount?: number;
  providerOAuthRequestScopePresent?: boolean;
  providerOAuthRequestScopeValue?: string;
  providerOAuthRequestTokenEndpointKind?: string;
  providerOAuthResponseErrorDescriptionFieldPresent?: boolean;
  providerOAuthResponseErrorFieldPresent?: boolean;
  providerOAuthResponseShapeKind?: string;
}

export interface HostedExecutionDeviceSyncRuntimeFailureDiagnostic {
  accountStatus: HostedExecutionDeviceSyncRuntimeConnectionStatus | null;
  code: string;
  details: HostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails;
  retryable: boolean;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  connectionId: string;
  connection?: HostedExecutionDeviceSyncRuntimeConnectionStateUpdate;
  credential?: HostedExecutionDeviceSyncRuntimeCredentialUpdate;
  failureDiagnostic?: HostedExecutionDeviceSyncRuntimeFailureDiagnostic;
  localState?: HostedExecutionDeviceSyncRuntimeLocalStateUpdate;
  observedConnectedAt?: string | null;
  observedUpdatedAt?: string | null;
  observedTokenVersion?: number | null;
  seed?: HostedExecutionDeviceSyncRuntimeConnectionSeed;
  sources?: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate[];
}

export interface HostedExecutionDeviceSyncRuntimeApplyRequest {
  occurredAt?: string | null;
  updates: HostedExecutionDeviceSyncRuntimeConnectionUpdate[];
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeApplyEntry {
  connection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot["connection"] | null;
  connectionId: string;
  status: "created" | "missing" | "updated";
  tokenUpdate: "applied" | "cleared" | "missing" | "skipped_version_mismatch" | "unchanged";
  writeUpdate: "applied" | "missing" | "skipped_version_mismatch" | "unchanged";
}

export interface HostedExecutionDeviceSyncRuntimeApplyResponse {
  appliedAt: string;
  updates: HostedExecutionDeviceSyncRuntimeApplyEntry[];
  userId: string;
}

export interface HostedExecutionDeviceSyncDirtyResource {
  count: number;
  dirtyPayloadId?: string;
  jobKind: string;
  payload?: Record<string, boolean | number | string>;
  resource: string | null;
  resourceCategory: string | null;
  sourceProviderSlug: string | null;
  windowEnd: string | null;
  windowStart: string | null;
}

const CREDENTIAL_INDEPENDENT_DELETE_PROVIDERS = new Set([
  "oura",
  "strava",
  "whoop",
]);

export type DeviceSyncCredentialIndependentImportJobClassifier = (input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}) => boolean;

/**
 * Returns true only when the provider executor can reach a canonical import
 * without using the connection's replaceable provider credentials.
 */
export function isDeviceSyncCredentialIndependentImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  provider?: string | null;
}, classifyProviderJob?: DeviceSyncCredentialIndependentImportJobClassifier): boolean {
  if (
    input.kind === "delete"
    && typeof input.provider === "string"
    && CREDENTIAL_INDEPENDENT_DELETE_PROVIDERS.has(input.provider)
  ) {
    return true;
  }

  if (input.provider !== "junction" || input.kind !== "resource") {
    return false;
  }

  const resource = input.payload?.resource;
  if (
    resource === COMPANION_HRV_RMSSD_RESOURCE
    || resource === JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE
  ) {
    return true;
  }

  return classifyProviderJob?.({
    kind: input.kind,
    payload: input.payload,
  }) === true;
}

export function serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const isCompanionHealthMetadata =
    payload?.eventType === JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE
    && payload.resource === JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE
    && payload.resourceCategory === "summary"
    && payload.sourceProviderSlug === JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER;
  const stablePayload = Object.fromEntries(
    Object.entries(payload ?? {})
      .filter(([key]) =>
        key !== "windowEnd"
        && key !== "windowStart"
        && !(isCompanionHealthMetadata && key === "occurredAt")
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return Object.keys(stablePayload).length > 0
    ? JSON.stringify(stablePayload)
    : null;
}

export interface HostedExecutionDeviceSyncDirtyPendingRequest {
  limit?: number | null;
  stagedDirtyAcks?: HostedExecutionDeviceSyncStagedDirtyAck[];
  userId: string;
}

export interface HostedExecutionDeviceSyncStagedDirtyAck {
  connectionId: string;
  processedDirtyPayloadIds?: string[];
  processedRevision: string;
}

export interface HostedExecutionDeviceSyncDirtyStateResponse {
  connectionId: string;
  dirtyRevision: string;
  dirtyResources: HostedExecutionDeviceSyncDirtyResource[];
  eventCount: string;
  latestDirtyAt: string;
  processedRevision: string;
  provider: string;
  resourceCategoryCounts: Record<string, number>;
  sourceProviderCounts: Record<string, number>;
  userId: string;
  windowEnd: string | null;
  windowStart: string | null;
}

export interface HostedExecutionDeviceSyncDirtyPendingResponse {
  hasMore: boolean;
  items: HostedExecutionDeviceSyncDirtyStateResponse[];
  nextWakeAt: string | null;
  userId: string;
}

export interface HostedExecutionDeviceSyncDirtyAckRequest {
  connectionId: string;
  processedDirtyPayloadIds?: string[];
  processedRevision: string;
  stagedDirtyAcks?: HostedExecutionDeviceSyncStagedDirtyAck[];
  userId: string;
}

export interface HostedExecutionDeviceSyncDirtyAckResponse {
  connectionId: string;
  dirtyRevision: string | null;
  nextWakeAt: string | null;
  processedRevision: string | null;
  recorded: boolean;
  stillDirty: boolean;
  userId: string;
}

export function findHostedExecutionDeviceSyncRuntimeApplyEntry(
  response: HostedExecutionDeviceSyncRuntimeApplyResponse,
  connectionId: string,
): HostedExecutionDeviceSyncRuntimeApplyEntry | null {
  return response.updates.find((entry) => entry.connectionId === connectionId) ?? null;
}

export function didHostedExecutionDeviceSyncRuntimeApplyConnectionWrite(
  entry: Pick<HostedExecutionDeviceSyncRuntimeApplyEntry, "writeUpdate"> | null,
): boolean {
  return entry?.writeUpdate === "applied";
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

export interface HostedExecutionDeviceSyncWakeEventLike {
  connectionId?: string | null;
  expectedConnectedAt?: string;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  provider?: string | null;
}

type HostedExecutionDeviceSyncHintPayloadFieldKind = "boolean" | "isoTimestamp" | "number" | "string";

// Keep this generic wake-hint seam aligned with the current manifest-owned hosted-hint fields
// until hosted wake parsing becomes provider-aware at this boundary.
const HOSTED_EXECUTION_DEVICE_SYNC_HINT_PAYLOAD_FIELD_KINDS: Readonly<
  Record<string, HostedExecutionDeviceSyncHintPayloadFieldKind>
> = Object.freeze({
  dataType: "string",
  emptyBackfillAttempts: "number",
  eventType: "string",
  historicalBackfill: "boolean",
  historicalProviderRecordsSeen: "boolean",
  historicalRecordsSeen: "boolean",
  historicalUnresolvedProviderRecordCount: "number",
  historicalWindowStart: "isoTimestamp",
  includePersonalInfo: "boolean",
  includeProfile: "boolean",
  objectId: "string",
  occurredAt: "isoTimestamp",
  resource: "string",
  resourceCategory: "string",
  resourceId: "string",
  resourceType: "string",
  sourceEventType: "string",
  sourceProviderSlug: "string",
  timeseriesCursor: "isoTimestamp",
  webhookDataJson: "string",
  windowEnd: "isoTimestamp",
  windowStart: "isoTimestamp",
});

export function buildHostedExecutionDeviceSyncConnectLinkPath(connectTarget: string): string {
  return `/api/internal/device-sync/connect-targets/${encodeURIComponent(connectTarget)}/connect-link`;
}

export function parseHostedExecutionDeviceSyncConnectLinkResponse(
  value: unknown,
): HostedExecutionDeviceSyncConnectLinkResponse {
  const record = requireObject(value, "Hosted device-sync connect link response");
  const authorizationUrl = typeof record.authorizationUrl === "string"
    ? record.authorizationUrl
    : null;
  const connectUrl = typeof record.connectUrl === "string"
    ? record.connectUrl
    : authorizationUrl;

  return {
    authorizationUrl: requireString(
      authorizationUrl ?? connectUrl,
      "Hosted device-sync connect link response authorizationUrl",
    ),
    connectUrl: requireString(
      connectUrl,
      "Hosted device-sync connect link response connectUrl",
    ),
    expiresAt: requireString(
      record.expiresAt,
      "Hosted device-sync connect link response expiresAt",
    ),
    provider: requireString(record.provider, "Hosted device-sync connect link response provider"),
    providerLabel: requireString(
      record.providerLabel,
      "Hosted device-sync connect link response providerLabel",
    ),
  };
}

export function parseHostedExecutionDeviceSyncReconcileRequest(
  value: unknown,
): HostedExecutionDeviceSyncReconcileRequest {
  const record = requireObject(value, "Hosted device-sync reconcile request");
  assertSupportedFields(
    record,
    "Hosted device-sync reconcile request",
    ["connectionId"],
  );

  return {
    connectionId: requireString(
      record.connectionId,
      "Hosted device-sync reconcile request connectionId",
    ),
  };
}

export function parseHostedExecutionDeviceSyncReconcileResponse(
  value: unknown,
): HostedExecutionDeviceSyncReconcileResponse {
  const record = requireObject(value, "Hosted device-sync reconcile response");
  assertSupportedFields(
    record,
    "Hosted device-sync reconcile response",
    ["connectionId", "occurredAt", "status"],
  );
  if (record.status !== "queued") {
    throw new TypeError("Hosted device-sync reconcile response status must be queued.");
  }

  return {
    connectionId: requireString(
      record.connectionId,
      "Hosted device-sync reconcile response connectionId",
    ),
    occurredAt: requireIsoTimestamp(
      record.occurredAt,
      "Hosted device-sync reconcile response occurredAt",
    ),
    status: "queued",
  };
}

export function parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  const record = requireObject(value, "Hosted device-sync runtime snapshot response");

  return {
    ...(record.capabilities === undefined
      ? {}
      : {
          capabilities: parseHostedExecutionDeviceSyncRuntimeSnapshotCapabilities(
            record.capabilities,
          ),
        }),
    connections: requireArray(
      record.connections,
      "Hosted device-sync runtime snapshot response connections",
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(entry, index)),
    generatedAt: requireString(
      record.generatedAt,
      "Hosted device-sync runtime snapshot response generatedAt",
    ),
    userId: requireString(record.userId, "Hosted device-sync runtime snapshot response userId"),
  };
}

function parseHostedExecutionDeviceSyncRuntimeSnapshotCapabilities(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeSnapshotCapabilities {
  const record = requireObject(value, "Hosted device-sync runtime snapshot response capabilities");

  return {
    ...(record.connectionSourceApply === undefined
      ? {}
      : {
          connectionSourceApply: requireBoolean(
            record.connectionSourceApply,
            "Hosted device-sync runtime snapshot response capabilities.connectionSourceApply",
          ),
        }),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  const record = requireObject(value, "Hosted device-sync runtime snapshot request");

  return {
    ...(record.connectionId === undefined
      ? {}
      : { connectionId: readNullableStringValue(record.connectionId, "Hosted device-sync runtime snapshot request connectionId") }),
    includeCredentialMaterial:
      record.includeCredentialMaterial === undefined
        ? false
        : requireBoolean(
            record.includeCredentialMaterial,
            "Hosted device-sync runtime snapshot request includeCredentialMaterial",
          ),
    ...(record.limit === undefined
      ? {}
      : {
          limit: readNullablePositiveInteger(
            record.limit,
            "Hosted device-sync runtime snapshot request limit",
          ),
        }),
    ...(record.provider === undefined
      ? {}
      : { provider: readNullableStringValue(record.provider, "Hosted device-sync runtime snapshot request provider") }),
    ...(record.sourceProviderSlug === undefined
      ? {}
      : {
          sourceProviderSlug: readNullableStringValue(
            record.sourceProviderSlug,
            "Hosted device-sync runtime snapshot request sourceProviderSlug",
          ),
        }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeApplyRequest {
  const record = requireObject(value, "Hosted device-sync runtime apply request");
  const updates = requireBoundedArray(
    record.updates,
    "Hosted device-sync runtime apply request updates",
    HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
  ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(entry, index));

  assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(updates);

  return {
    ...(record.occurredAt === undefined
      ? {}
      : {
          occurredAt: readNullableIsoTimestamp(
            record.occurredAt,
            "Hosted device-sync runtime apply request occurredAt",
          ),
        }),
    updates,
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeApplyResponse {
  const record = requireObject(value, "Hosted device-sync runtime apply response");
  const appliedAt = requireString(
    record.appliedAt,
    "Hosted device-sync runtime apply response appliedAt",
  );

  return {
    appliedAt,
    updates: requireBoundedArray(
      record.updates,
      "Hosted device-sync runtime apply response updates",
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeApplyEntry(entry, index)),
    userId: requireString(record.userId, "Hosted device-sync runtime apply response userId"),
  };
}

export function parseHostedExecutionDeviceSyncDirtyPendingRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncDirtyPendingRequest {
  const record = requireObject(value, "Hosted device-sync dirty pending request");
  const stagedDirtyAcks = record.stagedDirtyAcks === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncStagedDirtyAcks(
      record.stagedDirtyAcks,
      "Hosted device-sync dirty pending request stagedDirtyAcks",
    );

  return {
    ...(record.limit === undefined
      ? {}
      : {
          limit: readNullablePositiveInteger(
            record.limit,
            "Hosted device-sync dirty pending request limit",
          ),
        }),
    ...(stagedDirtyAcks === undefined ? {} : { stagedDirtyAcks }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

function parseHostedExecutionDeviceSyncStagedDirtyAcks(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncStagedDirtyAck[] {
  const entries = requireBoundedArray(
    value,
    label,
    HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT,
  );
  const stagedDirtyAcks = entries.map((entry, index) =>
    parseHostedExecutionDeviceSyncStagedDirtyAck(entry, `${label}[${index}]`)
  );
  const payloadIdCount = stagedDirtyAcks.reduce(
    (total, ack) => total + (ack.processedDirtyPayloadIds?.length ?? 0),
    0,
  );

  if (payloadIdCount > HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT) {
    throw new TypeError(
      `${label} processedDirtyPayloadIds must include no more than `
        + `${HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT} total entries.`,
    );
  }

  return stagedDirtyAcks;
}

function requireBoundedArray(value: unknown, label: string, limit: number): unknown[] {
  const array = requireArray(value, label);

  if (array.length > limit) {
    throw new TypeError(`${label} must include no more than ${limit} entries.`);
  }

  return array;
}

function parseHostedExecutionDeviceSyncStagedDirtyAck(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncStagedDirtyAck {
  const record = requireObject(value, label);

  return {
    connectionId: requireString(record.connectionId, `${label}.connectionId`),
    ...(record.processedDirtyPayloadIds === undefined
      ? {}
      : {
          processedDirtyPayloadIds: requireBoundedArray(
            record.processedDirtyPayloadIds,
            `${label}.processedDirtyPayloadIds`,
            HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT,
          ).map((entry, index) =>
            requireString(entry, `${label}.processedDirtyPayloadIds[${index}]`)
          ),
        }),
    processedRevision: requireBigIntString(record.processedRevision, `${label}.processedRevision`),
  };
}

export function parseHostedExecutionDeviceSyncDirtyStateResponse(
  value: unknown,
): HostedExecutionDeviceSyncDirtyStateResponse | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted device-sync dirty state response");

  return {
    connectionId: requireString(record.connectionId, "Hosted device-sync dirty state response connectionId"),
    dirtyRevision: requireBigIntString(record.dirtyRevision, "Hosted device-sync dirty state response dirtyRevision"),
    dirtyResources: requireArray(
      record.dirtyResources,
      "Hosted device-sync dirty state response dirtyResources",
    ).map((entry, index) => parseHostedExecutionDeviceSyncDirtyResource(
      entry,
      `Hosted device-sync dirty state response dirtyResources[${index}]`,
    )),
    eventCount: requireBigIntString(record.eventCount, "Hosted device-sync dirty state response eventCount"),
    latestDirtyAt: requireIsoTimestamp(record.latestDirtyAt, "Hosted device-sync dirty state response latestDirtyAt"),
    processedRevision: requireBigIntString(
      record.processedRevision,
      "Hosted device-sync dirty state response processedRevision",
    ),
    provider: requireString(record.provider, "Hosted device-sync dirty state response provider"),
    resourceCategoryCounts: parseHostedExecutionDeviceSyncDirtyCounters(
      record.resourceCategoryCounts,
      "Hosted device-sync dirty state response resourceCategoryCounts",
    ),
    sourceProviderCounts: parseHostedExecutionDeviceSyncDirtyCounters(
      record.sourceProviderCounts,
      "Hosted device-sync dirty state response sourceProviderCounts",
    ),
    userId: requireString(record.userId, "Hosted device-sync dirty state response userId"),
    windowEnd: readNullableIsoTimestamp(record.windowEnd, "Hosted device-sync dirty state response windowEnd"),
    windowStart: readNullableIsoTimestamp(record.windowStart, "Hosted device-sync dirty state response windowStart"),
  };
}

export function parseHostedExecutionDeviceSyncDirtyPendingResponse(
  value: unknown,
): HostedExecutionDeviceSyncDirtyPendingResponse {
  const record = requireObject(value, "Hosted device-sync dirty pending response");

  return {
    hasMore: requireBoolean(
      record.hasMore,
      "Hosted device-sync dirty pending response hasMore",
    ),
    items: requireArray(
      record.items,
      "Hosted device-sync dirty pending response items",
    ).map((entry, index) => {
      const parsed = parseHostedExecutionDeviceSyncDirtyStateResponse(entry);
      if (!parsed) {
        throw new TypeError(
          `Hosted device-sync dirty pending response items[${index}] must not be null.`,
        );
      }
      return parsed;
    }),
    nextWakeAt: readNullableIsoTimestamp(
      record.nextWakeAt,
      "Hosted device-sync dirty pending response nextWakeAt",
    ),
    userId: requireString(record.userId, "Hosted device-sync dirty pending response userId"),
  };
}

export function parseHostedExecutionDeviceSyncDirtyAckRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncDirtyAckRequest {
  const record = requireObject(value, "Hosted device-sync dirty ack request");
  const stagedDirtyAcks = record.stagedDirtyAcks === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncStagedDirtyAcks(
      record.stagedDirtyAcks,
      "Hosted device-sync dirty ack request stagedDirtyAcks",
    );

  return {
    connectionId: requireString(record.connectionId, "Hosted device-sync dirty ack request connectionId"),
    ...(record.processedDirtyPayloadIds === undefined
      ? {}
      : {
          processedDirtyPayloadIds: requireArray(
            record.processedDirtyPayloadIds,
            "Hosted device-sync dirty ack request processedDirtyPayloadIds",
          ).map((entry, index) =>
            requireString(
              entry,
              `Hosted device-sync dirty ack request processedDirtyPayloadIds[${index}]`,
            )
          ),
        }),
    processedRevision: requireBigIntString(
      record.processedRevision,
      "Hosted device-sync dirty ack request processedRevision",
    ),
    ...(stagedDirtyAcks === undefined ? {} : { stagedDirtyAcks }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncDirtyAckResponse(
  value: unknown,
): HostedExecutionDeviceSyncDirtyAckResponse {
  const record = requireObject(value, "Hosted device-sync dirty ack response");

  return {
    connectionId: requireString(record.connectionId, "Hosted device-sync dirty ack response connectionId"),
    dirtyRevision: readNullableBigIntString(
      record.dirtyRevision,
      "Hosted device-sync dirty ack response dirtyRevision",
    ),
    nextWakeAt: readNullableIsoTimestamp(
      record.nextWakeAt,
      "Hosted device-sync dirty ack response nextWakeAt",
    ),
    processedRevision: readNullableBigIntString(
      record.processedRevision,
      "Hosted device-sync dirty ack response processedRevision",
    ),
    recorded: requireBoolean(record.recorded, "Hosted device-sync dirty ack response recorded"),
    stillDirty: requireBoolean(record.stillDirty, "Hosted device-sync dirty ack response stillDirty"),
    userId: requireString(record.userId, "Hosted device-sync dirty ack response userId"),
  };
}

export function resolveHostedDeviceSyncWakeContext(
  event: HostedExecutionDeviceSyncWakeEventLike,
): {
  connectionId: string | null;
  expectedConnectedAt: string | null;
  hint: HostedExecutionDeviceSyncWakeEventLike["hint"];
  provider: string | null;
} {
  return {
    connectionId: event.connectionId ?? null,
    expectedConnectedAt: event.expectedConnectedAt ?? null,
    hint: event.hint ?? null,
    provider: event.provider ?? null,
  };
}

export function normalizeHostedDeviceSyncJobHints(
  value: HostedExecutionDeviceSyncWakeEventLike["hint"],
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

export function parseHostedExecutionDeviceSyncWakeHint(
  value: unknown,
): HostedExecutionDeviceSyncWakeHint | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint");
  const next: HostedExecutionDeviceSyncWakeHint = {};

  if (record.eventType !== undefined) {
    next.eventType = readNullableStringValue(
      record.eventType,
      "Hosted execution device-sync.wake hint eventType",
    );
  }

  if (record.jobs !== undefined) {
    next.jobs = requireArray(
      record.jobs,
      "Hosted execution device-sync.wake hint jobs",
    ).map((entry, index) => parseHostedExecutionDeviceSyncJobHint(entry, index));
  }

  if (record.nextReconcileAt !== undefined) {
    next.nextReconcileAt = readNullableIsoTimestamp(
      record.nextReconcileAt,
      "Hosted execution device-sync.wake hint nextReconcileAt",
    );
  }

  if (record.occurredAt !== undefined) {
    next.occurredAt = readNullableIsoTimestamp(
      record.occurredAt,
      "Hosted execution device-sync.wake hint occurredAt",
    );
  }

  if (record.reason !== undefined) {
    next.reason = readNullableStringValue(
      record.reason,
      "Hosted execution device-sync.wake hint reason",
    );
  }

  if (record.resourceCategory !== undefined) {
    next.resourceCategory = readNullableStringValue(
      record.resourceCategory,
      "Hosted execution device-sync.wake hint resourceCategory",
    );
  }

  if (record.revokeWarning !== undefined) {
    next.revokeWarning = parseHostedExecutionDeviceSyncRevokeWarning(record.revokeWarning);
  }

  if (record.scopes !== undefined) {
    next.scopes = requireStringArray(
      record.scopes,
      "Hosted execution device-sync.wake hint scopes",
    );
  }

  if (record.traceId !== undefined) {
    next.traceId = readNullableStringValue(
      record.traceId,
      "Hosted execution device-sync.wake hint traceId",
    );
  }

  return next;
}

function parseHostedExecutionDeviceSyncJobHint(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncJobHint {
  const record = requireObject(
    value,
    `Hosted execution device-sync.wake hint jobs[${index}]`,
  );
  const next: HostedExecutionDeviceSyncJobHint = {
    kind: requireString(
      record.kind,
      `Hosted execution device-sync.wake hint jobs[${index}].kind`,
    ),
  };

  if (record.availableAt !== undefined) {
    next.availableAt = requireIsoTimestamp(
      record.availableAt,
      `Hosted execution device-sync.wake hint jobs[${index}].availableAt`,
    );
  }

  if (record.dedupeKey !== undefined) {
    next.dedupeKey = readNullableStringValue(
      record.dedupeKey,
      `Hosted execution device-sync.wake hint jobs[${index}].dedupeKey`,
    );
  }

  if (record.maxAttempts !== undefined) {
    next.maxAttempts = requireNumber(
      record.maxAttempts,
      `Hosted execution device-sync.wake hint jobs[${index}].maxAttempts`,
    );
  }

  if (record.payload !== undefined) {
    next.payload = parseHostedExecutionDeviceSyncJobHintPayload(record.payload, index);
  }

  if (record.priority !== undefined) {
    next.priority = requireNumber(
      record.priority,
      `Hosted execution device-sync.wake hint jobs[${index}].priority`,
    );
  }

  return next;
}

function parseHostedExecutionDeviceSyncJobHintPayload(
  value: unknown,
  index: number,
): Record<string, unknown> {
  const label = `Hosted execution device-sync.wake hint jobs[${index}].payload`;
  const record = requireObject(value, label);
  const next: Record<string, unknown> = {};

  for (const [field, rawValue] of Object.entries(record)) {
    const kind = HOSTED_EXECUTION_DEVICE_SYNC_HINT_PAYLOAD_FIELD_KINDS[field];

    if (!kind) {
      throw new TypeError(`${label}.${field} is not supported.`);
    }

    if (kind === "string" && rawValue === "") {
      continue;
    }

    next[field] = parseHostedExecutionDeviceSyncJobHintPayloadField(
      rawValue,
      kind,
      `${label}.${field}`,
    );
  }

  return next;
}

function parseHostedExecutionDeviceSyncJobHintPayloadField(
  value: unknown,
  kind: HostedExecutionDeviceSyncHintPayloadFieldKind,
  label: string,
): boolean | number | string {
  switch (kind) {
    case "boolean":
      return requireBoolean(value, label);
    case "isoTimestamp":
      return requireIsoTimestamp(value, label);
    case "number":
      return requireNumber(value, label);
    case "string":
      return requireString(value, label);
  }
}

function parseHostedExecutionDeviceSyncRevokeWarning(
  value: unknown,
): { code: string; message: string } | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint revokeWarning");

  return {
    code: requireString(
      record.code,
      "Hosted execution device-sync.wake hint revokeWarning.code",
    ),
    message: requireString(
      record.message,
      "Hosted execution device-sync.wake hint revokeWarning.message",
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  const record = requireObject(
    value,
    `Hosted device-sync runtime snapshot response connections[${index}]`,
  );

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `Hosted device-sync runtime snapshot response connections[${index}].connection`,
    ),
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `Hosted device-sync runtime snapshot response connections[${index}].localState`,
    ),
    ...(record.sources === undefined
      ? {}
      : {
          sources: requireArray(
            record.sources,
            `Hosted device-sync runtime snapshot response connections[${index}].sources`,
          ).map((source, sourceIndex) => parseHostedExecutionDeviceSyncRuntimeConnectionSource(
            source,
            `Hosted device-sync runtime snapshot response connections[${index}].sources[${sourceIndex}]`,
          )),
        }),
    ...parseHostedExecutionDeviceSyncRuntimeCredentialSnapshotFields(
      record,
      `Hosted device-sync runtime snapshot response connections[${index}]`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeApplyEntry(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeApplyResponse["updates"][number] {
  const record = requireObject(value, `Hosted device-sync runtime apply response updates[${index}]`);
  const status = requireString(
    record.status,
    `Hosted device-sync runtime apply response updates[${index}].status`,
  );
  const tokenUpdate = requireString(
    record.tokenUpdate,
    `Hosted device-sync runtime apply response updates[${index}].tokenUpdate`,
  );
  const rawWriteUpdate = record.writeUpdate;

  if (status !== "created" && status !== "missing" && status !== "updated") {
    throw new TypeError(`Hosted device-sync runtime apply response updates[${index}].status is invalid.`);
  }

  if (
    tokenUpdate !== "applied"
    && tokenUpdate !== "cleared"
    && tokenUpdate !== "missing"
    && tokenUpdate !== "skipped_version_mismatch"
    && tokenUpdate !== "unchanged"
  ) {
    throw new TypeError(`Hosted device-sync runtime apply response updates[${index}].tokenUpdate is invalid.`);
  }

  const connection = record.connection === null
    ? null
    : parseHostedExecutionDeviceSyncRuntimeConnection(
        record.connection,
        `Hosted device-sync runtime apply response updates[${index}].connection`,
      );
  const writeUpdate = parseHostedExecutionDeviceSyncRuntimeWriteUpdate(rawWriteUpdate, index);

  return {
    connection,
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply response updates[${index}].connectionId`,
    ),
    status,
    tokenUpdate,
    writeUpdate,
  };
}

function parseHostedExecutionDeviceSyncDirtyResource(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncDirtyResource {
  const record = requireObject(value, label);

  return {
    count: requirePositiveInteger(record.count, `${label}.count`),
    ...(record.dirtyPayloadId === undefined
      ? {}
      : {
          dirtyPayloadId: requireString(record.dirtyPayloadId, `${label}.dirtyPayloadId`),
        }),
    jobKind: requireString(record.jobKind, `${label}.jobKind`),
    payload: readHostedExecutionDeviceSyncDirtyPayload(record.payload, `${label}.payload`),
    resource: readNullableStringValue(record.resource, `${label}.resource`),
    resourceCategory: readNullableStringValue(record.resourceCategory, `${label}.resourceCategory`),
    sourceProviderSlug: readNullableStringValue(record.sourceProviderSlug, `${label}.sourceProviderSlug`),
    windowEnd: readNullableIsoTimestamp(record.windowEnd, `${label}.windowEnd`),
    windowStart: readNullableIsoTimestamp(record.windowStart, `${label}.windowStart`),
  };
}

function readHostedExecutionDeviceSyncDirtyPayload(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncDirtyResource["payload"] {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireObject(value, label);
  const payload: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" || typeof entry === "boolean") {
      payload[key] = entry;
      continue;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[key] = entry;
      continue;
    }
    throw new TypeError(`${label}.${key} must be a string, number, or boolean.`);
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function parseHostedExecutionDeviceSyncDirtyCounters(
  value: unknown,
  label: string,
): Record<string, number> {
  const record = requireObject(value, label);
  const counters: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    counters[key] = requireNumber(rawValue, `${label}.${key}`);
  }

  return counters;
}

function parseHostedExecutionDeviceSyncRuntimeWriteUpdate(
  rawWriteUpdate: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeApplyEntry["writeUpdate"] {
  const writeUpdate = requireString(
    rawWriteUpdate,
    `Hosted device-sync runtime apply response updates[${index}].writeUpdate`,
  );

  if (
    writeUpdate !== "applied"
    && writeUpdate !== "missing"
    && writeUpdate !== "skipped_version_mismatch"
    && writeUpdate !== "unchanged"
  ) {
    throw new TypeError(
      `Hosted device-sync runtime apply response updates[${index}].writeUpdate is invalid.`,
    );
  }

  return writeUpdate;
}

function parseHostedExecutionDeviceSyncRuntimeConnection(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot {
  const record = requireObject(value, label);
  const status = requireString(record.status, `${label}.status`);

  if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
    throw new TypeError(`${label}.status is invalid.`);
  }

  return {
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    connectedAt: requireIsoTimestamp(record.connectedAt, `${label}.connectedAt`),
    createdAt: requireIsoTimestamp(record.createdAt, `${label}.createdAt`),
    displayName: readNullableStringValue(record.displayName, `${label}.displayName`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    id: requireString(record.id, `${label}.id`),
    metadata: sanitizeStoredDeviceSyncMetadata(
      requireObject(record.metadata, `${label}.metadata`),
    ),
    provider: requireString(record.provider, `${label}.provider`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    ...(record.setupExpiresAt === undefined
      ? {}
      : { setupExpiresAt: readNullableIsoTimestamp(record.setupExpiresAt, `${label}.setupExpiresAt`) }),
    ...(record.setupPhase === undefined
      ? {}
      : { setupPhase: readNullableHostedExecutionDeviceSyncRuntimeSetupPhase(record.setupPhase, `${label}.setupPhase`) }),
    status,
    ...(record.updatedAt === undefined
      ? {}
      : { updatedAt: readNullableIsoTimestamp(record.updatedAt, `${label}.updatedAt`) ?? undefined }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeLocalState(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeLocalStateSnapshot {
  const record = requireObject(value, label);

  return {
    lastErrorCode: sanitizeHostedRuntimeErrorCode(
      readNullableStringValue(record.lastErrorCode, `${label}.lastErrorCode`),
    ),
    lastErrorMessage: sanitizeHostedRuntimeErrorText(
      readNullableStringValue(record.lastErrorMessage, `${label}.lastErrorMessage`),
    ),
    lastSyncCompletedAt: readNullableIsoTimestamp(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableIsoTimestamp(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastSyncStartedAt: readNullableIsoTimestamp(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastWebhookAt: readNullableIsoTimestamp(record.lastWebhookAt, `${label}.lastWebhookAt`),
    nextReconcileAt: readNullableIsoTimestamp(record.nextReconcileAt, `${label}.nextReconcileAt`),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSource(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot {
  const record = requireObject(value, label);
  const status = requireString(record.status, `${label}.status`);
  const resourceCount = requireNumber(record.resourceCount, `${label}.resourceCount`);

  if (
    status !== "connected"
    && status !== "unavailable"
    && status !== "error"
    && status !== "disconnected"
  ) {
    throw new TypeError(`${label}.status is invalid.`);
  }

  if (!Number.isInteger(resourceCount) || resourceCount < 0) {
    throw new TypeError(`${label}.resourceCount must be a non-negative integer.`);
  }

  return {
    displayName: readNullableStringValue(record.displayName, `${label}.displayName`),
    firstSeenAt: requireIsoTimestamp(record.firstSeenAt, `${label}.firstSeenAt`),
    lastErrorCode: sanitizeHostedRuntimeErrorCode(
      readNullableStringValue(record.lastErrorCode, `${label}.lastErrorCode`),
    ),
    lastErrorMessage: sanitizeHostedRuntimeErrorText(
      readNullableStringValue(record.lastErrorMessage, `${label}.lastErrorMessage`),
    ),
    lastSeenAt: requireIsoTimestamp(record.lastSeenAt, `${label}.lastSeenAt`),
    // Absent means "produced before this field existed", which must stay
    // parseable: a runner-first deploy would otherwise reject every snapshot
    // from the older Web producer and stall device sync until Web caught up.
    // A present-but-malformed value is still rejected.
    lastDataAt: record.lastDataAt === undefined
      ? null
      : readNullableIsoTimestamp(record.lastDataAt, `${label}.lastDataAt`),
    resourceCount,
    ...(record.resourceAvailabilitySummary === undefined
      ? {}
      : {
          resourceAvailabilitySummary:
            parseHostedExecutionDeviceSyncRuntimeSourceAvailabilitySummary(
              record.resourceAvailabilitySummary,
              `${label}.resourceAvailabilitySummary`,
            ),
        }),
    ...(record.sourceInstanceKey === undefined
      ? {}
      : { sourceInstanceKey: requireString(record.sourceInstanceKey, `${label}.sourceInstanceKey`) }),
    sourceProviderSlug: requireString(record.sourceProviderSlug, `${label}.sourceProviderSlug`),
    status,
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  const label = `Hosted device-sync runtime apply request updates[${index}]`;
  const record = requireObject(value, label);
  assertSupportedFields(record, label, [
    "connection",
    "connectionId",
    "credential",
    "failureDiagnostic",
    "localState",
    "observedConnectedAt",
    "observedTokenVersion",
    "observedUpdatedAt",
    "seed",
    "sources",
  ]);
  const connection = record.connection === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
        record.connection,
        index,
      );
  const localState = record.localState === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(record.localState, index);
  const failureDiagnostic = record.failureDiagnostic === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeFailureDiagnostic(record.failureDiagnostic, index);
  const observedUpdatedAt = record.observedUpdatedAt === undefined
    ? undefined
    : readNullableIsoTimestamp(
        record.observedUpdatedAt,
        `Hosted device-sync runtime apply request updates[${index}].observedUpdatedAt`,
      );
  const observedConnectedAt = record.observedConnectedAt === undefined
    ? undefined
    : readNullableIsoTimestamp(
        record.observedConnectedAt,
        `Hosted device-sync runtime apply request updates[${index}].observedConnectedAt`,
      );
  const observedTokenVersion = record.observedTokenVersion === undefined
    ? undefined
    : readNullablePositiveInteger(
        record.observedTokenVersion,
        `Hosted device-sync runtime apply request updates[${index}].observedTokenVersion`,
      );
  const seed = record.seed === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeConnectionSeed(record.seed, index);
  const credential = record.credential === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeCredentialUpdate(
        record.credential,
        `Hosted device-sync runtime apply request updates[${index}].credential`,
      );
  const sources = record.sources === undefined
    ? undefined
    : requireArray(
        record.sources,
        `Hosted device-sync runtime apply request updates[${index}].sources`,
      ).map((entry, sourceIndex) =>
        parseHostedExecutionDeviceSyncRuntimeConnectionSourceUpdate(
          entry,
          `Hosted device-sync runtime apply request updates[${index}].sources[${sourceIndex}]`,
        )
      );

  assertHostedExecutionDeviceSyncRuntimeMutationFences({
    connection: connection !== undefined || seed !== undefined,
    credential,
    index,
    localState: localState !== undefined || seed !== undefined,
    observedTokenVersion,
    observedUpdatedAt,
    seed,
  });

  return {
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply request updates[${index}].connectionId`,
    ),
    ...(connection === undefined ? {} : { connection }),
    ...(credential === undefined ? {} : { credential }),
    ...(failureDiagnostic === undefined ? {} : { failureDiagnostic }),
    ...(localState === undefined ? {} : { localState }),
    ...(observedConnectedAt === undefined ? {} : { observedConnectedAt }),
    ...(observedUpdatedAt === undefined ? {} : { observedUpdatedAt }),
    ...(observedTokenVersion === undefined ? {} : { observedTokenVersion }),
    ...(seed === undefined ? {} : { seed }),
    ...(sources === undefined ? {} : { sources }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSourceUpdate(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate {
  const record = requireObject(value, label);
  assertSupportedFields(record, label, [
    "displayName",
    "firstSeenAt",
    "lastDataAt",
    "lastErrorCode",
    "lastErrorMessage",
    "lastSeenAt",
    "observedLastSeenAt",
    "resourceAvailabilitySummary",
    "sourceInstanceKey",
    "sourceProviderSlug",
    "status",
  ]);
  const status = requireString(record.status, `${label}.status`);

  if (
    status !== "connected"
    && status !== "unavailable"
    && status !== "error"
    && status !== "disconnected"
  ) {
    throw new TypeError(`${label}.status is invalid.`);
  }

  const resourceAvailabilitySummary = record.resourceAvailabilitySummary === undefined
    ? undefined
    : parseHostedExecutionDeviceSyncRuntimeSourceAvailabilitySummary(
        record.resourceAvailabilitySummary,
        `${label}.resourceAvailabilitySummary`,
      );

  return {
    observedLastSeenAt: readNullableIsoTimestamp(
      record.observedLastSeenAt,
      `${label}.observedLastSeenAt`,
    ),
    sourceInstanceKey: requireString(record.sourceInstanceKey, `${label}.sourceInstanceKey`),
    sourceProviderSlug: requireString(record.sourceProviderSlug, `${label}.sourceProviderSlug`),
    ...(record.displayName === undefined
      ? {}
      : { displayName: readNullableStringValue(record.displayName, `${label}.displayName`) }),
    status,
    ...(resourceAvailabilitySummary === undefined ? {} : { resourceAvailabilitySummary }),
    ...(record.lastErrorCode === undefined
      ? {}
      : {
          lastErrorCode: sanitizeHostedRuntimeErrorCode(
            readNullableStringValue(record.lastErrorCode, `${label}.lastErrorCode`),
          ),
        }),
    ...(record.lastErrorMessage === undefined
      ? {}
      : {
          lastErrorMessage: sanitizeHostedRuntimeErrorText(
            readNullableStringValue(record.lastErrorMessage, `${label}.lastErrorMessage`),
          ),
        }),
    ...(record.firstSeenAt === undefined
      ? {}
      : { firstSeenAt: readNullableIsoTimestamp(record.firstSeenAt, `${label}.firstSeenAt`) }),
    lastSeenAt: requireIsoTimestamp(record.lastSeenAt, `${label}.lastSeenAt`),
    ...(record.lastDataAt === undefined
      ? {}
      : { lastDataAt: readNullableIsoTimestamp(record.lastDataAt, `${label}.lastDataAt`) }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeSourceAvailabilitySummary(
  value: unknown,
  label: string,
): DeviceConnectionSourceResourceAvailabilitySummary {
  const record = requireObject(value, label);
  const summary: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const [key, rawValue] of Object.entries(record)) {
    if (!isHostedExecutionDeviceSyncRuntimeSourceSummaryKey(key)) {
      throw new TypeError(`${label} contains an invalid resource key.`);
    }

    if (
      typeof rawValue !== "string"
      && typeof rawValue !== "number"
      && typeof rawValue !== "boolean"
      && rawValue !== null
    ) {
      throw new TypeError(`${label}.${key} must be a primitive resource availability value.`);
    }

    if (typeof rawValue === "string" && rawValue.length > 256) {
      throw new TypeError(`${label}.${key} is too long.`);
    }

    summary[key] = rawValue;
  }

  return summary;
}

function parseHostedExecutionDeviceSyncRuntimeFailureDiagnostic(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeFailureDiagnostic {
  const label = `Hosted device-sync runtime apply request updates[${index}].failureDiagnostic`;
  const record = requireObject(value, label);
  assertSupportedFields(record, label, [
    "accountStatus",
    "code",
    "details",
    "retryable",
  ]);
  const code = sanitizeHostedRuntimeErrorCode(requireString(record.code, `${label}.code`));

  if (!code) {
    throw new TypeError(`${label}.code must be a non-empty diagnostic code.`);
  }

  return {
    accountStatus: readNullableHostedExecutionDeviceSyncRuntimeConnectionStatus(
      record.accountStatus,
      `${label}.accountStatus`,
    ),
    code,
    details: parseHostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails(
      record.details,
      `${label}.details`,
    ),
    retryable: requireBoolean(record.retryable, `${label}.retryable`),
  };
}

function parseHostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails {
  if (value === undefined || value === null) {
    return {};
  }

  const record = requireObject(value, label);
  assertSupportedFields(record, label, [
    "failureCauseCode",
    "failureCauseName",
    "failureErrorCause",
    "failureErrorName",
    "providerHttpStatus",
    "providerHttpStatusText",
    "providerRequestAuthKind",
    "providerRequestAuthPlacement",
    "providerRequestBodyFieldCount",
    "providerRequestBodyFieldNames",
    "providerRequestBodyKind",
    "providerRequestContentType",
    "providerRequestCredentialPresent",
    "providerRequestEndpointKind",
    "providerRequestMethod",
    "providerRequestQueryParameterCount",
    "providerRequestQueryParameterNames",
    "providerResponseErrorCode",
    "providerResponseErrorDescription",
    "providerResponseErrorDescriptionFieldPresent",
    "providerResponseErrorFieldPresent",
    "providerResponseShapeKind",
    "providerOAuthErrorCode",
    "providerOAuthErrorDescription",
    "providerOAuthGrantType",
    "providerOAuthRequestBodyBuilderKind",
    "providerOAuthRequestClientAuthPlacement",
    "providerOAuthRequestClientCredentialPresent",
    "providerOAuthRequestClientIdPresent",
    "providerOAuthRequestContentType",
    "providerOAuthRequestDuplicateParameterCount",
    "providerOAuthRequestEncodingKind",
    "providerOAuthRequestHasDuplicateParameters",
    "providerOAuthRequestMethod",
    "providerOAuthRequestOfflineScopePresent",
    "providerOAuthRequestParameterCount",
    "providerOAuthRequestParameterNames",
    "providerOAuthRequestRefreshCredentialPresent",
    "providerOAuthRequestScopeCount",
    "providerOAuthRequestScopePresent",
    "providerOAuthRequestScopeValue",
    "providerOAuthRequestTokenEndpointKind",
    "providerOAuthResponseErrorDescriptionFieldPresent",
    "providerOAuthResponseErrorFieldPresent",
    "providerOAuthResponseShapeKind",
  ]);
  const details: HostedExecutionDeviceSyncRuntimeFailureDiagnosticDetails = {};

  for (const field of [
    "failureCauseCode",
    "failureCauseName",
    "failureErrorName",
    "providerRequestAuthKind",
    "providerRequestAuthPlacement",
    "providerRequestBodyFieldNames",
    "providerRequestBodyKind",
    "providerRequestContentType",
    "providerRequestEndpointKind",
    "providerRequestMethod",
    "providerRequestQueryParameterNames",
    "providerResponseErrorCode",
    "providerResponseShapeKind",
    "providerOAuthErrorCode",
    "providerOAuthGrantType",
    "providerOAuthRequestBodyBuilderKind",
    "providerOAuthRequestClientAuthPlacement",
    "providerOAuthRequestContentType",
    "providerOAuthRequestEncodingKind",
    "providerOAuthRequestMethod",
    "providerOAuthRequestParameterNames",
    "providerOAuthRequestScopeValue",
    "providerOAuthRequestTokenEndpointKind",
    "providerOAuthResponseShapeKind",
  ] as const) {
    if (record[field] !== undefined) {
      const value = sanitizeHostedRuntimeErrorCode(
        readNullableStringValue(record[field], `${label}.${field}`),
      );
      if (
        value
        && (
          (field !== "providerResponseErrorCode" && field !== "providerOAuthErrorCode")
          || !isHostedRuntimeIdShapedDiagnosticToken(value)
        )
      ) {
        details[field] = value;
      }
    }
  }

  for (const field of [
    "failureErrorCause",
    "providerHttpStatusText",
    "providerResponseErrorDescription",
    "providerOAuthErrorDescription",
  ] as const) {
    if (record[field] !== undefined) {
      const value = sanitizeHostedRuntimeDiagnosticText(
        readNullableStringValue(record[field], `${label}.${field}`),
      );
      if (value) {
        details[field] = value;
      }
    }
  }

  if (record.providerHttpStatus !== undefined) {
    details.providerHttpStatus = requireNumber(record.providerHttpStatus, `${label}.providerHttpStatus`);
  }

  for (const field of [
    "providerRequestBodyFieldCount",
    "providerRequestQueryParameterCount",
    "providerOAuthRequestDuplicateParameterCount",
    "providerOAuthRequestParameterCount",
    "providerOAuthRequestScopeCount",
  ] as const) {
    if (record[field] !== undefined && record[field] !== null) {
      details[field] = requireNumber(record[field], `${label}.${field}`);
    }
  }

  for (const field of [
    "providerRequestCredentialPresent",
    "providerResponseErrorDescriptionFieldPresent",
    "providerResponseErrorFieldPresent",
    "providerOAuthRequestClientCredentialPresent",
    "providerOAuthRequestClientIdPresent",
    "providerOAuthRequestHasDuplicateParameters",
    "providerOAuthRequestOfflineScopePresent",
    "providerOAuthRequestRefreshCredentialPresent",
    "providerOAuthRequestScopePresent",
    "providerOAuthResponseErrorDescriptionFieldPresent",
    "providerOAuthResponseErrorFieldPresent",
  ] as const) {
    if (record[field] !== undefined && record[field] !== null) {
      details[field] = requireBoolean(record[field], `${label}.${field}`);
    }
  }

  return details;
}

function assertHostedExecutionDeviceSyncRuntimeMutationFences(input: {
  connection: boolean;
  credential: HostedExecutionDeviceSyncRuntimeCredentialUpdate | undefined;
  index: number;
  localState: boolean;
  observedTokenVersion: number | null | undefined;
  observedUpdatedAt: string | null | undefined;
  seed: HostedExecutionDeviceSyncRuntimeConnectionSeed | undefined;
}): void {
  if ((input.connection || input.localState) && input.observedUpdatedAt === undefined) {
    throw new TypeError(
      `Hosted device-sync runtime apply request updates[${input.index}].observedUpdatedAt is required when connection or localState mutations are present.`,
    );
  }

  const tokenMutationRequiresFence = hostedRuntimeCredentialUpdateRequiresTokenFence(input.credential)
    || hostedRuntimeSeedRequiresTokenFence(input.seed);

  if (tokenMutationRequiresFence && input.observedTokenVersion === undefined) {
    throw new TypeError(
      `Hosted device-sync runtime apply request updates[${input.index}].observedTokenVersion is required when credential mutations are present.`,
    );
  }
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSeed(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionSeed {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].seed`);
  const fields = parseHostedExecutionDeviceSyncRuntimeCredentialSnapshotFields(
    record,
    `Hosted device-sync runtime apply request updates[${index}].seed`,
  );
  const credential = requireHostedExecutionWritableCredentialSnapshot(
    fields.credential,
    `Hosted device-sync runtime apply request updates[${index}].seed.credential`,
  );

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `Hosted device-sync runtime apply request updates[${index}].seed.connection`,
    ),
    credential,
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `Hosted device-sync runtime apply request updates[${index}].seed.localState`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionStateUpdate {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].connection`);
  const next: HostedExecutionDeviceSyncRuntimeConnectionStateUpdate = {};

  if (record.displayName !== undefined) {
    next.displayName = readNullableStringValue(
      record.displayName,
      `Hosted device-sync runtime apply request updates[${index}].connection.displayName`,
    );
  }
  if (record.metadata !== undefined) {
    next.metadata = sanitizeStoredDeviceSyncMetadata(
      requireObject(
        record.metadata,
        `Hosted device-sync runtime apply request updates[${index}].connection.metadata`,
      ),
    );
  }
  if (record.scopes !== undefined) {
    next.scopes = requireStringArray(
      record.scopes,
      `Hosted device-sync runtime apply request updates[${index}].connection.scopes`,
    );
  }
  if (record.setupExpiresAt !== undefined) {
    next.setupExpiresAt = readNullableIsoTimestamp(
      record.setupExpiresAt,
      `Hosted device-sync runtime apply request updates[${index}].connection.setupExpiresAt`,
    );
  }
  if (record.setupPhase !== undefined) {
    next.setupPhase = readNullableHostedExecutionDeviceSyncRuntimeSetupPhase(
      record.setupPhase,
      `Hosted device-sync runtime apply request updates[${index}].connection.setupPhase`,
    );
  }
  if (record.status !== undefined) {
    const status = requireString(
      record.status,
      `Hosted device-sync runtime apply request updates[${index}].connection.status`,
    );

    if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
      throw new TypeError(
        `Hosted device-sync runtime apply request updates[${index}].connection.status is invalid.`,
      );
    }

    next.status = status;
  }

  return next;
}

function parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeLocalStateUpdate {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].localState`);
  const next: HostedExecutionDeviceSyncRuntimeLocalStateUpdate = {};

  if (record.clearError !== undefined) {
    next.clearError = requireBoolean(
      record.clearError,
      `Hosted device-sync runtime apply request updates[${index}].localState.clearError`,
    );
  }

  for (const field of [
    "lastErrorCode",
    "lastErrorMessage",
  ] as const) {
    if (record[field] !== undefined) {
      const value = readNullableStringValue(
        record[field],
        `Hosted device-sync runtime apply request updates[${index}].localState.${field}`,
      );

      next[field] = field === "lastErrorCode"
        ? sanitizeHostedRuntimeErrorCode(value)
        : sanitizeHostedRuntimeErrorText(value);
    }
  }

  for (const field of [
    "lastSyncCompletedAt",
    "lastSyncErrorAt",
    "lastSyncStartedAt",
    "lastWebhookAt",
    "nextReconcileAt",
  ] as const) {
    if (record[field] !== undefined) {
      next[field] = readNullableIsoTimestamp(
        record[field],
        `Hosted device-sync runtime apply request updates[${index}].localState.${field}`,
      );
    }
  }

  return next;
}

function parseHostedExecutionDeviceSyncRuntimeCredentialSnapshotFields(
  record: Record<string, unknown>,
  label: string,
): Pick<HostedExecutionDeviceSyncRuntimeConnectionSnapshot, "credential"> {
  if (record.tokenBundle !== undefined) {
    throw new TypeError(`${label}.tokenBundle is not supported.`);
  }

  if (record.credential === undefined) {
    throw new TypeError(`${label}.credential is required.`);
  }

  return {
    credential: parseHostedExecutionDeviceSyncRuntimeCredentialSnapshot(
      record.credential,
      `${label}.credential`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeCredentialSnapshot(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeCredentialSnapshot {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  switch (kind) {
    case "oauth_tokens":
      assertSupportedFields(record, label, ["kind", "tokenBundle"]);
      return {
        kind,
        tokenBundle: parseHostedExecutionDeviceSyncRuntimeOAuthTokenBundle(
          record.tokenBundle,
          `${label}.tokenBundle`,
        ) ?? rejectNullHostedExecutionCredentialTokenBundle(`${label}.tokenBundle`),
      };
    case "oauth_tokens_redacted":
      assertSupportedFields(record, label, [
        "credentialMetadata",
        "kind",
        "tokenVersion",
      ]);
      return {
        credentialMetadata: parseHostedExecutionDeviceSyncCredentialMetadata(
          record.credentialMetadata,
          `${label}.credentialMetadata`,
        ),
        kind,
        tokenVersion: readNullablePositiveInteger(record.tokenVersion, `${label}.tokenVersion`),
      };
    case "provider_config": {
      assertSupportedFields(record, label, [
        "credentialMetadata",
        "kind",
        "providerConfigKey",
      ]);
      const credentialMetadata = parseHostedExecutionDeviceSyncCredentialMetadata(
        record.credentialMetadata,
        `${label}.credentialMetadata`,
      );
      return {
        credentialMetadata,
        kind,
        providerConfigKey: requireString(record.providerConfigKey, `${label}.providerConfigKey`),
      };
    }
    case "none":
      assertSupportedFields(record, label, ["credentialMetadata", "kind"]);
      return {
        credentialMetadata: parseHostedExecutionDeviceSyncCredentialMetadata(
          record.credentialMetadata,
          `${label}.credentialMetadata`,
        ),
        kind,
      };
    default:
      throw new TypeError(`${label}.kind is invalid.`);
  }
}

function parseHostedExecutionDeviceSyncRuntimeCredentialUpdate(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeCredentialUpdate {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind === "oauth_tokens" && record.clearTokens === true) {
    assertSupportedFields(record, label, ["clearTokens", "kind"]);
    return {
      clearTokens: true,
      kind,
    };
  }

  return requireHostedExecutionWritableCredentialSnapshot(
    parseHostedExecutionDeviceSyncRuntimeCredentialSnapshot(value, label),
    label,
  );
}

function rejectNullHostedExecutionCredentialTokenBundle(label: string): never {
  throw new TypeError(`${label} must be an object.`);
}

function requireHostedExecutionWritableCredentialSnapshot(
  credential: HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  label: string,
): HostedExecutionDeviceSyncRuntimeWritableCredentialSnapshot {
  if (credential.kind === "oauth_tokens_redacted") {
    throw new TypeError(`${label}.kind is not supported for credential mutations.`);
  }

  return credential;
}

function assertSupportedFields(
  record: Record<string, unknown>,
  label: string,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(allowedFields);

  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw new TypeError(`${label}.${field} is not supported.`);
    }
  }
}

function parseHostedExecutionDeviceSyncCredentialMetadata(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
    requireObject(value, label),
  );
}

function isBlockedHostedDeviceSyncCredentialMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  return HOSTED_DEVICE_SYNC_CREDENTIAL_METADATA_BLOCKED_KEY_SUBSTRINGS.some((token) =>
    normalized.includes(token),
  ) || isBlockedHostedDeviceSyncCredentialMetadataIdentifierKey(normalized);
}

function isBlockedHostedDeviceSyncCredentialMetadataIdentifierKey(normalized: string): boolean {
  if (normalized.includes("hash") || normalized.includes("blindindex")) {
    return false;
  }

  return normalized === "owner"
    || normalized === "user"
    || normalized === "client"
    || normalized.includes("ownerid")
    || normalized.includes("userid")
    || normalized.includes("clientuserid");
}

function isBlockedHostedDeviceSyncCredentialMetadataValue(key: string, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (HOSTED_DEVICE_SYNC_CREDENTIAL_METADATA_SECRET_VALUE_PATTERN.test(value)) {
    return true;
  }

  if (isAllowedHostedDeviceSyncCredentialMetadataDigestKey(key)) {
    return false;
  }

  return isOpaqueHostedDeviceSyncCredentialMetadataSecretValue(value);
}

function isAllowedHostedDeviceSyncCredentialMetadataDigestKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return normalized.includes("hash") || normalized.includes("blindindex");
}

function isOpaqueHostedDeviceSyncCredentialMetadataSecretValue(value: string): boolean {
  const normalized = value.trim();

  if (normalized.length < 32) {
    return false;
  }

  return /^[A-Za-z0-9._~+/=-]+$/u.test(normalized)
    && /[A-Za-z]/u.test(normalized)
    && /[0-9]/u.test(normalized);
}

function hostedRuntimeCredentialUpdateRequiresTokenFence(
  credential: HostedExecutionDeviceSyncRuntimeCredentialUpdate | undefined,
): boolean {
  return credential !== undefined;
}

function hostedRuntimeSeedRequiresTokenFence(
  seed: HostedExecutionDeviceSyncRuntimeConnectionSeed | undefined,
): boolean {
  return seed !== undefined;
}

function parseHostedExecutionDeviceSyncRuntimeOAuthTokenBundle(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeTokenBundle | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, label);
  const tokenVersion = requirePositiveInteger(record.tokenVersion, `${label}.tokenVersion`);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableStringValue(record.refreshToken, `${label}.refreshToken`),
    tokenVersion,
  };
}

function assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionUpdate[],
): void {
  const seen = new Set<string>();

  for (const update of updates) {
    if (seen.has(update.connectionId)) {
      throw new TypeError(
        `Hosted device-sync runtime apply request updates contain duplicate connectionId ${update.connectionId}.`,
      );
    }

    seen.add(update.connectionId);
  }
}

function resolveHostedDeviceSyncRuntimeRequestUserId(
  value: unknown,
  trustedUserId: string | null,
): string {
  if (trustedUserId) {
    if (value !== undefined && value !== trustedUserId) {
      throw new TypeError("userId must match the authenticated hosted execution user.");
    }

    return trustedUserId;
  }

  return requireString(value, "Hosted device-sync runtime request userId");
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function isHostedExecutionDeviceSyncRuntimeSourceSummaryKey(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function requireStringArray(value: unknown, label: string): string[] {
  const array = requireArray(value, label);
  return array.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireBigIntString(value: unknown, label: string): string {
  const raw = requireString(value, label);
  try {
    const parsed = BigInt(raw);
    if (parsed < 0n) {
      throw new TypeError(`${label} must be a non-negative integer string.`);
    }
    return raw;
  } catch {
    throw new TypeError(`${label} must be a non-negative integer string.`);
  }
}

const ISO_8601_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function readNullableStringValue(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

function readNullableBigIntString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireBigIntString(value, label);
}

function sanitizeHostedRuntimeErrorString(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) {
    return null;
  }

  let sanitized = value
    .replace(HOSTED_RUNTIME_ERROR_AUTH_HEADER_PATTERN, "$1$2[redacted]")
    .replace(HOSTED_RUNTIME_ERROR_CONTROL_CHAR_PATTERN, " ")
    .replace(HOSTED_RUNTIME_ERROR_QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(HOSTED_RUNTIME_ERROR_NAMED_SECRET_PATTERN, "$1$2[redacted]")
    .replace(HOSTED_RUNTIME_ERROR_JWT_PATTERN, "[redacted.jwt]")
    .replace(HOSTED_RUNTIME_ERROR_INLINE_BEARER_PATTERN, "Bearer [redacted]")
    .replace(HOSTED_RUNTIME_ERROR_FILE_URL_PATTERN, "<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_URL_PATTERN, "<redacted-url>")
    .replace(HOSTED_RUNTIME_ERROR_POSIX_PATH_PATTERN, "$1<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_WINDOWS_PATH_PATTERN, "<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_EMAIL_PATTERN, "<redacted-email>")
    .replace(HOSTED_RUNTIME_ERROR_PHONE_PATTERN, "<redacted-phone>")
    .replace(HOSTED_RUNTIME_ERROR_WHITESPACE_PATTERN, " ")
    .trim();

  if (!sanitized) {
    sanitized = "[redacted]";
  }

  return sanitized.length <= maxLength
    ? sanitized
    : `${sanitized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function sanitizeHostedRuntimeErrorCode(value: string | null): string | null {
  return sanitizeHostedRuntimeErrorString(value, HOSTED_RUNTIME_ERROR_CODE_MAX_LENGTH);
}

export function sanitizeHostedRuntimeErrorText(value: string | null): string | null {
  return sanitizeHostedRuntimeErrorString(value, HOSTED_RUNTIME_ERROR_TEXT_MAX_LENGTH);
}

export function isHostedRuntimeIdShapedDiagnosticToken(value: string): boolean {
  const token = value.replace(HOSTED_RUNTIME_DIAGNOSTIC_FORMAT_CHAR_PATTERN, "").trim();
  if (!token) {
    return false;
  }

  const tokenAlphanumericLength = token.replace(/[^A-Za-z0-9]/gu, "").length;

  return (
    matchesEntireHostedRuntimeDiagnosticToken(HOSTED_RUNTIME_DIAGNOSTIC_LONG_TOKEN_PATTERN, token)
    || (
      tokenAlphanumericLength >= 6
      &&
      matchesEntireHostedRuntimeDiagnosticToken(HOSTED_RUNTIME_DIAGNOSTIC_DIGIT_TOKEN_PATTERN, token)
      && !HOSTED_RUNTIME_DIAGNOSTIC_SAFE_DIGIT_TOKEN_PATTERN.test(token)
    )
  );
}

function matchesEntireHostedRuntimeDiagnosticToken(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[0] === value;
}

function findHostedRuntimeDiagnosticStructuredBracketIndex(value: string): number {
  const openBracketIndexes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "[") {
      openBracketIndexes.push(index);
      continue;
    }

    if (char === "]") {
      openBracketIndexes.pop();
      continue;
    }

    if (openBracketIndexes.length > 0 && (char === "=" || char === "," || char === ":")) {
      return openBracketIndexes[0] ?? -1;
    }
  }

  return -1;
}

function findHostedRuntimeDiagnosticUnsafeTailIndex(value: string): number {
  const assignmentIndex = value.search(HOSTED_RUNTIME_DIAGNOSTIC_ASSIGNMENT_TAIL_PATTERN);
  const bracketIndex = findHostedRuntimeDiagnosticStructuredBracketIndex(value);

  if (assignmentIndex === -1) {
    return bracketIndex;
  }

  if (bracketIndex === -1) {
    return assignmentIndex;
  }

  return Math.min(assignmentIndex, bracketIndex);
}

// Keeps safe provider error prose debuggable by failing raw structured dumps
// closed, truncating at unsafe assignment/bracket tails, then masking unsafe
// spans that remain in the prose prefix.
export function sanitizeHostedRuntimeDiagnosticText(value: string | null): string | null {
  const normalizedValue = value?.replace(HOSTED_RUNTIME_DIAGNOSTIC_FORMAT_CHAR_PATTERN, "") ?? null;
  const sanitizedBase = sanitizeHostedRuntimeErrorString(normalizedValue, HOSTED_RUNTIME_ERROR_TEXT_MAX_LENGTH);
  if (
    !sanitizedBase
    || HOSTED_RUNTIME_DIAGNOSTIC_JSON_FRAGMENT_PATTERN.test(sanitizedBase)
  ) {
    return null;
  }

  const unsafeTailIndex = findHostedRuntimeDiagnosticUnsafeTailIndex(sanitizedBase);
  const prosePrefix = (unsafeTailIndex === -1
    ? sanitizedBase
    : sanitizedBase.slice(0, unsafeTailIndex)
  ).replace(/[\s,;]+$/u, "");

  if (!prosePrefix) {
    return null;
  }

  const sanitized = prosePrefix
    .replace(HOSTED_RUNTIME_ERROR_FILE_URL_PATTERN, "<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_POSIX_PATH_PATTERN, "$1<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_WINDOWS_PATH_PATTERN, "<redacted-path>")
    .replace(HOSTED_RUNTIME_ERROR_URL_PATTERN, "<redacted-url>")
    .replace(HOSTED_RUNTIME_ERROR_EMAIL_PATTERN, "<redacted-email>")
    .replace(HOSTED_RUNTIME_ERROR_PHONE_PATTERN, "<redacted-phone>")
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_DIRECT_IDENTIFIER_COLON_ASSIGNMENT_PATTERN, "$1<redacted-id>")
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_IDENTIFIER_COLON_ASSIGNMENT_PATTERN, "$1<redacted-id>")
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_IDENTIFIER_PHRASE_PATTERN, "$1<redacted-id>")
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_IPV4_PATTERN, "<redacted-ip>")
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_DELIMITED_PATTERN, "$1<redacted-token>")
    .replace(
      HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_PATTERN,
      (_match, prefix: string, token: string) => {
        const proseWord = token.replace(/[.!?,;:]+$/u, "");
        return HOSTED_RUNTIME_DIAGNOSTIC_LABELED_TOKEN_SAFE_WORD_PATTERN.test(proseWord)
          ? `${prefix}${token}`
          : `${prefix}<redacted-token>`;
      },
    )
    .replace(
      HOSTED_RUNTIME_DIAGNOSTIC_DIGIT_TOKEN_PATTERN,
      (token) => HOSTED_RUNTIME_DIAGNOSTIC_SAFE_DIGIT_TOKEN_PATTERN.test(token) ? token : "<redacted-token>",
    )
    .replace(HOSTED_RUNTIME_DIAGNOSTIC_LONG_TOKEN_PATTERN, "<redacted-token>")
    .trim();

  if (!sanitized) {
    return null;
  }
  if (HOSTED_RUNTIME_DIAGNOSTIC_UNLABELED_NAME_ACTION_PATTERN.test(sanitized)) {
    return null;
  }
  if (
    HOSTED_RUNTIME_DIAGNOSTIC_BARE_NAME_PATTERN.test(sanitized)
    && !HOSTED_RUNTIME_DIAGNOSTIC_SAFE_BARE_TITLE_PATTERN.test(sanitized)
  ) {
    return null;
  }

  const clamped = sanitized.length <= HOSTED_RUNTIME_DIAGNOSTIC_TEXT_MAX_LENGTH
    ? sanitized
    : `${sanitized.slice(0, HOSTED_RUNTIME_DIAGNOSTIC_TEXT_MAX_LENGTH - 3).trimEnd()}...`;

  return clamped;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return value;
}

function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return requirePositiveInteger(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireIsoTimestamp(value, label);
}

function readNullableHostedExecutionDeviceSyncRuntimeSetupPhase(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeSetupPhase | null {
  if (value === null) {
    return null;
  }

  const phase = requireString(value, label);
  if (
    phase === "pending_link"
    || phase === "link_returned"
    || phase === "source_confirmed"
    || phase === "failed"
  ) {
    return phase;
  }

  throw new TypeError(`${label} is invalid.`);
}

function readNullableHostedExecutionDeviceSyncRuntimeConnectionStatus(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionStatus | null {
  if (value === null) {
    return null;
  }

  const status = requireString(value, label);
  if (status === "active" || status === "reauthorization_required" || status === "disconnected") {
    return status;
  }

  throw new TypeError(`${label} is invalid.`);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const parsed = requireString(value, label);

  if (!ISO_8601_TIMESTAMP_PATTERN.test(parsed)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return new Date(timestamp).toISOString();
}
