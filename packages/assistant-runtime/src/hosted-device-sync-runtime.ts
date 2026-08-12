import { createHash } from "node:crypto";

import {
  COMPANION_HRV_RMSSD_RESOURCE,
  parseCompanionHrvRmssdAdmissionId,
  parseSerializedCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import {
  isJunctionCompanionHrvRmssdJob,
  JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE,
} from "@murphai/device-syncd/junction-resources";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "@murphai/device-syncd/local-secret-codec";
import type { DeviceSyncService } from "@murphai/device-syncd/service";
import type {
  DeviceSyncJobInput,
  DeviceSyncJobFailureDiagnostic,
  StoredDeviceConnectionSource,
  StoredDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
  mergeHostedDeviceSyncConnectionMetadata,
  mergeHostedDeviceSyncEventToProviderSendBuckets,
  normalizeHostedDeviceSyncJobHints,
  resolveHostedDeviceSyncWakeContext,
  sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata,
  serializeHostedExecutionDeviceSyncDirtyPayloadIdentity,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncRuntimeCredentialSnapshot as HostedDeviceSyncRuntimeCredentialSnapshot,
  HostedExecutionDeviceSyncRuntimeCredentialUpdate as HostedDeviceSyncRuntimeCredentialUpdate,
  HostedExecutionDeviceSyncDirtyResource,
  HostedExecutionDeviceSyncDirtyStateResponse,
  HostedDeviceSyncEventToProviderSendBucket,
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot as HostedDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate as HostedDeviceSyncRuntimeConnectionSourceUpdate,
  HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  HostedExecutionDeviceSyncRuntimeFailureDiagnostic as HostedDeviceSyncRuntimeFailureDiagnostic,
  HostedExecutionDeviceSyncRuntimeLocalStateSnapshot as HostedDeviceSyncRuntimeLocalStateSnapshot,
  HostedExecutionDeviceSyncRuntimeLocalStateUpdate as HostedDeviceSyncRuntimeLocalStateUpdate,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse as HostedDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
  HostedExecutionDeviceSyncRuntimeWritableCredentialSnapshot as HostedDeviceSyncRuntimeWritableCredentialSnapshot,
  HostedExecutionDeviceSyncStagedDirtyAck,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
} from "./hosted-runtime/platform.ts";
import { requireHostedRuntimeDeviceSyncStore } from "./device-sync-service.ts";
import {
  HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT,
} from "./hosted-device-sync-limits.ts";

export interface HostedDeviceSyncRuntimeSyncState {
  hostedToLocalAccountIds: Map<string, string>;
  localToHostedAccountIds: Map<string, string>;
  observedTokenVersions: Map<string, number | null>;
  pendingDirtyAcks: HostedDeviceSyncRuntimeDirtyAck[];
  pendingDirtyPayloadJobs: HostedDeviceSyncRuntimeDirtyPayloadJob[];
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null;
  /** True when a connection-scoped wake lacks authority for the hydrated epoch. */
  wakeSuperseded?: boolean;
}

export interface HostedDeviceSyncRuntimeDirtyAck {
  connectionId: string;
  nextWakeAt: string | null;
  processedDirtyPayloadIds?: string[];
  processedRevision: string;
}

export interface HostedDeviceSyncRuntimeDirtyPayloadJob {
  connectionId: string;
  dirtyPayloadId: string | null;
  jobId: string;
  processedRevision: string;
  timing?: HostedDeviceSyncImportTiming;
}

export interface HostedDeviceSyncImportTiming {
  eventToProviderSendBucket: HostedDeviceSyncEventToProviderSendBucket | null;
  firstWebhookReceivedAt: string | null;
  providerSendToWebhookMs: number | null;
  sourceProvider: string | null;
}

export interface HostedDeviceSyncCompletedImportTiming extends HostedDeviceSyncImportTiming {
  importCompletedAt: string;
  importExecutionStartedAt: string | null;
  jobCreatedAt: string;
  jobKind: string;
  provider: string;
}

interface HostedDirtyDeviceSyncJob {
  dirtyPayloadId: string | null;
  input: DeviceSyncJobInput;
  resource: HostedExecutionDeviceSyncDirtyResource;
}

interface HostedDirtyDeviceSyncApplyResult {
  ack: HostedDeviceSyncRuntimeDirtyAck;
  pendingDirtyPayloadJobs: HostedDeviceSyncRuntimeDirtyPayloadJob[];
}

type HostedRuntimeDeviceSyncStore = ReturnType<typeof requireHostedRuntimeDeviceSyncStore>;
type HostedAccountHydrationInput = Parameters<HostedRuntimeDeviceSyncStore["hydrateHostedAccount"]>[0];
type HostedDeviceSyncRuntimeClient = HostedRuntimeDeviceSyncPort | null;
type HostedDirtyDeviceSyncStateSkipReason =
  | "connection_missing"
  | "disconnected"
  | "local_account_missing"
  | "provider_mismatch"
  | "provider_not_registered"
  | "reauthorization_required";
type HostedTerminalDeviceSyncStatus = "disconnected" | "reauthorization_required";

export async function syncHostedDeviceSyncControlPlaneState(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  secret: string;
  service: DeviceSyncService;
  snapshot?: HostedDeviceSyncRuntimeSnapshotResponse | null;
  signal?: AbortSignal | null;
  skipDirtyPendingFetch?: boolean;
  stagedDirtyAcks?: readonly HostedExecutionDeviceSyncStagedDirtyAck[] | null;
  wake: HostedRuntimeEvent;
}): Promise<HostedDeviceSyncRuntimeSyncState> {
  const client = resolveHostedDeviceSyncRuntimeClientForUser(input.deviceSyncPort);
  if (!client) {
    throw new Error(
      "Hosted device-sync control-plane sync requires a configured hosted device-sync control-plane port.",
    );
  }

  const snapshot = input.snapshot === undefined
    ? (input.signal
      ? await client.fetchSnapshot({
          includeCredentialMaterial: true,
          signal: input.signal,
        })
      : await client.fetchSnapshot({ includeCredentialMaterial: true }))
    : input.snapshot;
  const state = createEmptyHostedDeviceSyncRuntimeSyncState(
    snapshot ? { ...snapshot, connections: [] } : null,
  );
  if (!snapshot) {
    return state;
  }

  const codec = createSecretCodec(input.secret);
  const now = input.wake.occurredAt;
  const store = requireHostedRuntimeDeviceSyncStore(input.service);

  const orderedConnections = [
    ...snapshot.connections.filter((entry) => isTerminalHostedPrivacyScrub(entry.connection)),
    ...snapshot.connections.filter((entry) => !isTerminalHostedPrivacyScrub(entry.connection)),
  ];
  let classifyJunctionProviderJob: HostedAccountHydrationInput["classifyProviderJob"];
  for (const entry of orderedConnections) {
    const existingByHostedConnection = store.getAccountByHostedConnectionId(
      entry.connection.id,
    );
    const existingByExternalAccount = store.getAccountByExternalAccount(
      entry.connection.provider,
      entry.connection.externalAccountId,
    );
    const existing = existingByHostedConnection
      ?? existingByExternalAccount
      ?? (isTerminalHostedPrivacyScrub(entry.connection)
        ? store.getUnboundAccountByConnectionEpoch(
            entry.connection.provider,
            entry.connection.connectedAt,
          )
        : null);
    if (
      entry.connection.provider === "junction"
      && existing
      && existing.connectedAt !== entry.connection.connectedAt
      && !classifyJunctionProviderJob
    ) {
      ({
        isJunctionCredentialIndependentInlineImportJob: classifyJunctionProviderJob,
      } = await import("@murphai/device-syncd/junction-inline-authority"));
    }
    const stored = store.hydrateHostedAccount(
      buildHostedAccountHydrationInput({
        classifyProviderJob: entry.connection.provider === "junction"
          ? classifyJunctionProviderJob
          : undefined,
        codec,
        entry,
        existing,
      }),
    );

    if (!stored) {
      continue;
    }

    const hostedConnectionEpochChanged = Boolean(
      existing && existing.connectedAt !== stored.connectedAt,
    );
    const terminalStatus = readHostedTerminalDeviceSyncStatus(stored);
    const localSources = store.listConnectionSources({ connectionId: stored.id });
    const localSourcesByKey = new Map(
      localSources.map(
        (source) => [source.sourceInstanceKey, source] as const,
      ),
    );
    for (const source of entry.sources ?? []) {
      if (!source.sourceInstanceKey) {
        continue;
      }

      const sourceInstanceKey = resolveHostedHydrationSourceInstanceKey({
        entry,
        localSources,
        source,
        sourceInstanceKey: source.sourceInstanceKey,
      });
      const localSource = localSourcesByKey.get(sourceInstanceKey);
      if (
        !terminalStatus
        && localSource
        && shouldPreserveLocalHydrationSource({
          hostedConnectionEpochChanged,
          localSource,
          source,
        })
      ) {
        continue;
      }

      const hydratedSource = store.upsertConnectionSource({
        connectionId: stored.id,
        sourceInstanceKey,
        sourceProviderSlug: source.sourceProviderSlug,
        displayName: source.displayName,
        status: source.status,
        ...(source.resourceAvailabilitySummary === undefined
          ? {}
          : { resourceAvailabilitySummary: source.resourceAvailabilitySummary }),
        lastErrorCode: source.lastErrorCode,
        lastErrorMessage: source.lastErrorMessage,
        firstSeenAt: source.firstSeenAt,
        lastSeenAt: source.lastSeenAt,
        // Merged monotonically below rather than taken verbatim: Web and the
        // runner can each have seen an arrival the other has not.
        lastDataAt: laterIsoTimestamp(source.lastDataAt ?? null, localSource?.lastDataAt ?? null),
      });
      localSourcesByKey.set(sourceInstanceKey, hydratedSource);
    }

    if (terminalStatus) {
      markHostedTerminalDeviceSyncJobsDead({
        accountId: stored.id,
        now,
        status: terminalStatus,
        store,
      });
    }

    state.hostedToLocalAccountIds.set(entry.connection.id, stored.id);
    state.localToHostedAccountIds.set(stored.id, entry.connection.id);
    state.observedTokenVersions.set(entry.connection.id, stored.hostedObservedTokenVersion ?? null);
    state.snapshot?.connections.push(
      buildAcceptedHostedDeviceSyncRuntimeSnapshotEntry({
        codec,
        entry,
        stored,
      }),
    );
  }

  if (input.wake.kind === "device-sync.wake") {
    const superseded = await applyHostedDeviceSyncWakeHint({
      wake: input.wake,
      hostedToLocalAccountIds: state.hostedToLocalAccountIds,
      service: input.service,
    });
    if (superseded) {
      state.wakeSuperseded = true;
      return state;
    }
  }
  if (input.skipDirtyPendingFetch !== true) {
    const dirtyState = await applyHostedPendingDirtyDeviceSyncState({
      deviceSyncPort: client,
      hostedToLocalAccountIds: state.hostedToLocalAccountIds,
      signal: input.signal ?? null,
      service: input.service,
      stagedDirtyAcks: input.stagedDirtyAcks ?? null,
      wake: input.wake,
    });
    state.pendingDirtyAcks = dirtyState.acks;
    state.pendingDirtyPayloadJobs = dirtyState.pendingDirtyPayloadJobs;
  }

  return state;
}

