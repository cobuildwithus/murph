import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";
import { normalizeNullableString } from "./shared";

const HEARTBEAT_ALLOWED_FIELDS = new Set([
  "lastSyncStartedAt",
  "lastSyncCompletedAt",
  "lastSyncErrorAt",
  "lastErrorCode",
  "lastErrorMessage",
]);

const HEARTBEAT_SERVER_OWNED_FIELDS = new Set(["status", "nextReconcileAt", "clearError"]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_HEARTBEAT_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

export interface HostedLocalHeartbeatPatch {
  lastSyncStartedAt?: string;
  lastSyncCompletedAt?: string;
  lastSyncErrorAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

type HostedLocalHeartbeatState = Pick<
  PublicDeviceSyncAccount,
  "lastSyncStartedAt" | "lastSyncCompletedAt" | "lastSyncErrorAt" | "lastErrorCode" | "lastErrorMessage"
>;

export interface HostedLocalHeartbeatUpdate {
  lastSyncStartedAt?: Date;
  lastSyncCompletedAt?: Date;
  lastSyncErrorAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export function parseHostedLocalHeartbeatPatch(
  body: Record<string, unknown>,
  now: Date = new Date(),
): HostedLocalHeartbeatPatch {
  const unexpectedFields = Object.keys(body).filter((field) => !HEARTBEAT_ALLOWED_FIELDS.has(field));

  if (unexpectedFields.length > 0) {
    const serverOwned = unexpectedFields.filter((field) => HEARTBEAT_SERVER_OWNED_FIELDS.has(field));

    if (serverOwned.length > 0) {
      throw invalidLocalHeartbeat(
        `Local heartbeat may not update server-owned fields: ${serverOwned.join(", ")}.`,
      );
    }

    throw invalidLocalHeartbeat(`Local heartbeat received unsupported fields: ${unexpectedFields.join(", ")}.`);
  }

  const patch: HostedLocalHeartbeatPatch = {};

  if ("lastSyncStartedAt" in body) {
    patch.lastSyncStartedAt = parseHeartbeatTimestamp("lastSyncStartedAt", body.lastSyncStartedAt, now);
  }

  if ("lastSyncCompletedAt" in body) {
    patch.lastSyncCompletedAt = parseHeartbeatTimestamp("lastSyncCompletedAt", body.lastSyncCompletedAt, now);
  }

  if ("lastSyncErrorAt" in body) {
    patch.lastSyncErrorAt = parseHeartbeatTimestamp("lastSyncErrorAt", body.lastSyncErrorAt, now);
  }

  if ("lastErrorCode" in body) {
    patch.lastErrorCode = parseHeartbeatString("lastErrorCode", body.lastErrorCode, MAX_ERROR_CODE_LENGTH);
  }

  if ("lastErrorMessage" in body) {
    patch.lastErrorMessage = parseHeartbeatString("lastErrorMessage", body.lastErrorMessage, MAX_ERROR_MESSAGE_LENGTH);
  }

  if ((patch.lastErrorCode !== undefined || patch.lastErrorMessage !== undefined) && patch.lastSyncErrorAt === undefined) {
    throw invalidLocalHeartbeat("Local heartbeat error details require lastSyncErrorAt in the same request.");
  }

  return patch;
}

export function buildHostedLocalHeartbeatUpdate(
  existing: HostedLocalHeartbeatState,
  patch: HostedLocalHeartbeatPatch,
): HostedLocalHeartbeatUpdate {
  const nextStartedMs = patch.lastSyncStartedAt ? Date.parse(patch.lastSyncStartedAt) : null;
  const nextCompletedMs = patch.lastSyncCompletedAt ? Date.parse(patch.lastSyncCompletedAt) : null;
  const nextErrorMs = patch.lastSyncErrorAt ? Date.parse(patch.lastSyncErrorAt) : null;
  const currentStartedMs = parseMaybeTimestamp(existing.lastSyncStartedAt);
  const currentCompletedMs = parseMaybeTimestamp(existing.lastSyncCompletedAt);
  const currentErrorMs = parseMaybeTimestamp(existing.lastSyncErrorAt);

  assertNonRegressiveTimestamp("lastSyncStartedAt", nextStartedMs, currentStartedMs);
  assertNonRegressiveTimestamp("lastSyncCompletedAt", nextCompletedMs, currentCompletedMs);
  assertNonRegressiveTimestamp("lastSyncErrorAt", nextErrorMs, currentErrorMs);

  const effectiveStartedMs = nextStartedMs ?? currentStartedMs;

  if (nextCompletedMs !== null && effectiveStartedMs !== null && nextCompletedMs < effectiveStartedMs) {
    throw invalidLocalHeartbeat("Local heartbeat lastSyncCompletedAt may not be earlier than lastSyncStartedAt.");
  }

  if (nextErrorMs !== null && effectiveStartedMs !== null && nextErrorMs < effectiveStartedMs) {
    throw invalidLocalHeartbeat("Local heartbeat lastSyncErrorAt may not be earlier than lastSyncStartedAt.");
  }

  const update: HostedLocalHeartbeatUpdate = {};

  if (patch.lastSyncStartedAt !== undefined) {
    update.lastSyncStartedAt = new Date(patch.lastSyncStartedAt);
  }

  if (patch.lastSyncCompletedAt !== undefined) {
    update.lastSyncCompletedAt = new Date(patch.lastSyncCompletedAt);
  }

  if (patch.lastSyncErrorAt !== undefined) {
    update.lastSyncErrorAt = new Date(patch.lastSyncErrorAt);
  }

  if (patch.lastErrorCode !== undefined) {
    update.lastErrorCode = patch.lastErrorCode;
  }

  if (patch.lastErrorMessage !== undefined) {
    update.lastErrorMessage = patch.lastErrorMessage;
  }

  return update;
}

function parseHeartbeatTimestamp(field: string, value: unknown, now: Date): string {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);

  if (!normalized) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} must be a non-empty ISO 8601 timestamp string.`);
  }

  if (!ISO_TIMESTAMP_PATTERN.test(normalized)) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} must include an explicit ISO 8601 timezone.`);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} must be a valid ISO 8601 timestamp.`);
  }

  if (parsed.getTime() > now.getTime() + MAX_HEARTBEAT_FUTURE_SKEW_MS) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} may not be more than 5 minutes in the future.`);
  }

  return parsed.toISOString();
}

function parseHeartbeatString(field: string, value: unknown, maxLength: number): string {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);

  if (!normalized) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} must be a non-empty string.`);
  }

  if (normalized.length > maxLength) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} exceeded the ${maxLength}-character limit.`);
  }

  return normalized;
}

function parseMaybeTimestamp(value: string | null | undefined): number | null {
  return value ? Date.parse(value) : null;
}

function assertNonRegressiveTimestamp(field: string, nextMs: number | null, currentMs: number | null): void {
  if (nextMs !== null && currentMs !== null && nextMs < currentMs) {
    throw invalidLocalHeartbeat(`Local heartbeat field ${field} may not move backward.`);
  }
}

function invalidLocalHeartbeat(message: string) {
  return deviceSyncError({
    code: "INVALID_LOCAL_HEARTBEAT",
    message,
    retryable: false,
    httpStatus: 400,
  });
}
