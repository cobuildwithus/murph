import type { Prisma } from "@prisma/client";
import type {
  DeviceAccountCredentialKind,
  DeviceSyncAccount,
} from "@murphai/device-syncd/types";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-account";

import type { HostedStaticDeviceSyncConnectionRecord } from "../internal-runtime";
import {
  maybeIsoTimestamp,
  normalizeNullableString,
  sanitizeHostedConnectionLastErrorMessage,
} from "../shared";

export const hostedConnectionRecordArgs = {
  select: {
    accessTokenEncrypted: true,
    accessTokenExpiresAt: true,
    connectedAt: true,
    createdAt: true,
    credentialKind: true,
    credentialMetadataJson: true,
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
    providerConfigKey: true,
    providerApplicationId: true,
    providerApplicationRevision: true,
    refreshTokenEncrypted: true,
    refreshLeaseExpiresAt: true,
    refreshLeaseOwner: true,
    refreshLeaseTokenVersion: true,
    scopesJson: true,
    setupExpiresAt: true,
    setupPhase: true,
    status: true,
    tokenVersion: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;
export type HostedStoredDeviceSyncAccount = DeviceSyncAccount & {
  keyVersion: string | null;
  tokenVersion: number | null;
};

export function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  const credentialKind = normalizeHostedDeviceSyncCredentialKind(record.credentialKind);
  validateHostedConnectionCredentialRecord(record, credentialKind);

  return {
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    credentialKind,
    credentialMetadata: readStoredCredentialMetadata(record.credentialMetadataJson),
    displayName: normalizeNullableString(record.displayName),
    externalAccountId: null,
    id: record.id,
    lastErrorCode: normalizeNullableString(record.lastErrorCode),
    lastErrorMessage: sanitizeHostedConnectionLastErrorMessage(record.lastErrorMessage),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    metadata: readStoredMetadata(record.metadataJson),
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    provider: record.provider,
    providerConfigKey: normalizeNullableString(record.providerConfigKey),
    providerApplicationId: normalizeNullableString(record.providerApplicationId),
    providerApplicationRevision: normalizeProviderApplicationRevision(
      record.providerApplicationId,
      record.providerApplicationRevision,
    ),
    scopes: readStoredScopes(record.scopesJson),
    setupExpiresAt: maybeIsoTimestamp(record.setupExpiresAt),
    setupPhase: normalizeHostedDeviceSyncSetupPhase(record.setupPhase),
    status: normalizeHostedDeviceSyncLifecycleStatus(record.status),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}

function normalizeProviderApplicationRevision(
  applicationId: string | null | undefined,
  revision: number | null | undefined,
): number | null {
  const normalizedApplicationId = normalizeNullableString(applicationId);
  if (!normalizedApplicationId && revision == null) {
    return null;
  }
  if (
    !normalizedApplicationId
    || !Number.isSafeInteger(revision)
    || (revision as number) <= 0
  ) {
    throw new TypeError(
      "Hosted device-sync provider application binding is invalid.",
    );
  }
  return revision as number;
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

  return sanitizeHostedDeviceSyncConnectionMetadata(value as Record<string, unknown>);
}

function readStoredCredentialMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeHostedDeviceSyncCredentialMetadata(value as Record<string, unknown>);
}

export function normalizeHostedDeviceSyncCredentialKind(
  value: string | null | undefined,
): DeviceAccountCredentialKind {
  if (value === "provider_config" || value === "none" || value === "oauth_tokens") {
    return value;
  }

  throw new TypeError("Hosted device-sync credential_kind is invalid.");
}

function validateHostedConnectionCredentialRecord(
  record: HostedConnectionRecord,
  credentialKind: DeviceAccountCredentialKind,
): void {
  if (credentialKind === "oauth_tokens") {
    if (normalizeNullableString(record.providerConfigKey)) {
      throw new TypeError("Hosted OAuth token credential rows must not contain providerConfigKey.");
    }
    return;
  }

  if (
    normalizeNullableString(record.accessTokenEncrypted)
    || normalizeNullableString(record.refreshTokenEncrypted)
    || record.accessTokenExpiresAt
    || normalizeNullableString(record.keyVersion)
    || typeof record.tokenVersion === "number"
  ) {
    throw new TypeError("Hosted non-token credential rows must not contain token material.");
  }

  if (credentialKind === "provider_config") {
    if (!normalizeNullableString(record.providerConfigKey)) {
      throw new TypeError("Hosted provider-config credential rows require providerConfigKey.");
    }
    return;
  }

  if (normalizeNullableString(record.providerConfigKey)) {
    throw new TypeError("Hosted none credential rows must not contain providerConfigKey.");
  }
}

export function normalizeHostedDeviceSyncLifecycleStatus(
  value: string | null | undefined,
): HostedStaticDeviceSyncConnectionRecord["status"] {
  if (value === "reauthorization_required" || value === "disconnected") {
    return value;
  }

  return "active";
}

export function normalizeHostedDeviceSyncSetupPhase(
  value: string | null | undefined,
): HostedStaticDeviceSyncConnectionRecord["setupPhase"] {
  if (
    value === "pending_link"
    || value === "link_returned"
    || value === "source_confirmed"
    || value === "failed"
  ) {
    return value;
  }

  return null;
}

export function sanitizeHostedDeviceSyncConnectionMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);

  for (const key of Object.keys(sanitized)) {
    if (isBlockedHostedDeviceSyncConnectionMetadataKey(key)) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

export function sanitizeHostedDeviceSyncCredentialMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);

  for (const key of Object.keys(sanitized)) {
    if (isBlockedHostedDeviceSyncConnectionMetadataKey(key)) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

function isBlockedHostedDeviceSyncConnectionMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  if (
    (normalized.includes("ownerid")
      || normalized.includes("userid")
      || normalized.includes("clientuserid")
      || normalized.includes("accountid")
      || normalized.includes("profileid"))
    && !normalized.includes("hash")
    && !normalized.includes("blindindex")
  ) {
    return true;
  }

  return normalized.includes("secret")
    || normalized.includes("connectedsources")
    || normalized.includes("hmac")
    || normalized.includes("resourceavailability")
    || normalized.includes("webhook")
    || normalized.includes("rawclientuserid");
}
