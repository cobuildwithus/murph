import {
  sanitizeStoredDeviceSyncMetadata,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncDirtyAckRequest,
  parseHostedExecutionDeviceSyncDirtyPendingRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata,
  type HostedExecutionDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncDirtyAckResponse,
  type HostedExecutionDeviceSyncDirtyPendingResponse,
  type HostedExecutionDeviceSyncDirtyStateResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  type HostedExecutionDeviceSyncRuntimeCredentialUpdate,
  type HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";
import { resolveConfiguredDeviceSyncProviderManifest } from "@murphai/device-syncd/config";
import type { HostedRuntimeRedactedJson } from "@murphai/hosted-execution/runtime-control";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import {
  buildHostedPublicDeviceSyncAccount,
  type HostedStaticDeviceSyncConnectionRecord,
} from "./internal-runtime";
import { buildStoredTokenBundle } from "./agent-session-token-bundle";
import {
  hostedConnectionRecordArgs,
  type HostedDeviceSyncDirtyConnectionRecord,
  type HostedDeviceConnectionSource,
  mapHostedConnectionRecord,
  type HostedConnectionRecord,
  type HostedPrismaTransactionClient,
  type HostedStoredDeviceSyncAccount,
} from "./prisma-store";
import {
  normalizeHostedDeviceSyncLifecycleStatus,
} from "./prisma-store/connection-records";
import { toPrismaJsonObject } from "./prisma-store/prisma-json";
import {
  appendHostedDeviceSyncReconnectNoticeTx,
  startHostedDeviceSyncReconnectNoticeWorkflowBestEffort,
} from "./reconnect-notice";
import { normalizeNullableString } from "./shared";
import { recordHostedRuntimeLogTx } from "../hosted-workspace/store";

type HostedRuntimeConnectionSnapshot = HostedExecutionDeviceSyncRuntimeConnectionSnapshot;

type HostedRuntimeSnapshotWireResponse = Omit<
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  "connections"
> & {
  connections: HostedRuntimeConnectionSnapshot[];
};

export async function readHostedDeviceSyncRuntimeState(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedRuntimeSnapshotWireResponse> {
  const parsed = parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const records = await controlPlane.store.prisma.deviceConnection.findMany({
    where: {
      userId: input.trustedUserId,
      ...(parsed.connectionId ? { id: parsed.connectionId } : {}),
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.sourceProviderSlug
        ? {
            sources: {
              some: {
                sourceProviderSlug: parsed.sourceProviderSlug,
                status: {
                  not: "disconnected",
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...hostedConnectionRecordArgs,
  });

  const connections = await Promise.all(
    records.map(async (record) => {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.trustedUserId,
        record.id,
      );
      const durableConnection = storedAccount
        ? null
        : await controlPlane.store.getConnectionForUser(input.trustedUserId, record.id);
      const sources = await controlPlane.store.listConnectionSources(record.id);

      return buildHostedRuntimeConnectionSnapshot(
        record,
        storedAccount,
        storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null,
        sources.map(toHostedRuntimeConnectionSourceSnapshot),
        {
          includeCredentialMaterial: parsed.includeCredentialMaterial,
        },
      );
    }),
  );

  return {
    connections: sortHostedRuntimeConnectionSnapshots(connections),
    generatedAt: new Date().toISOString(),
    userId: input.trustedUserId,
  };
}

export async function applyHostedDeviceSyncRuntimeResult(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
  const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const appliedAt = parsed.occurredAt ?? new Date().toISOString();

  for (const update of parsed.updates) {
    if (update.seed !== undefined) {
      throw new TypeError("Hosted device-sync runtime callbacks must not seed Cloudflare-owned state.");
    }
  }

  const updates = await Promise.all(
    parsed.updates.map(async (update) => {
      let reconnectNoticeMailboxItemId: string | null = null;
      const result = await controlPlane.store.withConnectionMutationLock(update.connectionId, async (tx) => {
        const record = await tx.deviceConnection.findFirst({
          where: {
            id: update.connectionId,
            userId: input.trustedUserId,
          },
          ...hostedConnectionRecordArgs,
        });

        if (!record) {
          return {
            connection: null,
            connectionId: update.connectionId,
            status: "missing",
            tokenUpdate: "missing",
            writeUpdate: "missing",
          } satisfies HostedExecutionDeviceSyncRuntimeApplyEntry;
        }

        const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
          input.trustedUserId,
          update.connectionId,
          tx,
        );
        const durableConnection = storedAccount
          ? null
          : await controlPlane.store.getConnectionForUser(input.trustedUserId, update.connectionId, tx);
        const durableExternalAccountId =
          storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null;
        const sources = await controlPlane.store.listConnectionSources(record.id, tx);
        const baseline = buildHostedRuntimeConnectionSnapshot(
          record,
          storedAccount,
          durableExternalAccountId,
          sources.map(toHostedRuntimeConnectionSourceSnapshot),
          {
            includeCredentialMaterial: true,
          },
        );
        const stateMutationRequested = update.connection !== undefined || update.localState !== undefined;
        const credentialMutationRequested = update.credential !== undefined;
        const connectionWriteRequested = stateMutationRequested || credentialMutationRequested;
        const connectionVersionMismatch = stateMutationRequested
          && (baseline.connection.updatedAt ?? null) !== update.observedUpdatedAt;
        const baselineTokenVersion = getHostedRuntimeOAuthTokenBundle(baseline.credential)?.tokenVersion ?? null;
        const tokenVersionMismatch = hostedRuntimeCredentialMutationRequiresTokenFence(update)
          && baselineTokenVersion !== update.observedTokenVersion;
        const tokenRefreshLeaseConflict = hostedRuntimeCredentialMutationRequiresTokenFence(update)
          && hasHostedRuntimeRefreshLeaseForTokenVersion(record, baselineTokenVersion);
        const versionMismatch = connectionVersionMismatch || tokenVersionMismatch || tokenRefreshLeaseConflict;
        const credentialUpdate = update.credential === undefined
          ? undefined
          : resolveHostedRuntimeCredentialUpdate(update.credential);
        if (credentialUpdate) {
          validateHostedRuntimeCredentialMutation({
            baseline,
            credential: credentialUpdate,
            provider: record.provider,
          });
        }
        const nextAccount = buildPublicConnectionFromRuntimeSnapshot(baseline);
        let tokenBundleToPersist: HostedExecutionDeviceSyncRuntimeTokenBundle | null | undefined;
        let tokenBundlePersistenceRequested = false;
        let credentialToPersist:
          | Exclude<
            HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
            { kind: "oauth_tokens" } | { kind: "oauth_tokens_redacted" }
          >
          | undefined;

        if (!versionMismatch && update.connection) {
          if (Object.prototype.hasOwnProperty.call(update.connection, "displayName")) {
            nextAccount.displayName = update.connection.displayName ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "metadata")) {
            nextAccount.metadata = sanitizeStoredDeviceSyncMetadata(update.connection.metadata ?? {});
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "scopes")) {
            nextAccount.scopes = [...(update.connection.scopes ?? [])];
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "status") && update.connection.status) {
            nextAccount.status = normalizeHostedDeviceSyncLifecycleStatus(update.connection.status);
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "setupExpiresAt")) {
            nextAccount.setupExpiresAt = update.connection.setupExpiresAt ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "setupPhase")) {
            nextAccount.setupPhase = update.connection.setupPhase ?? null;
          }
        }

        if (!versionMismatch && update.localState) {
          if (update.localState.clearError) {
            nextAccount.lastErrorCode = null;
            nextAccount.lastErrorMessage = null;
          }

          for (const field of [
            "lastErrorCode",
            "lastErrorMessage",
            "lastSyncCompletedAt",
            "lastSyncErrorAt",
            "lastSyncStartedAt",
            "lastWebhookAt",
            "nextReconcileAt",
          ] as const) {
            if (Object.prototype.hasOwnProperty.call(update.localState, field)) {
              nextAccount[field] = update.localState[field] ?? null;
            }
          }
        }

        let tokenUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["tokenUpdate"];
        if (versionMismatch) {
          tokenUpdate = "skipped_version_mismatch";
        } else if (update.credential !== undefined) {
          if (!credentialUpdate) {
            throw new TypeError("Hosted device-sync runtime credential update was not parsed.");
          }

          if (credentialUpdate.kind === "oauth_tokens") {
            if ("clearTokens" in credentialUpdate) {
              tokenBundleToPersist = null;
              tokenBundlePersistenceRequested = true;
              nextAccount.accessTokenExpiresAt = null;
              tokenUpdate = getHostedRuntimeOAuthTokenBundle(baseline.credential) ? "cleared" : "missing";
            } else {
              tokenBundleToPersist = {
                ...credentialUpdate.tokenBundle,
                tokenVersion: computeNextHostedTokenVersion(
                  getHostedRuntimeOAuthTokenBundle(baseline.credential),
                  credentialUpdate.tokenBundle,
                ),
              };
              tokenBundlePersistenceRequested = true;
              nextAccount.accessTokenExpiresAt = tokenBundleToPersist.accessTokenExpiresAt;
              tokenUpdate = "applied";
            }
          } else {
            credentialToPersist = credentialUpdate;
            nextAccount.accessTokenExpiresAt = null;
            tokenUpdate = getHostedRuntimeOAuthTokenBundle(baseline.credential) ? "cleared" : "missing";
          }
        } else {
          tokenUpdate = getHostedRuntimeOAuthTokenBundle(baseline.credential) ? "unchanged" : "missing";
        }

        const writeUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["writeUpdate"] = versionMismatch
          ? "skipped_version_mismatch"
          : connectionWriteRequested
            ? "applied"
            : "unchanged";

        if (!versionMismatch && connectionWriteRequested) {
          await controlPlane.store.syncDurableConnectionState(nextAccount, tx);
        }

        if (!versionMismatch && credentialToPersist) {
          await persistHostedRuntimeCredentialSnapshot({
            connectionId: update.connectionId,
            credential: credentialToPersist,
            tx,
          });
        } else if (!versionMismatch && tokenBundlePersistenceRequested) {
          await controlPlane.store.persistStoredConnectionTokenBundle({
            connectionId: update.connectionId,
            externalAccountId: storedAccount?.externalAccountId,
            provider: record.provider,
            tokenBundle: tokenBundleToPersist ?? null,
            tx,
          });
        }

        if (!versionMismatch && connectionWriteRequested) {
          await recordHostedRuntimeFailureApplyDiagnostic({
            appliedAt,
            baseline,
            nextAccount,
            tx,
            update,
            userId: input.trustedUserId,
          });
          if (shouldAppendHostedDeviceSyncReconnectNotice({
            baseline,
            nextAccount,
            update,
          })) {
            const noticeAppend = await appendHostedDeviceSyncReconnectNoticeTx({
              appliedAt,
              connection: nextAccount,
              failureCode: nextAccount.lastErrorCode ?? update.failureDiagnostic?.code ?? null,
              observedTokenVersion: update.observedTokenVersion ?? null,
              request: input.request,
              tx,
              userId: input.trustedUserId,
            });

            if (noticeAppend.inserted && noticeAppend.mailboxItemId) {
              reconnectNoticeMailboxItemId = noticeAppend.mailboxItemId;
            }
          }
        }

        const refreshedRecord = await tx.deviceConnection.findFirst({
          where: {
            id: update.connectionId,
            userId: input.trustedUserId,
          },
          ...hostedConnectionRecordArgs,
        });
        const refreshedStoredAccount = refreshedRecord
          ? await controlPlane.store.getStoredConnectionAccountForUser(
              input.trustedUserId,
              update.connectionId,
              tx,
            )
          : null;
        const refreshedSources = refreshedRecord
          ? await controlPlane.store.listConnectionSources(refreshedRecord.id, tx)
          : [];

        return {
          connection: refreshedRecord
            ? buildHostedRuntimeConnectionSnapshot(
                refreshedRecord,
                refreshedStoredAccount,
                durableExternalAccountId,
                refreshedSources.map(toHostedRuntimeConnectionSourceSnapshot),
              ).connection
            : null,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate,
          writeUpdate,
        } satisfies HostedExecutionDeviceSyncRuntimeApplyEntry;
      });

      if (reconnectNoticeMailboxItemId) {
        await startHostedDeviceSyncReconnectNoticeWorkflowBestEffort(reconnectNoticeMailboxItemId);
      }

      return result;
    }),
  );

  return {
    appliedAt,
    updates,
    userId: input.trustedUserId,
  };
}

