import type { Prisma } from "@prisma/client";
import type { DeviceSyncAccount } from "@murphai/device-syncd/public-ingress";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";

import type { HostedStaticDeviceSyncConnectionRecord } from "../internal-runtime";
import {
  maybeIsoTimestamp,
  normalizeNullableString,
  sanitizeHostedSqlErrorText,
} from "../shared";

export const hostedConnectionRecordArgs = {
  select: {
    accessTokenEncrypted: true,
    accessTokenExpiresAt: true,
    connectedAt: true,
    createdAt: true,
    displayName: true,
    externalAccountIdEncrypted: true,
    id: true,
    keyVersion: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lastSyncCompletedAt: true,
    lastSyncErrorAt: true,
    lastSyncStartedAt: true,
    lastWebhookAt: true,
    metadataJson: true,
    nextReconcileAt: true,
    provider: true,
    providerAccountBlindIndex: true,
    refreshTokenEncrypted: true,
    scopesJson: true,
    status: true,
    tokenVersion: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;
export type HostedStoredDeviceSyncAccount = DeviceSyncAccount & {
  keyVersion: string;
  tokenVersion: number;
};

export function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  return {
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    displayName: normalizeNullableString(record.displayName),
    externalAccountId: null,
    id: record.id,
    lastErrorCode: normalizeNullableString(record.lastErrorCode),
    lastErrorMessage: sanitizeHostedSqlErrorText(record.lastErrorMessage),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    metadata: readStoredMetadata(record.metadataJson),
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    provider: record.provider,
    scopes: readStoredScopes(record.scopesJson),
    status: record.status as HostedStaticDeviceSyncConnectionRecord["status"],
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}

export function normalizeStoredScopes(value: readonly string[] | null | undefined): string[] {
  return (value ?? [])
    .map((entry) => normalizeNullableString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readStoredScopes(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNullableString(typeof entry === "string" ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

function readStoredMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeStoredDeviceSyncMetadata(value as Record<string, unknown>);
}
