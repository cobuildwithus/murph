import { deviceSyncError } from "@murphai/device-syncd/errors";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-account";
import type {
  DeviceAccountCredentialKind,
  DeviceSyncAccount,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";

export interface HostedStaticDeviceSyncConnectionRecord {
  accessTokenExpiresAt: string | null;
  id: string;
  userId: string;
  provider: string;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  displayName: string | null;
  externalAccountId: string | null;
  credentialKind: DeviceAccountCredentialKind;
  providerConfigKey: string | null;
  credentialMetadata: Record<string, unknown>;
  setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  setupExpiresAt: string | null;
  metadata: Record<string, unknown>;
  scopes: string[];
  status: "active" | "reauthorization_required" | "disconnected";
  connectedAt: string;
  lastWebhookAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: string | null;
  nextRuntimeWakeAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HostedPublicDeviceSyncAccountFallback {
  accessTokenExpiresAt?: string | null;
  connectedAt?: string | null;
  createdAt?: string | null;
  displayName?: string | null;
  externalAccountId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastWebhookAt?: string | null;
  metadata?: Record<string, unknown> | null;
  nextReconcileAt?: string | null;
  scopes?: readonly string[] | null;
  setupExpiresAt?: string | null;
  setupPhase?: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  status?: "active" | "reauthorization_required" | "disconnected";
  updatedAt?: string | null;
}

export function requireHostedDeviceSyncStoredTokenBundle(input: {
  connectionId: string;
  storedTokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
  userId: string;
}): HostedExecutionDeviceSyncRuntimeTokenBundle {
  if (input.storedTokenBundle) {
    return input.storedTokenBundle;
  }

  throw deviceSyncError({
    code: "CONNECTION_SECRET_MISSING",
    message: "Hosted device-sync connection no longer has a stored token bundle.",
    retryable: false,
    httpStatus: 409,
    details: {
      connectionId: input.connectionId,
      userId: input.userId,
    },
  });
}

export function composeHostedRuntimeOAuthDeviceSyncAccount(input: {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle;
}): DeviceSyncAccount {
  return {
    ...input.connection,
    disconnectGeneration: 0,
    accessTokenExpiresAt: input.tokenBundle.accessTokenExpiresAt,
    credential: {
      kind: "oauth_tokens",
      tokens: {
        accessToken: input.tokenBundle.accessToken,
        accessTokenExpiresAt: input.tokenBundle.accessTokenExpiresAt,
        refreshToken: input.tokenBundle.refreshToken,
      },
    },
    metadata: sanitizeStoredDeviceSyncMetadata(input.connection.metadata ?? {}),
  };
}

export function buildHostedPublicDeviceSyncAccount(input: {
  record: HostedStaticDeviceSyncConnectionRecord;
  fallback?: HostedPublicDeviceSyncAccountFallback;
}): PublicDeviceSyncAccount {
  const fallback = input.fallback ?? {};
  const externalAccountId = normalizeHostedExternalAccountId(
    input.record.externalAccountId ?? fallback.externalAccountId,
    input.record.id,
  );

  return {
    externalAccountId,
    id: input.record.id,
    provider: input.record.provider,
    displayName: input.record.displayName ?? fallback.displayName ?? null,
    status: fallback.status ?? input.record.status,
    scopes: input.record.scopes.length > 0 ? [...input.record.scopes] : fallback.scopes ? [...fallback.scopes] : [],
    accessTokenExpiresAt: input.record.accessTokenExpiresAt ?? fallback.accessTokenExpiresAt ?? null,
    setupExpiresAt: fallback.setupExpiresAt ?? input.record.setupExpiresAt,
    setupPhase: fallback.setupPhase ?? input.record.setupPhase,
    metadata: sanitizeStoredDeviceSyncMetadata(
      Object.keys(input.record.metadata).length > 0 ? input.record.metadata : fallback.metadata ?? {},
    ),
    connectedAt: fallback.connectedAt ?? input.record.connectedAt,
    lastWebhookAt: fallback.lastWebhookAt ?? input.record.lastWebhookAt,
    lastSyncStartedAt: fallback.lastSyncStartedAt ?? input.record.lastSyncStartedAt,
    lastSyncCompletedAt: fallback.lastSyncCompletedAt ?? input.record.lastSyncCompletedAt,
    lastSyncErrorAt: fallback.lastSyncErrorAt ?? input.record.lastSyncErrorAt,
    lastErrorCode: sanitizeHostedRuntimeErrorCode(
      fallback.lastErrorCode ?? input.record.lastErrorCode,
    ),
    lastErrorMessage: sanitizeHostedRuntimeErrorText(
      fallback.lastErrorMessage ?? input.record.lastErrorMessage,
    ),
    nextReconcileAt: fallback.nextReconcileAt ?? input.record.nextReconcileAt,
    createdAt: fallback.createdAt ?? input.record.createdAt,
    updatedAt: fallback.updatedAt ?? input.record.updatedAt,
  } satisfies PublicDeviceSyncAccount;
}

function normalizeHostedExternalAccountId(
  value: string | null | undefined,
  connectionId: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  // Hosted durable SQL intentionally omits raw provider account ids. Keep the
  // internal account shape total even when only the opaque connection id is available.
  return `opaque:${connectionId}`;
}
