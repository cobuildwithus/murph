import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import {
  buildJunctionProviderSourceInstanceKey,
  canonicalizeJunctionProviderSlug,
  resolveJunctionDeviceConnectRouteByProviderSlug,
} from "../connect-config.ts";
import { isDeviceSyncSourceDisconnectFenced } from "../public-account.ts";
import {
  generatePrefixedId,
  stringifyJson,
  toIsoTimestamp,
} from "../shared.ts";
import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
  ListDeviceConnectionSourcesInput,
  StoredDeviceConnectionSource,
  UpsertDeviceConnectionSourceInput,
} from "../types.ts";

type SqliteRow = Record<string, unknown>;

interface StoredDeviceConnectionSourceRow {
  id: string;
  connection_id: string;
  source_instance_key: string;
  source_provider_slug: string;
  display_name: string | null;
  status: DeviceConnectionSourceStatus;
  resource_availability_summary_json: string;
  last_error_code: string | null;
  last_error_message: string | null;
  lifecycle_epoch: number;
  first_seen_at: string;
  last_seen_at: string;
  last_data_at: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCE_INSTANCE_KEY_MAX_LENGTH = 128;
const SOURCE_PROVIDER_SLUG_MAX_LENGTH = 80;
const SOURCE_DISPLAY_NAME_MAX_LENGTH = 120;
const SOURCE_ERROR_CODE_MAX_LENGTH = 80;
const SOURCE_ERROR_MESSAGE_MAX_LENGTH = 240;
const SOURCE_AVAILABILITY_MAX_ENTRIES = 64;
const SOURCE_AVAILABILITY_KEY_MAX_LENGTH = 96;
const SOURCE_AVAILABILITY_STRING_MAX_LENGTH = 256;
const SAFE_SOURCE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const SOURCE_AVAILABILITY_BLOCKED_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const SOURCE_AVAILABILITY_BLOCKED_KEY_SUBSTRINGS = [
  "accountid",
  "accesstoken",
  "authorization",
  "apikey",
  "bearer",
  "clientsecret",
  "clientuserid",
  "cookie",
  "deviceid",
  "externalid",
  "hmac",
  "imei",
  "macaddress",
  "ownerid",
  "password",
  "raw",
  "refreshtoken",
  "secret",
  "serial",
  "setcookie",
  "sourceid",
  "token",
  "userid",
];
const SOURCE_STATUS_PRECEDENCE: Record<DeviceConnectionSourceStatus, number> = {
  connected: 0,
  unavailable: 1,
  error: 2,
  disconnected: 3,
};

const CONNECTION_SOURCE_ROW_SELECT = `
  select
    id,
    connection_id,
    source_instance_key,
    source_provider_slug,
    display_name,
    status,
    resource_availability_summary_json,
    last_error_code,
    last_error_message,
    lifecycle_epoch,
    first_seen_at,
    last_seen_at,
    last_data_at,
    created_at,
    updated_at
  from device_connection_source
`;

function hasOwnInputProperty<T extends object>(
  input: T,
  key: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }

  return value;
}

function expectNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, field);
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Expected ${field} to be a positive integer.`);
  }
  return value;
}

function isDeviceConnectionSourceStatus(
  value: unknown,
): value is DeviceConnectionSourceStatus {
  return value === "connected"
    || value === "unavailable"
    || value === "error"
    || value === "disconnected";
}

function expectDeviceConnectionSourceStatus(
  value: unknown,
  field: string,
): DeviceConnectionSourceStatus {
  if (isDeviceConnectionSourceStatus(value)) {
    return value;
  }

  throw new TypeError(`Expected ${field} to be a supported device connection source status.`);
}

function normalizeRequiredBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${field} must not be empty.`);
  }

  if (normalized.length > maxLength) {
    throw new TypeError(`${field} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function normalizeRequiredSourceSlug(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const normalized = normalizeRequiredBoundedString(value, field, maxLength);

  if (!SAFE_SOURCE_SLUG_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a stable opaque lowercase slug.`);
  }

  return normalized;
}

function normalizeNullableBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string or null.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new TypeError(`${field} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function normalizeAvailabilityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isBlockedAvailabilityKey(value: string): boolean {
  if (SOURCE_AVAILABILITY_BLOCKED_KEYS.has(value)) {
    return true;
  }

  const normalized = normalizeAvailabilityKey(value);
  return normalized === "id" || SOURCE_AVAILABILITY_BLOCKED_KEY_SUBSTRINGS.some((token) =>
    normalized.includes(token)
  );
}

function isBlockedAvailabilityString(value: string): boolean {
  const normalized = normalizeAvailabilityKey(value);

  return normalized === "id" || SOURCE_AVAILABILITY_BLOCKED_KEY_SUBSTRINGS.some((token) =>
    normalized.includes(token)
  );
}

function normalizeSourceAvailabilitySummaryValue(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized
        && normalized.length <= SOURCE_AVAILABILITY_STRING_MAX_LENGTH
        && !isBlockedAvailabilityString(normalized)
      ? normalized
      : undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function sanitizeSourceAvailabilitySummary(
  value: unknown,
): DeviceConnectionSourceResourceAvailabilitySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sanitized: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(sanitized).length >= SOURCE_AVAILABILITY_MAX_ENTRIES) {
      break;
    }

    const key = rawKey.trim();
    if (
      !key
      || key.length > SOURCE_AVAILABILITY_KEY_MAX_LENGTH
      || isBlockedAvailabilityKey(key)
    ) {
      continue;
    }

    const normalizedValue = normalizeSourceAvailabilitySummaryValue(rawValue);
    if (normalizedValue === undefined) {
      continue;
    }

    sanitized[key] = normalizedValue;
  }

  return sanitized;
}

function parseStoredSourceAvailabilitySummary(
  value: string,
): DeviceConnectionSourceResourceAvailabilitySummary {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError("device_connection_source.resource_availability_summary_json is not valid JSON.", {
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("device_connection_source.resource_availability_summary_json must be a JSON object.");
  }

  const summary: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const [key, rawValue] of Object.entries(parsed)) {
    if (Object.keys(summary).length >= SOURCE_AVAILABILITY_MAX_ENTRIES) {
      throw new TypeError("device_connection_source.resource_availability_summary_json has too many entries.");
    }

    const normalizedKey = key.trim();
    if (
      !normalizedKey
      || normalizedKey.length > SOURCE_AVAILABILITY_KEY_MAX_LENGTH
      || isBlockedAvailabilityKey(normalizedKey)
    ) {
      throw new TypeError("device_connection_source.resource_availability_summary_json contains a blocked key.");
    }

    const value = normalizeSourceAvailabilitySummaryValue(rawValue);
    if (value === undefined) {
      throw new TypeError(
        "device_connection_source.resource_availability_summary_json must contain only scalar values.",
      );
    }

    summary[normalizedKey] = value;
  }

  return summary;
}

function earliestIsoTimestamp(left: string, right: string): string {
  return Date.parse(right) < Date.parse(left) ? right : left;
}

function latestIsoTimestamp(left: string, right: string): string {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function normalizeSourceStatus(status: unknown): DeviceConnectionSourceStatus {
  return expectDeviceConnectionSourceStatus(status, "device_connection_source.status");
}

function normalizeSourceInput(input: UpsertDeviceConnectionSourceInput) {
  const lastSeenAt = toIsoTimestamp(input.lastSeenAt);
  const requestedFirstSeenAt = toIsoTimestamp(input.firstSeenAt ?? lastSeenAt);
  const firstSeenAt = earliestIsoTimestamp(requestedFirstSeenAt, lastSeenAt);

  return {
    connectionId: normalizeRequiredBoundedString(
      input.connectionId,
      "connectionId",
      SOURCE_INSTANCE_KEY_MAX_LENGTH,
    ),
    sourceInstanceKey: normalizeRequiredSourceSlug(
      input.sourceInstanceKey,
      "sourceInstanceKey",
      SOURCE_INSTANCE_KEY_MAX_LENGTH,
    ),
    sourceProviderSlug: normalizeRequiredSourceSlug(
      input.sourceProviderSlug,
      "sourceProviderSlug",
      SOURCE_PROVIDER_SLUG_MAX_LENGTH,
    ),
    displayName: hasOwnInputProperty(input, "displayName")
      ? normalizeNullableBoundedString(
          input.displayName,
          "displayName",
          SOURCE_DISPLAY_NAME_MAX_LENGTH,
        )
      : undefined,
    status: normalizeSourceStatus(input.status),
    resourceAvailabilitySummaryJson: hasOwnInputProperty(input, "resourceAvailabilitySummary")
      ? stringifyJson(sanitizeSourceAvailabilitySummary(input.resourceAvailabilitySummary))
      : undefined,
    lastErrorCode: hasOwnInputProperty(input, "lastErrorCode")
      ? normalizeNullableBoundedString(
          input.lastErrorCode,
          "lastErrorCode",
          SOURCE_ERROR_CODE_MAX_LENGTH,
        )
      : null,
    lastErrorMessage: hasOwnInputProperty(input, "lastErrorMessage")
      ? normalizeNullableBoundedString(
          input.lastErrorMessage,
          "lastErrorMessage",
          SOURCE_ERROR_MESSAGE_MAX_LENGTH,
        )
      : null,
    lifecycleEpoch: hasOwnInputProperty(input, "lifecycleEpoch")
      ? expectPositiveInteger(input.lifecycleEpoch, "lifecycleEpoch")
      : undefined,
    firstSeenAt,
    lastSeenAt,
    // Undefined means "leave the stored arrival signal alone". Only hosted
    // hydration passes an explicit value; the reconcile projection must never
    // move it, or it would report a dead push carrier as freshly delivering.
    lastDataAt: hasOwnInputProperty(input, "lastDataAt")
      ? input.lastDataAt === null || input.lastDataAt === undefined
        ? null
        : toIsoTimestamp(input.lastDataAt)
      : undefined,
  };
}

function decodeConnectionSourceRow(row: SqliteRow): StoredDeviceConnectionSourceRow {
  return {
    id: expectString(row.id, "device_connection_source.id"),
    connection_id: expectString(row.connection_id, "device_connection_source.connection_id"),
    source_instance_key: expectString(
      row.source_instance_key,
      "device_connection_source.source_instance_key",
    ),
    source_provider_slug: expectString(
      row.source_provider_slug,
      "device_connection_source.source_provider_slug",
    ),
    display_name: expectNullableString(row.display_name, "device_connection_source.display_name"),
    status: expectDeviceConnectionSourceStatus(
      row.status,
      "device_connection_source.status",
    ),
    resource_availability_summary_json: expectString(
      row.resource_availability_summary_json,
      "device_connection_source.resource_availability_summary_json",
    ),
    last_error_code: expectNullableString(
      row.last_error_code,
      "device_connection_source.last_error_code",
    ),
    last_error_message: expectNullableString(
      row.last_error_message,
      "device_connection_source.last_error_message",
    ),
    lifecycle_epoch: expectPositiveInteger(
      row.lifecycle_epoch,
      "device_connection_source.lifecycle_epoch",
    ),
    first_seen_at: expectString(row.first_seen_at, "device_connection_source.first_seen_at"),
    last_seen_at: expectString(row.last_seen_at, "device_connection_source.last_seen_at"),
    last_data_at: expectNullableString(
      row.last_data_at ?? null,
      "device_connection_source.last_data_at",
    ),
    created_at: expectString(row.created_at, "device_connection_source.created_at"),
    updated_at: expectString(row.updated_at, "device_connection_source.updated_at"),
  };
}

function mapConnectionSourceRow(
  row: StoredDeviceConnectionSourceRow,
): StoredDeviceConnectionSource {
  return {
    id: row.id,
    connectionId: row.connection_id,
    sourceInstanceKey: row.source_instance_key,
    sourceProviderSlug: row.source_provider_slug,
    displayName: row.display_name,
    status: row.status,
    resourceAvailabilitySummary: parseStoredSourceAvailabilitySummary(
      row.resource_availability_summary_json,
    ),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    lifecycleEpoch: row.lifecycle_epoch,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastDataAt: row.last_data_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getConnectionSourceByInstanceKey(
  database: DatabaseSync,
  connectionId: string,
  sourceInstanceKey: string,
): StoredDeviceConnectionSource | null {
  const row = database.prepare(`
    ${CONNECTION_SOURCE_ROW_SELECT}
    where connection_id = ?
      and source_instance_key = ?
  `).get(connectionId, sourceInstanceKey);

  return row ? mapConnectionSourceRow(decodeConnectionSourceRow(row)) : null;
}

function readConnectionProvider(database: DatabaseSync, connectionId: string): string | null {
  const row = database.prepare("select provider from device_connection where id = ?")
    .get(connectionId) as { provider?: unknown } | undefined;

  return row ? expectString(row.provider, "device_connection.provider") : null;
}

function listJunctionSourceIdentitySlugs(canonicalProviderSlug: string): string[] {
  const route = resolveJunctionDeviceConnectRouteByProviderSlug(canonicalProviderSlug)?.route;
  return route
    ? [route.sourceProviderSlug, ...(route.sourceProviderSlugAliases ?? [])]
    : [canonicalProviderSlug];
}

function readJunctionSourceIdentityCandidates(
  database: DatabaseSync,
  input: {
    connectionId: string;
    sourceInstanceKey: string;
    sourceProviderSlug: string;
  },
): StoredDeviceConnectionSource[] {
  const slugs = listJunctionSourceIdentitySlugs(input.sourceProviderSlug);
  return database.prepare(`
    ${CONNECTION_SOURCE_ROW_SELECT}
    where connection_id = ?
      and (
        source_provider_slug in (${slugs.map(() => "?").join(", ")})
        or source_instance_key = ?
      )
  `).all(input.connectionId, ...slugs, input.sourceInstanceKey)
    .map((row) => mapConnectionSourceRow(decodeConnectionSourceRow(row)));
}

function mergeJunctionSourceIdentity(
  candidates: readonly StoredDeviceConnectionSource[],
): StoredDeviceConnectionSource | null {
  if (candidates.length === 0) {
    return null;
  }

  const ordered = [...candidates].sort((left, right) =>
    right.lifecycleEpoch - left.lifecycleEpoch
    || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
    || left.id.localeCompare(right.id)
  );
  const identityRow = [...candidates].sort((left, right) =>
    Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt)
    || left.sourceInstanceKey.localeCompare(right.sourceInstanceKey)
    || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    || left.id.localeCompare(right.id)
  )[0]!;
  const lifecycleEpoch = ordered[0]!.lifecycleEpoch;
  const currentLifecycle = ordered.filter((source) => source.lifecycleEpoch === lifecycleEpoch);
  const lifecycleState = currentLifecycle
    .sort((left, right) =>
      SOURCE_STATUS_PRECEDENCE[right.status] - SOURCE_STATUS_PRECEDENCE[left.status]
      || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
      || left.id.localeCompare(right.id)
    )[0]!;
  const lifecycleFence = currentLifecycle
    .filter(isDeviceSyncSourceDisconnectFenced)
    .sort((left, right) =>
      left.lastErrorCode!.localeCompare(right.lastErrorCode!)
      || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
      || left.id.localeCompare(right.id)
    )[0] ?? null;
  let firstSeenAt = identityRow.firstSeenAt;
  let lastSeenAt = identityRow.lastSeenAt;
  let lastDataAt = identityRow.lastDataAt;
  let updatedAt = identityRow.updatedAt;
  let availabilityCount = 0;
  const availability: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const source of ordered) {
    firstSeenAt = earliestIsoTimestamp(firstSeenAt, source.firstSeenAt);
    lastSeenAt = latestIsoTimestamp(lastSeenAt, source.lastSeenAt);
    updatedAt = latestIsoTimestamp(updatedAt, source.updatedAt);
    if (source.lastDataAt !== null) {
      lastDataAt = lastDataAt === null
        ? source.lastDataAt
        : latestIsoTimestamp(lastDataAt, source.lastDataAt);
    }
    for (const [key, value] of Object.entries(source.resourceAvailabilitySummary)) {
      if (!Object.hasOwn(availability, key) && availabilityCount < SOURCE_AVAILABILITY_MAX_ENTRIES) {
        availability[key] = value;
        availabilityCount += 1;
      }
    }
  }

  return {
    ...identityRow,
    displayName: lifecycleState.displayName,
    firstSeenAt,
    lastDataAt,
    lastErrorCode: lifecycleFence?.lastErrorCode ?? lifecycleState.lastErrorCode,
    lastErrorMessage: lifecycleFence?.lastErrorMessage ?? lifecycleState.lastErrorMessage,
    lastSeenAt,
    lifecycleEpoch,
    resourceAvailabilitySummary: availability,
    status: lifecycleState.status,
    updatedAt,
  };
}

export function prepareConnectionSourceWriteInTransaction(
  database: DatabaseSync,
  input: UpsertDeviceConnectionSourceInput,
) {
  const connectionId = normalizeRequiredBoundedString(
    input.connectionId,
    "connectionId",
    SOURCE_INSTANCE_KEY_MAX_LENGTH,
  );
  const connectionProvider = readConnectionProvider(database, connectionId);
  const canonicalProviderSlug = connectionProvider === "junction"
    ? canonicalizeJunctionProviderSlug(input.sourceProviderSlug)
    : null;
  const canonicalSourceInstanceKey = canonicalProviderSlug
    ? buildJunctionProviderSourceInstanceKey({
        connectionId,
        sourceProviderSlug: canonicalProviderSlug,
      })
    : null;
  const requested = normalizeSourceInput(input);
  const exactExisting = getConnectionSourceByInstanceKey(
    database,
    requested.connectionId,
    requested.sourceInstanceKey,
  );
  const established = canonicalProviderSlug !== null
    ? mergeJunctionSourceIdentity(
        readJunctionSourceIdentityCandidates(database, requested),
      )
    : null;
  const ownsCanonicalNewIdentity = !established
    && !exactExisting
    && canonicalProviderSlug !== null
    && canonicalSourceInstanceKey !== null
    && (
      hasOwnInputProperty(input, "lifecycleEpoch")
      || requested.sourceProviderSlug === canonicalProviderSlug
    );
  const ownedInput = established
    ? {
        ...input,
        sourceInstanceKey: established.sourceInstanceKey,
        sourceProviderSlug: established.sourceProviderSlug,
      }
    : ownsCanonicalNewIdentity
      ? {
          ...input,
          sourceInstanceKey: canonicalSourceInstanceKey,
          sourceProviderSlug: canonicalProviderSlug,
        }
      : input;
  const normalized = normalizeSourceInput(ownedInput);
  const existing = established ?? getConnectionSourceByInstanceKey(
      database,
      normalized.connectionId,
      normalized.sourceInstanceKey,
    );
  return { existing, input: ownedInput, normalized };
}

export function upsertConnectionSource(
  database: DatabaseSync,
  input: UpsertDeviceConnectionSourceInput,
  options: {
    fenceActiveWorkOnReconnect?: boolean;
    preserveDisconnected?: boolean;
  } = {},
): StoredDeviceConnectionSource {
  return withImmediateTransaction(database, () => {
    if (
      options.preserveDisconnected
      && readConnectionProvider(database, input.connectionId) === "junction"
    ) {
      const requested = normalizeSourceInput(input);
      const established = mergeJunctionSourceIdentity(
        readJunctionSourceIdentityCandidates(database, requested),
      );
      if (
        established
        && (
          established.status === "disconnected"
          || isDeviceSyncSourceDisconnectFenced(established)
        )
      ) {
        return established;
      }
    }
    const prepared = prepareConnectionSourceWriteInTransaction(database, input);
    if (
      options.preserveDisconnected
      && prepared.existing
      && (
        prepared.existing.status === "disconnected"
        || isDeviceSyncSourceDisconnectFenced(prepared.existing)
      )
    ) {
      return prepared.existing;
    }
    const reconnectStarted = options.fenceActiveWorkOnReconnect === true
      && prepared.existing !== null
      && prepared.existing.status !== "disconnected"
      && prepared.normalized.status === "disconnected";
    const source = upsertPreparedConnectionSourceInTransaction(database, prepared);
    if (reconnectStarted) {
      database.prepare(`
        update device_observation_state
        set local_connection_revision = local_connection_revision + 1,
            updated_at = ?
        where account_id = ?
      `).run(source.lastSeenAt, source.connectionId);
    }
    return source;
  });
}

export function upsertConnectionSourceInTransaction(
  database: DatabaseSync,
  input: UpsertDeviceConnectionSourceInput,
): StoredDeviceConnectionSource {
  return upsertPreparedConnectionSourceInTransaction(
    database,
    prepareConnectionSourceWriteInTransaction(database, input),
  );
}

export function upsertPreparedConnectionSourceInTransaction(
  database: DatabaseSync,
  prepared: ReturnType<typeof prepareConnectionSourceWriteInTransaction>,
  input: UpsertDeviceConnectionSourceInput = prepared.input,
): StoredDeviceConnectionSource {
  const { existing } = prepared;
  const normalized = input === prepared.input
    ? prepared.normalized
    : normalizeSourceInput(input);
  const displayName = normalized.displayName !== undefined
    ? normalized.displayName
    : existing?.displayName ?? null;
  const resourceAvailabilitySummaryJson = normalized.resourceAvailabilitySummaryJson
    ?? stringifyJson(existing?.resourceAvailabilitySummary ?? {});
  const lastErrorCode = hasOwnInputProperty(input, "lastErrorCode")
    ? normalized.lastErrorCode
    : normalized.status === "error"
      ? existing?.lastErrorCode ?? null
      : null;
  const lastErrorMessage = hasOwnInputProperty(input, "lastErrorMessage")
    ? normalized.lastErrorMessage
    : normalized.status === "error"
      ? existing?.lastErrorMessage ?? null
      : null;

  if (existing) {
    const firstSeenAt = input.replaceFirstSeenAt
      ? normalized.firstSeenAt
      : earliestIsoTimestamp(existing.firstSeenAt, normalized.firstSeenAt);

    database.prepare(`
      update device_connection_source
      set source_provider_slug = ?,
          display_name = ?,
          status = ?,
          resource_availability_summary_json = ?,
          last_error_code = ?,
          last_error_message = ?,
          lifecycle_epoch = ?,
          first_seen_at = ?,
          last_seen_at = ?,
          last_data_at = ?,
          updated_at = ?
      where id = ?
    `).run(
      normalized.sourceProviderSlug,
      displayName,
      normalized.status,
      resourceAvailabilitySummaryJson,
      lastErrorCode,
      lastErrorMessage,
      normalized.lifecycleEpoch ?? existing.lifecycleEpoch,
      firstSeenAt,
      normalized.lastSeenAt,
      normalized.lastDataAt === undefined ? existing.lastDataAt : normalized.lastDataAt,
      normalized.lastSeenAt,
      existing.id,
    );

    return getConnectionSourceByInstanceKey(
      database,
      normalized.connectionId,
      normalized.sourceInstanceKey,
    )!;
  }

  const id = generatePrefixedId("dcs");
  database.prepare(`
    insert into device_connection_source (
      id,
      connection_id,
      source_instance_key,
      source_provider_slug,
      display_name,
      status,
      resource_availability_summary_json,
      last_error_code,
      last_error_message,
      lifecycle_epoch,
      first_seen_at,
      last_seen_at,
      last_data_at,
      created_at,
      updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalized.connectionId,
    normalized.sourceInstanceKey,
    normalized.sourceProviderSlug,
    displayName,
    normalized.status,
    resourceAvailabilitySummaryJson,
    lastErrorCode,
    lastErrorMessage,
    normalized.lifecycleEpoch ?? 1,
    normalized.firstSeenAt,
    normalized.lastSeenAt,
    normalized.lastDataAt ?? null,
    normalized.firstSeenAt,
    normalized.lastSeenAt,
  );

  return getConnectionSourceByInstanceKey(
    database,
    normalized.connectionId,
    normalized.sourceInstanceKey,
  )!;
}