function isTerminalHostedPrivacyScrub(
  connection: HostedDeviceSyncRuntimeConnectionSnapshot["connection"],
): boolean {
  return connection.status !== "active"
    && connection.externalAccountId === `opaque:${connection.id}`;
}

function resolveHostedHydrationSourceInstanceKey(input: {
  entry: HostedDeviceSyncRuntimeConnectionSnapshot;
  localSources: readonly StoredDeviceConnectionSource[];
  source: NonNullable<HostedDeviceSyncRuntimeConnectionSnapshot["sources"]>[number];
  sourceInstanceKey: string;
}): string {
  if (input.entry.connection.provider.trim().toLowerCase() !== "junction") {
    return input.sourceInstanceKey;
  }

  const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.entry.connection.id,
    sourceProviderSlug: input.source.sourceProviderSlug,
  });
  const matchingSource = input.localSources.find((source) =>
    source.sourceInstanceKey === canonicalSourceInstanceKey
  ) ?? input.localSources.find((source) =>
    source.sourceInstanceKey === input.sourceInstanceKey
  ) ?? input.localSources.find((source) =>
    source.sourceProviderSlug === input.source.sourceProviderSlug
  );

  return matchingSource?.sourceInstanceKey
    ?? canonicalSourceInstanceKey
    ?? input.sourceInstanceKey;
}

function shouldPreserveLocalHydrationSource(input: {
  hostedConnectionEpochChanged: boolean;
  localSource: StoredDeviceConnectionSource;
  source: NonNullable<HostedDeviceSyncRuntimeConnectionSnapshot["sources"]>[number];
}): boolean {
  if (input.hostedConnectionEpochChanged) {
    return false;
  }

  // An arrival can advance with no other field moving, so a lastSeenAt-only
  // shortcut would drop the one signal a stall is measured against.
  if (
    laterIsoTimestamp(input.source.lastDataAt ?? null, input.localSource.lastDataAt)
      !== input.localSource.lastDataAt
  ) {
    return false;
  }

  return Date.parse(input.localSource.lastSeenAt) >= Date.parse(input.source.lastSeenAt);
}

/** Returns whichever ISO timestamp is later, treating null as "never". */
function laterIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export async function reconcileHostedDeviceSyncControlPlaneState(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  secret: string;
  signal?: AbortSignal | null;
  service: DeviceSyncService;
  state: HostedDeviceSyncRuntimeSyncState;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  if (!input.state.snapshot) {
    return;
  }

  const client = resolveHostedDeviceSyncRuntimeClientForUser(input.deviceSyncPort);
  if (!client) {
    throw new Error(
      "Hosted device-sync control-plane reconciliation requires a configured hosted device-sync control-plane port.",
    );
  }

  const codec = createSecretCodec(input.secret);
  const updates: HostedDeviceSyncRuntimeConnectionUpdate[] = [];
  const store = requireHostedRuntimeDeviceSyncStore(input.service);
  const snapshotByConnectionId = new Map(
    input.state.snapshot.connections.map((entry) => [entry.connection.id, entry]),
  );
  const failureDiagnosticByLocalAccountId = new Map(
    input.service.listJobFailureDiagnostics().map((entry) => [entry.accountId, entry]),
  );

  for (const [localAccountId, hostedConnectionId] of input.state.localToHostedAccountIds.entries()) {
    const account = store.getAccountById(localAccountId);

    if (!account) {
      continue;
    }

    const update = buildHostedDeviceSyncRuntimeConnectionUpdate({
      account,
      baseline: snapshotByConnectionId.get(hostedConnectionId) ?? null,
      codec,
      failureDiagnostic: failureDiagnosticByLocalAccountId.get(localAccountId) ?? null,
      hostedConnectionId,
      nextReconcileAt: account.status === "active"
        ? earliestIsoTimestamp(
            account.nextReconcileAt ?? null,
            store.readNextJobWakeAtForAccount(account.id),
          )
        : account.nextReconcileAt ?? null,
      observedTokenVersion: input.state.observedTokenVersions.get(hostedConnectionId) ?? null,
      sourceApplyEnabled: input.state.snapshot?.capabilities?.connectionSourceApply === true,
      sources: store.listConnectionSources({
        connectionId: account.id,
      }),
    });

    if (update) {
      updates.push(update);
    }
  }

  let offset = 0;
  do {
    await client.applyUpdates({
      occurredAt: input.wake.occurredAt,
      ...(input.signal ? { signal: input.signal } : {}),
      updates: updates.slice(
        offset,
        offset + HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
      ),
    });
    offset += HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT;
  } while (offset < updates.length);
}

function createEmptyHostedDeviceSyncRuntimeSyncState(
  snapshot: HostedDeviceSyncRuntimeSnapshotResponse | null = null,
): HostedDeviceSyncRuntimeSyncState {
  return {
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    pendingDirtyAcks: [],
    pendingDirtyPayloadJobs: [],
    snapshot,
  };
}

function resolveHostedDeviceSyncRuntimeClientForUser(
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined,
): HostedDeviceSyncRuntimeClient {
  return deviceSyncPort ?? null;
}

function readHostedTerminalDeviceSyncStatus(
  account: Pick<StoredDeviceSyncAccount, "status">,
): HostedTerminalDeviceSyncStatus | null {
  if (account.status === "disconnected" || account.status === "reauthorization_required") {
    return account.status;
  }

  return null;
}

function markHostedTerminalDeviceSyncJobsDead(input: {
  accountId: string;
  now: string;
  status: HostedTerminalDeviceSyncStatus;
  store: HostedRuntimeDeviceSyncStore;
}): void {
  if (input.status === "disconnected") {
    input.store.markPendingJobsDeadForAccount(
      input.accountId,
      input.now,
      "HOSTED_CONTROL_PLANE_DISCONNECTED",
      "Hosted control plane marked the device-sync connection as disconnected.",
    );
    return;
  }

  input.store.markPendingJobsDeadForAccount(
    input.accountId,
    input.now,
    "HOSTED_CONTROL_PLANE_REAUTHORIZATION_REQUIRED",
    "Hosted control plane marked the device-sync connection as requiring reconnection.",
  );
}

