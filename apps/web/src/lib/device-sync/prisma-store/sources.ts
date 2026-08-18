import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
} from "@murphai/device-syncd/client";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT } from "@murphai/device-syncd/hosted-runtime";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";

import {
  generateHostedRandomPrefixedId,
  maybeDate,
  normalizeNullableString,
  omitHostedSqlErrorText,
} from "../shared";
import { toNullablePrismaJsonValue } from "./prisma-json";
import type { HostedPrismaTransactionClient } from "./types";

export const hostedConnectionSourceRecordArgs = {
  select: {
    connectionId: true,
    createdAt: true,
    displayName: true,
    firstSeenAt: true,
    id: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lastSeenAt: true,
    lastDataAt: true,
    resourceAvailabilitySummaryJson: true,
    sourceInstanceKey: true,
    sourceProviderSlug: true,
    status: true,
    updatedAt: true,
  },
} satisfies Prisma.DeviceConnectionSourceDefaultArgs;

export type HostedConnectionSourceRecord =
  Prisma.DeviceConnectionSourceGetPayload<typeof hostedConnectionSourceRecordArgs>;

const hostedConnectionSourceAdmissionArgs = {
  select: {
    id: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lastSeenAt: true,
    sourceInstanceKey: true,
    sourceProviderSlug: true,
    status: true,
  },
} satisfies Prisma.DeviceConnectionSourceDefaultArgs;

type HostedConnectionSourceAdmissionRecord =
  Prisma.DeviceConnectionSourceGetPayload<typeof hostedConnectionSourceAdmissionArgs>;

export type HostedConnectionSourceAdmissionCandidate = Omit<
  HostedConnectionSourceAdmissionRecord,
  "status"
> & {
  status: DeviceConnectionSourceStatus;
};

