import { createHmac } from "node:crypto";

import { formatDeviceSyncAccountLabel } from "@murphai/device-syncd/provider-label";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";

import { formatHostedDeviceSyncProviderLabel } from "./provider-label";
import {
  normalizeHostedDeviceSyncLifecycleStatus,
  normalizeHostedDeviceSyncSetupPhase,
} from "./prisma-store/connection-records";
import { maybeIsoTimestamp, normalizeNullableString } from "./shared";

export interface HostedBrowserDeviceSyncConnection extends Omit<PublicDeviceSyncAccount, "externalAccountId"> {
  id: string;
}

const HOSTED_PUBLIC_CONNECTION_ID_PREFIX = "dspc_";

export interface HostedSidebarDeviceSyncConnectionRecord {
  connectedAt: Date;
  createdAt: Date;
  id: string;
  lastErrorCode: string | null;
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastWebhookAt: Date | null;
  nextReconcileAt: Date | null;
  provider: string;
  setupExpiresAt: Date | null;
  setupPhase: string | null;
  status: string;
  updatedAt: Date;
}

export function createHostedBrowserConnectionId(secret: Buffer | Uint8Array | string, connectionId: string): string {
  return `${HOSTED_PUBLIC_CONNECTION_ID_PREFIX}${createHmac("sha256", normalizeSecret(secret))
    .update(connectionId, "utf8")
    .digest("base64url")}`;
}

export function toHostedBrowserDeviceSyncConnection(
  account: PublicDeviceSyncAccount,
  secret: Buffer | Uint8Array | string,
): HostedBrowserDeviceSyncConnection {
  const { externalAccountId, id, ...rest } = account;
  void externalAccountId;

  return {
    ...rest,
    displayName: sanitizeHostedBrowserDisplayName(account),
    id: createHostedBrowserConnectionId(secret, id),
  };
}

export function toHostedBrowserDeviceSyncSidebarConnection(
  record: HostedSidebarDeviceSyncConnectionRecord,
  secret: Buffer | Uint8Array | string,
): HostedBrowserDeviceSyncConnection {
  return {
    accessTokenExpiresAt: null,
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    displayName: null,
    id: createHostedBrowserConnectionId(secret, record.id),
    lastErrorCode: normalizeNullableString(record.lastErrorCode),
    lastErrorMessage: null,
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    metadata: {},
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    provider: record.provider,
    scopes: [],
    setupExpiresAt: maybeIsoTimestamp(record.setupExpiresAt),
    setupPhase: normalizeHostedDeviceSyncSetupPhase(record.setupPhase),
    status: normalizeHostedDeviceSyncLifecycleStatus(record.status),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function sanitizeHostedBrowserDisplayName(account: PublicDeviceSyncAccount): string | null {
  const displayName = account.displayName?.trim() ?? "";

  if (!displayName) {
    return null;
  }

  const providerLabel = formatHostedDeviceSyncProviderLabel(account.provider);
  const providerGeneratedLabel = formatDeviceSyncAccountLabel(account.provider, account.externalAccountId);

  if (displayName.toLowerCase() === providerGeneratedLabel.toLowerCase()) {
    return providerLabel;
  }

  return displayName;
}

function normalizeSecret(secret: Buffer | Uint8Array | string): Buffer | Uint8Array {
  if (typeof secret === "string") {
    return Buffer.from(secret, "utf8");
  }

  return secret;
}