async function applyHostedDeviceSyncWakeHint(input: {
  wake: HostedRuntimeEvent;
  hostedToLocalAccountIds: Map<string, string>;
  service: DeviceSyncService;
}): Promise<boolean> {
  if (input.wake.kind !== "device-sync.wake") {
    return false;
  }

  const wake = resolveHostedDeviceSyncWakeContext(input.wake);
  const localAccountId = wake.connectionId ? input.hostedToLocalAccountIds.get(wake.connectionId) ?? null : null;
  const store = requireHostedRuntimeDeviceSyncStore(input.service);

  if (!localAccountId) {
    return false;
  }

  const account = store.getAccountById(localAccountId);

  if (!account) {
    return false;
  }

  // Missing epochs remain readable during deploy skew, but have no authority.
  if (
    wake.expectedConnectedAt === null
    || wake.expectedConnectedAt !== account.connectedAt
  ) {
    return true;
  }

  const terminalStatus = readHostedTerminalDeviceSyncStatus(account);
  if (terminalStatus) {
    markHostedTerminalDeviceSyncJobsDead({
      accountId: localAccountId,
      now: input.wake.occurredAt,
      status: terminalStatus,
      store,
    });
    return false;
  }

  if (input.wake.reason === "disconnected") {
    store.disconnectAccount(localAccountId, input.wake.occurredAt);
    store.markPendingJobsDeadForAccount(
      localAccountId,
      input.wake.occurredAt,
      "HOSTED_DEVICE_SYNC_DISCONNECTED",
      "Hosted device-sync wake marked the connection as disconnected.",
    );
    return false;
  }

  if (input.wake.reason === "reauthorization_required") {
    store.patchAccount(localAccountId, {
      nextReconcileAt: null,
      status: "reauthorization_required",
    });
    store.markPendingJobsDeadForAccount(
      localAccountId,
      input.wake.occurredAt,
      "HOSTED_DEVICE_SYNC_REAUTHORIZATION_REQUIRED",
      "Hosted device-sync wake marked the connection as requiring reconnection.",
    );
    return false;
  }

  if (
    input.wake.reason === "reconcile_due"
    && wake.hint?.reason === "manual_reconcile"
  ) {
    input.service.queueManualReconcile(localAccountId);
    return false;
  }

  const jobHints = normalizeHostedDeviceSyncJobHints(wake.hint);

  for (const hint of jobHints) {
    const job = hostedJobHintToDeviceSyncJobInput(hint, input.wake.occurredAt);
    store.enqueueJob({
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
    store.patchAccount(localAccountId, wakePatch);
  }

  return false;
}

async function applyHostedPendingDirtyDeviceSyncState(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
  hostedToLocalAccountIds: Map<string, string>;
  signal?: AbortSignal | null;
  service: DeviceSyncService;
  stagedDirtyAcks?: readonly HostedExecutionDeviceSyncStagedDirtyAck[] | null;
  wake: HostedRuntimeEvent;
}): Promise<{
  acks: HostedDeviceSyncRuntimeDirtyAck[];
  pendingDirtyPayloadJobs: HostedDeviceSyncRuntimeDirtyPayloadJob[];
}> {
  const pending = await input.deviceSyncPort.fetchDirtyStates({
    limit: HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.stagedDirtyAcks && input.stagedDirtyAcks.length > 0
      ? { stagedDirtyAcks: [...input.stagedDirtyAcks] }
      : {}),
  });
  const acks: HostedDeviceSyncRuntimeDirtyAck[] = [];
  const pendingDirtyPayloadJobs: HostedDeviceSyncRuntimeDirtyPayloadJob[] = [];

  for (const dirtyState of pending.items) {
    const applied = applyHostedDirtyDeviceSyncState({
      dirtyState,
      hostedToLocalAccountIds: input.hostedToLocalAccountIds,
      nextWakeAt: pending.nextWakeAt,
      service: input.service,
      wake: input.wake,
    });

    if (applied) {
      acks.push(applied.ack);
      pendingDirtyPayloadJobs.push(...applied.pendingDirtyPayloadJobs);
    }
  }

  return { acks, pendingDirtyPayloadJobs };
}

function applyHostedDirtyDeviceSyncState(input: {
  dirtyState: HostedExecutionDeviceSyncDirtyStateResponse;
  hostedToLocalAccountIds: Map<string, string>;
  nextWakeAt: string | null;
  service: DeviceSyncService;
  wake: HostedRuntimeEvent;
}): HostedDirtyDeviceSyncApplyResult | null {
  const localAccountId = input.hostedToLocalAccountIds.get(input.dirtyState.connectionId) ?? null;
  if (!localAccountId) {
    reportHostedDirtyDeviceSyncStateSkipped({
      dirtyState: input.dirtyState,
      reason: "connection_missing",
      wake: input.wake,
    });
    return null;
  }

  const store = requireHostedRuntimeDeviceSyncStore(input.service);
  const account = store.getAccountById(localAccountId);
  if (!account) {
    reportHostedDirtyDeviceSyncStateSkipped({
      dirtyState: input.dirtyState,
      reason: "local_account_missing",
      wake: input.wake,
    });
    return null;
  }

  if (account.provider !== input.dirtyState.provider) {
    reportHostedDirtyDeviceSyncStateSkipped({
      account,
      dirtyState: input.dirtyState,
      reason: "provider_mismatch",
      wake: input.wake,
    });
    return null;
  }

  const dirtyJobs = buildHostedDirtyDeviceSyncJobs(input.dirtyState, input.wake.occurredAt);
  const acceptedCompanionHrvJobs = dirtyJobs.filter((job) =>
    isJunctionCompanionHrvRmssdJob({
      kind: job.input.kind,
      payload: job.input.payload,
      provider: account.provider,
    })
  );
  const terminalStatus = readHostedTerminalDeviceSyncStatus(account);
  if (terminalStatus) {
    reportHostedDirtyDeviceSyncStateSkipped({
      account,
      dirtyState: input.dirtyState,
      reason: terminalStatus,
      wake: input.wake,
    });
    if (acceptedCompanionHrvJobs.length > 0 && !input.service.registry.get(account.provider)) {
      reportHostedDirtyDeviceSyncStateSkipped({
        account,
        dirtyState: input.dirtyState,
        reason: "provider_not_registered",
        wake: input.wake,
      });
      return null;
    }
    const pendingDirtyPayloadJobs = enqueueHostedDirtyDeviceSyncJobs({
      accountId: localAccountId,
      connectionId: input.dirtyState.connectionId,
      jobs: acceptedCompanionHrvJobs,
      processedRevision: input.dirtyState.dirtyRevision,
      provider: account.provider,
      store,
    });
    markHostedTerminalDeviceSyncJobsDead({
      accountId: localAccountId,
      now: input.wake.occurredAt,
      status: terminalStatus,
      store,
    });
    return {
      ack: {
        connectionId: input.dirtyState.connectionId,
        nextWakeAt: input.nextWakeAt,
        ...withHostedDirtyPayloadAckIds(
          input.dirtyState,
          pendingDirtyPayloadJobs.flatMap((job) =>
            job.dirtyPayloadId ? [job.dirtyPayloadId] : []
          ),
        ),
        processedRevision: input.dirtyState.dirtyRevision,
      },
      pendingDirtyPayloadJobs,
    };
  }

  if (!input.service.registry.get(account.provider)) {
    reportHostedDirtyDeviceSyncStateSkipped({
      account,
      dirtyState: input.dirtyState,
      reason: "provider_not_registered",
      wake: input.wake,
    });
    return null;
  }

  const pendingDirtyPayloadJobs = enqueueHostedDirtyDeviceSyncJobs({
    accountId: localAccountId,
    connectionId: input.dirtyState.connectionId,
    jobs: dirtyJobs,
    processedRevision: input.dirtyState.dirtyRevision,
    provider: account.provider,
    store,
  });

  return {
    ack: {
      connectionId: input.dirtyState.connectionId,
      nextWakeAt: input.nextWakeAt,
      ...withHostedDirtyPayloadAckIds(
        input.dirtyState,
        pendingDirtyPayloadJobs.flatMap((job) =>
          job.dirtyPayloadId ? [job.dirtyPayloadId] : []
        ),
      ),
      processedRevision: input.dirtyState.dirtyRevision,
    },
    pendingDirtyPayloadJobs,
  };
}

function withHostedDirtyPayloadAckIds(
  dirtyState: HostedExecutionDeviceSyncDirtyStateResponse,
  deferredIds: readonly string[] = [],
): Pick<HostedDeviceSyncRuntimeDirtyAck, "processedDirtyPayloadIds"> | Record<string, never> {
  const deferred = new Set(deferredIds);
  const ids = dirtyState.dirtyResources
    .map((resource) => resource.dirtyPayloadId)
    .filter((id): id is string =>
      typeof id === "string" && id.length > 0 && !deferred.has(id)
    );

  return ids.length > 0 ? { processedDirtyPayloadIds: [...new Set(ids)] } : {};
}

