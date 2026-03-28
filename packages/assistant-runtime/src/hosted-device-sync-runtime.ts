import {
  createSecretCodec,
  type DeviceSyncJobInput,
  type DeviceSyncService,
  type StoredDeviceSyncAccount,
} from "@murph/device-syncd";
import type {
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDispatchRequest,
  HostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";

import {
  applyHostedDeviceSyncRuntimeUpdates,
  fetchHostedDeviceSyncRuntimeSnapshot,
  normalizeHostedDeviceSyncJobHints,
  resolveHostedDeviceSyncWakeContext,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot as HostedDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse as HostedDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "./hosted-device-sync-control-plane.ts";

export interface HostedDeviceSyncRuntimeSyncState {
  hostedToLocalAccountIds: Map<string, string>;
  localToHostedAccountIds: Map<string, string>;
  observedTokenVersions: Map<string, number | null>;
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null;
}

type HostedAccountHydrationInput = Parameters<DeviceSyncService["store"]["hydrateHostedAccount"]>[0];

export async function syncHostedDeviceSyncControlPlaneState(input: {
  dispatch: HostedExecutionDispatchRequest;
  secret: string;
  service: DeviceSyncService;
  timeoutMs: number | null;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<HostedDeviceSyncRuntimeSyncState> {
  if (!hasHostedDeviceSyncRuntimeAccess(input.webControlPlane)) {
    return {
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      snapshot: null,
    };
  }
  const baseUrl = input.webControlPlane.deviceSyncRuntimeBaseUrl!;
  const internalToken = input.webControlPlane.internalToken!;

  const snapshot = await fetchHostedDeviceSyncRuntimeSnapshot({
    baseUrl,
    internalToken,
    timeoutMs: input.timeoutMs,
    userId: input.dispatch.event.userId,
  });
  const hostedToLocalAccountIds = new Map<string, string>();
  const localToHostedAccountIds = new Map<string, string>();
  const observedTokenVersions = new Map<string, number | null>();

  if (!snapshot) {
    return {
      hostedToLocalAccountIds,
      localToHostedAccountIds,
      observedTokenVersions,
      snapshot: null,
    };
  }

  const codec = createSecretCodec(input.secret);
  const now = input.dispatch.occurredAt;

  for (const entry of snapshot.connections) {
    observedTokenVersions.set(entry.connection.id, entry.tokenBundle?.tokenVersion ?? null);
    const existing = input.service.store.getAccountByExternalAccount(
      entry.connection.provider,
      entry.connection.externalAccountId,
    );
    const stored = input.service.store.hydrateHostedAccount(
      buildHostedAccountHydrationInput({
        codec,
        entry,
        existing,
      }),
    );

    if (!stored) {
      continue;
    }

    if (stored.status === "disconnected" && existing?.status !== "disconnected") {
      input.service.store.markPendingJobsDeadForAccount(
        stored.id,
        now,
        "HOSTED_CONTROL_PLANE_DISCONNECTED",
        "Hosted control plane marked the device-sync connection as disconnected.",
      );
    }

    hostedToLocalAccountIds.set(entry.connection.id, stored.id);
    localToHostedAccountIds.set(stored.id, entry.connection.id);
  }

  if (input.dispatch.event.kind === "device-sync.wake") {
    applyHostedDeviceSyncWakeHint({
      dispatch: input.dispatch,
      hostedToLocalAccountIds,
      service: input.service,
    });
  }

  return {
    hostedToLocalAccountIds,
    localToHostedAccountIds,
    observedTokenVersions,
    snapshot,
  };
}

export async function reconcileHostedDeviceSyncControlPlaneState(input: {
  dispatch: HostedExecutionDispatchRequest;
  secret: string;
  service: DeviceSyncService;
  state: HostedDeviceSyncRuntimeSyncState;
  timeoutMs: number | null;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<void> {
  if (!input.state.snapshot) {
    return;
  }

  if (!hasHostedDeviceSyncRuntimeAccess(input.webControlPlane)) {
    return;
  }
  const baseUrl = input.webControlPlane.deviceSyncRuntimeBaseUrl!;
  const internalToken = input.webControlPlane.internalToken!;

  const codec = createSecretCodec(input.secret);
  const updates: HostedDeviceSyncRuntimeConnectionUpdate[] = [];
  const snapshotByConnectionId = new Map(
    input.state.snapshot.connections.map((entry) => [entry.connection.id, entry]),
  );

  for (const [localAccountId, hostedConnectionId] of input.state.localToHostedAccountIds.entries()) {
    const account = input.service.store.getAccountById(localAccountId);

    if (!account) {
      continue;
    }

    const update = buildHostedDeviceSyncRuntimeConnectionUpdate({
      account,
      baseline: snapshotByConnectionId.get(hostedConnectionId) ?? null,
      codec,
      hostedConnectionId,
      observedTokenVersion: input.state.observedTokenVersions.get(hostedConnectionId) ?? null,
    });

    if (update) {
      updates.push(update);
    }
  }

  await applyHostedDeviceSyncRuntimeUpdates({
    baseUrl,
    internalToken,
    occurredAt: input.dispatch.occurredAt,
    timeoutMs: input.timeoutMs,
    updates,
    userId: input.dispatch.event.userId,
  });
}

function hasHostedDeviceSyncRuntimeAccess(
  webControlPlane: HostedExecutionWebControlPlaneEnvironment,
): boolean {
  if (!webControlPlane.deviceSyncRuntimeBaseUrl) {
    return false;
  }

  return webControlPlane.internalToken !== null
    || isHostedWorkerProxyBaseUrl(webControlPlane.deviceSyncRuntimeBaseUrl, "device-sync.worker");
}

function isHostedWorkerProxyBaseUrl(baseUrl: string, hostname: string): boolean {
  try {
    return new URL(baseUrl).hostname === hostname;
  } catch {
    return false;
  }
}

function applyHostedDeviceSyncWakeHint(input: {
  dispatch: HostedExecutionDispatchRequest;
  hostedToLocalAccountIds: Map<string, string>;
  service: DeviceSyncService;
}): void {
  if (input.dispatch.event.kind !== "device-sync.wake") {
    return;
  }

  const wake = resolveHostedDeviceSyncWakeContext(input.dispatch.event);
  const localAccountId = wake.connectionId ? input.hostedToLocalAccountIds.get(wake.connectionId) ?? null : null;

  if (!localAccountId) {
    return;
  }

  const account = input.service.store.getAccountById(localAccountId);

  if (!account) {
    return;
  }

  if (input.dispatch.event.reason === "disconnected") {
    input.service.store.disconnectAccount(localAccountId, input.dispatch.occurredAt);
    input.service.store.markPendingJobsDeadForAccount(
      localAccountId,
      input.dispatch.occurredAt,
      "HOSTED_DEVICE_SYNC_DISCONNECTED",
      "Hosted device-sync wake marked the connection as disconnected.",
    );
    return;
  }

  if (input.dispatch.event.reason === "reauthorization_required") {
    input.service.store.patchAccount(localAccountId, {
      status: "reauthorization_required",
    });
    return;
  }

  const jobHints = normalizeHostedDeviceSyncJobHints(wake.hint);

  for (const hint of jobHints) {
    const job = hostedJobHintToDeviceSyncJobInput(hint, input.dispatch.occurredAt);
    input.service.store.enqueueJob({
      accountId: localAccountId,
      availableAt: job.availableAt,
      dedupeKey: job.dedupeKey,
      kind: job.kind,
      maxAttempts: job.maxAttempts,
      payload: job.payload ?? {},
      priority: job.priority ?? 0,
      provider: account.provider,
    });
  }

  if (wake.hint?.nextReconcileAt !== undefined || wake.hint?.scopes !== undefined) {
    input.service.store.patchAccount(localAccountId, {
      ...(wake.hint?.nextReconcileAt !== undefined
        ? { nextReconcileAt: wake.hint.nextReconcileAt ?? null }
        : {}),
      ...(wake.hint?.scopes !== undefined
        ? { scopes: wake.hint.scopes ?? [] }
        : {}),
    });
  }
}

function buildHostedDeviceSyncRuntimeConnectionUpdate(input: {
  account: StoredDeviceSyncAccount;
  baseline: HostedDeviceSyncRuntimeConnectionSnapshot | null;
  codec: ReturnType<typeof createSecretCodec>;
  hostedConnectionId: string;
  observedTokenVersion: number | null;
}): HostedDeviceSyncRuntimeConnectionUpdate | null {
  const baselineConnection = input.baseline?.connection ?? null;
  const baselineTokenBundle = input.baseline?.tokenBundle ?? null;
  const tokenBundle = input.account.status === "disconnected"
    ? null
    : {
        accessToken: input.account.accessTokenEncrypted
          ? input.codec.decrypt(input.account.accessTokenEncrypted)
          : "",
        accessTokenExpiresAt: input.account.accessTokenExpiresAt ?? null,
        keyVersion: "local-runtime",
        refreshToken: input.account.refreshTokenEncrypted
          ? input.codec.decrypt(input.account.refreshTokenEncrypted)
          : null,
        tokenVersion: input.observedTokenVersion ?? 0,
      } satisfies HostedDeviceSyncRuntimeTokenBundle;
  const update: HostedDeviceSyncRuntimeConnectionUpdate = {
    connectionId: input.hostedConnectionId,
  };

  if (input.account.status === "disconnected") {
    if (baselineConnection?.status !== "disconnected") {
      update.status = "disconnected";
    }

    assignErrorFieldUpdate(update, input.account, baselineConnection);

    return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
  }

  if (input.account.status !== baselineConnection?.status) {
    update.status = input.account.status;
  }

  if (input.account.displayName !== (baselineConnection?.displayName ?? null)) {
    update.displayName = input.account.displayName ?? null;
  }

  if (!equalStringArrays(input.account.scopes, baselineConnection?.scopes ?? [])) {
    update.scopes = [...input.account.scopes];
  }

  if (!equalJsonRecords(input.account.metadata, baselineConnection?.metadata ?? {})) {
    update.metadata = { ...input.account.metadata };
  }

  if (input.account.nextReconcileAt !== (baselineConnection?.nextReconcileAt ?? null)) {
    update.nextReconcileAt = input.account.nextReconcileAt ?? null;
  }

  if (!equalHostedDeviceSyncRuntimeTokenBundles(tokenBundle, baselineTokenBundle)) {
    update.accessTokenExpiresAt = input.account.accessTokenExpiresAt ?? null;
    update.observedTokenVersion = input.observedTokenVersion;
    update.tokenBundle = tokenBundle;
  }

  assignErrorFieldUpdate(update, input.account, baselineConnection);

  assignMonotonicTimestampUpdate(update, "lastWebhookAt", input.account.lastWebhookAt, baselineConnection?.lastWebhookAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncStartedAt", input.account.lastSyncStartedAt, baselineConnection?.lastSyncStartedAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncCompletedAt", input.account.lastSyncCompletedAt, baselineConnection?.lastSyncCompletedAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncErrorAt", input.account.lastSyncErrorAt, baselineConnection?.lastSyncErrorAt ?? null);

  return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
}

function hasHostedDeviceSyncRuntimeConnectionUpdateChanges(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
): boolean {
  return Object.keys(update).some((key) => key !== "connectionId");
}

function equalHostedDeviceSyncRuntimeTokenBundles(
  left: HostedDeviceSyncRuntimeTokenBundle | null,
  right: HostedDeviceSyncRuntimeTokenBundle | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.accessToken === right.accessToken
    && left.accessTokenExpiresAt === right.accessTokenExpiresAt
    && left.refreshToken === right.refreshToken;
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildHostedAccountHydrationInput(input: {
  codec: ReturnType<typeof createSecretCodec>;
  entry: HostedDeviceSyncRuntimeConnectionSnapshot;
  existing: StoredDeviceSyncAccount | null;
}): HostedAccountHydrationInput {
  const hostedConnection = input.entry.connection;
  const hostedTokenVersion = input.entry.tokenBundle?.tokenVersion ?? null;
  const hostedUpdatedAt = hostedConnection.updatedAt ?? null;
  const localHasPendingHostedChanges = hasLocalPendingHostedChanges(input.existing);
  const hostedConnectionAdvanced = hasHostedConnectionAdvanced(input.existing, hostedUpdatedAt);
  const hostedTokenAdvanced = hasHostedTokenAdvanced(input.existing, hostedTokenVersion);
  const useHostedConnectionState = !input.existing || !localHasPendingHostedChanges || hostedConnectionAdvanced;
  const useHostedTokens =
    hostedConnection.status === "disconnected"
      ? useHostedConnectionState
      : !input.existing || !localHasPendingHostedChanges || hostedTokenAdvanced;
  const nextHostedObservedUpdatedAt = useHostedConnectionState
    ? latestIsoTimestamp(input.existing?.hostedObservedUpdatedAt ?? null, hostedUpdatedAt)
    : input.existing?.hostedObservedUpdatedAt ?? null;
  const nextHostedObservedTokenVersion = useHostedTokens
    ? latestObservedTokenVersion(input.existing?.hostedObservedTokenVersion ?? null, hostedTokenVersion)
    : input.existing?.hostedObservedTokenVersion ?? null;

  return {
    connectedAt: hostedConnection.connectedAt,
    displayName: useHostedConnectionState
      ? hostedConnection.displayName ?? null
      : input.existing?.displayName ?? null,
    externalAccountId: hostedConnection.externalAccountId,
    hostedObservedTokenVersion: nextHostedObservedTokenVersion,
    hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
    lastErrorCode: useHostedConnectionState
      ? hostedConnection.lastErrorCode ?? null
      : input.existing?.lastErrorCode ?? null,
    lastErrorMessage: useHostedConnectionState
      ? hostedConnection.lastErrorMessage ?? null
      : input.existing?.lastErrorMessage ?? null,
    lastSyncCompletedAt: mergeMonotonicTimestamp(
      input.existing?.lastSyncCompletedAt ?? null,
      hostedConnection.lastSyncCompletedAt ?? null,
      localHasPendingHostedChanges,
    ),
    lastSyncErrorAt:
      useHostedConnectionState
      && hostedConnection.lastErrorCode === null
      && hostedConnection.lastErrorMessage === null
      && hostedConnection.lastSyncErrorAt === null
        ? null
        : mergeMonotonicTimestamp(
            input.existing?.lastSyncErrorAt ?? null,
            hostedConnection.lastSyncErrorAt ?? null,
            localHasPendingHostedChanges,
          ),
    lastSyncStartedAt: mergeMonotonicTimestamp(
      input.existing?.lastSyncStartedAt ?? null,
      hostedConnection.lastSyncStartedAt ?? null,
      localHasPendingHostedChanges,
    ),
    lastWebhookAt: mergeMonotonicTimestamp(
      input.existing?.lastWebhookAt ?? null,
      hostedConnection.lastWebhookAt ?? null,
      localHasPendingHostedChanges,
    ),
    metadata: useHostedConnectionState
      ? { ...hostedConnection.metadata }
      : { ...(input.existing?.metadata ?? {}) },
    nextReconcileAt: mergeMonotonicTimestamp(
      input.existing?.nextReconcileAt ?? null,
      hostedConnection.nextReconcileAt ?? null,
      localHasPendingHostedChanges && !hostedConnectionAdvanced,
    ),
    provider: hostedConnection.provider,
    scopes: useHostedConnectionState
      ? [...hostedConnection.scopes]
      : [...(input.existing?.scopes ?? [])],
    status: useHostedConnectionState
      ? hostedConnection.status
      : input.existing?.status ?? hostedConnection.status,
    // Hosted only overwrites token/schedule state once the hosted snapshot advances past
    // the last hosted state acknowledged by the local mirror.
    updatedAt: resolveHydratedHostedAccountUpdatedAt({
      connectedAt: hostedConnection.connectedAt,
      existing: input.existing,
      hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
      useHostedConnectionState,
    }),
    ...(useHostedTokens && input.entry.tokenBundle
      ? {
          tokens: {
            accessToken: input.entry.tokenBundle.accessToken,
            accessTokenEncrypted: input.codec.encrypt(input.entry.tokenBundle.accessToken),
            accessTokenExpiresAt: input.entry.tokenBundle.accessTokenExpiresAt ?? undefined,
            refreshToken: input.entry.tokenBundle.refreshToken ?? undefined,
            refreshTokenEncrypted: input.entry.tokenBundle.refreshToken
              ? input.codec.encrypt(input.entry.tokenBundle.refreshToken)
              : null,
          },
        }
      : {}),
  };
}

function equalJsonRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assignErrorFieldUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  account: StoredDeviceSyncAccount,
  baselineConnection: HostedDeviceSyncRuntimeConnectionSnapshot["connection"] | null,
): void {
  const localLastErrorCode = account.lastErrorCode ?? null;
  const localLastErrorMessage = account.lastErrorMessage ?? null;
  const baselineLastErrorCode = baselineConnection?.lastErrorCode ?? null;
  const baselineLastErrorMessage = baselineConnection?.lastErrorMessage ?? null;

  if (
    localLastErrorCode === null
    && localLastErrorMessage === null
    && (baselineLastErrorCode !== null || baselineLastErrorMessage !== null)
  ) {
    update.clearError = true;

    if ((baselineConnection?.lastSyncErrorAt ?? null) !== null) {
      update.lastSyncErrorAt = null;
    }

    return;
  }

  if (localLastErrorCode !== baselineLastErrorCode) {
    update.lastErrorCode = localLastErrorCode;
  }

  if (localLastErrorMessage !== baselineLastErrorMessage) {
    update.lastErrorMessage = localLastErrorMessage;
  }
}

function hasLocalPendingHostedChanges(account: StoredDeviceSyncAccount | null): boolean {
  if (!account?.hostedObservedUpdatedAt) {
    return false;
  }

  const localUpdatedAtMs = parseIsoMs(account.updatedAt);
  const hostedObservedUpdatedAtMs = parseIsoMs(account.hostedObservedUpdatedAt);

  if (localUpdatedAtMs === null || hostedObservedUpdatedAtMs === null) {
    return true;
  }

  return localUpdatedAtMs > hostedObservedUpdatedAtMs;
}

function hasHostedConnectionAdvanced(
  account: StoredDeviceSyncAccount | null,
  hostedUpdatedAt: string | null,
): boolean {
  if (!hostedUpdatedAt) {
    return !account?.hostedObservedUpdatedAt;
  }

  if (!account?.hostedObservedUpdatedAt) {
    return true;
  }

  const hostedUpdatedAtMs = parseIsoMs(hostedUpdatedAt);
  const hostedObservedUpdatedAtMs = parseIsoMs(account.hostedObservedUpdatedAt);

  if (hostedUpdatedAtMs === null || hostedObservedUpdatedAtMs === null) {
    return false;
  }

  return hostedUpdatedAtMs > hostedObservedUpdatedAtMs;
}

function hasHostedTokenAdvanced(
  account: StoredDeviceSyncAccount | null,
  hostedTokenVersion: number | null,
): boolean {
  if (hostedTokenVersion === null) {
    return false;
  }

  if (account?.hostedObservedTokenVersion === null || account?.hostedObservedTokenVersion === undefined) {
    return true;
  }

  return hostedTokenVersion > account.hostedObservedTokenVersion;
}

function mergeMonotonicTimestamp(
  localValue: string | null,
  hostedValue: string | null,
  preserveLocalAheadState: boolean,
): string | null {
  if (!preserveLocalAheadState) {
    return hostedValue;
  }

  return latestIsoTimestamp(localValue, hostedValue);
}

function latestIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftMs = parseIsoMs(left);
  const rightMs = parseIsoMs(right);

  if (leftMs === null) {
    return right;
  }

  if (rightMs === null) {
    return left;
  }

  return leftMs >= rightMs ? left : right;
}

function latestObservedTokenVersion(left: number | null, right: number | null): number | null {
  if (left === null || left === undefined) {
    return right ?? null;
  }

  if (right === null || right === undefined) {
    return left;
  }

  return Math.max(left, right);
}

function resolveHydratedHostedAccountUpdatedAt(input: {
  connectedAt: string;
  existing: StoredDeviceSyncAccount | null;
  hostedObservedUpdatedAt: string | null;
  useHostedConnectionState: boolean;
}): string {
  if (input.useHostedConnectionState) {
    return input.hostedObservedUpdatedAt ?? input.existing?.updatedAt ?? input.connectedAt;
  }

  return input.existing?.updatedAt ?? input.hostedObservedUpdatedAt ?? input.connectedAt;
}

function parseIsoMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function assignMonotonicTimestampUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  key: "lastWebhookAt" | "lastSyncStartedAt" | "lastSyncCompletedAt" | "lastSyncErrorAt",
  localValue: string | null,
  baselineValue: string | null,
): void {
  if (!localValue) {
    return;
  }

  if (baselineValue && Date.parse(localValue) <= Date.parse(baselineValue)) {
    return;
  }

  update[key] = localValue;
}

function hostedJobHintToDeviceSyncJobInput(
  hint: HostedExecutionDeviceSyncJobHint,
  fallbackAvailableAt: string,
): DeviceSyncJobInput {
  return {
    kind: hint.kind,
    ...(hint.availableAt ? { availableAt: hint.availableAt } : { availableAt: fallbackAvailableAt }),
    ...(hint.dedupeKey !== undefined ? { dedupeKey: hint.dedupeKey ?? undefined } : {}),
    ...(typeof hint.maxAttempts === "number" ? { maxAttempts: hint.maxAttempts } : {}),
    ...(hint.payload ? { payload: { ...hint.payload } } : {}),
    ...(typeof hint.priority === "number" ? { priority: hint.priority } : {}),
  };
}