/**
 * Records that an inbound payload carried data for this source. Matching is by
 * provider slug because that is what the webhook envelope names; a connection
 * can hold more than one instance of the same provider, and every one of them
 * is fed by the same upstream carrier.
 *
 * This never creates a source row. A payload that arrives before the connect
 * projection has recorded the source leaves nothing to stamp, and staleness
 * evaluation falls back to `first_seen_at` for a source that has never
 * delivered.
 */
export function markConnectionSourceDataReceived(
  database: DatabaseSync,
  input: {
    connectionId: string;
    now: string;
    sourceProviderSlug: string;
  },
): number {
  const connectionId = normalizeRequiredBoundedString(
    input.connectionId,
    "connectionId",
    SOURCE_INSTANCE_KEY_MAX_LENGTH,
  );
  const requestedSourceProviderSlug = normalizeRequiredSourceSlug(
    input.sourceProviderSlug,
    "sourceProviderSlug",
    SOURCE_PROVIDER_SLUG_MAX_LENGTH,
  );
  const isJunctionConnection = readConnectionProvider(database, connectionId) === "junction";
  const canonicalProviderSlug = isJunctionConnection
    ? canonicalizeJunctionProviderSlug(requestedSourceProviderSlug) ?? requestedSourceProviderSlug
    : requestedSourceProviderSlug;
  const junctionSlugs = isJunctionConnection
    ? listJunctionSourceIdentitySlugs(canonicalProviderSlug)
    : null;
  const sourcePredicate = junctionSlugs
    ? `source_provider_slug in (${junctionSlugs.map(() => "?").join(", ")})`
    : "source_provider_slug = ?";
  const sourceParams = junctionSlugs
    ? junctionSlugs
    : [canonicalProviderSlug];
  const now = toIsoTimestamp(input.now);

  const result = database.prepare(`
    update device_connection_source
    set last_data_at = ?,
        updated_at = ?
    where connection_id = ?
      and ${sourcePredicate}
      and (last_data_at is null or last_data_at < ?)
  `).run(now, now, connectionId, ...sourceParams, now);

  return Number(result.changes ?? 0);
}