function reportHostedDirtyDeviceSyncStateSkipped(input: {
  account?: Pick<StoredDeviceSyncAccount, "provider"> | null;
  dirtyState: HostedExecutionDeviceSyncDirtyStateResponse;
  reason: HostedDirtyDeviceSyncStateSkipReason;
  wake: HostedRuntimeEvent;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      dirtyConnectionFingerprint: fingerprintHostedDeviceSyncRuntimeId(input.dirtyState.connectionId),
      dirtyProvider: input.dirtyState.provider,
      eventCode: `dirty_state.${input.reason}`,
      localProvider: input.account?.provider ?? null,
      reason: input.reason,
    },
    level: "warn",
    message: `Hosted device-sync dirty state skipped: dirty_state.${input.reason}.`,
    phase: "wake.running",
    wake: input.wake,
  });
}

function buildHostedDirtyDeviceSyncJobs(
  dirtyState: HostedExecutionDeviceSyncDirtyStateResponse,
  occurredAt: string,
): HostedDirtyDeviceSyncJob[] {
  const dirtyResources = dirtyState.dirtyResources.length > 0
    ? dirtyState.dirtyResources
    : [{
        count: 1,
        jobKind: "reconcile",
        payload: undefined,
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        windowEnd: dirtyState.windowEnd,
        windowStart: dirtyState.windowStart,
      }];

  return dirtyResources.map((resource) => ({
    dirtyPayloadId:
      typeof resource.dirtyPayloadId === "string" && resource.dirtyPayloadId.length > 0
      ? resource.dirtyPayloadId
      : null,
    input: hostedDirtyResourceToDeviceSyncJobInput(resource, dirtyState, occurredAt),
    resource,
  }));
}

function enqueueHostedDirtyDeviceSyncJobs(input: {
  accountId: string;
  connectionId: string;
  jobs: readonly HostedDirtyDeviceSyncJob[];
  processedRevision: string;
  provider: string;
  store: HostedRuntimeDeviceSyncStore;
}): HostedDeviceSyncRuntimeDirtyPayloadJob[] {
  return input.jobs.flatMap((job) => {
    const enqueued = input.store.enqueueJob({
      accountId: input.accountId,
      availableAt: job.input.availableAt,
      dedupeKey: job.input.dedupeKey,
      kind: job.input.kind,
      maxAttempts: job.input.maxAttempts,
      payload: job.input.payload ?? {},
      priority: job.input.priority ?? 0,
      provider: input.provider,
    });
    const timing = buildHostedDeviceSyncImportTiming({
      provider: input.provider,
      resource: job.resource,
    });
    return job.dirtyPayloadId || "timing" in timing
      ? [{
          connectionId: input.connectionId,
          dirtyPayloadId: job.dirtyPayloadId,
          jobId: enqueued.id,
          processedRevision: input.processedRevision,
          ...timing,
        }]
      : [];
  });
}

function buildHostedDeviceSyncImportTiming(
  input: {
    provider: string;
    resource: HostedExecutionDeviceSyncDirtyResource;
  },
): { timing: HostedDeviceSyncImportTiming } | Record<string, never> {
  const eventToProviderSendBucket = input.resource.eventToProviderSendBucket ?? null;
  const firstWebhookReceivedAt = input.resource.firstWebhookReceivedAt ?? null;
  const providerSendToWebhookMs = input.resource.providerSendToWebhookMs ?? null;
  if (!eventToProviderSendBucket && !firstWebhookReceivedAt && providerSendToWebhookMs === null) {
    return {};
  }

  return {
    timing: {
      eventToProviderSendBucket,
      firstWebhookReceivedAt,
      providerSendToWebhookMs,
      sourceProvider: input.resource.timingSourceProviderSlug === undefined
        ? input.resource.sourceProviderSlug ?? input.provider
        : input.resource.timingSourceProviderSlug,
    },
  };
}

/**
 * Promotes payloads whose local owner reached a durable terminal decision.
 * Successful companion jobs and generic jobs that ran while their account was
 * active acknowledge their payloads. Generic provider jobs also acknowledge a
 * terminal failure so the same hosted row cannot recreate dead work forever.
 * A generic job marked succeeded only because its account disconnected stays
 * hosted, and companion RMSSD remains hosted until canonical import succeeds.
 */
export function promoteHostedCompletedDirtyPayloadAcks(input: {
  service: DeviceSyncService;
  state: HostedDeviceSyncRuntimeSyncState;
}): HostedDeviceSyncCompletedImportTiming[] {
  if (input.state.pendingDirtyPayloadJobs.length === 0) {
    return [];
  }

  const store = requireHostedRuntimeDeviceSyncStore(input.service);
  const completedImportsByJobId = new Map<
    string,
    HostedDeviceSyncCompletedImportTiming
  >();
  const completedByAck = new Map<string, Set<string>>();
  const remaining: HostedDeviceSyncRuntimeDirtyPayloadJob[] = [];
  for (const pending of input.state.pendingDirtyPayloadJobs) {
    const job = store.getJobById(pending.jobId);
    const isCompanionHrv = job ? isJunctionCompanionHrvRmssdJob(job) : false;
    const completed = job?.status === "dead"
      ? !isCompanionHrv
        || job.lastErrorCode === JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE
      : job?.status === "succeeded" && (
        isCompanionHrv
        || store.getAccountById(job.accountId)?.status === "active"
      );
    if (!completed) {
      remaining.push(pending);
      continue;
    }
    if (
      job?.status === "succeeded"
      && job.finishedAt
      && pending.timing
    ) {
      const completedImport = {
        ...pending.timing,
        importCompletedAt: job.finishedAt,
        importExecutionStartedAt: job.startedAt,
        jobCreatedAt: job.createdAt,
        jobKind: job.kind,
        provider: job.provider,
      };
      const previous = completedImportsByJobId.get(job.id);
      completedImportsByJobId.set(
        job.id,
        previous
          ? {
              ...completedImport,
              ...mergeHostedDeviceSyncImportTiming(previous, completedImport),
            }
          : completedImport,
      );
    }
    const ackKey = buildHostedDirtyAckKey(pending.connectionId, pending.processedRevision);
    const ids = completedByAck.get(ackKey) ?? new Set<string>();
    if (pending.dirtyPayloadId) {
      ids.add(pending.dirtyPayloadId);
    }
    completedByAck.set(ackKey, ids);
  }

  for (const ack of input.state.pendingDirtyAcks) {
    const completedIds = completedByAck.get(
      buildHostedDirtyAckKey(ack.connectionId, ack.processedRevision),
    );
    if (!completedIds || completedIds.size === 0) {
      continue;
    }
    ack.processedDirtyPayloadIds = [
      ...new Set([
        ...(ack.processedDirtyPayloadIds ?? []),
        ...completedIds,
      ]),
    ];
  }
  input.state.pendingDirtyPayloadJobs = remaining;
  return [...completedImportsByJobId.values()];
}

function mergeHostedDeviceSyncImportTiming(
  left: HostedDeviceSyncImportTiming,
  right: HostedDeviceSyncImportTiming,
): HostedDeviceSyncImportTiming {
  return {
    eventToProviderSendBucket: mergeHostedDeviceSyncEventToProviderSendBuckets(
      left.eventToProviderSendBucket,
      right.eventToProviderSendBucket,
    ),
    firstWebhookReceivedAt: minOptionalIso(
      left.firstWebhookReceivedAt,
      right.firstWebhookReceivedAt,
    ),
    providerSendToWebhookMs: maxOptionalDurationMs(
      left.providerSendToWebhookMs,
      right.providerSendToWebhookMs,
    ),
    sourceProvider: left.sourceProvider === right.sourceProvider
      ? left.sourceProvider
      : null,
  };
}

function minOptionalIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxOptionalDurationMs(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}

function buildHostedDirtyAckKey(connectionId: string, processedRevision: string): string {
  return `${connectionId}\0${processedRevision}`;
}