export interface HostedDeviceConnectionSource {
  id: string;
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: DeviceConnectionSourceResourceAvailabilitySummary | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last inbound payload carrying this source's data; null until one has. */
  lastDataAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertHostedDeviceConnectionSourceInput {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName?: string | null;
  status?: DeviceConnectionSourceStatus | null;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  /** Omit to preserve the stored arrival signal; the reconcile projection must. */
  lastDataAt?: string | null;
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface MarkHostedDeviceConnectionSourceDataReceivedInput {
  connectionId: string;
  now?: string;
  sourceProviderSlug: string;
  tx?: HostedPrismaTransactionClient;
}

export interface MarkHostedDeviceConnectionSourcesDisconnectedInput {
  connectionId: string;
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface ListHostedBoundedConnectionSourcesForConnectionsInput {
  connectionIds: readonly string[];
  excludeDisconnected?: boolean;
  limitPerConnection?: number;
  sourceProviderSlugs?: readonly string[] | null;
  tx?: HostedPrismaTransactionClient;
}

type HostedBoundedConnectionSourceRecord = HostedConnectionSourceRecord & {
  projectionRowNumber: bigint | number;
};

const SAFE_SOURCE_INSTANCE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const SAFE_SOURCE_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_][A-Z0-9_-]*$/u;
const SAFE_SUMMARY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const SAFE_SUMMARY_STRING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/u;

export class PrismaHostedConnectionSourceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsertConnectionSource(
    input: UpsertHostedDeviceConnectionSourceInput,
  ): Promise<HostedDeviceConnectionSource> {
    const prisma = input.tx ?? this.prisma;
    const now = resolveSourceTimestamp(input.now, new Date());
    const lastSeenAt = resolveSourceTimestamp(input.lastSeenAt, now);
    const firstSeenAt = resolveSourceTimestamp(input.firstSeenAt, lastSeenAt);
    const sourceInstanceKey = normalizeSourceInstanceKey(input.sourceInstanceKey);
    const sourceProviderSlug = normalizeSourceProviderSlug(input.sourceProviderSlug);
    const status = normalizeSourceStatus(input.status);
    const hasDisplayName = hasOwnInputProperty(input, "displayName");
    const hasResourceAvailabilitySummary = hasOwnInputProperty(input, "resourceAvailabilitySummary");
    const hasLastErrorCode = hasOwnInputProperty(input, "lastErrorCode");
    const hasLastErrorMessage = hasOwnInputProperty(input, "lastErrorMessage");
    const hasLastDataAt = hasOwnInputProperty(input, "lastDataAt");
    const lastDataAt = hasLastDataAt ? maybeDate(input.lastDataAt) ?? null : null;
    const displayName = hasDisplayName
      ? sanitizeSourceDisplayName(input.displayName)
      : null;
    const lastErrorCode = hasLastErrorCode
      ? sanitizeSourceErrorCode(input.lastErrorCode)
      : null;
    const lastErrorMessage = hasLastErrorMessage
      ? omitHostedSqlErrorText(input.lastErrorMessage)
      : null;
    const resourceAvailabilitySummary = hasResourceAvailabilitySummary
      ? sanitizeResourceAvailabilitySummary(input.resourceAvailabilitySummary)
      : null;
    const update: Prisma.DeviceConnectionSourceUpdateInput = {
      lastSeenAt,
      sourceProviderSlug,
      status,
    };

    if (hasDisplayName) {
      update.displayName = displayName;
    }

    if (hasResourceAvailabilitySummary) {
      update.resourceAvailabilitySummaryJson = toNullablePrismaJsonValue(
        resourceAvailabilitySummary,
      );
    }

    if (hasLastErrorCode || status !== "error") {
      update.lastErrorCode = lastErrorCode;
    }

    if (hasLastErrorMessage || status !== "error") {
      update.lastErrorMessage = lastErrorMessage;
    }

    // Only an explicit value moves the arrival signal. The reconcile projection
    // omits it, so a source the provider still lists but no longer feeds keeps
    // its real last-delivery instant.
    if (hasLastDataAt) {
      update.lastDataAt = lastDataAt;
    }

    const record = await prisma.deviceConnectionSource.upsert({
      where: {
        connectionId_sourceInstanceKey: {
          connectionId: requireConnectionId(input.connectionId),
          sourceInstanceKey,
        },
      },
      create: {
        connectionId: requireConnectionId(input.connectionId),
        displayName,
        firstSeenAt,
        id: generateHostedRandomPrefixedId("dcs"),
        lastErrorCode,
        lastErrorMessage,
        lastSeenAt,
        lastDataAt,
        resourceAvailabilitySummaryJson: toNullablePrismaJsonValue(resourceAvailabilitySummary),
        sourceInstanceKey,
        sourceProviderSlug,
        status,
      },
      update,
      ...hostedConnectionSourceRecordArgs,
    });

    return mapHostedConnectionSourceRecord(record);
  }

  /**
   * Records that an inbound payload carried this source's data. Matching is by
   * provider slug because that is what the webhook envelope names, and the
   * update is forward-only so an out-of-order redelivery cannot rewind the
   * signal a stall is measured against.
   *
   * This never creates a source row: a payload that arrives before the connect
   * projection recorded the source leaves nothing to stamp, and staleness falls
   * back to `first_seen_at` for a source that has never delivered.
   */
  async markConnectionSourceDataReceived(
    input: MarkHostedDeviceConnectionSourceDataReceivedInput,
  ): Promise<number> {
    const prisma = input.tx ?? this.prisma;
    const lastDataAt = resolveSourceTimestamp(input.now, new Date());
    const result = await prisma.deviceConnectionSource.updateMany({
      where: {
        connectionId: requireConnectionId(input.connectionId),
        sourceProviderSlug: normalizeSourceProviderSlug(input.sourceProviderSlug),
        OR: [
          { lastDataAt: null },
          { lastDataAt: { lt: lastDataAt } },
        ],
      },
      data: {
        lastDataAt,
        updatedAt: lastDataAt,
      },
    });

    return result.count;
  }

  async markConnectionSourcesDisconnected(
    input: MarkHostedDeviceConnectionSourcesDisconnectedInput,
  ): Promise<number> {
    const prisma = input.tx ?? this.prisma;
    const updatedAt = resolveSourceTimestamp(input.now, new Date());
    const result = await prisma.deviceConnectionSource.updateMany({
      where: {
        connectionId: requireConnectionId(input.connectionId),
        status: {
          not: "disconnected",
        },
      },
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: updatedAt,
        status: "disconnected",
        updatedAt,
      },
    });

    return result.count;
  }