export function listConnectionSources(
  database: DatabaseSync,
  input: ListDeviceConnectionSourcesInput,
): StoredDeviceConnectionSource[] {
  const connectionId = normalizeRequiredBoundedString(
    input.connectionId,
    "connectionId",
    SOURCE_INSTANCE_KEY_MAX_LENGTH,
  );
  const requestedSourceProviderSlug = input.sourceProviderSlug === null || input.sourceProviderSlug === undefined
    ? null
    : normalizeRequiredBoundedString(
        input.sourceProviderSlug,
        "sourceProviderSlug",
        SOURCE_PROVIDER_SLUG_MAX_LENGTH,
      );
  const status = input.status === null || input.status === undefined
    ? null
    : normalizeSourceStatus(input.status);

  if (
    requestedSourceProviderSlug !== null
    && readConnectionProvider(database, connectionId) === "junction"
  ) {
    const sourceProviderSlug = canonicalizeJunctionProviderSlug(requestedSourceProviderSlug)
      ?? requestedSourceProviderSlug;
    const merged = mergeJunctionSourceIdentity(
      readJunctionSourceIdentityCandidates(database, {
        connectionId,
        sourceInstanceKey: "",
        sourceProviderSlug,
      }),
    );
    return merged && (status === null || merged.status === status) ? [merged] : [];
  }

  const conditions = ["connection_id = ?"];
  const params: string[] = [connectionId];

  if (requestedSourceProviderSlug !== null) {
    conditions.push("source_provider_slug = ?");
    params.push(requestedSourceProviderSlug);
  }

  if (status !== null) {
    conditions.push("status = ?");
    params.push(status);
  }

  return database.prepare(`
    ${CONNECTION_SOURCE_ROW_SELECT}
    where ${conditions.join(" and ")}
    order by last_seen_at desc, source_provider_slug asc, source_instance_key asc, id asc
  `).all(...params).map((row) => mapConnectionSourceRow(decodeConnectionSourceRow(row)));
}
