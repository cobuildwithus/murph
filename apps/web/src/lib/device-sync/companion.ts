import "server-only";

import {
  parseCompanionHrvRmssdObservation,
  type CompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { normalizeJunctionProviderSlug } from "@murphai/device-syncd/connect-config";
import { isEstablishedDeviceSyncConnection } from "@murphai/device-syncd/public-account";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
  JunctionCompanionHealthMetadataParseError,
  normalizeJunctionResourceName,
  parseJunctionCompanionHealthMetadataBatch,
  readJunctionWebhookResourceName,
  type JunctionCompanionHealthMetadataBatch,
  type JunctionCompanionHealthMetadataKind,
  type JunctionCompanionHealthMetadataRecord,
} from "@murphai/device-syncd/junction-resources";

import type {
  HostedDeviceSyncDirtyResource,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import { isAvailableConnectionSourceResource } from "./browser-connection-source";

/** The companion app's only device-sync provider. */
export const COMPANION_DEVICE_SYNC_PROVIDER = "junction";

const COMPANION_METADATA_STRING_MAX_LENGTH = 200;
const COMPANION_SDK_VERSION_MAX_ENTRIES = 10;
const COMPANION_HEALTH_METADATA_JUNCTION_SOURCE_PROVIDER =
  normalizeJunctionProviderSlug(JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER);

export const COMPANION_HEALTH_METADATA_RESOURCE = JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE;
export const COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES =
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES;

export type CompanionHealthMetadataKind = JunctionCompanionHealthMetadataKind;
export type CompanionHealthMetadataRecord = JunctionCompanionHealthMetadataRecord;
export type CompanionHealthMetadataBatch = JunctionCompanionHealthMetadataBatch;
const COMPANION_HRV_MAXIMUM_AGE_MS = 24 * 60 * 60 * 1_000;
const COMPANION_HRV_MAXIMUM_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const COMPANION_AUTH_DIAGNOSTIC_VERSION_PATTERN = /^[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}$/u;
const COMPANION_AUTH_DIAGNOSTIC_PROVIDER_CODES = new Set([
  "authentication_failure",
  "bad_email",
  "bad_request",
  "custom_auth_provider_returned_no_token",
  "email_not_found",
  "embedded_wallet_failure",
  "expired_code",
  "failure_during_authentication",
  "forbidden",
  "incorrect_credentials_custom_access_token",
  "incorrect_credentials_email",
  "incorrect_credentials_oauth",
  "incorrect_credentials_passkey",
  "incorrect_credentials_phone",
  "incorrect_credentials_siwe",
  "incorrect_credentials_siws",
  "incorrect_credentials_unknown",
  "initialization_failed",
  "invalid_code",
  "invalid_email",
  "invalid_jwt",
  "invalid_native_app_id",
  "invalid_native_app_identifier",
  "invalid_native_client",
  "invalid_phone",
  "invalid_request",
  "no_custom_auth_provider_configured",
  "not_found",
  "not_logged_in",
  "passkey_authentication_failed",
  "passkey_creation_failed",
  "passkey_no_credentials",
  "passkey_user_cancelled",
  "phone_not_found",
  "rate_limit_exceeded",
  "rate_limited",
  "service_unavailable",
  "timeout",
  "too_many_requests",
  "unauthorized",
  "unavailable",
]);
const COMPANION_AUTH_DIAGNOSTIC_ALLOWED_KEYS = new Set([
  "appVersion",
  "diagnosticCode",
  "errorKind",
  "httpStatus",
  "method",
  "providerErrorCode",
  "retryable",
  "stage",
]);

const COMPANION_AUTH_DIAGNOSTIC_STAGES = new Set([
  "confirm_code",
  "send_code",
]);
const COMPANION_AUTH_DIAGNOSTIC_METHODS = new Set(["email", "sms"]);
const COMPANION_AUTH_DIAGNOSTIC_ERROR_KINDS = new Set([
  "configuration",
  "network",
  "provider",
  "rate_limited",
  "unavailable",
  "unknown",
]);
const COMPANION_AUTH_DIAGNOSTIC_CODE_DESCRIPTIONS = {
  network_lost: "Network connection was lost.",
  network_offline: "Network appears offline.",
  network_timeout: "Network request timed out.",
  network_unknown: "Network request failed.",
  privy_bad_email: "Privy rejected the email address.",
  privy_bad_request: "Privy rejected the auth request.",
  privy_authentication_failed: "Privy authentication failed.",
  privy_could_not_construct_request: "Privy request construction failed.",
  privy_decoding_error: "Privy response decoding failed.",
  privy_expired_code: "Privy OTP expired.",
  privy_forbidden: "Privy rejected the request as forbidden.",
  privy_invalid_code: "Privy rejected the OTP code.",
  privy_invalid_email: "Privy rejected the email address.",
  privy_invalid_native_app_id: "Privy rejected the native app configuration.",
  privy_invalid_phone: "Privy rejected the phone number.",
  privy_initialization_failed: "Privy initialization failed.",
  privy_malformed_response: "Privy returned a malformed response.",
  privy_network_error: "Privy request failed at the network layer.",
  privy_not_found: "Privy resource was not found.",
  privy_rate_limited: "Privy rate limited the auth request.",
  privy_service_unavailable: "Privy service was unavailable.",
  privy_timeout: "Privy request timed out.",
  privy_unauthorized: "Privy rejected the request as unauthorized.",
  privy_unknown: "Privy auth request failed.",
} as const;
type CompanionAuthDiagnosticCode = keyof typeof COMPANION_AUTH_DIAGNOSTIC_CODE_DESCRIPTIONS;

interface CompanionAuthDiagnosticLog {
  diagnosticCode: string;
  diagnosticDescription: string;
  errorKind: string;
  httpStatus: number | null;
  method: string;
  platform: "ios";
  provider: "privy";
  providerErrorCode: string | null;
  retryable: boolean;
  stage: string;
  appVersion: string | null;
}

/**
 * Validates the optional companion sign-in request metadata and discards it.
 *
 * A `companion_installations` record was considered in the MVP spec and is
 * deliberately deferred until operationally needed: the metadata carries no
 * load-bearing behavior today, so we validate the shape for forward
 * compatibility and persist or log nothing from it.
 */
export function validateCompanionSignInRequestBody(body: Record<string, unknown>): void {
  const platform = readOptionalBoundedString(body, "platform");
  if (platform !== null && platform !== "ios") {
    throw companionRequestInvalid("platform must be ios when provided.");
  }
  readOptionalBoundedString(body, "appInstallationId");
  readOptionalBoundedString(body, "appVersion");

  const sdkVersions = body.sdkVersions;
  if (sdkVersions === undefined || sdkVersions === null) {
    return;
  }

  if (typeof sdkVersions !== "object" || Array.isArray(sdkVersions)) {
    throw companionRequestInvalid("sdkVersions must be an object of string values.");
  }

  const entries = Object.entries(sdkVersions as Record<string, unknown>);
  if (entries.length > COMPANION_SDK_VERSION_MAX_ENTRIES) {
    throw companionRequestInvalid("sdkVersions has too many entries.");
  }

  for (const [, value] of entries) {
    if (typeof value !== "string" || value.length > COMPANION_METADATA_STRING_MAX_LENGTH) {
      throw companionRequestInvalid("sdkVersions must be an object of string values.");
    }
  }
}

export function parseCompanionHrvRmssdObservationRequestBody(
  body: Record<string, unknown>,
): CompanionHrvRmssdObservation {
  try {
    return parseCompanionHrvRmssdObservation(body);
  } catch {
    throw companionRequestInvalid("HRV observation payload is invalid.");
  }
}

/**
 * Applies the first-admission clock gate after durable replay identity has
 * been checked. Exact retained retries must remain idempotent even when the
 * original observation later becomes stale.
 */
export function assertCompanionHrvRmssdObservationFresh(
  observation: CompanionHrvRmssdObservation,
  options: { now?: Date } = {},
): void {
  const nowMs = (options.now ?? new Date()).getTime();
  const observedAtMs = Date.parse(observation.observedAt);
  const captureEndedAtMs = observedAtMs + observation.durationMs;

  if (
    !Number.isFinite(nowMs)
    || observedAtMs < nowMs - COMPANION_HRV_MAXIMUM_AGE_MS
    || captureEndedAtMs > nowMs + COMPANION_HRV_MAXIMUM_FUTURE_SKEW_MS
  ) {
    throw companionRequestInvalid("HRV observation payload is invalid.");
  }
}

export async function resolveCompanionHrvRmssdConnection(input: {
  connections?: readonly PublicDeviceSyncAccount[];
  memberId: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<{ id: string; provider: string }> {
  const connections = input.connections
    ?? await input.store.listConnectionsForUser(input.memberId);
  const activeConnections = connections.filter(
    (connection) =>
      connection.provider === COMPANION_DEVICE_SYNC_PROVIDER
      && isEstablishedDeviceSyncConnection(connection),
  );

  if (activeConnections.length === 0) {
    throw deviceSyncError({
      code: "COMPANION_HRV_CONNECTION_REQUIRED",
      message: "Finish companion setup before uploading a spot HRV reading.",
      retryable: false,
      httpStatus: 409,
    });
  }
  if (activeConnections.length > 1) {
    throw deviceSyncError({
      code: "COMPANION_HRV_CONNECTION_AMBIGUOUS",
      message: "The companion could not identify one active device-sync connection. Sign in again and retry.",
      retryable: false,
      httpStatus: 409,
    });
  }

  return activeConnections[0]!;
}

/**
 * Parse the companion's deliberately closed HealthKit metadata envelope.
 *
 * Only privacy-safe record hashes and the two WHOOP-keyed scalar values
 * cross this boundary. Arbitrary HealthKit metadata, provider identifiers,
 * metric names, and canonical event fields are not accepted.
 */
export function parseCompanionHealthMetadataBatch(
  body: Record<string, unknown>,
  receivedAt: string,
): CompanionHealthMetadataBatch {
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    throw companionRequestInvalid("receivedAt must be a valid timestamp.");
  }

  try {
    return parseJunctionCompanionHealthMetadataBatch(body, receivedAtMs);
  } catch (error) {
    if (error instanceof JunctionCompanionHealthMetadataParseError) {
      throw companionRequestInvalid(`${error.message}.`);
    }
    throw error;
  }
}

export function buildCompanionHealthMetadataDirtyResource(input: {
  batch: CompanionHealthMetadataBatch;
  occurredAt: string;
}): HostedDeviceSyncDirtyResource {
  return {
    count: input.batch.records.length,
    jobKind: "resource",
    payload: {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: input.occurredAt,
      resource: COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify(input.batch),
    },
    resource: COMPANION_HEALTH_METADATA_RESOURCE,
    resourceCategory: "summary",
    sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
    windowEnd: null,
    windowStart: null,
  };
}

export async function resolveCompanionHealthMetadataConnection(input: {
  memberId: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<{ id: string; provider: string }> {
  const activeConnections = (await input.store.listConnectionsForUser(input.memberId)).filter(
    (connection) =>
      connection.provider === COMPANION_DEVICE_SYNC_PROVIDER
      && connection.status === "active",
  );

  if (activeConnections.length === 0) {
    throw deviceSyncError({
      code: "COMPANION_HEALTH_CONNECTION_REQUIRED",
      message: "Connect Apple Health in the companion before syncing supplemental metadata.",
      retryable: false,
      httpStatus: 409,
    });
  }
  if (activeConnections.length === 1) {
    return activeConnections[0]!;
  }

  const appleHealthConnections: typeof activeConnections = [];
  for (const connection of activeConnections) {
    const sources = await input.store.listConnectionSources(connection.id);
    if (sources.some((source) =>
      source.status === "connected"
      && normalizeJunctionProviderSlug(source.sourceProviderSlug)
        === COMPANION_HEALTH_METADATA_JUNCTION_SOURCE_PROVIDER
    )) {
      appleHealthConnections.push(connection);
    }
  }

  if (appleHealthConnections.length === 1) {
    return appleHealthConnections[0]!;
  }

  throw deviceSyncError({
    code: "COMPANION_HEALTH_CONNECTION_AMBIGUOUS",
    message: "The companion could not identify one active Apple Health connection. Reconnect Apple Health and retry.",
    retryable: false,
    httpStatus: 409,
  });
}

/**
 * Validates pre-login companion auth diagnostics. The allowlisted envelope uses
 * app-owned diagnostic codes and strict provider machine identifiers only: raw
 * provider prose, contacts, credentials, and health fields never cross the
 * server boundary.
 */
export function validateCompanionAuthDiagnosticRequestBody(
  body: Record<string, unknown>,
): CompanionAuthDiagnosticLog {
  rejectUnknownAuthDiagnosticKeys(body);
  const stage = readRequiredEnum(body, "stage", COMPANION_AUTH_DIAGNOSTIC_STAGES);
  const method = readRequiredEnum(body, "method", COMPANION_AUTH_DIAGNOSTIC_METHODS);
  const errorKind = readRequiredEnum(
    body,
    "errorKind",
    COMPANION_AUTH_DIAGNOSTIC_ERROR_KINDS,
  );
  const httpStatus = readOptionalHttpStatus(body, "httpStatus");
  const diagnosticCode = readRequiredAuthDiagnosticCode(body, "diagnosticCode");

  return {
    diagnosticCode,
    diagnosticDescription: COMPANION_AUTH_DIAGNOSTIC_CODE_DESCRIPTIONS[diagnosticCode],
    errorKind,
    httpStatus,
    method,
    platform: "ios",
    provider: "privy",
    providerErrorCode: readOptionalProviderErrorCode(body),
    retryable: readRequiredBoolean(body, "retryable"),
    stage,
    appVersion: readOptionalAuthDiagnosticAppVersion(body),
  };
}

function readOptionalProviderErrorCode(body: Record<string, unknown>): string | null {
  const value = body.providerErrorCode;
  return typeof value === "string" && COMPANION_AUTH_DIAGNOSTIC_PROVIDER_CODES.has(value)
    ? value
    : null;
}

function rejectUnknownAuthDiagnosticKeys(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => !COMPANION_AUTH_DIAGNOSTIC_ALLOWED_KEYS.has(key))) {
    throw companionRequestInvalid("auth diagnostic contains unsupported fields.");
  }
}

function readOptionalAuthDiagnosticAppVersion(body: Record<string, unknown>): string | null {
  const value = body.appVersion;

  return typeof value === "string" && COMPANION_AUTH_DIAGNOSTIC_VERSION_PATTERN.test(value)
    ? value
    : null;
}

export interface CompanionDeviceSyncResourceStatus {
  lastReceivedAt: string | null;
}

export interface CompanionDeviceSyncStatusResponse {
  lastDataReceivedAt: string | null;
  resources: Record<string, CompanionDeviceSyncResourceStatus>;
}

/**
 * Backend-confirmed sync evidence for the member's Junction connection,
 * sourced from existing read models only (no new persisted state):
 *
 * - Per-resource `lastReceivedAt` comes from durable webhook receipt signals
 *   (`device_sync_signal` rows with `kind: "webhook_hint"`, written once per
 *   durably accepted Junction webhook). The Junction resource name is parsed
 *   from the webhook event type (`daily.data.<resource>.*`); lifecycle events
 *   such as `provider.connection.created` carry no resource and are excluded.
 * - `lastDataReceivedAt` is the max of those per-resource receipt times, so it
 *   only reflects actual data webhooks, never connection lifecycle events.
 * - Resource keys additionally include resources Junction reports available
 *   for connected sources (`device_connection_source.resourceAvailabilitySummary`,
 *   projected by the reconcile floor), with `lastReceivedAt: null` until the
 *   first receipt, so the app can render honest "waiting for first data"
 *   states per resource.
 *
 * Known limits, accepted for the MVP status surface: Junction is
 * push-primary, so webhook receipts are the delivery evidence; data imported
 * by the pull floor alone does not advance these timestamps, and receipt
 * evidence is bounded to the most recent webhook signals. No health values
 * are ever included - timestamps and resource names only.
 */
export async function readCompanionDeviceSyncStatus(input: {
  memberId: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<CompanionDeviceSyncStatusResponse> {
  const connections = (await input.store.listConnectionsForUser(input.memberId)).filter(
    (connection) =>
      connection.provider === COMPANION_DEVICE_SYNC_PROVIDER
      && connection.status !== "disconnected",
  );

  const resources: Record<string, CompanionDeviceSyncResourceStatus> = {};

  for (const connection of connections) {
    const sources = await input.store.listConnectionSources(connection.id);

    for (const source of sources) {
      // Only currently connected sources contribute "waiting for first data"
      // resource keys; stale availability on disconnected/errored sources
      // would otherwise advertise resources that cannot arrive.
      if (source.status !== "connected") {
        continue;
      }

      for (const [resource, availability] of Object.entries(source.resourceAvailabilitySummary ?? {})) {
        if (!isAvailableConnectionSourceResource(resource, availability)) {
          continue;
        }

        // Availability summaries carry Junction's raw resource keys (for
        // example `heart_rate`); normalize them with the same alias mapping
        // webhook receipts use so one resource never splits into two entries.
        const resourceName = normalizeJunctionResourceName(resource);
        if (!resourceName) {
          continue;
        }

        resources[resourceName] ??= { lastReceivedAt: null };
      }
    }
  }

  let lastDataReceivedAt: string | null = null;

  if (connections.length > 0) {
    const signals = await input.store.listRecentConnectionWebhookSignals({
      userId: input.memberId,
      connectionIds: connections.map((connection) => connection.id),
    });

    for (const signal of signals) {
      const resource = signal.eventType
        ? readJunctionWebhookResourceName(signal.eventType)
        : null;

      if (!resource) {
        continue;
      }

      const receivedAt = signal.createdAt;
      const entry = (resources[resource] ??= { lastReceivedAt: null });
      entry.lastReceivedAt = maxIsoTimestamp(entry.lastReceivedAt, receivedAt);
      lastDataReceivedAt = maxIsoTimestamp(lastDataReceivedAt, receivedAt);
    }
  }

  return {
    lastDataReceivedAt,
    resources,
  };
}

function maxIsoTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function readOptionalBoundedString(
  body: Record<string, unknown>,
  key: string,
  maxLength = COMPANION_METADATA_STRING_MAX_LENGTH,
): string | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length > maxLength) {
    throw companionRequestInvalid(`${key} must be a short string when provided.`);
  }

  return value;
}

function readRequiredEnum(
  body: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
): string {
  const value = body[key];

  if (typeof value !== "string" || !allowed.has(value)) {
    throw companionRequestInvalid(`${key} is invalid.`);
  }

  return value;
}

function readRequiredAuthDiagnosticCode(
  body: Record<string, unknown>,
  key: string,
): CompanionAuthDiagnosticCode {
  const value = body[key];

  if (typeof value !== "string" || !isCompanionAuthDiagnosticCode(value)) {
    throw companionRequestInvalid(`${key} is invalid.`);
  }

  return value;
}

function isCompanionAuthDiagnosticCode(value: string): value is CompanionAuthDiagnosticCode {
  return Object.prototype.hasOwnProperty.call(
    COMPANION_AUTH_DIAGNOSTIC_CODE_DESCRIPTIONS,
    value,
  );
}

function readRequiredBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];

  if (typeof value !== "boolean") {
    throw companionRequestInvalid(`${key} must be a boolean.`);
  }

  return value;
}

function readOptionalHttpStatus(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    throw companionRequestInvalid(`${key} must be a valid HTTP status.`);
  }

  return value;
}

function companionRequestInvalid(message: string) {
  return deviceSyncError({
    code: "COMPANION_REQUEST_INVALID",
    message,
    retryable: false,
    httpStatus: 400,
  });
}