export async function readHostedDeviceSyncPendingDirtyState(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncDirtyPendingResponse> {
  const parsed = parseHostedExecutionDeviceSyncDirtyPendingRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const pending = await controlPlane.store.listPendingDirtyConnectionsForUser({
    limit: parsed.limit ?? 10,
    userId: input.trustedUserId,
  });

  return {
    hasMore: pending.hasMore,
    items: pending.items.map((dirty) =>
      mapHostedDeviceSyncDirtyStateResponse(dirty, input.trustedUserId)
    ),
    nextWakeAt: pending.hasMore ? new Date().toISOString() : null,
    userId: input.trustedUserId,
  };
}

export async function ackHostedDeviceSyncDirtyStateProcessed(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncDirtyAckResponse> {
  const parsed = parseHostedExecutionDeviceSyncDirtyAckRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const dirty = await controlPlane.store.markDirtyConnectionProcessed({
    connectionId: parsed.connectionId,
    processedRevision: BigInt(parsed.processedRevision),
    userId: input.trustedUserId,
  });
  const stillDirty = dirty ? dirty.dirtyRevision > dirty.processedRevision : false;
  const hasPendingDirty = stillDirty
    || (await controlPlane.store.listPendingDirtyConnectionsForUser({
      limit: 1,
      userId: input.trustedUserId,
    })).items.length > 0;

  return {
    connectionId: parsed.connectionId,
    dirtyRevision: dirty?.dirtyRevision.toString() ?? null,
    nextWakeAt: hasPendingDirty ? new Date().toISOString() : null,
    processedRevision: dirty?.processedRevision.toString() ?? null,
    recorded: dirty !== null,
    stillDirty,
    userId: input.trustedUserId,
  };
}

function mapHostedDeviceSyncDirtyStateResponse(
  dirty: HostedDeviceSyncDirtyConnectionRecord,
  trustedUserId: string,
): HostedExecutionDeviceSyncDirtyStateResponse {
  return {
    connectionId: dirty.connectionId,
    dirtyRevision: dirty.dirtyRevision.toString(),
    dirtyResources: Object.values(dirty.dirtyResources),
    eventCount: dirty.eventCount.toString(),
    latestDirtyAt: dirty.latestDirtyAt,
    processedRevision: dirty.processedRevision.toString(),
    provider: dirty.provider,
    resourceCategoryCounts: dirty.resourceCategoryCounts,
    sourceProviderCounts: dirty.sourceProviderCounts,
    userId: trustedUserId,
    windowEnd: dirty.windowEnd,
    windowStart: dirty.windowStart,
  };
}

function buildHostedRuntimeConnectionSnapshot(
  record: HostedConnectionRecord,
  storedAccount: HostedStoredDeviceSyncAccount | null,
  fallbackExternalAccountId: string | null = null,
  sources: HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot[] = [],
  options: {
    includeCredentialMaterial: boolean;
  } = {
    includeCredentialMaterial: false,
  },
): HostedRuntimeConnectionSnapshot {
  const mappedRecord = mapHostedConnectionRecord(record);
  const publicConnection = storedAccount
    ? storedAccount
    : buildHostedPublicDeviceSyncAccount({
        record: mappedRecord,
        fallback: {
          externalAccountId: fallbackExternalAccountId,
        },
      });
  const storedTokenBundle = buildStoredTokenBundle(storedAccount);
  const withholdRuntimeTokenMaterial = shouldWithholdHostedRuntimeTokenMaterial({
    record,
    tokenVersion: storedTokenBundle?.tokenVersion ?? null,
  });
  const credential = buildHostedRuntimeCredentialSnapshot({
    includeCredentialMaterial: options.includeCredentialMaterial && !withholdRuntimeTokenMaterial,
    record: mappedRecord,
    storedAccount,
    withholdTokenMaterial: options.includeCredentialMaterial && withholdRuntimeTokenMaterial,
  });
  return {
    connection: {
      accessTokenExpiresAt: publicConnection.accessTokenExpiresAt ?? null,
      connectedAt: publicConnection.connectedAt,
      createdAt: publicConnection.createdAt,
      displayName: publicConnection.displayName,
      externalAccountId: publicConnection.externalAccountId,
      id: publicConnection.id,
      metadata: sanitizeStoredDeviceSyncMetadata(publicConnection.metadata ?? {}),
      provider: publicConnection.provider,
      scopes: [...publicConnection.scopes],
      setupExpiresAt: publicConnection.setupExpiresAt ?? null,
      setupPhase: publicConnection.setupPhase ?? null,
      status: publicConnection.status,
      updatedAt: publicConnection.updatedAt,
    },
    localState: {
      lastErrorCode: publicConnection.lastErrorCode,
      lastErrorMessage: publicConnection.lastErrorMessage,
      lastSyncCompletedAt: publicConnection.lastSyncCompletedAt,
      lastSyncErrorAt: publicConnection.lastSyncErrorAt,
      lastSyncStartedAt: publicConnection.lastSyncStartedAt,
      lastWebhookAt: publicConnection.lastWebhookAt,
      nextReconcileAt: publicConnection.nextReconcileAt,
    },
    sources,
    credential,
  };
}

function buildPublicConnectionFromRuntimeSnapshot(
  snapshot: HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
): PublicDeviceSyncAccount {
  return {
    accessTokenExpiresAt: snapshot.connection.accessTokenExpiresAt,
    connectedAt: snapshot.connection.connectedAt,
    createdAt: snapshot.connection.createdAt,
    displayName: snapshot.connection.displayName,
    externalAccountId: snapshot.connection.externalAccountId,
    id: snapshot.connection.id,
    lastErrorCode: snapshot.localState.lastErrorCode,
    lastErrorMessage: snapshot.localState.lastErrorMessage,
    lastSyncCompletedAt: snapshot.localState.lastSyncCompletedAt,
    lastSyncErrorAt: snapshot.localState.lastSyncErrorAt,
    lastSyncStartedAt: snapshot.localState.lastSyncStartedAt,
    lastWebhookAt: snapshot.localState.lastWebhookAt,
    metadata: sanitizeStoredDeviceSyncMetadata(snapshot.connection.metadata ?? {}),
    nextReconcileAt: snapshot.localState.nextReconcileAt,
    provider: snapshot.connection.provider,
    scopes: [...snapshot.connection.scopes],
    sources: snapshot.sources ?? [],
    setupExpiresAt: snapshot.connection.setupExpiresAt ?? null,
    setupPhase: snapshot.connection.setupPhase ?? null,
    status: normalizeHostedDeviceSyncLifecycleStatus(snapshot.connection.status),
    updatedAt: snapshot.connection.updatedAt ?? snapshot.connection.createdAt,
  };
}

const CONNECTION_SOURCE_SUMMARY_METADATA_KEYS = new Set([
  "sourceInstanceKeyFallback",
]);

function toHostedRuntimeConnectionSourceSnapshot(
  source: HostedDeviceConnectionSource,
): HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot {
  return {
    displayName: source.displayName,
    firstSeenAt: source.firstSeenAt,
    lastErrorCode: source.lastErrorCode,
    lastErrorMessage: source.lastErrorMessage,
    lastSeenAt: source.lastSeenAt,
    resourceCount: countHostedRuntimeConnectionSourceResources(
      source.resourceAvailabilitySummary,
    ),
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

function countHostedRuntimeConnectionSourceResources(
  summary: HostedDeviceConnectionSource["resourceAvailabilitySummary"],
): number {
  if (!summary) {
    return 0;
  }

  return Object.entries(summary).filter(([key, value]) =>
    !CONNECTION_SOURCE_SUMMARY_METADATA_KEYS.has(key)
    && value !== false
    && value !== null
    && value !== undefined
  ).length;
}

function sortHostedRuntimeConnectionSnapshots(
  connections: HostedRuntimeConnectionSnapshot[],
): HostedRuntimeConnectionSnapshot[] {
  return [...connections].sort((left, right) => {
    const leftUpdatedAt = left.connection.updatedAt ?? left.connection.createdAt;
    const rightUpdatedAt = right.connection.updatedAt ?? right.connection.createdAt;
    return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.connection.id.localeCompare(right.connection.id);
  });
}

function buildHostedRuntimeCredentialSnapshot(input: {
  includeCredentialMaterial: boolean;
  record: HostedStaticDeviceSyncConnectionRecord;
  storedAccount: HostedStoredDeviceSyncAccount | null;
  withholdTokenMaterial?: boolean;
}): HostedExecutionDeviceSyncRuntimeCredentialSnapshot {
  const storedTokenBundle = buildStoredTokenBundle(input.storedAccount);

  if (storedTokenBundle && input.withholdTokenMaterial === true) {
    return {
      credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(input.record.credentialMetadata),
      kind: "oauth_tokens_redacted",
      tokenVersion: storedTokenBundle.tokenVersion,
    };
  }

  if (storedTokenBundle && input.includeCredentialMaterial) {
    return {
      kind: "oauth_tokens",
      tokenBundle: storedTokenBundle,
    };
  }

  if (input.record.credentialKind === "oauth_tokens" && !input.includeCredentialMaterial) {
    return {
      credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(input.record.credentialMetadata),
      kind: "oauth_tokens_redacted",
      tokenVersion: storedTokenBundle?.tokenVersion ?? null,
    };
  }

  if (input.record.credentialKind === "provider_config") {
    if (!input.record.providerConfigKey) {
      throw new TypeError("Hosted provider-config device-sync credential is missing providerConfigKey.");
    }

    const credentialMetadata = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
      input.record.credentialMetadata,
    );

    return {
      credentialMetadata,
      kind: "provider_config",
      providerConfigKey: input.record.providerConfigKey,
    };
  }

  return {
    credentialMetadata: sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(input.record.credentialMetadata),
    kind: "none",
  };
}

function shouldWithholdHostedRuntimeTokenMaterial(input: {
  record: HostedConnectionRecord;
  tokenVersion: number | null;
}): boolean {
  if (input.tokenVersion === null || input.record.status !== "active") {
    return true;
  }

  const refreshLeaseOwner = normalizeNullableString(input.record.refreshLeaseOwner);
  return Boolean(
    refreshLeaseOwner
    && input.record.refreshLeaseExpiresAt !== null
    && input.record.refreshLeaseTokenVersion === input.tokenVersion,
  );
}

function getHostedRuntimeOAuthTokenBundle(
  credential: HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
): HostedExecutionDeviceSyncRuntimeTokenBundle | null {
  return credential.kind === "oauth_tokens" ? credential.tokenBundle : null;
}

function hostedRuntimeCredentialMutationRequiresTokenFence(
  update: HostedExecutionDeviceSyncRuntimeConnectionUpdate,
): boolean {
  return update.credential !== undefined;
}

async function recordHostedRuntimeFailureApplyDiagnostic(input: {
  appliedAt: string;
  baseline: HostedRuntimeConnectionSnapshot;
  nextAccount: PublicDeviceSyncAccount;
  tx: HostedPrismaTransactionClient;
  update: HostedExecutionDeviceSyncRuntimeConnectionUpdate;
  userId: string;
}): Promise<void> {
  if (!didHostedRuntimeFailureStateAdvance(
    input.baseline.localState.lastSyncErrorAt,
    input.nextAccount.lastSyncErrorAt,
  )) {
    return;
  }

  const at = input.nextAccount.lastSyncErrorAt ?? input.appliedAt;
  const errorCode = toHostedRuntimeApplyLogCode(
    input.nextAccount.lastErrorCode ?? input.update.failureDiagnostic?.code ?? null,
  );
  const provider = toHostedRuntimeApplyLogCode(input.nextAccount.provider);
  const redacted = buildHostedRuntimeFailureApplyRedactedJson(input);

  try {
    await recordHostedRuntimeLogTx({
      at,
      component: "device-sync",
      errorCode,
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted,
      tx: input.tx,
      userId: input.userId,
    });
  } catch (error) {
    console.warn("Hosted device-sync failure diagnostic log write failed.", {
      errorCode,
      errorName: error instanceof Error ? error.name : typeof error,
      provider,
    });
  }
}

function shouldAppendHostedDeviceSyncReconnectNotice(input: {
  baseline: HostedRuntimeConnectionSnapshot;
  nextAccount: PublicDeviceSyncAccount;
  update: HostedExecutionDeviceSyncRuntimeConnectionUpdate;
}): boolean {
  if (input.nextAccount.status !== "reauthorization_required") {
    return false;
  }

  return input.baseline.connection.status !== "reauthorization_required"
    || didHostedRuntimeFailureStateAdvance(
      input.baseline.localState.lastSyncErrorAt,
      input.nextAccount.lastSyncErrorAt,
    )
    || input.update.failureDiagnostic?.accountStatus === "reauthorization_required";
}

function buildHostedRuntimeFailureApplyRedactedJson(input: {
  baseline: HostedRuntimeConnectionSnapshot;
  nextAccount: PublicDeviceSyncAccount;
  update: HostedExecutionDeviceSyncRuntimeConnectionUpdate;
}): HostedRuntimeRedactedJson {
  const diagnostic = input.update.failureDiagnostic ?? null;
  const summary = sanitizeHostedRuntimeDiagnosticText(
    input.update.localState?.lastErrorMessage ?? input.nextAccount.lastErrorMessage ?? null,
  );

  return {
    failureCode: toHostedRuntimeApplyLogCode(input.nextAccount.lastErrorCode ?? diagnostic?.code ?? null),
    ...(summary ? { failureSummary: summary } : {}),
    ...buildHostedRuntimeFailureDiagnosticRedactedJson(diagnostic),
    hadPriorFailure: Boolean(input.baseline.localState.lastSyncErrorAt),
    hadPriorSuccess: Boolean(input.baseline.localState.lastSyncCompletedAt),
    nextReconcileAt: input.nextAccount.nextReconcileAt,
    provider: toHostedRuntimeApplyLogCode(input.nextAccount.provider),
    setupPhase: input.nextAccount.setupPhase ?? null,
    status: toHostedRuntimeApplyLogCode(input.nextAccount.status),
    syncCompletedAt: input.nextAccount.lastSyncCompletedAt,
    syncFailedAt: input.nextAccount.lastSyncErrorAt,
    syncStartedAt: input.nextAccount.lastSyncStartedAt,
  };
}

function buildHostedRuntimeFailureDiagnosticRedactedJson(
  diagnostic: HostedExecutionDeviceSyncRuntimeConnectionUpdate["failureDiagnostic"] | null,
): HostedRuntimeRedactedJson {
  if (!diagnostic) {
    return {};
  }

  return {
    failureRetryable: diagnostic.retryable,
    ...(diagnostic.accountStatus
      ? { providerAccountStatus: toHostedRuntimeApplyLogCode(diagnostic.accountStatus) }
      : {}),
    ...buildHostedRuntimeFailureDiagnosticDetailsRedactedJson(diagnostic.details),
  };
}

type HostedRuntimeFailureDiagnosticDetails =
  NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["failureDiagnostic"]>["details"];
type HostedRuntimeFailureDiagnosticStringField = {
  [Key in keyof HostedRuntimeFailureDiagnosticDetails]: HostedRuntimeFailureDiagnosticDetails[Key] extends
    string | undefined ? Key : never;
}[keyof HostedRuntimeFailureDiagnosticDetails];
type HostedRuntimeFailureDiagnosticNumberField = {
  [Key in keyof HostedRuntimeFailureDiagnosticDetails]: HostedRuntimeFailureDiagnosticDetails[Key] extends
    number | undefined ? Key : never;
}[keyof HostedRuntimeFailureDiagnosticDetails];
type HostedRuntimeFailureDiagnosticBooleanField = {
  [Key in keyof HostedRuntimeFailureDiagnosticDetails]: HostedRuntimeFailureDiagnosticDetails[Key] extends
    boolean | undefined ? Key : never;
}[keyof HostedRuntimeFailureDiagnosticDetails];

const HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_CODE_FIELDS = [
  "failureCauseCode",
  "failureCauseName",
  "failureErrorName",
  "providerRequestAuthKind",
  "providerRequestAuthPlacement",
  "providerRequestBodyFieldNames",
  "providerRequestBodyKind",
  "providerRequestContentType",
  "providerRequestEndpointKind",
  "providerRequestMethod",
  "providerRequestQueryParameterNames",
  "providerResponseErrorCode",
  "providerResponseShapeKind",
  "providerOAuthErrorCode",
  "providerOAuthGrantType",
  "providerOAuthRequestBodyBuilderKind",
  "providerOAuthRequestClientAuthPlacement",
  "providerOAuthRequestContentType",
  "providerOAuthRequestEncodingKind",
  "providerOAuthRequestMethod",
  "providerOAuthRequestParameterNames",
  "providerOAuthRequestScopeValue",
  "providerOAuthRequestTokenEndpointKind",
  "providerOAuthResponseShapeKind",
] as const satisfies readonly HostedRuntimeFailureDiagnosticStringField[];

const HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_REASON_FIELDS = [
  "failureErrorCause",
  "providerHttpStatusText",
  "providerResponseErrorDescription",
  "providerOAuthErrorDescription",
] as const satisfies readonly HostedRuntimeFailureDiagnosticStringField[];

const HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_NUMBER_FIELDS = [
  "providerHttpStatus",
  "providerRequestBodyFieldCount",
  "providerRequestQueryParameterCount",
  "providerOAuthRequestDuplicateParameterCount",
  "providerOAuthRequestParameterCount",
  "providerOAuthRequestScopeCount",
] as const satisfies readonly HostedRuntimeFailureDiagnosticNumberField[];

const HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS = [
  "providerRequestCredentialPresent",
  "providerResponseErrorDescriptionFieldPresent",
  "providerResponseErrorFieldPresent",
  "providerOAuthRequestClientCredentialPresent",
  "providerOAuthRequestClientIdPresent",
  "providerOAuthRequestHasDuplicateParameters",
  "providerOAuthRequestOfflineScopePresent",
  "providerOAuthRequestRefreshCredentialPresent",
  "providerOAuthRequestScopePresent",
  "providerOAuthResponseErrorDescriptionFieldPresent",
  "providerOAuthResponseErrorFieldPresent",
] as const satisfies readonly HostedRuntimeFailureDiagnosticBooleanField[];

function buildHostedRuntimeFailureDiagnosticDetailsRedactedJson(
  details: HostedRuntimeFailureDiagnosticDetails,
): HostedRuntimeRedactedJson {
  const redacted: HostedRuntimeRedactedJson = {};

  for (const field of HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_CODE_FIELDS) {
    appendHostedRuntimeDiagnosticCode(redacted, field, details[field]);
  }

  for (const field of HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_REASON_FIELDS) {
    appendHostedRuntimeDiagnosticReason(redacted, field, details[field]);
  }

  for (const field of HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_NUMBER_FIELDS) {
    appendHostedRuntimeDiagnosticNumber(redacted, field, details[field]);
  }

  for (const field of HOSTED_RUNTIME_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS) {
    appendHostedRuntimeDiagnosticBoolean(redacted, field, details[field]);
  }

  return redacted;
}

function appendHostedRuntimeDiagnosticBoolean(
  redacted: HostedRuntimeRedactedJson,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    redacted[key] = value;
  }
}

function appendHostedRuntimeDiagnosticNumber(
  redacted: HostedRuntimeRedactedJson,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined) {
    redacted[key] = value;
  }
}

function appendHostedRuntimeDiagnosticCode(
  redacted: HostedRuntimeRedactedJson,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    redacted[key] = toHostedRuntimeApplyLogCode(value);
  }
}

