import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
} from "@murphai/device-syncd/client";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

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
    resourceAvailabilitySummaryJson: true,
    sourceInstanceKey: true,
    sourceProviderSlug: true,
    status: true,
    updatedAt: true,
  },
} satisfies Prisma.DeviceConnectionSourceDefaultArgs;

export type HostedConnectionSourceRecord =
  Prisma.DeviceConnectionSourceGetPayload<typeof hostedConnectionSourceRecordArgs>;

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
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface MarkHostedDeviceConnectionSourcesDisconnectedInput {
  connectionId: string;
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

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
