import {
  createSecretCodec,
  type DeviceSyncJobInput,
  type DeviceSyncService,
  type StoredDeviceSyncAccount,
} from "@murphai/device-syncd";
import type {
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDispatchRequest,
  HostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";
import {
  normalizeHostedDeviceSyncJobHints,
  resolveHostedExecutionDeviceSyncRuntimeClient,
  type HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot as HostedDeviceSyncRuntimeConnectionStateSnapshot,
  resolveHostedDeviceSyncWakeContext,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot as HostedDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeLocalStateSnapshot as HostedDeviceSyncRuntimeLocalStateSnapshot,
  type HostedExecutionDeviceSyncRuntimeLocalStateUpdate as HostedDeviceSyncRuntimeLocalStateUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse as HostedDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "@murphai/hosted-execution";

export interface HostedDeviceSyncRuntimeSyncState {
  hostedToLocalAccountIds: Map<string, string>;
  localToHostedAccountIds: Map<string, string>;
  observedTokenVersions: Map<string, number | null>;
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null;
}

type HostedAccountHydrationInput = Parameters<DeviceSyncService["store"]["hydrateHostedAccount"]>[0];
type HostedDeviceSyncRuntimeClient = ReturnType<typeof resolveHostedExecutionDeviceSyncRuntimeClient>;

export async function syncHostedDeviceSyncControlPlaneState(input: {
  dispatch: HostedExecutionDispatchRequest;
  fetchImpl?: typeof fetch;
  secret: string;
  service: DeviceSyncService;
  timeoutMs: number | null;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<HostedDeviceSyncRuntimeSyncState> {
  const client = resolveHostedDeviceSyncRuntimeClientForUser({
    boundUserId: input.dispatch.event.userId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    webControlPlane: input.webControlPlane,
  });
  if (!client) {
    return createEmptyHostedDeviceSyncRuntimeSyncState();
  }

  const snapshot = await client.fetchSnapshot();
  const state = createEmptyHostedDeviceSyncRuntimeSyncState(snapshot);
  if (!snapshot) {
    return state;
  }

  const codec = createSecretCodec(input.secret);
  const now = input.dispatch.occurredAt;

  for (const entry of snapshot.connections) {
    state.observedTokenVersions.set(entry.connection.id, entry.tokenBundle?.tokenVersion ?? null);
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

    state.hostedToLocalAccountIds.set(entry.connection.id, stored.id);
    state.localToHostedAccountIds.set(stored.id, entry.connection.id);
  }

  if (input.dispatch.event.kind === "device-sync.wake") {
    applyHostedDeviceSyncWakeHint({
      dispatch: input.dispatch,
      hostedToLocalAccountIds: state.hostedToLocalAccountIds,
      service: input.service,
    });
  }

  return state;
}

export async function reconcileHostedDeviceSyncControlPlaneState(input: {
  dispatch: HostedExecutionDispatchRequest;
  fetchImpl?: typeof fetch;
  secret: string;
  service: DeviceSyncService;
  state: HostedDeviceSyncRuntimeSyncState;
  timeoutMs: number | null;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): Promise<void> {
  if (!input.state.snapshot) {
    return;
  }

  const client = resolveHostedDeviceSyncRuntimeClientForUser({
    boundUserId: input.dispatch.event.userId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    webControlPlane: input.webControlPlane,
  });
  if (!client) {
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

  await client.applyUpdates({
    occurredAt: input.dispatch.occurredAt,
    updates,
  });
}

function createEmptyHostedDeviceSyncRuntimeSyncState(
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null = null,
): HostedDeviceSyncRuntimeSyncState {
  return {
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot,
  };
}

function resolveHostedDeviceSyncRuntimeClientForUser(input: {
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}): HostedDeviceSyncRuntimeClient {
  return resolveHostedExecutionDeviceSyncRuntimeClient({
    baseUrl: input.webControlPlane.deviceSyncRuntimeBaseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    internalToken: input.webControlPlane.internalToken,
    timeoutMs: input.timeoutMs,
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

  const wakePatch = buildHostedDeviceSyncWakeAccountPatch(account, wake.hint);
  if (wakePatch) {
    input.service.store.patchAccount(localAccountId, wakePatch);
  }
}

function buildHostedDeviceSyncWakeAccountPatch(
  account: Pick<StoredDeviceSyncAccount, "nextReconcileAt">,
  hint: ReturnType<typeof resolveHostedDeviceSyncWakeContext>["hint"],
): Partial<Pick<StoredDeviceSyncAccount, "nextReconcileAt">> | null {
  if (!hint || hint.nextReconcileAt === undefined) {
    return null;
  }

  const nextReconcileAt = resolveHostedWakeNextReconcileAt(
    account.nextReconcileAt ?? null,
    hint.nextReconcileAt,
  );
  return nextReconcileAt ? { nextReconcileAt } : null;
}

function buildHostedDeviceSyncRuntimeConnectionUpdate(input: {
  account: StoredDeviceSyncAccount;
  baseline: HostedDeviceSyncRuntimeConnectionSnapshot | null;
  codec: ReturnType<typeof createSecretCodec>;
  hostedConnectionId: string;
  observedTokenVersion: number | null;
}): HostedDeviceSyncRuntimeConnectionUpdate | null {
  const baselineConnection = input.baseline?.connection ?? null;
  const baselineLocalState = input.baseline
    ? resolveHostedDeviceSyncRuntimeLocalStateSnapshot(input.baseline)
    : null;
  const baselineTokenBundle = input.baseline?.tokenBundle ?? null;
  const hasLocalTokenEscrow = input.account.accessTokenEncrypted.length > 0;
  const tokenBundle = input.account.status === "disconnected" || !hasLocalTokenEscrow
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
    observedUpdatedAt: baselineConnection?.updatedAt ?? null,
  };

  if (input.account.status === "disconnected") {
    if (baselineConnection?.status !== "disconnected") {
      update.connection = {
        ...(update.connection ?? {}),
        status: "disconnected",
      };
    }

    assignErrorFieldUpdate(update, input.account, baselineLocalState);

    return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
  }

  if (input.account.status !== baselineConnection?.status) {
    update.connection = {
      ...(update.connection ?? {}),
      status: input.account.status,
    };
  }

  if (input.account.displayName !== (baselineConnection?.displayName ?? null)) {
    update.connection = {
      ...(update.connection ?? {}),
      displayName: input.account.displayName ?? null,
    };
  }

  if (!equalStringArrays(input.account.scopes, baselineConnection?.scopes ?? [])) {
    update.connection = {
      ...(update.connection ?? {}),
      scopes: [...input.account.scopes],
    };
  }

  if (!equalJsonRecords(input.account.metadata, baselineConnection?.metadata ?? {})) {
    update.connection = {
      ...(update.connection ?? {}),
      metadata: { ...input.account.metadata },
    };
  }

  assignForwardOnlyNextReconcileAtUpdate(
    update,
    input.account.nextReconcileAt ?? null,
    baselineLocalState?.nextReconcileAt ?? null,
  );

  if (!equalHostedDeviceSyncRuntimeTokenBundles(tokenBundle, baselineTokenBundle)) {
    update.observedTokenVersion = input.observedTokenVersion;
    update.tokenBundle = tokenBundle;
  }

  assignErrorFieldUpdate(update, input.account, baselineLocalState);

  assignMonotonicTimestampUpdate(update, "lastWebhookAt", input.account.lastWebhookAt, baselineLocalState?.lastWebhookAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncStartedAt", input.account.lastSyncStartedAt, baselineLocalState?.lastSyncStartedAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncCompletedAt", input.account.lastSyncCompletedAt, baselineLocalState?.lastSyncCompletedAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncErrorAt", input.account.lastSyncErrorAt, baselineLocalState?.lastSyncErrorAt ?? null);

  return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
}

function hasHostedDeviceSyncRuntimeConnectionUpdateChanges(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
): boolean {
  return update.connection !== undefined
    || update.localState !== undefined
    || update.tokenBundle !== undefined
    || update.observedTokenVersion !== undefined;
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
  const hostedLocalState = input.entry.localState;
  const hostedTokenVersion = input.entry.tokenBundle?.tokenVersion ?? null;
  const hostedUpdatedAt = hostedConnection.updatedAt ?? null;
  const nextHostedObservedUpdatedAt = hostedUpdatedAt ?? input.existing?.hostedObservedUpdatedAt ?? null;
  const nextHostedObservedTokenVersion = hostedTokenVersion ?? input.existing?.hostedObservedTokenVersion ?? null;
  const hostedStateAdvanced = didHostedStateAdvance(
    input.existing?.hostedObservedUpdatedAt ?? null,
    nextHostedObservedUpdatedAt,
  );

  return {
    clearTokens: input.entry.tokenBundle === null,
    hostedObservedTokenVersion: nextHostedObservedTokenVersion,
    hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
    connection: {
      connectedAt: hostedConnection.connectedAt,
      displayName: hostedConnection.displayName ?? null,
      externalAccountId: hostedConnection.externalAccountId,
      metadata: { ...hostedConnection.metadata },
      provider: hostedConnection.provider,
      scopes: [...hostedConnection.scopes],
      status: hostedConnection.status,
      updatedAt: resolveHydratedHostedAccountUpdatedAt({
        connectedAt: hostedConnection.connectedAt,
        existing: input.existing,
        hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
      }),
    },
    localState: resolveHydratedHostedLocalState({
      existing: input.existing,
      hostedLocalState,
      hostedStateAdvanced,
    }),
    ...(input.entry.tokenBundle
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
  baselineLocalState: HostedDeviceSyncRuntimeLocalStateSnapshot | null,
): void {
  const localLastErrorCode = account.lastErrorCode ?? null;
  const localLastErrorMessage = account.lastErrorMessage ?? null;
  const baselineLastErrorCode = baselineLocalState?.lastErrorCode ?? null;
  const baselineLastErrorMessage = baselineLocalState?.lastErrorMessage ?? null;

  if (
    localLastErrorCode === null
    && localLastErrorMessage === null
    && (baselineLastErrorCode !== null || baselineLastErrorMessage !== null)
  ) {
    update.localState = {
      ...(update.localState ?? {}),
      clearError: true,
    };

    if ((baselineLocalState?.lastSyncErrorAt ?? null) !== null) {
      update.localState = {
        ...(update.localState ?? {}),
        lastSyncErrorAt: null,
      };
    }

    return;
  }

  if (localLastErrorCode !== baselineLastErrorCode) {
    update.localState = {
      ...(update.localState ?? {}),
      lastErrorCode: localLastErrorCode,
    };
  }

  if (localLastErrorMessage !== baselineLastErrorMessage) {
    update.localState = {
      ...(update.localState ?? {}),
      lastErrorMessage: localLastErrorMessage,
    };
  }
}

function resolveHostedDeviceSyncRuntimeLocalStateSnapshot(
  entry: HostedDeviceSyncRuntimeConnectionSnapshot,
): HostedDeviceSyncRuntimeLocalStateSnapshot {
  return entry.localState;
}

function resolveHydratedHostedLocalState(input: {
  existing: StoredDeviceSyncAccount | null;
  hostedLocalState: HostedDeviceSyncRuntimeLocalStateSnapshot;
  hostedStateAdvanced: boolean;
}): {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncStartedAt: string | null;
  lastWebhookAt: string | null;
  nextReconcileAt: string | null;
} {
  const errorState = resolveHydratedHostedLocalErrorState(input);

  return {
    lastErrorCode: errorState.lastErrorCode,
    lastErrorMessage: errorState.lastErrorMessage,
    lastSyncCompletedAt: latestIsoTimestamp(
      input.existing?.lastSyncCompletedAt ?? null,
      input.hostedLocalState.lastSyncCompletedAt ?? null,
    ),
    lastSyncErrorAt: errorState.lastSyncErrorAt,
    lastSyncStartedAt: latestIsoTimestamp(
      input.existing?.lastSyncStartedAt ?? null,
      input.hostedLocalState.lastSyncStartedAt ?? null,
    ),
    lastWebhookAt: latestIsoTimestamp(
      input.existing?.lastWebhookAt ?? null,
      input.hostedLocalState.lastWebhookAt ?? null,
    ),
    nextReconcileAt: resolveHydratedNextReconcileAt(input),
  };
}

function resolveHydratedHostedLocalErrorState(input: {
  existing: StoredDeviceSyncAccount | null;
  hostedLocalState: HostedDeviceSyncRuntimeLocalStateSnapshot;
}): {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSyncErrorAt: string | null;
} {
  const localErrorAt = input.existing?.lastSyncErrorAt ?? null;
  const hostedErrorAt = input.hostedLocalState.lastSyncErrorAt ?? null;

  if (hostedErrorAt) {
    const latestErrorAt = latestIsoTimestamp(localErrorAt, hostedErrorAt);

    if (latestErrorAt === hostedErrorAt) {
      return {
        lastErrorCode: input.hostedLocalState.lastErrorCode ?? null,
        lastErrorMessage: input.hostedLocalState.lastErrorMessage ?? null,
        lastSyncErrorAt: hostedErrorAt,
      };
    }
  }

  const hostedClearedError = input.hostedLocalState.lastErrorCode === null
    && input.hostedLocalState.lastErrorMessage === null
    && hostedErrorAt === null;

  if (hostedClearedError) {
    if (!localErrorAt) {
      return {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncErrorAt: null,
      };
    }

    const hostedCompletedAtMs = input.hostedLocalState.lastSyncCompletedAt
      ? parseIsoMs(input.hostedLocalState.lastSyncCompletedAt)
      : null;
    const localErrorAtMs = parseIsoMs(localErrorAt);

    if (hostedCompletedAtMs !== null && localErrorAtMs !== null && hostedCompletedAtMs > localErrorAtMs) {
      return {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncErrorAt: null,
      };
    }
  }

  return {
    lastErrorCode: input.existing?.lastErrorCode ?? null,
    lastErrorMessage: input.existing?.lastErrorMessage ?? null,
    lastSyncErrorAt: localErrorAt,
  };
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

function didHostedStateAdvance(
  previousObservedUpdatedAt: string | null,
  nextObservedUpdatedAt: string | null,
): boolean {
  return Boolean(
    nextObservedUpdatedAt
      && nextObservedUpdatedAt !== previousObservedUpdatedAt
      && latestIsoTimestamp(previousObservedUpdatedAt, nextObservedUpdatedAt) === nextObservedUpdatedAt,
  );
}

function resolveHydratedHostedAccountUpdatedAt(input: {
  connectedAt: string;
  existing: StoredDeviceSyncAccount | null;
  hostedObservedUpdatedAt: string | null;
}): string {
  return input.hostedObservedUpdatedAt ?? input.existing?.updatedAt ?? input.connectedAt;
}

function resolveHydratedNextReconcileAt(input: {
  existing: StoredDeviceSyncAccount | null;
  hostedLocalState: HostedDeviceSyncRuntimeLocalStateSnapshot;
  hostedStateAdvanced: boolean;
}): string | null {
  const localNextReconcileAt = input.existing?.nextReconcileAt ?? null;
  const hostedNextReconcileAt = input.hostedLocalState.nextReconcileAt ?? null;

  if (!input.existing) {
    return hostedNextReconcileAt;
  }

  if (input.hostedStateAdvanced) {
    return hostedNextReconcileAt;
  }

  return latestIsoTimestamp(localNextReconcileAt, hostedNextReconcileAt);
}

function parseIsoMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveHostedWakeNextReconcileAt(
  existingValue: string | null,
  hintedValue: string | null | undefined,
): string | null {
  if (!hintedValue || hintedValue === existingValue) {
    return null;
  }

  return latestIsoTimestamp(existingValue, hintedValue) === hintedValue
    ? hintedValue
    : null;
}

function assignForwardOnlyNextReconcileAtUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  localValue: string | null,
  baselineValue: string | null,
): void {
  if (!localValue || localValue === baselineValue) {
    return;
  }

  if (latestIsoTimestamp(localValue, baselineValue) !== localValue) {
    return;
  }

  update.localState = {
    ...(update.localState ?? {}),
    nextReconcileAt: localValue,
  } satisfies HostedDeviceSyncRuntimeLocalStateUpdate;
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

  update.localState = {
    ...(update.localState ?? {}),
    [key]: localValue,
  } satisfies HostedDeviceSyncRuntimeLocalStateUpdate;
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