function hostedDirtyResourceToDeviceSyncJobInput(
  resource: HostedExecutionDeviceSyncDirtyResource,
  dirtyState: HostedExecutionDeviceSyncDirtyStateResponse,
  occurredAt: string,
): DeviceSyncJobInput {
  const hasManifestPayload = Boolean(resource.payload && Object.keys(resource.payload).length > 0);
  const payload: Record<string, unknown> = {
    ...(resource.payload ?? {}),
  };
  if (shouldApplyHostedDirtyWindowDefaults(resource, payload, hasManifestPayload)) {
    payload.windowEnd =
      readHostedDirtyPayloadString(payload.windowEnd) ?? resource.windowEnd ?? dirtyState.windowEnd ?? occurredAt;
    payload.windowStart =
      readHostedDirtyPayloadString(payload.windowStart) ?? resource.windowStart ?? dirtyState.windowStart ?? occurredAt;
  }

  if (!hasManifestPayload && resource.jobKind === "resource" && resource.resource) {
    payload.resource = resource.resource;
  }
  if (!hasManifestPayload && resource.jobKind === "resource" && resource.resourceCategory) {
    payload.resourceCategory = resource.resourceCategory;
  }
  if (!hasManifestPayload && resource.jobKind === "resource" && resource.sourceProviderSlug) {
    payload.sourceProviderSlug = resource.sourceProviderSlug;
  }
  const dedupeKey = [
    "hosted-dirty",
    dirtyState.provider,
    resource.jobKind,
    ...(typeof resource.maxAttempts === "number" ? [`attempts-${resource.maxAttempts}`] : []),
    resource.sourceProviderSlug ?? "provider",
    resource.resourceCategory ?? "category",
    resource.resource ?? "resource",
    buildHostedDirtyPayloadDedupeKey(payload),
    payload.windowStart,
    payload.windowEnd,
  ].join(":");

  return {
    kind: resource.jobKind,
    ...(typeof resource.maxAttempts === "number" ? { maxAttempts: resource.maxAttempts } : {}),
    payload,
    priority: 60,
    dedupeKey,
  };
}

function readHostedDirtyPayloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function shouldApplyHostedDirtyWindowDefaults(
  resource: HostedExecutionDeviceSyncDirtyResource,
  payload: Record<string, unknown>,
  hasManifestPayload: boolean,
): boolean {
  if (hasManifestPayload) {
    return Object.prototype.hasOwnProperty.call(payload, "windowEnd")
      || Object.prototype.hasOwnProperty.call(payload, "windowStart");
  }

  return resource.jobKind !== "delete" && resource.jobKind !== "deauthorize";
}

function buildHostedDirtyPayloadDedupeKey(payload: Record<string, unknown>): string {
  if (payload.resource === COMPANION_HRV_RMSSD_RESOURCE) {
    try {
      const observation = parseSerializedCompanionHrvRmssdObservation(
        payload.companionObservationJson,
      );
      const admissionId = parseCompanionHrvRmssdAdmissionId(
        payload.companionAdmissionId,
      );
      const expectedAdmissionId = createHash("sha256")
        .update(serializeCompanionHrvRmssdObservation(observation))
        .digest("hex");
      if (admissionId !== expectedAdmissionId) {
        throw new TypeError("Companion HRV admission identity did not match its observation.");
      }
      return `companion-admission-${admissionId}`;
    } catch {
      // The provider boundary will produce the durable validation failure.
    }
  }

  const identity = serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(payload);
  return identity ? createHash("sha256").update(identity).digest("hex").slice(0, 24) : "payload";
}