function appendHostedRuntimeDiagnosticReason(
  redacted: HostedRuntimeRedactedJson,
  key: string,
  value: string | undefined,
): void {
  const sanitized = sanitizeHostedRuntimeDiagnosticText(value ?? null);
  if (sanitized) {
    redacted[key] = sanitized;
  }
}

function didHostedRuntimeFailureStateAdvance(
  previousValue: string | null,
  nextValue: string | null,
): boolean {
  if (!nextValue || nextValue === previousValue) {
    return false;
  }

  if (!previousValue) {
    return true;
  }

  const previousMs = Date.parse(previousValue);
  const nextMs = Date.parse(nextValue);

  return !Number.isNaN(nextMs) && (Number.isNaN(previousMs) || nextMs > previousMs);
}

function toHostedRuntimeApplyLogCode(value: string | null | undefined): string {
  const normalized = value?.trim();

  return normalized
    && normalized.length <= 96
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : "unclassified";
}

function resolveHostedRuntimeCredentialUpdate(
  credential: HostedExecutionDeviceSyncRuntimeCredentialUpdate,
): HostedExecutionDeviceSyncRuntimeCredentialUpdate {
  if (credential.kind === "oauth_tokens" && "clearTokens" in credential) {
    return credential;
  }

  return credential;
}

