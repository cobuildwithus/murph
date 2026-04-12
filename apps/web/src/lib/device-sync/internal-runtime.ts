import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  type DeviceSyncAccount,
  type DeviceSyncAccountStatus,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncRuntimeConnectionSeed,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeLocalStateSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";

// Keep hosted runtime request parsing with the package that already owns the shared request model.
export {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest as parseHostedDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest as parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/device-syncd/hosted-runtime";

export interface HostedStaticDeviceSyncConnectionRecord {
  id: string;
  userId: string;
  provider: string;
  status: DeviceSyncAccountStatus;
  connectedAt: string;
  lastWebhookAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: string | null;
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
  status?: DeviceSyncAccountStatus;
  updatedAt?: string | null;
}

const DEFAULT_MISSING_RUNTIME_STATUS: DeviceSyncAccountStatus = "reauthorization_required";

export function findHostedDeviceSyncRuntimeConnection(
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  connectionId: string,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null {
  return snapshot.connections.find((entry) => entry.connection.id === connectionId) ?? null;
}

export function requireHostedDeviceSyncRuntimeTokenBundle(input: {
  connectionId: string;
  runtimeConnection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null;
  userId: string;
}): HostedExecutionDeviceSyncRuntimeTokenBundle {
  if (input.runtimeConnection?.tokenBundle) {
    return input.runtimeConnection.tokenBundle;
  }

  throw deviceSyncError({
    code: "CONNECTION_SECRET_MISSING",
    message: "Hosted device-sync connection no longer has an escrowed token bundle.",
    retryable: false,
    httpStatus: 409,
    details: {
      connectionId: input.connectionId,
      userId: input.userId,
    },
  });
}

export function composeHostedRuntimeDeviceSyncAccount(input: {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle;
}): DeviceSyncAccount {
  return {
    ...input.connection,
    accessToken: input.tokenBundle.accessToken,
    refreshToken: input.tokenBundle.refreshToken,
    disconnectGeneration: 0,
    accessTokenExpiresAt: input.tokenBundle.accessTokenExpiresAt,
    metadata: sanitizeStoredDeviceSyncMetadata(input.connection.metadata ?? {}),
  };
}

export function buildHostedPublicDeviceSyncAccount(input: {
  record: HostedStaticDeviceSyncConnectionRecord;
  runtimeConnection?: HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null;
  fallback?: HostedPublicDeviceSyncAccountFallback;
  missingRuntimeStatus?: DeviceSyncAccountStatus;
}): PublicDeviceSyncAccount {
  const runtimeConnection = input.runtimeConnection ?? null;

  if (runtimeConnection) {
    assertHostedRuntimeConnectionMatchesRecord(input.record, runtimeConnection);

    return {
      externalAccountId: runtimeConnection.connection.externalAccountId,
      id: input.record.id,
      provider: input.record.provider,
      displayName: runtimeConnection.connection.displayName ?? input.fallback?.displayName ?? null,
      status: runtimeConnection.connection.status,
      scopes: [...runtimeConnection.connection.scopes],
      accessTokenExpiresAt: runtimeConnection.connection.accessTokenExpiresAt ?? null,
      metadata: sanitizeStoredDeviceSyncMetadata(runtimeConnection.connection.metadata),
      connectedAt: runtimeConnection.connection.connectedAt,
      lastWebhookAt: runtimeConnection.localState.lastWebhookAt,
      lastSyncStartedAt: runtimeConnection.localState.lastSyncStartedAt,
      lastSyncCompletedAt: runtimeConnection.localState.lastSyncCompletedAt,
      lastSyncErrorAt: runtimeConnection.localState.lastSyncErrorAt,
      lastErrorCode: sanitizeHostedRuntimeErrorCode(runtimeConnection.localState.lastErrorCode),
      lastErrorMessage: sanitizeHostedRuntimeErrorText(runtimeConnection.localState.lastErrorMessage),
      nextReconcileAt: runtimeConnection.localState.nextReconcileAt,
      createdAt: runtimeConnection.connection.createdAt,
      updatedAt: runtimeConnection.connection.updatedAt ?? runtimeConnection.connection.createdAt,
    } satisfies PublicDeviceSyncAccount;
  }

  const fallback = input.fallback ?? {};
  const externalAccountId = normalizeHostedExternalAccountId(
    fallback.externalAccountId,
    input.record.id,
  );

  return {
    externalAccountId,
    id: input.record.id,
    provider: input.record.provider,
    displayName: fallback.displayName ?? null,
    status: fallback.status ?? input.record.status ?? input.missingRuntimeStatus ?? DEFAULT_MISSING_RUNTIME_STATUS,
    scopes: fallback.scopes ? [...fallback.scopes] : [],
    accessTokenExpiresAt: fallback.accessTokenExpiresAt ?? null,
    metadata: sanitizeStoredDeviceSyncMetadata(fallback.metadata ?? {}),
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

export function buildHostedDeviceSyncRuntimeSeedFromPublicAccount(input: {
  account: PublicDeviceSyncAccount;
  externalAccountId: string;
  localState?: Partial<HostedExecutionDeviceSyncRuntimeLocalStateSnapshot>;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}): HostedExecutionDeviceSyncRuntimeConnectionSeed {
  return {
    connection: {
      accessTokenExpiresAt: input.tokenBundle?.accessTokenExpiresAt ?? input.account.accessTokenExpiresAt ?? null,
      connectedAt: input.account.connectedAt,
      createdAt: input.account.createdAt,
      displayName: input.account.displayName,
      externalAccountId: input.externalAccountId,
      id: input.account.id,
      metadata: sanitizeStoredDeviceSyncMetadata(input.account.metadata ?? {}),
      provider: input.account.provider,
      scopes: [...input.account.scopes],
      status: input.account.status,
      updatedAt: input.account.updatedAt,
    },
    localState: {
      lastErrorCode: sanitizeHostedRuntimeErrorCode(
        input.localState?.lastErrorCode ?? input.account.lastErrorCode ?? null,
      ),
      lastErrorMessage: sanitizeHostedRuntimeErrorText(
        input.localState?.lastErrorMessage ?? input.account.lastErrorMessage ?? null,
      ),
      lastSyncCompletedAt: input.localState?.lastSyncCompletedAt ?? input.account.lastSyncCompletedAt ?? null,
      lastSyncErrorAt: input.localState?.lastSyncErrorAt ?? input.account.lastSyncErrorAt ?? null,
      lastSyncStartedAt: input.localState?.lastSyncStartedAt ?? input.account.lastSyncStartedAt ?? null,
      lastWebhookAt: input.localState?.lastWebhookAt ?? input.account.lastWebhookAt ?? null,
      nextReconcileAt: input.localState?.nextReconcileAt ?? input.account.nextReconcileAt ?? null,
    },
    tokenBundle: input.tokenBundle ? { ...input.tokenBundle } : null,
  } satisfies HostedExecutionDeviceSyncRuntimeConnectionSeed;
}

function assertHostedRuntimeConnectionMatchesRecord(
  record: HostedStaticDeviceSyncConnectionRecord,
  runtimeConnection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
): void {
  if (
    runtimeConnection.connection.id === record.id
    && runtimeConnection.connection.provider === record.provider
  ) {
    return;
  }

  throw deviceSyncError({
    code: "RUNTIME_STATE_CONFLICT",
    message: `Hosted device-sync runtime returned mismatched connection metadata for ${record.id}.`,
    retryable: true,
    httpStatus: 409,
  });
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