function fingerprintHostedDeviceSyncRuntimeId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
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
  failureDiagnostic: DeviceSyncJobFailureDiagnostic | null;
  hostedConnectionId: string;
  nextReconcileAt: string | null;
  observedTokenVersion: number | null;
  sourceApplyEnabled: boolean;
  sources: readonly StoredDeviceConnectionSource[];
}): HostedDeviceSyncRuntimeConnectionUpdate | null {
  const baselineConnection = input.baseline?.connection ?? null;
  const baselineLocalState = input.baseline
    ? resolveHostedDeviceSyncRuntimeLocalStateSnapshot(input.baseline)
    : null;
  const baselineCredential = input.baseline
    ? resolveHostedDeviceSyncRuntimeCredentialSnapshot(input.baseline)
    : null;
  const credential = buildHostedDeviceSyncRuntimeCredentialSnapshotFromAccount({
    account: input.account,
    baselineCredential,
    codec: input.codec,
    observedTokenVersion: input.observedTokenVersion,
  });
  const baselineTokenBundle = baselineCredential
    ? getHostedDeviceSyncRuntimeOAuthTokenBundle(baselineCredential)
    : null;
  const update: HostedDeviceSyncRuntimeConnectionUpdate = {
    connectionId: input.hostedConnectionId,
    observedConnectedAt: baselineConnection?.connectedAt ?? null,
    observedUpdatedAt: baselineConnection?.updatedAt ?? null,
  };
  const sources = input.sourceApplyEnabled && input.account.status !== "disconnected"
    ? buildHostedDeviceSyncRuntimeConnectionSourceUpdates(
        input.sources,
        input.baseline?.sources ?? [],
      )
    : [];
  if (sources.length > 0) {
    update.sources = sources;
  }

  if (input.account.status === "disconnected") {
    if (baselineConnection?.status !== "disconnected") {
      update.connection = {
        ...(update.connection ?? {}),
        status: "disconnected",
      };
    }

    if ((baselineConnection?.setupPhase ?? null) !== null) {
      update.connection = {
        ...(update.connection ?? {}),
        setupPhase: null,
      };
    }

    if ((baselineConnection?.setupExpiresAt ?? null) !== null) {
      update.connection = {
        ...(update.connection ?? {}),
        setupExpiresAt: null,
      };
    }

    if (baselineTokenBundle !== null) {
      update.observedTokenVersion = input.observedTokenVersion;
      assignHostedDeviceSyncRuntimeCredentialUpdate(update, {
        clearTokens: true,
        kind: "oauth_tokens",
      });
    }

    assignErrorFieldUpdate(update, input.account, baselineLocalState);
    assignNextReconcileAtUpdate(
      update,
      input.account.status,
      input.nextReconcileAt,
      baselineLocalState?.nextReconcileAt ?? null,
    );
    assignFailureDiagnosticUpdate(
      update,
      input.account.lastSyncErrorAt ?? null,
      baselineLocalState?.lastSyncErrorAt ?? null,
      input.failureDiagnostic,
    );

    return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
  }

  if (input.account.status !== baselineConnection?.status) {
    update.connection = {
      ...(update.connection ?? {}),
      status: input.account.status,
    };
  }

  if ((input.account.setupPhase ?? null) !== (baselineConnection?.setupPhase ?? null)) {
    update.connection = {
      ...(update.connection ?? {}),
      setupPhase: input.account.setupPhase ?? null,
    };
  }

  if ((input.account.setupExpiresAt ?? null) !== (baselineConnection?.setupExpiresAt ?? null)) {
    update.connection = {
      ...(update.connection ?? {}),
      setupExpiresAt: input.account.setupExpiresAt ?? null,
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

  assignNextReconcileAtUpdate(
    update,
    input.account.status,
    input.nextReconcileAt,
    baselineLocalState?.nextReconcileAt ?? null,
  );

  if (!equalHostedDeviceSyncRuntimeCredentials(credential, baselineCredential)) {
    if (credential.kind === "none" && baselineTokenBundle !== null) {
      assignHostedDeviceSyncRuntimeCredentialUpdate(update, {
        clearTokens: true,
        kind: "oauth_tokens",
      });
    } else if (credential.kind !== "oauth_tokens_redacted") {
      assignHostedDeviceSyncRuntimeCredentialUpdate(update, credential);
    }

    if (hostedDeviceSyncRuntimeCredentialUpdateRequiresTokenFence(update.credential)) {
      update.observedTokenVersion = input.observedTokenVersion;
    }
  }

  assignErrorFieldUpdate(update, input.account, baselineLocalState);

  assignMonotonicTimestampUpdate(update, "lastWebhookAt", input.account.lastWebhookAt, baselineLocalState?.lastWebhookAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncStartedAt", input.account.lastSyncStartedAt, baselineLocalState?.lastSyncStartedAt ?? null);
  assignMonotonicTimestampUpdate(update, "lastSyncCompletedAt", input.account.lastSyncCompletedAt, baselineLocalState?.lastSyncCompletedAt ?? null);
  assignFailureDiagnosticUpdate(
    update,
    input.account.lastSyncErrorAt ?? null,
    baselineLocalState?.lastSyncErrorAt ?? null,
    input.failureDiagnostic,
  );

  return hasHostedDeviceSyncRuntimeConnectionUpdateChanges(update) ? update : null;
}

function hasHostedDeviceSyncRuntimeConnectionUpdateChanges(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
): boolean {
  return update.connection !== undefined
    || update.localState !== undefined
    || update.credential !== undefined
    || update.failureDiagnostic !== undefined
    || update.observedTokenVersion !== undefined
    || (update.sources !== undefined && update.sources.length > 0);
}

function buildHostedDeviceSyncRuntimeConnectionSourceUpdates(
  sources: readonly StoredDeviceConnectionSource[],
  baselineSources: readonly NonNullable<HostedDeviceSyncRuntimeConnectionSnapshot["sources"]>[number][],
): HostedDeviceSyncRuntimeConnectionSourceUpdate[] {
  const baselineByInstanceKey = new Map(
    baselineSources
      .filter((source) => Boolean(source.sourceInstanceKey))
      .map((source) => [source.sourceInstanceKey as string, source]),
  );

  return sources
    .map((source): HostedDeviceSyncRuntimeConnectionSourceUpdate => {
      const baseline = baselineByInstanceKey.get(source.sourceInstanceKey) ?? null;

      return {
        sourceInstanceKey: source.sourceInstanceKey,
        sourceProviderSlug: source.sourceProviderSlug,
        observedLastSeenAt: baseline?.lastSeenAt ?? null,
        displayName: source.displayName ?? null,
        status: source.status,
        resourceAvailabilitySummary: { ...source.resourceAvailabilitySummary },
        lastErrorCode: source.lastErrorCode ?? null,
        lastErrorMessage: source.lastErrorMessage ?? null,
        firstSeenAt: source.firstSeenAt,
        lastSeenAt: source.lastSeenAt,
        lastDataAt: source.lastDataAt,
      };
    })
    .filter((source) =>
      !hostedDeviceSyncRuntimeSourceUpdateMatchesBaseline(
        source,
        baselineByInstanceKey.get(source.sourceInstanceKey) ?? null,
      )
    );
}

function hostedDeviceSyncRuntimeSourceUpdateMatchesBaseline(
  update: HostedDeviceSyncRuntimeConnectionSourceUpdate,
  baseline: NonNullable<HostedDeviceSyncRuntimeConnectionSnapshot["sources"]>[number] | null,
): boolean {
  if (!baseline) {
    return false;
  }

  return baseline.sourceProviderSlug === update.sourceProviderSlug
    && (baseline.displayName ?? null) === (update.displayName ?? null)
    && baseline.status === update.status
    && equalJsonRecords(
      baseline.resourceAvailabilitySummary ?? {},
      update.resourceAvailabilitySummary ?? {},
    )
    && (baseline.lastErrorCode ?? null) === (update.lastErrorCode ?? null)
    && (baseline.lastErrorMessage ?? null) === (update.lastErrorMessage ?? null)
    && baseline.firstSeenAt === (update.firstSeenAt ?? null)
    && baseline.lastSeenAt === update.lastSeenAt
    && (baseline.lastDataAt ?? null) === (update.lastDataAt ?? null);
}

function assignHostedDeviceSyncRuntimeCredentialUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  credential: HostedDeviceSyncRuntimeWritableCredentialSnapshot | HostedDeviceSyncRuntimeCredentialUpdate,
): void {
  update.credential = cloneHostedDeviceSyncRuntimeCredentialUpdate(credential);
}

function hostedDeviceSyncRuntimeCredentialUpdateRequiresTokenFence(
  credential: HostedDeviceSyncRuntimeConnectionUpdate["credential"],
): boolean {
  return credential !== undefined;
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

function equalHostedDeviceSyncRuntimeCredentials(
  left: HostedDeviceSyncRuntimeCredentialSnapshot,
  right: HostedDeviceSyncRuntimeCredentialSnapshot | null,
): boolean {
  if (!right || left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "oauth_tokens":
      return right.kind === "oauth_tokens"
        && equalHostedDeviceSyncRuntimeTokenBundles(left.tokenBundle, right.tokenBundle);
    case "oauth_tokens_redacted":
      return right.kind === "oauth_tokens_redacted"
        && left.tokenVersion === right.tokenVersion
        && equalJsonRecords(left.credentialMetadata ?? {}, right.credentialMetadata ?? {});
    case "provider_config":
      return right.kind === "provider_config"
        && left.providerConfigKey === right.providerConfigKey
        && equalJsonRecords(left.credentialMetadata ?? {}, right.credentialMetadata ?? {});
    case "none":
      return true;
  }
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildStoredDeviceSyncTokenCipherOptions(
  input: { externalAccountId: string; provider: string },
  purpose: "device-sync-access-token" | "device-sync-refresh-token",
) {
  return buildDeviceSyncTokenCipherOptions({
    externalAccountId: input.externalAccountId,
    provider: input.provider,
    purpose,
  });
}

function buildHostedDeviceSyncRuntimeCredentialSnapshotFromAccount(input: {
  account: StoredDeviceSyncAccount;
  baselineCredential: HostedDeviceSyncRuntimeCredentialSnapshot | null;
  codec: ReturnType<typeof createSecretCodec>;
  keyVersion?: string;
  observedTokenVersion: number | null;
}): HostedDeviceSyncRuntimeCredentialSnapshot {
  if (input.baselineCredential?.kind === "oauth_tokens_redacted") {
    return cloneHostedDeviceSyncRuntimeCredentialSnapshot(input.baselineCredential);
  }

  const storedCredential = buildHostedDeviceSyncRuntimeStoredCredentialSnapshot(input.account);
  if (storedCredential) {
    return storedCredential;
  }

  if (input.baselineCredential?.kind === "provider_config") {
    return cloneHostedDeviceSyncRuntimeCredentialSnapshot(input.baselineCredential);
  }

  const tokenBundle = buildHostedDeviceSyncRuntimeTokenBundleFromAccount(input);

  if (tokenBundle) {
    return {
      kind: "oauth_tokens",
      tokenBundle,
    };
  }

  return {
    credentialMetadata: {},
    kind: "none",
  };
}

function buildHostedDeviceSyncRuntimeStoredCredentialSnapshot(
  account: StoredDeviceSyncAccount,
): HostedDeviceSyncRuntimeCredentialSnapshot | null {
  if (account.credential.kind === "provider_config") {
    const providerConfigKey = account.credential.providerConfigKey.trim();
    if (!providerConfigKey) {
      return {
        credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
          account.credential.credentialMetadata,
        ),
        kind: "none",
      };
    }

    const credentialMetadata = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
      account.credential.credentialMetadata,
    );
    return {
      kind: "provider_config",
      providerConfigKey,
      credentialMetadata,
    };
  }

  if (account.credential.kind === "none") {
    return {
      credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
        account.credential.credentialMetadata,
      ),
      kind: "none",
    };
  }

  return null;
}

function buildHostedDeviceSyncRuntimeTokenBundleFromAccount(input: {
  account: StoredDeviceSyncAccount;
  codec: ReturnType<typeof createSecretCodec>;
  keyVersion?: string;
  observedTokenVersion: number | null;
}): HostedDeviceSyncRuntimeTokenBundle | null {
  const credential = input.account.credential.kind === "oauth_tokens"
    ? input.account.credential
    : null;

  if (input.account.status === "disconnected" || !credential) {
    return null;
  }

  return {
    accessToken: input.codec.decrypt(
      credential.accessTokenEncrypted,
      buildStoredDeviceSyncTokenCipherOptions(input.account, "device-sync-access-token"),
    ),
    accessTokenExpiresAt: credential.accessTokenExpiresAt ?? null,
    keyVersion: input.keyVersion ?? "local-runtime",
    refreshToken: credential.refreshTokenEncrypted
      ? input.codec.decrypt(
        credential.refreshTokenEncrypted,
        buildStoredDeviceSyncTokenCipherOptions(input.account, "device-sync-refresh-token"),
      )
      : null,
    tokenVersion: input.observedTokenVersion ?? 1,
  } satisfies HostedDeviceSyncRuntimeTokenBundle;
}

function buildAcceptedHostedDeviceSyncRuntimeSnapshotEntry(input: {
  codec: ReturnType<typeof createSecretCodec>;
  entry: HostedDeviceSyncRuntimeConnectionSnapshot;
  stored: StoredDeviceSyncAccount;
}): HostedDeviceSyncRuntimeConnectionSnapshot {
  const baselineCredential = resolveHostedDeviceSyncRuntimeCredentialSnapshot(input.entry);
  const credential = buildHostedDeviceSyncRuntimeCredentialSnapshotFromAccount({
    account: input.stored,
    baselineCredential,
    codec: input.codec,
    keyVersion: baselineCredential.kind === "oauth_tokens"
      ? baselineCredential.tokenBundle.keyVersion
      : "local-runtime",
    observedTokenVersion: input.stored.hostedObservedTokenVersion ?? null,
  });
  const baselineMetadata = shouldUseRawHostedMetadataBaseline({
    entry: input.entry,
    stored: input.stored,
  })
    ? input.entry.connection.metadata
    : input.stored.metadata;

  return {
    connection: {
      accessTokenExpiresAt: input.stored.accessTokenExpiresAt ?? null,
      connectedAt: input.stored.connectedAt,
      createdAt: input.entry.connection.createdAt,
      displayName: input.stored.displayName ?? null,
      externalAccountId: input.stored.externalAccountId,
      id: input.entry.connection.id,
      metadata: { ...baselineMetadata },
      provider: input.stored.provider,
      scopes: [...input.stored.scopes],
      setupExpiresAt: input.stored.setupExpiresAt ?? null,
      setupPhase: input.stored.setupPhase ?? null,
      status: input.stored.status,
      ...(input.stored.hostedObservedUpdatedAt
        ? {
            updatedAt: input.stored.hostedObservedUpdatedAt,
          }
        : {}),
    },
    localState: {
      ...resolveHostedDeviceSyncRuntimeLocalStateSnapshot(input.entry),
    },
    ...(input.entry.sources === undefined ? {} : { sources: input.entry.sources }),
    credential,
  };
}

function shouldUseRawHostedMetadataBaseline(input: {
  entry: HostedDeviceSyncRuntimeConnectionSnapshot;
  stored: StoredDeviceSyncAccount;
}): boolean {
  return mergeHostedDeviceSyncConnectionMetadata({
    hostedMetadata: input.entry.connection.metadata,
    localConnectionStateUnpublished: Boolean(
      input.stored.hostedObservedUpdatedAt
        && input.stored.hostedObservedUpdatedAt === input.entry.connection.updatedAt
        && input.stored.localConnectionRevision !== input.stored.hostedObservedConnectionRevision,
    ),
    localMetadata: input.stored.metadata,
  }).preservedLocalProgress;
}

function buildHostedAccountHydrationInput(input: {
  classifyProviderJob?: HostedAccountHydrationInput["classifyProviderJob"];
  codec: ReturnType<typeof createSecretCodec>;
  entry: HostedDeviceSyncRuntimeConnectionSnapshot;
  existing: StoredDeviceSyncAccount | null;
}): HostedAccountHydrationInput {
  const hostedConnection = input.entry.connection;
  const hostedLocalState = input.entry.localState;
  const hostedCredential = resolveHostedDeviceSyncRuntimeCredentialSnapshot(input.entry);
  const hostedTokenBundle = getHostedDeviceSyncRuntimeOAuthTokenBundle(hostedCredential);
  const hostedTokenVersion = getHostedDeviceSyncRuntimeObservedTokenVersion(hostedCredential);
  const hostedUpdatedAt = hostedConnection.updatedAt ?? null;
  const previousHostedObservedUpdatedAt = input.existing?.hostedObservedUpdatedAt ?? null;
  const previousHostedObservedTokenVersion = input.existing?.hostedObservedTokenVersion ?? null;
  const hostedConnectionStateStale = isStaleHostedObservedUpdatedAt(
    previousHostedObservedUpdatedAt,
    hostedUpdatedAt,
  );
  const hostedConnectionStateReplayed = isReplayedHostedObservedUpdatedAt({
    hostedObservedConnectionRevision: input.existing?.hostedObservedConnectionRevision ?? 0,
    localConnectionRevision: input.existing?.localConnectionRevision ?? 0,
    nextObservedUpdatedAt: hostedUpdatedAt,
    previousObservedUpdatedAt: previousHostedObservedUpdatedAt,
  });
  const hostedTokenStateStale = isStaleHostedObservedTokenVersion(
    previousHostedObservedTokenVersion,
    hostedTokenVersion,
  );
  const hostedTokenStateReplayed = isReplayedHostedObservedTokenVersion({
    hostedObservedTokenRevision: input.existing?.hostedObservedTokenRevision ?? 0,
    localTokenRevision: input.existing?.localTokenRevision ?? 0,
    nextObservedTokenVersion: hostedTokenVersion,
    previousObservedTokenVersion: previousHostedObservedTokenVersion,
  });
  const hostedConnectionEpochChanged = Boolean(
    input.existing
      && !hostedConnectionStateStale
      && !hostedConnectionStateReplayed
      && input.existing.connectedAt !== hostedConnection.connectedAt,
  );
  const shouldClearTokens = hostedCredential.kind === "none"
    && !hostedConnectionStateStale
    && !hostedConnectionStateReplayed
    && !hostedTokenStateStale
    && !hostedTokenStateReplayed;
  const credential = buildHostedAccountHydrationCredential({
    credential: hostedCredential,
    existing: input.existing,
  });
  const nextHostedObservedUpdatedAt = hostedConnectionStateStale || hostedConnectionStateReplayed
    ? previousHostedObservedUpdatedAt
    : hostedUpdatedAt ?? previousHostedObservedUpdatedAt;
  const nextHostedObservedTokenVersion = shouldClearTokens
    ? null
    : (hostedTokenStateStale || hostedTokenStateReplayed)
      ? previousHostedObservedTokenVersion
      : hostedTokenVersion ?? previousHostedObservedTokenVersion;
  const hostedStateAdvanced = didHostedStateAdvance(
    previousHostedObservedUpdatedAt,
    nextHostedObservedUpdatedAt,
  );
  const localConnectionStateUnpublished = Boolean(
    input.existing
      && !hostedConnectionEpochChanged
      && input.existing.localConnectionRevision !== input.existing.hostedObservedConnectionRevision,
  );
  const hydratedMetadata = mergeHostedDeviceSyncConnectionMetadata({
    hostedMetadata: hostedConnection.metadata,
    localConnectionStateUnpublished,
    localMetadata: hostedConnectionEpochChanged ? undefined : input.existing?.metadata,
  });
  const preserveUnpublishedLocalProviderProgress = Boolean(
    input.existing
      && hydratedMetadata.preservedLocalProgress,
  );
  const connection = (hostedConnectionStateStale || hostedConnectionStateReplayed) && input.existing
    ? {
        connectedAt: input.existing.connectedAt,
        displayName: input.existing.displayName ?? null,
        externalAccountId: input.existing.externalAccountId,
        metadata: { ...input.existing.metadata },
        provider: input.existing.provider,
        scopes: [...input.existing.scopes],
        setupExpiresAt: input.existing.setupExpiresAt ?? null,
        setupPhase: input.existing.setupPhase ?? null,
        status: input.existing.status,
        updatedAt: input.existing.updatedAt,
      }
    : {
        connectedAt: hostedConnection.connectedAt,
        displayName: hostedConnection.displayName ?? null,
        externalAccountId: hostedConnection.externalAccountId,
        metadata: hydratedMetadata.metadata,
        provider: hostedConnection.provider,
        scopes: [...hostedConnection.scopes],
        setupExpiresAt: hostedConnection.setupExpiresAt ?? null,
        setupPhase: hostedConnection.setupPhase ?? null,
        status: hostedConnection.status,
        updatedAt: resolveHydratedHostedAccountUpdatedAt({
          connectedAt: hostedConnection.connectedAt,
          existing: input.existing,
          hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
        }),
      };

  return {
    clearTokens: shouldClearTokens,
    advanceHostedObservedConnectionRevision: !preserveUnpublishedLocalProviderProgress,
    ...(input.classifyProviderJob
      ? { classifyProviderJob: input.classifyProviderJob }
      : {}),
    ...(credential ? { credential } : {}),
    hostedConnectionId: hostedConnection.id,
    hostedObservedTokenVersion: nextHostedObservedTokenVersion,
    hostedObservedUpdatedAt: nextHostedObservedUpdatedAt,
    connection,
    localState: resolveHydratedHostedLocalState({
      existing: input.existing,
      hostedLocalState,
      hostedStateAdvanced,
      preserveUnpublishedLocalProviderProgress,
      status: connection.status,
    }),
    ...(hostedTokenBundle && !hostedTokenStateStale && !hostedTokenStateReplayed
      ? {
          tokens: {
            accessToken: hostedTokenBundle.accessToken,
            accessTokenEncrypted: input.codec.encrypt(
              hostedTokenBundle.accessToken,
              buildStoredDeviceSyncTokenCipherOptions(hostedConnection, "device-sync-access-token"),
            ),
            accessTokenExpiresAt: hostedTokenBundle.accessTokenExpiresAt ?? undefined,
            refreshToken: hostedTokenBundle.refreshToken ?? undefined,
            refreshTokenEncrypted: hostedTokenBundle.refreshToken
              ? input.codec.encrypt(
                hostedTokenBundle.refreshToken,
                buildStoredDeviceSyncTokenCipherOptions(hostedConnection, "device-sync-refresh-token"),
              )
              : null,
          },
        }
      : {}),
  };
}

function buildHostedAccountHydrationCredential(input: {
  existing: StoredDeviceSyncAccount | null;
  credential: HostedDeviceSyncRuntimeCredentialSnapshot;
}): HostedAccountHydrationInput["credential"] {
  if (input.credential.kind === "oauth_tokens_redacted") {
    if (input.existing) {
      return undefined;
    }

    return {
      credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
        input.credential.credentialMetadata,
      ),
      kind: "none",
    };
  }

  if (input.credential.kind === "provider_config") {
    const credentialMetadata = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
      input.credential.credentialMetadata,
    );
    return {
      kind: "provider_config",
      providerConfigKey: input.credential.providerConfigKey,
      credentialMetadata,
    };
  }

  if (input.credential.kind === "none") {
    return {
      credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
        input.credential.credentialMetadata,
      ),
      kind: "none",
    };
  }

  return undefined;
}

