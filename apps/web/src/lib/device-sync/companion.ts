import "server-only";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  isHostedRuntimeIdShapedDiagnosticToken,
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedRuntimeErrorCode,
} from "@murphai/device-syncd/hosted-runtime";
import {
  normalizeJunctionResourceName,
  readJunctionWebhookResourceName,
} from "@murphai/device-syncd/junction-resources";

import type { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { isAvailableConnectionSourceResource } from "./browser-connection-source";

/** The companion app's only device-sync provider. */
export const COMPANION_DEVICE_SYNC_PROVIDER = "junction";

const COMPANION_METADATA_STRING_MAX_LENGTH = 200;
const COMPANION_SDK_VERSION_MAX_ENTRIES = 10;
const COMPANION_AUTH_DIAGNOSTIC_MESSAGE_MAX_LENGTH = 500;
const COMPANION_AUTH_DIAGNOSTIC_SAFE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const COMPANION_AUTH_DIAGNOSTIC_VERSION_PATTERN = /^[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}$/u;
const COMPANION_AUTH_DIAGNOSTIC_EMAIL_PATTERN = /[^\s@]+@[^\s@]+/gu;
const COMPANION_AUTH_DIAGNOSTIC_PRIVY_DID_PATTERN = /\bdid:privy:[A-Za-z0-9._:-]+/giu;
const COMPANION_AUTH_DIAGNOSTIC_ALLOWED_KEYS = new Set([
  "appVersion",
  "errorKind",
  "httpStatus",
  "method",
  "providerErrorCode",
  "providerMessage",
  "stage",
]);
const COMPANION_AUTH_DIAGNOSTIC_PHONE_PATTERN =
  /(?<!\d)(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/gu;
const COMPANION_AUTH_DIAGNOSTIC_FORMATTED_PHONE_PATTERN =
  /(?<!\d)\+?\d(?:[().\s-]*\d){7,14}(?!\d)/gu;
const COMPANION_AUTH_DIAGNOSTIC_IPV4_PATTERN =
  /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?!\d)/gu;
const COMPANION_AUTH_DIAGNOSTIC_IPV6_PATTERN =
  /(?<![A-F0-9:])(?:[A-F0-9]{1,4}:){2,}[A-F0-9:]{1,}(?:%[A-Z0-9_.-]+)?(?![A-F0-9:])/giu;
const COMPANION_AUTH_DIAGNOSTIC_OTP_PATTERN = /(?<!\d)\d{4,8}(?!\d)/gu;
const COMPANION_AUTH_DIAGNOSTIC_TOKEN_PATTERN =
  /(?:(?<![A-Za-z0-9_-])(?:[A-Za-z0-9_-]{16,}\.){2}[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-]))/gu;
const COMPANION_AUTH_DIAGNOSTIC_HOST_PATTERN =
  /(?<![A-Za-z0-9-])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}(?::\d{2,5})?(?:\/[^\s"',)]+)?/giu;

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

interface CompanionAuthDiagnosticLog {
  errorKind: string;
  httpStatus: number | null;
  method: string;
  platform: "ios";
  provider: "privy";
  providerErrorCode: string | null;
  redactedProviderMessage: string | null;
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

/**
 * Validates pre-login companion auth diagnostics. The allowlisted envelope has
 * no contact, identity, credential, or health fields. A provider message may
 * contain sensitive text, so it is re-sanitized and logged only as
 * `redactedProviderMessage`.
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

  return {
    errorKind,
    httpStatus,
    method,
    platform: "ios",
    provider: "privy",
    providerErrorCode: readOptionalSafeAuthDiagnosticCode(body, "providerErrorCode"),
    redactedProviderMessage: sanitizeCompanionAuthDiagnosticMessage(
      readOptionalBoundedString(
        body,
        "providerMessage",
        COMPANION_AUTH_DIAGNOSTIC_MESSAGE_MAX_LENGTH * 2,
      ),
    ),
    stage,
    appVersion: readOptionalAuthDiagnosticAppVersion(body),
  };
}

function rejectUnknownAuthDiagnosticKeys(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => !COMPANION_AUTH_DIAGNOSTIC_ALLOWED_KEYS.has(key))) {
    throw companionRequestInvalid("auth diagnostic contains unsupported fields.");
  }
}

function sanitizeCompanionAuthDiagnosticMessage(message: string | null): string | null {
  return sanitizeHostedRuntimeDiagnosticText(message)
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_EMAIL_PATTERN, "<redacted-email>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_PRIVY_DID_PATTERN, "<redacted-user-id>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_TOKEN_PATTERN, "<redacted-secret>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_HOST_PATTERN, "<redacted-url>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_IPV4_PATTERN, "<redacted-ip>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_IPV6_PATTERN, "<redacted-ip>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_PHONE_PATTERN, "<redacted-phone>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_FORMATTED_PHONE_PATTERN, "<redacted-phone>")
    ?.replace(COMPANION_AUTH_DIAGNOSTIC_OTP_PATTERN, "<redacted-code>")
    ?.slice(0, COMPANION_AUTH_DIAGNOSTIC_MESSAGE_MAX_LENGTH)
    ?? null;
}

function readOptionalAuthDiagnosticAppVersion(body: Record<string, unknown>): string | null {
  const value = body.appVersion;

  return typeof value === "string" && COMPANION_AUTH_DIAGNOSTIC_VERSION_PATTERN.test(value)
    ? value
    : null;
}

function readOptionalSafeAuthDiagnosticCode(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = readOptionalPatternString(
    body,
    key,
    COMPANION_AUTH_DIAGNOSTIC_SAFE_CODE_PATTERN,
  );

  if (value === null) {
    return null;
  }

  const sanitizedCode = sanitizeHostedRuntimeErrorCode(value);
  if (
    sanitizedCode !== value
    || isHostedRuntimeIdShapedDiagnosticToken(sanitizedCode)
    || sanitizeCompanionAuthDiagnosticMessage(value) !== value
  ) {
    return null;
  }

  return value;
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

function readOptionalPatternString(
  body: Record<string, unknown>,
  key: string,
  pattern: RegExp,
): string | null {
  const value = readOptionalBoundedString(body, key);

  if (value === null) {
    return null;
  }

  if (!pattern.test(value)) {
    throw companionRequestInvalid(`${key} is invalid.`);
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
