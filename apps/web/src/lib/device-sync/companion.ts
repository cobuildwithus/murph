import "server-only";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import { normalizeJunctionProviderSlug } from "@murphai/device-syncd/connect-config";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
  normalizeJunctionResourceName,
  readJunctionWebhookResourceName,
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
const COMPANION_HEALTH_METADATA_MAX_SYNC_VERSION = Number.MAX_SAFE_INTEGER;
const COMPANION_HEALTH_METADATA_RECORD_ID_PATTERN = /^[a-f0-9]{64}$/u;
const COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const COMPANION_HEALTH_METADATA_JUNCTION_SOURCE_PROVIDER =
  normalizeJunctionProviderSlug(JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER);

export const COMPANION_HEALTH_METADATA_RESOURCE = JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE;
export const COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES =
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES;

export type CompanionHealthMetadataKind = "recovery_score" | "workout_strain";

export interface CompanionHealthMetadataRecord {
  endAt: string;
  kind: CompanionHealthMetadataKind;
  recordId: string;
  startAt: string;
  syncVersion?: number;
  value: number;
}

export interface CompanionHealthMetadataBatch {
  records: CompanionHealthMetadataRecord[];
  schemaVersion: 1;
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

  assertExactObjectKeys(body, ["records", "schemaVersion"], "request");

  if (body.schemaVersion !== JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION) {
    throw companionRequestInvalid("schemaVersion must be 1.");
  }

  if (!Array.isArray(body.records)) {
    throw companionRequestInvalid("records must be an array.");
  }
  if (
    body.records.length < 1
    || body.records.length > JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS
  ) {
    throw companionRequestInvalid(
      `records must contain between 1 and ${JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS} entries.`,
    );
  }

  const seenRecordIds = new Set<string>();
  const records = body.records.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw companionRequestInvalid(`records[${index}] must be an object.`);
    }

    const record = value as Record<string, unknown>;
    assertExactObjectKeys(
      record,
      ["endAt", "kind", "recordId", "startAt", "syncVersion", "value"],
      `records[${index}]`,
    );

    const recordId = record.recordId;
    if (typeof recordId !== "string" || !COMPANION_HEALTH_METADATA_RECORD_ID_PATTERN.test(recordId)) {
      throw companionRequestInvalid(`records[${index}].recordId must be a lowercase SHA-256 digest.`);
    }
    if (seenRecordIds.has(recordId)) {
      throw companionRequestInvalid(`records[${index}].recordId is duplicated.`);
    }
    seenRecordIds.add(recordId);

    const kind = readCompanionHealthMetadataKind(record.kind, index);
    const valueNumber = readCompanionHealthMetadataValue(record.value, kind, index);
    const startAt = readCompanionHealthMetadataTimestamp(record.startAt, `records[${index}].startAt`);
    const endAt = readCompanionHealthMetadataTimestamp(record.endAt, `records[${index}].endAt`);
    const startAtMs = Date.parse(startAt);
    const endAtMs = Date.parse(endAt);
    if (endAtMs <= startAtMs) {
      throw companionRequestInvalid(`records[${index}].endAt must follow startAt.`);
    }
    if (startAtMs < receivedAtMs - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS) {
      throw companionRequestInvalid(`records[${index}].startAt is outside the supported history window.`);
    }
    if (endAtMs > receivedAtMs + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS) {
      throw companionRequestInvalid(`records[${index}].endAt is too far in the future.`);
    }

    const syncVersion = readCompanionHealthMetadataSyncVersion(record.syncVersion, index);
    return {
      endAt,
      kind,
      recordId,
      startAt,
      ...(syncVersion === undefined ? {} : { syncVersion }),
      value: valueNumber,
    } satisfies CompanionHealthMetadataRecord;
  });

  records.sort((left, right) =>
    left.recordId.localeCompare(right.recordId) || left.kind.localeCompare(right.kind)
  );
  const batch = {
    records,
    schemaVersion: 1,
  } satisfies CompanionHealthMetadataBatch;

  if (
    new TextEncoder().encode(JSON.stringify(batch)).byteLength
      > COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES
  ) {
    throw companionRequestInvalid("records exceed the companion metadata payload limit.");
  }

  return batch;
}

export function buildCompanionHealthMetadataDirtyResource(input: {
  batch: CompanionHealthMetadataBatch;
  occurredAt: string;
}): HostedDeviceSyncDirtyResource {
  const windowStart = input.batch.records.reduce(
    (earliest, record) => Date.parse(record.startAt) < Date.parse(earliest) ? record.startAt : earliest,
    input.batch.records[0]!.startAt,
  );
  const windowEnd = input.batch.records.reduce(
    (latest, record) => Date.parse(record.endAt) > Date.parse(latest) ? record.endAt : latest,
    input.batch.records[0]!.endAt,
  );

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
    windowEnd,
    windowStart,
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
    code: appleHealthConnections.length === 0
      ? "COMPANION_HEALTH_CONNECTION_REQUIRED"
      : "COMPANION_HEALTH_CONNECTION_AMBIGUOUS",
    message: appleHealthConnections.length === 0
      ? "Connect Apple Health in the companion before syncing supplemental metadata."
      : "The companion could not identify one active Apple Health connection. Reconnect Apple Health and retry.",
    retryable: false,
    httpStatus: 409,
  });
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

function readOptionalBoundedString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length > COMPANION_METADATA_STRING_MAX_LENGTH) {
    throw companionRequestInvalid(`${key} must be a short string when provided.`);
  }

  return value;
}

function readCompanionHealthMetadataKind(value: unknown, index: number): CompanionHealthMetadataKind {
  if (value === "recovery_score" || value === "workout_strain") {
    return value;
  }

  throw companionRequestInvalid(
    `records[${index}].kind must be recovery_score or workout_strain.`,
  );
}

function readCompanionHealthMetadataValue(
  value: unknown,
  kind: CompanionHealthMetadataKind,
  index: number,
): number {
  const maximum = kind === "recovery_score" ? 100 : 21;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw companionRequestInvalid(
      `records[${index}].value is outside the allowed range for ${kind}.`,
    );
  }
  return value;
}

function readCompanionHealthMetadataTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length > 64
    || !COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw companionRequestInvalid(`${path} must be an ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

function readCompanionHealthMetadataSyncVersion(value: unknown, index: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > COMPANION_HEALTH_METADATA_MAX_SYNC_VERSION
  ) {
    throw companionRequestInvalid(`records[${index}].syncVersion must be a nonnegative safe integer.`);
  }
  return value;
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw companionRequestInvalid(`${path} contains unsupported field ${unexpected}.`);
  }
}

function companionRequestInvalid(message: string) {
  return deviceSyncError({
    code: "COMPANION_REQUEST_INVALID",
    message,
    retryable: false,
    httpStatus: 400,
  });
}