function resolveHostedDeviceSyncRuntimeCredentialSnapshot(
  entry: HostedDeviceSyncRuntimeConnectionSnapshot,
): HostedDeviceSyncRuntimeCredentialSnapshot {
  return cloneHostedDeviceSyncRuntimeCredentialSnapshot(entry.credential);
}

function getHostedDeviceSyncRuntimeOAuthTokenBundle(
  credential: HostedDeviceSyncRuntimeCredentialSnapshot,
): HostedDeviceSyncRuntimeTokenBundle | null {
  return credential.kind === "oauth_tokens"
    ? credential.tokenBundle
    : null;
}

function getHostedDeviceSyncRuntimeObservedTokenVersion(
  credential: HostedDeviceSyncRuntimeCredentialSnapshot,
): number | null {
  if (credential.kind === "oauth_tokens") {
    return credential.tokenBundle.tokenVersion;
  }

  if (credential.kind === "oauth_tokens_redacted") {
    return credential.tokenVersion;
  }

  return null;
}

function cloneHostedDeviceSyncRuntimeCredentialSnapshot(
  credential: HostedDeviceSyncRuntimeCredentialSnapshot,
): HostedDeviceSyncRuntimeCredentialSnapshot {
  switch (credential.kind) {
    case "oauth_tokens":
      return {
        kind: "oauth_tokens",
        tokenBundle: cloneHostedDeviceSyncRuntimeTokenBundle(credential.tokenBundle),
      };
    case "oauth_tokens_redacted":
      return {
        credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
          credential.credentialMetadata,
        ),
        kind: "oauth_tokens_redacted",
        tokenVersion: credential.tokenVersion,
      };
    case "provider_config": {
      const credentialMetadata = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
        credential.credentialMetadata,
      );
      return {
        kind: "provider_config",
        providerConfigKey: credential.providerConfigKey,
        credentialMetadata,
      };
    }
    case "none":
      return {
        credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
          credential.credentialMetadata,
        ),
        kind: "none",
      };
  }
}