function validateHostedRuntimeCredentialMutation(input: {
  baseline: HostedRuntimeConnectionSnapshot;
  credential:
    | Exclude<HostedExecutionDeviceSyncRuntimeCredentialSnapshot, { kind: "oauth_tokens_redacted" }>
    | Extract<HostedExecutionDeviceSyncRuntimeCredentialUpdate, { clearTokens: true; kind: "oauth_tokens" }>;
  provider: string;
}): void {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(input.provider);
  const policy = manifest?.credentialPolicy;

  switch (input.credential.kind) {
    case "oauth_tokens":
      if (policy && policy.kind !== "oauth_tokens") {
        throw new TypeError(
          `Hosted device-sync runtime credential update for ${input.provider} must match the configured ${policy.kind} credential policy.`,
        );
      }
      if (!policy && input.baseline.credential.kind !== "oauth_tokens") {
        throw new TypeError(
          "Hosted device-sync runtime cannot replace non-token credentials with OAuth tokens without a manifest policy.",
        );
      }
      return;
    case "provider_config": {
      const providerConfigKey = input.credential.providerConfigKey.trim();
      if (!providerConfigKey) {
        throw new TypeError("Hosted provider-config device-sync credential is missing providerConfigKey.");
      }

      if (policy) {
        if (policy.kind !== "provider_config" || policy.providerConfigKey !== providerConfigKey) {
          throw new TypeError(
            `Hosted provider-config device-sync credential for ${input.provider} does not match the configured provider profile.`,
          );
        }
        return;
      }

      if (
        input.baseline.credential.kind !== "provider_config"
        || input.baseline.credential.providerConfigKey !== providerConfigKey
      ) {
        throw new TypeError(
          "Hosted device-sync runtime cannot replace account credentials with a provider-config profile without a matching manifest policy.",
        );
      }
      return;
    }
    case "none":
      if (policy && policy.kind !== "none") {
        throw new TypeError(
          `Hosted device-sync runtime credential update for ${input.provider} must match the configured ${policy.kind} credential policy.`,
        );
      }
      if (!policy && input.baseline.credential.kind !== "none") {
        throw new TypeError(
          "Hosted device-sync runtime cannot replace account credentials with none without a manifest policy.",
        );
      }
      return;
  }
}

