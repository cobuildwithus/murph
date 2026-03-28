import {
  createSecretCodec,
  type DeviceSyncJobInput,
  type DeviceSyncService,
  type StoredDeviceSyncAccount,
} from "@murph/device-syncd";
import type {
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import {
  applyHostedDeviceSyncRuntimeUpdates,
  fetchHostedDeviceSyncRuntimeSnapshot,
  normalizeHostedDeviceSyncJobHints,
  resolveHostedDeviceSyncWakeContext,
  type HostedDeviceSyncRuntimeConnectionSnapshot,
  type HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedDeviceSyncRuntimeSnapshotResponse,
  type HostedDeviceSyncRuntimeTokenBundle,
} from "./hosted-device-sync-control-plane.ts";

export interface HostedDeviceSyncRuntimeSyncState {
  hostedToLocalAccountIds: Map<string, string>;
  localToHostedAccountIds: Map<string, string>;
  observedTokenVersions: Map<string, number | null>;
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null;
}

export async function syncHostedDeviceSyncControlPlaneState(input: {
  dispatch: HostedExecutionDispatchRequest;
  env: Readonly<Record<string, string>>;
  secret: string;
  service: DeviceSyncService;
  timeoutMs: number | null;
}): Promise<HostedDeviceSyncRuntimeSyncState> {
  const snapshot = await fetchHostedDeviceSyncRuntimeSnapshot({
    env: input.env,
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
    const stored = input.service.store.hydrateHostedAccount({
      connectedAt: entry.connection.connectedAt,
      displayName: entry.connection.displayName ?? null,
      externalAccountId: entry.connection.externalAccountId,
      lastErrorCode: entry.connection.lastErrorCode ?? null,
      lastErrorMessage: entry.connection.lastErrorMessage ?? null,
      lastSyncCompletedAt: entry.connection.lastSyncCompletedAt ?? null,
      lastSyncErrorAt: entry.connection.lastSyncErrorAt ?? null,
      lastSyncStartedAt: entry.connection.lastSyncStartedAt ?? null,
      lastWebhookAt: entry.connection.lastWebhookAt ?? null,
      metadata: entry.connection.metadata,
      nextReconcileAt: entry.connection.nextReconcileAt ?? null,
      provider: entry.connection.provider,
      scopes: entry.connection.scopes,
      status: entry.connection.status,
      ...(entry.tokenBundle
        ? {
            tokens: {
              accessToken: entry.tokenBundle.accessToken,
              accessTokenEncrypted: codec.encrypt(entry.tokenBundle.accessToken),
              accessTokenExpiresAt: entry.tokenBundle.accessTokenExpiresAt ?? undefined,
              refreshToken: entry.tokenBundle.refreshToken ?? undefined,
              refreshTokenEncrypted: entry.tokenBundle.refreshToken
                ? codec.encrypt(entry.tokenBundle.refreshToken)
                : null,
            },
          }
        : {}),
      ...(entry.connection.status === "disconnected"
        ? {
            tokenCleartextPlaceholder: {
              accessTokenEncrypted: codec.encrypt(""),
            },
          }
        : {}),
    });

    if (!stored) {
      continue;
    }

    if (entry.connection.status === "disconnected") {
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
  env: Readonly<Record<string, string>>;
  secret: string;
  service: DeviceSyncService;
  state: HostedDeviceSyncRuntimeSyncState;
  timeoutMs: number | null;
}): Promise<void> {
  if (!input.state.snapshot) {
    return;
  }

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
    env: input.env,
    occurredAt: input.dispatch.occurredAt,
    timeoutMs: input.timeoutMs,
    updates,
    userId: input.dispatch.event.userId,
  });
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
  const localAccountId =
    (wake.connectionId ? input.hostedToLocalAccountIds.get(wake.connectionId) : null)
    ?? (wake.connectionId ? input.service.store.getAccountById(wake.connectionId)?.id ?? null : null);

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

    if (input.account.lastErrorCode && input.account.lastErrorCode !== baselineConnection?.lastErrorCode) {
      update.lastErrorCode = input.account.lastErrorCode;
    }

    if (input.account.lastErrorMessage && input.account.lastErrorMessage !== baselineConnection?.lastErrorMessage) {
      update.lastErrorMessage = input.account.lastErrorMessage;
    }

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

  const localLastErrorCode = input.account.lastErrorCode ?? null;
  const localLastErrorMessage = input.account.lastErrorMessage ?? null;
  const baselineLastErrorCode = baselineConnection?.lastErrorCode ?? null;
  const baselineLastErrorMessage = baselineConnection?.lastErrorMessage ?? null;

  if (
    localLastErrorCode === null
    && localLastErrorMessage === null
    && (baselineLastErrorCode !== null || baselineLastErrorMessage !== null)
  ) {
    update.clearError = true;
  } else {
    if (localLastErrorCode !== baselineLastErrorCode) {
      update.lastErrorCode = localLastErrorCode;
    }

    if (localLastErrorMessage !== baselineLastErrorMessage) {
      update.lastErrorMessage = localLastErrorMessage;
    }
  }

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

function equalJsonRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