function cloneHostedDeviceSyncRuntimeCredentialUpdate(
  credential: HostedDeviceSyncRuntimeWritableCredentialSnapshot | HostedDeviceSyncRuntimeCredentialUpdate,
): HostedDeviceSyncRuntimeCredentialUpdate {
  if (credential.kind === "oauth_tokens" && "clearTokens" in credential) {
    return {
      clearTokens: true,
      kind: "oauth_tokens",
    };
  }

  switch (credential.kind) {
    case "oauth_tokens":
      return {
        kind: "oauth_tokens",
        tokenBundle: cloneHostedDeviceSyncRuntimeTokenBundle(credential.tokenBundle),
      };
    case "provider_config":
      return {
        credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
          credential.credentialMetadata,
        ),
        kind: "provider_config",
        providerConfigKey: credential.providerConfigKey,
      };
    case "none":
      return {
        credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
          credential.credentialMetadata,
        ),
        kind: "none",
      };
  }
}

function cloneHostedDeviceSyncRuntimeTokenBundle(
  tokenBundle: HostedDeviceSyncRuntimeTokenBundle,
): HostedDeviceSyncRuntimeTokenBundle {
  return {
    accessToken: tokenBundle.accessToken,
    accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt,
    keyVersion: tokenBundle.keyVersion,
    refreshToken: tokenBundle.refreshToken,
    tokenVersion: tokenBundle.tokenVersion,
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
  preserveUnpublishedLocalProviderProgress: boolean;
  status: StoredDeviceSyncAccount["status"];
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

function earliestIsoTimestamp(left: string | null, right: string | null): string | null {
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

  return leftMs <= rightMs ? left : right;
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

function isStaleHostedObservedUpdatedAt(
  previousObservedUpdatedAt: string | null,
  nextObservedUpdatedAt: string | null,
): boolean {
  if (
    !previousObservedUpdatedAt
    || !nextObservedUpdatedAt
    || previousObservedUpdatedAt === nextObservedUpdatedAt
  ) {
    return false;
  }

  const previousObservedUpdatedAtMs = parseIsoMs(previousObservedUpdatedAt);
  const nextObservedUpdatedAtMs = parseIsoMs(nextObservedUpdatedAt);

  return previousObservedUpdatedAtMs !== null
    && nextObservedUpdatedAtMs !== null
    && nextObservedUpdatedAtMs < previousObservedUpdatedAtMs;
}

function isReplayedHostedObservedUpdatedAt(input: {
  hostedObservedConnectionRevision: number;
  localConnectionRevision: number;
  nextObservedUpdatedAt: string | null;
  previousObservedUpdatedAt: string | null;
}): boolean {
  return Boolean(
    input.previousObservedUpdatedAt
      && input.nextObservedUpdatedAt
      && input.previousObservedUpdatedAt === input.nextObservedUpdatedAt
      && input.localConnectionRevision !== input.hostedObservedConnectionRevision,
  );
}

function isStaleHostedObservedTokenVersion(
  previousObservedTokenVersion: number | null,
  nextObservedTokenVersion: number | null,
): boolean {
  return typeof previousObservedTokenVersion === "number"
    && typeof nextObservedTokenVersion === "number"
    && nextObservedTokenVersion < previousObservedTokenVersion;
}

function isReplayedHostedObservedTokenVersion(input: {
  hostedObservedTokenRevision: number;
  localTokenRevision: number;
  nextObservedTokenVersion: number | null;
  previousObservedTokenVersion: number | null;
}): boolean {
  return typeof input.previousObservedTokenVersion === "number"
    && typeof input.nextObservedTokenVersion === "number"
    && input.previousObservedTokenVersion === input.nextObservedTokenVersion
    && input.localTokenRevision !== input.hostedObservedTokenRevision;
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
  preserveUnpublishedLocalProviderProgress: boolean;
  status: StoredDeviceSyncAccount["status"];
}): string | null {
  if (input.status === "disconnected" || input.status === "reauthorization_required") {
    return null;
  }

  const localNextReconcileAt = input.existing?.nextReconcileAt ?? null;
  const hostedNextReconcileAt = input.hostedLocalState.nextReconcileAt ?? null;

  if (!input.existing) {
    return hostedNextReconcileAt;
  }

  if (input.preserveUnpublishedLocalProviderProgress && localNextReconcileAt) {
    return earliestIsoTimestamp(localNextReconcileAt, hostedNextReconcileAt);
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

function assignFailureDiagnosticUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  localLastSyncErrorAt: string | null,
  baselineLastSyncErrorAt: string | null,
  diagnostic: DeviceSyncJobFailureDiagnostic | null,
): void {
  assignMonotonicTimestampUpdate(
    update,
    "lastSyncErrorAt",
    localLastSyncErrorAt,
    baselineLastSyncErrorAt,
  );

  if (!didHostedRuntimeFailureTimestampAdvance(localLastSyncErrorAt, baselineLastSyncErrorAt)) {
    return;
  }

  const failureDiagnostic = toHostedRuntimeFailureDiagnostic(diagnostic);
  if (failureDiagnostic) {
    update.failureDiagnostic = failureDiagnostic;
  }
}

function didHostedRuntimeFailureTimestampAdvance(
  localValue: string | null,
  baselineValue: string | null,
): boolean {
  if (!localValue) {
    return false;
  }

  if (!baselineValue) {
    return true;
  }

  const localMs = parseIsoMs(localValue);
  const baselineMs = parseIsoMs(baselineValue);

  return localMs !== null && (baselineMs === null || localMs > baselineMs);
}

function toHostedRuntimeFailureDiagnostic(
  diagnostic: DeviceSyncJobFailureDiagnostic | null,
): HostedDeviceSyncRuntimeFailureDiagnostic | null {
  if (!diagnostic) {
    return null;
  }

  return {
    accountStatus: diagnostic.accountStatus,
    code: diagnostic.code,
    details: { ...diagnostic.details },
    retryable: diagnostic.retryable,
  };
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

function assignNextReconcileAtUpdate(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
  status: StoredDeviceSyncAccount["status"],
  localValue: string | null,
  baselineValue: string | null,
): void {
  if (
    (status === "reauthorization_required" || status === "disconnected")
    && localValue === null
    && baselineValue !== null
  ) {
    update.localState = {
      ...(update.localState ?? {}),
      nextReconcileAt: null,
    } satisfies HostedDeviceSyncRuntimeLocalStateUpdate;
    return;
  }

  if (!localValue || localValue === baselineValue) {
    return;
  }

  // `nextReconcileAt` is owned by device-sync execution, not an append-only
  // event timestamp. Empty-backfill retry floors may intentionally pull it
  // earlier; stale hosted replays are still rejected by the web apply
  // observedUpdatedAt/version fence before localState mutates hosted state.
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