async function persistHostedRuntimeCredentialSnapshot(input: {
  connectionId: string;
  credential: Exclude<
    HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
    { kind: "oauth_tokens" } | { kind: "oauth_tokens_redacted" }
  >;
  tx: HostedPrismaTransactionClient;
}): Promise<void> {
  if (input.credential.kind === "provider_config" && !input.credential.providerConfigKey.trim()) {
    throw new TypeError("Hosted provider-config device-sync credential is missing providerConfigKey.");
  }

  const credentialMetadataJson = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
    input.credential.credentialMetadata,
  );

  await input.tx.deviceConnection.update({
    where: {
      id: input.connectionId,
    },
    data: {
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialKind: input.credential.kind,
      credentialMetadataJson: toPrismaJsonObject(credentialMetadataJson),
      keyVersion: null,
      providerConfigKey: input.credential.kind === "provider_config"
        ? input.credential.providerConfigKey.trim()
        : null,
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
      refreshTokenEncrypted: null,
      tokenVersion: null,
    },
  });
}

function hasHostedRuntimeRefreshLeaseForTokenVersion(
  record: HostedConnectionRecord,
  tokenVersion: number | null,
): boolean {
  return Boolean(typeof tokenVersion === "number"
    && normalizeNullableString(record.refreshLeaseOwner)
    && record.refreshLeaseExpiresAt !== null
    && record.refreshLeaseTokenVersion === tokenVersion);
}

function computeNextHostedTokenVersion(
  current: HostedExecutionDeviceSyncRuntimeTokenBundle | null,
  next: HostedExecutionDeviceSyncRuntimeTokenBundle,
): number {
  if (!current) {
    return Math.max(1, next.tokenVersion);
  }

  return hasSameHostedTokenBundle(current, next)
    ? current.tokenVersion
    : current.tokenVersion + 1;
}

function hasSameHostedTokenBundle(
  left: HostedExecutionDeviceSyncRuntimeTokenBundle,
  right: HostedExecutionDeviceSyncRuntimeTokenBundle,
): boolean {
  return left.accessToken === right.accessToken
    && left.accessTokenExpiresAt === right.accessTokenExpiresAt
    && left.keyVersion === right.keyVersion
    && left.refreshToken === right.refreshToken;
}