  async listConnectionSources(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = tx ?? this.prisma;
    const records = await prisma.deviceConnectionSource.findMany({
      where: {
        connectionId: requireConnectionId(connectionId),
      },
      orderBy: [
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      ...hostedConnectionSourceRecordArgs,
    });

    return records.map(mapHostedConnectionSourceRecord);
  }

  async resolveConnectionSourceAdmissionCandidate(input: {
    connectionId: string;
    sourceInstanceKey?: string;
    sourceProviderSlug: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionSourceAdmissionCandidate | null> {
    const prisma = input.tx ?? this.prisma;
    const connectionId = requireConnectionId(input.connectionId);
    const sourceInstanceKey = input.sourceInstanceKey === undefined
      ? null
      : normalizeSourceInstanceKey(input.sourceInstanceKey);
    const sourceProviderSlug = normalizeSourceProviderSlug(input.sourceProviderSlug);
    const [candidate] = await prisma.$queryRaw<HostedConnectionSourceAdmissionRecord[]>(
      Prisma.sql`
        SELECT
          "id",
          "last_error_code" AS "lastErrorCode",
          "last_error_message" AS "lastErrorMessage",
          "last_seen_at" AS "lastSeenAt",
          "source_instance_key" AS "sourceInstanceKey",
          "source_provider_slug" AS "sourceProviderSlug",
          "status"
        FROM "device_connection_source"
        WHERE "connection_id" = ${connectionId}
          AND "source_provider_slug" = ${sourceProviderSlug}
        ORDER BY
          ${sourceInstanceKey === null
            ? Prisma.empty
            : Prisma.sql`("source_instance_key" = ${sourceInstanceKey}) DESC,`}
          (
            "status" = 'connected'
            AND (
              "last_error_code" IS NULL
              OR "last_error_code" NOT IN (
                ${DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE},
                ${DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE},
                ${DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE}
              )
            )
          ) DESC,
          "last_seen_at" DESC,
          "source_instance_key" ASC,
          "id" ASC
        LIMIT 1
      `,
    );

    return candidate
      ? {
          ...candidate,
          status: normalizeSourceStatus(candidate.status),
        }
      : null;
  }

  async listConnectionSourcesForConnections(
    connectionIds: readonly string[],
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = tx ?? this.prisma;
    const normalizedConnectionIds = [...new Set(connectionIds.map(requireConnectionId))];

    if (normalizedConnectionIds.length === 0) {
      return [];
    }

    const records = await prisma.deviceConnectionSource.findMany({
      where: {
        connectionId: {
          in: normalizedConnectionIds,
        },
      },
      orderBy: [
        { connectionId: "asc" },
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      ...hostedConnectionSourceRecordArgs,
    });

    return records.map(mapHostedConnectionSourceRecord);
  }

  async listBoundedConnectionSourcesForConnections(
    input: ListHostedBoundedConnectionSourcesForConnectionsInput,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = input.tx ?? this.prisma;
    const connectionIds = [...new Set(input.connectionIds.map(requireConnectionId))];
    if (connectionIds.length === 0) {
      return [];
    }
    const requestedLimit = input.limitPerConnection
      ?? HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT;
    const limitPerConnection = Math.min(
      requireSourceProjectionLimit(requestedLimit),
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
    );
    const sourceProviderSlugs = input.sourceProviderSlugs == null
      ? null
      : normalizeSourceProviderSlugList(input.sourceProviderSlugs);
    if (sourceProviderSlugs !== null && sourceProviderSlugs.length === 0) {
      return [];
    }
    const sourceFilter = sourceProviderSlugs === null
      ? Prisma.empty
      : Prisma.sql`AND source_provider_slug IN (${Prisma.join(sourceProviderSlugs)})`;
    const statusFilter = input.excludeDisconnected === true
      ? Prisma.sql`AND status <> 'disconnected'`
      : Prisma.empty;
    const records = await prisma.$queryRaw<HostedBoundedConnectionSourceRecord[]>(
      Prisma.sql`
        SELECT
          id,
          connection_id AS "connectionId",
          source_instance_key AS "sourceInstanceKey",
          source_provider_slug AS "sourceProviderSlug",
          display_name AS "displayName",
          status,
          resource_availability_summary_json AS "resourceAvailabilitySummaryJson",
          last_error_code AS "lastErrorCode",
          last_error_message AS "lastErrorMessage",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          last_data_at AS "lastDataAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          "projectionRowNumber"
        FROM (
          SELECT
            source.*,
            ROW_NUMBER() OVER (
              PARTITION BY connection_id
              ORDER BY
                last_seen_at DESC,
                source_provider_slug ASC,
                source_instance_key ASC,
                id ASC
            ) AS "projectionRowNumber"
          FROM device_connection_source AS source
          WHERE connection_id IN (${Prisma.join(connectionIds)})
            ${sourceFilter}
            ${statusFilter}
        ) AS bounded_source
        WHERE "projectionRowNumber" <= ${limitPerConnection + 1}
        ORDER BY
          connection_id ASC,
          last_seen_at DESC,
          source_provider_slug ASC,
          source_instance_key ASC,
          id ASC
      `,
    );

    const saturatedConnection = records.find(
      (record) => Number(record.projectionRowNumber) > limitPerConnection,
    );
    if (saturatedConnection) {
      throw sourceContractError(
        "CONNECTION_SOURCE_SNAPSHOT_SATURATED",
        `Hosted device connection source authority exceeds the ${limitPerConnection}-row per-connection snapshot bound.`,
      );
    }

    return records.map(mapHostedConnectionSourceRecord);
  }
}

export function mapHostedConnectionSourceRecord(
  record: HostedConnectionSourceRecord,
): HostedDeviceConnectionSource {
  return {
    connectionId: record.connectionId,
    createdAt: record.createdAt.toISOString(),
    displayName: sanitizeSourceDisplayName(record.displayName),
    firstSeenAt: record.firstSeenAt.toISOString(),
    id: record.id,
    lastErrorCode: sanitizeSourceErrorCode(record.lastErrorCode),
    lastErrorMessage: omitHostedSqlErrorText(record.lastErrorMessage),
    lastSeenAt: record.lastSeenAt.toISOString(),
    lastDataAt: record.lastDataAt?.toISOString() ?? null,
    resourceAvailabilitySummary: sanitizeResourceAvailabilitySummary(
      readResourceAvailabilitySummary(record.resourceAvailabilitySummaryJson),
    ),
    sourceInstanceKey: normalizeSourceInstanceKey(record.sourceInstanceKey),
    sourceProviderSlug: normalizeSourceProviderSlug(record.sourceProviderSlug),
    status: normalizeSourceStatus(record.status),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requireConnectionId(value: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw sourceContractError("CONNECTION_SOURCE_CONNECTION_REQUIRED", "Hosted device connection source requires a connection id.");
  }

  return normalized;
}

function normalizeSourceInstanceKey(value: string): string {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;

  if (
    !normalized
    || normalized.length > 128
    || !SAFE_SOURCE_INSTANCE_KEY_PATTERN.test(normalized)
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_INSTANCE_KEY_INVALID",
      "Hosted device connection source instance keys must be stable opaque slugs.",
    );
  }

  return normalized;
}

function normalizeSourceProviderSlug(value: string): string {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;

  if (
    !normalized
    || normalized.length > 80
    || !SAFE_SOURCE_PROVIDER_SLUG_PATTERN.test(normalized)
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_PROVIDER_SLUG_INVALID",
      "Hosted device connection source provider slugs must be compact public slugs.",
    );
  }

  return normalized;
}

function normalizeSourceProviderSlugList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const value of values) {
    const normalized = normalizeSourceProviderSlug(value);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function requireSourceProjectionLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw sourceContractError(
      "CONNECTION_SOURCE_LIST_LIMIT_INVALID",
      "Hosted device connection source snapshot limits must be positive integers.",
    );
  }

  return value;
}

function hasOwnInputProperty<T extends object>(
  input: T,
  key: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeSourceStatus(value: string | null | undefined): DeviceConnectionSourceStatus {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? "connected";

  if (
    normalized !== "connected"
    && normalized !== "unavailable"
    && normalized !== "error"
    && normalized !== "disconnected"
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_STATUS_INVALID",
      "Hosted device connection source status must be a supported source lifecycle value.",
    );
  }

  return normalized;
}

function sanitizeSourceDisplayName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value?.replace(/[\u0000-\u001f\u007f]/gu, " "));

  if (!normalized) {
    return null;
  }

  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function sanitizeSourceErrorCode(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)?.toUpperCase() ?? null;

  if (!normalized) {
    return null;
  }

  if (normalized.length > 80 || !SAFE_ERROR_CODE_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function sanitizeResourceAvailabilitySummary(
  value: Record<string, unknown> | null | undefined,
): DeviceConnectionSourceResourceAvailabilitySummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const summary: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = sanitizeSummaryKey(rawKey);

    if (!key) {
      continue;
    }

    const scalar = sanitizeSummaryScalar(rawValue);

    if (scalar !== undefined) {
      summary[key] = scalar;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function sanitizeSummaryKey(value: string): string | null {
  const key = normalizeNullableString(value);

  if (
    !key
    || key.length > 64
    || !SAFE_SUMMARY_KEY_PATTERN.test(key)
    || isBlockedSourceSummaryKey(key)
  ) {
    return null;
  }

  return key;
}

function sanitizeSummaryScalar(value: unknown): boolean | number | string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeNullableString(value);

  if (
    !normalized
    || normalized.length > 64
    || !SAFE_SUMMARY_STRING_PATTERN.test(normalized)
    || isBlockedSourceSummaryScalar(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function isBlockedSourceSummaryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  return isBlockedSourceSummaryNormalizedText(normalized);
}

function isBlockedSourceSummaryScalar(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  return isBlockedSourceSummaryNormalizedText(normalized);
}

function isBlockedSourceSummaryNormalizedText(normalized: string): boolean {
  return normalized === "id"
    || normalized.includes("accountid")
    || normalized.includes("clientuserid")
    || normalized.includes("deviceid")
    || normalized.includes("externalid")
    || normalized.includes("hmac")
    || normalized.includes("imei")
    || normalized.includes("macaddress")
    || normalized.includes("ownerid")
    || normalized.includes("raw")
    || normalized.includes("secret")
    || normalized.includes("serial")
    || normalized.includes("sourceid")
    || normalized.includes("token")
    || normalized.includes("userid");
}

function readResourceAvailabilitySummary(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function resolveSourceTimestamp(value: string | null | undefined, fallback: Date): Date {
  return maybeDate(value) ?? fallback;
}

function sourceContractError(code: string, message: string): Error {
  return deviceSyncError({
    code,
    message,
    retryable: false,
    httpStatus: 400,
  });
}
