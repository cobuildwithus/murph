import type { PrismaClient } from "@prisma/client";

import {
  isDeviceSyncDisconnectInProgress,
  requiresHistoricalResetDeviceSyncSource,
  sanitizeStoredDeviceSyncMetadata,
} from "@murphai/device-syncd/public-account";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";
import type {
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import {
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
  mergeHostedDeviceSyncConnectionMetadata,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncDirtyAckRequest,
  parseHostedExecutionDeviceSyncDirtyPendingRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  readJunctionHistoricalBackfillProgress,
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata,
  type HostedExecutionDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncDirtyAckResponse,
  type HostedExecutionDeviceSyncDirtyPendingResponse,
  type HostedExecutionDeviceSyncStagedDirtyAck,
  type HostedExecutionDeviceSyncDirtyStateResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  type HostedExecutionDeviceSyncRuntimeCredentialUpdate,
  type HostedExecutionDeviceSyncRuntimeConnectionSourceSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import {
  resolveConfiguredDeviceSyncProviderCredentialPolicy,
} from "@murphai/device-syncd/provider-credential-policy";
import { resolveDeviceProviderMatchKeys } from "@murphai/device-syncd/provider-match";
import {
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  type HostedRuntimeLogEntry,
  type HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import { lockAndReadActiveHostedDomainRootKeyIdTx } from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { writeHostedRuntimeLogs } from "../hosted-runtime-log/write";
import { createHostedDeviceSyncControlPlane } from "./control-plane";
import { isHostedSourceDisconnectFenced } from "./connection-source-lifecycle";
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
  type HostedRuntimeApplyConnectionSecretMaterial,
  type HostedRuntimeApplyPreparedTokenWrite,
  type PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import {
  normalizeHostedDeviceSyncLifecycleStatus,
} from "./prisma-store/connection-records";
import { toPrismaJsonObject } from "./prisma-store/prisma-json";
import {
  isDeviceProviderApplicationError,
  isMemberOwnedDeviceProviderApplicationProvider,
  resolveDeviceProviderApplication,
} from "./provider-applications";
import { normalizeNullableString } from "./shared";

type HostedRuntimeConnectionSnapshot = HostedExecutionDeviceSyncRuntimeConnectionSnapshot;

interface HostedRuntimeFailureApplyResult {
  failureDiagnostic: HostedRuntimeLogEntry | null;
  update: HostedExecutionDeviceSyncRuntimeApplyEntry;
}

interface HostedRuntimePreparedApplyConnection {
  record: HostedConnectionRecord;
  secretMaterial: HostedRuntimeApplyConnectionSecretMaterial;
  tokenWrite: HostedRuntimeApplyPreparedTokenWrite | null;
}

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
  const providerKeys = resolveDeviceProviderMatchKeys(parsed.provider);
  const sourceProviderKeys = resolveDeviceProviderMatchKeys(parsed.sourceProviderSlug);
  const boundedSourceProviderKeys = sourceProviderKeys.length > 0 ? sourceProviderKeys : providerKeys;
  const boundedSourceLimit = parsed.limit ?? null;
  const explicitBlankFilter = (
    parsed.provider !== undefined && parsed.provider !== null && providerKeys.length === 0
  ) || (
    parsed.sourceProviderSlug !== undefined
    && parsed.sourceProviderSlug !== null
    && sourceProviderKeys.length === 0
  );
  const records = await controlPlane.store.prisma.deviceConnection.findMany({
    where: {
      userId: input.trustedUserId,
      ...(explicitBlankFilter ? { AND: [{ id: { in: [] } }] } : {}),
      ...(parsed.connectionId ? { id: parsed.connectionId } : {}),
      ...(providerKeys.length > 0
        ? {
            OR: [
              { provider: { in: providerKeys } },
              {
                sources: {
                  some: {
                    sourceProviderSlug: { in: providerKeys },
                    status: {
                      not: "disconnected",
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(sourceProviderKeys.length > 0
        ? {
            sources: {
              some: {
                sourceProviderSlug: { in: sourceProviderKeys },
                status: {
                  not: "disconnected",
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...(parsed.limit ? { take: parsed.limit } : {}),
    ...hostedConnectionRecordArgs,
  });

  const providerApplicationRuntime = await resolveHostedRuntimeProviderApplications({
    includeCredentialMaterial: parsed.includeCredentialMaterial,
    prisma: controlPlane.store.prisma,
    records,
    userId: input.trustedUserId,
  });

  const useBoundedSourceProjection = boundedSourceLimit !== null
    && boundedSourceProviderKeys.length > 0;
  const unboundedSources = useBoundedSourceProjection
    ? []
    : await controlPlane.store.listConnectionSourcesForConnections(
        records.map((record) => record.id),
      );
  const unboundedSourcesByConnectionId = new Map<string, HostedDeviceConnectionSource[]>();
  for (const source of unboundedSources) {
    const sources = unboundedSourcesByConnectionId.get(source.connectionId) ?? [];
    sources.push(source);
    unboundedSourcesByConnectionId.set(source.connectionId, sources);
  }

  // Account materialization may decrypt credential material, so keep records
  // sequential without re-reading the connection rows already selected above.
  const connections: HostedRuntimeConnectionSnapshot[] = [];
  for (const record of records) {
    const storedAccount = await controlPlane.store.materializeStoredConnectionAccount(record);
    const durableConnection = storedAccount
      ? null
      : await controlPlane.store.materializeDurableConnectionRecord(record);
    const sources = useBoundedSourceProjection && boundedSourceLimit !== null
      ? await controlPlane.store.listRuntimeSnapshotConnectionSources({
          connectionId: record.id,
          limit: boundedSourceLimit,
          sourceProviderSlugs: boundedSourceProviderKeys,
        })
      : unboundedSourcesByConnectionId.get(record.id) ?? [];

    connections.push(buildHostedRuntimeConnectionSnapshot(
      record,
      storedAccount,
      storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null,
      sources.map(toHostedRuntimeConnectionSourceSnapshot),
      {
        forceReauthorizationRequired:
          providerApplicationRuntime.blockedConnectionIds.has(record.id),
        includeCredentialMaterial: parsed.includeCredentialMaterial,
      },
    ));
  }

  return {
    capabilities: {
      connectionSourceApply: true,
    },
    connections: sortHostedRuntimeConnectionSnapshots(connections),
    generatedAt: new Date().toISOString(),
    ...(Object.keys(providerApplicationRuntime.providerConfigs).length > 0
      ? { providerConfigs: providerApplicationRuntime.providerConfigs }
      : {}),
    userId: input.trustedUserId,
  };
}

export async function applyHostedDeviceSyncRuntimeResult(input: {
  request: Request;
  scheduleFailureDiagnostics?: (task: () => Promise<void>) => void;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
  const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const appliedAt = parsed.occurredAt ?? new Date().toISOString();

  for (const update of parsed.updates) {
    if (update.seed !== undefined) {
      throw new TypeError("Hosted device-sync runtime callbacks must not seed Cloudflare-owned state.");
    }
  }

  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const preparedConnections = await prepareHostedRuntimeApplyConnections({
    store: controlPlane.store,
    updates: parsed.updates,
    userId: input.trustedUserId,
  });
  const updates: HostedExecutionDeviceSyncRuntimeApplyEntry[] = [];
  const failureDiagnostics: HostedRuntimeLogEntry[] = [];

  for (const update of parsed.updates) {
    const preparedConnection = preparedConnections.get(update.connectionId) ?? null;
    const applied = await controlPlane.store.withConnectionMutationLock(
      update.connectionId,
      async (tx) => {
        const record = await tx.deviceConnection.findFirst({
          where: {
            id: update.connectionId,
            userId: input.trustedUserId,
          },
          ...hostedConnectionRecordArgs,
        });

        if (!record || !preparedConnection) {
          return {
            failureDiagnostic: null,
            update: {
              connection: null,
              connectionId: update.connectionId,
              status: "missing",
              tokenUpdate: "missing",
              writeUpdate: "missing",
            },
          } satisfies HostedRuntimeFailureApplyResult;
        }

        const secretAuthorityCurrent = isHostedRuntimeApplySecretAuthorityCurrent(
          preparedConnection.record,
          record,
        );
        const storedAccount = secretAuthorityCurrent
          ? buildHostedRuntimePreparedStoredAccount(
              record,
              preparedConnection.secretMaterial,
            )
          : null;
        const durableExternalAccountId = secretAuthorityCurrent
          ? preparedConnection.secretMaterial.externalAccountId
          : null;
        const preparedSecretAuthorityMismatch = !secretAuthorityCurrent;
        const sources = await controlPlane.store.listConnectionSources(record.id, tx);
        const providerApplicationBindingCurrent =
          await isHostedProviderApplicationBindingCurrent({
            record,
            tx,
            userId: input.trustedUserId,
          });
        const preparedTokenRootCurrent = secretAuthorityCurrent
          && preparedConnection.tokenWrite?.rootKeyId
          ? await lockAndReadActiveHostedDomainRootKeyIdTx({
              domain: "device",
              tx,
              userId: input.trustedUserId,
            }) === preparedConnection.tokenWrite.rootKeyId
          : true;
        const baseline = buildHostedRuntimeConnectionSnapshot(
          record,
          storedAccount,
          durableExternalAccountId,
          sources.map(toHostedRuntimeConnectionSourceSnapshot),
          {
            forceReauthorizationRequired:
              !providerApplicationBindingCurrent,
            includeCredentialMaterial: secretAuthorityCurrent,
          },
        );
        const disconnectInProgress = isDeviceSyncDisconnectInProgress(record);
        const historicalMetadataResolution = resolveHostedRuntimeHistoricalMetadata({
          baselineMetadata: baseline.connection.metadata,
          candidateMetadata: update.connection?.metadata,
          provider: record.provider,
        });
        const sourceUpdates = resolveHostedRuntimeSourceUpdatesToApply({
          connectionId: record.id,
          currentSources: sources,
          historicalMetadata: historicalMetadataResolution?.metadata
            ?? baseline.connection.metadata,
          provider: record.provider,
          updates: update.sources ?? [],
        });
        const stateMutationRequested = update.connection !== undefined || update.localState !== undefined;
        const credentialMutationRequested = update.credential !== undefined;
        const sourceMutationRequested = sourceUpdates.toApply.length > 0;
        const sourceVersionMismatch =
          (update.sources?.length ?? 0) > 0 && sourceUpdates.staleCount > 0;
        const historicalResetStateMismatch = isHostedRuntimeHistoricalResetStateInconsistent({
          currentSources: sources,
          historicalMetadata: historicalMetadataResolution?.metadata
            ?? baseline.connection.metadata,
          provider: record.provider,
          sourceUpdates: sourceUpdates.toApply,
        });
        const connectionWriteRequested =
          stateMutationRequested || credentialMutationRequested || sourceMutationRequested;
        const preparedConnectionEpochMismatch = connectionWriteRequested
          && !sameHostedRuntimeApplyTimestamp(
            preparedConnection.record.connectedAt,
            record.connectedAt,
          );
        const junctionSourceMutationRequested = record.provider.trim().toLowerCase() === "junction"
          && (update.sources?.length ?? 0) > 0;
        const connectionVersionMismatch = (stateMutationRequested || junctionSourceMutationRequested)
          && (baseline.connection.updatedAt ?? null) !== update.observedUpdatedAt;
        const connectionEpochMismatch = connectionWriteRequested
          && baseline.connection.connectedAt !== update.observedConnectedAt;
        const baselineTokenVersion = getHostedRuntimeOAuthTokenBundle(baseline.credential)?.tokenVersion ?? null;
        const tokenVersionMismatch = hostedRuntimeCredentialMutationRequiresTokenFence(update)
          && baselineTokenVersion !== update.observedTokenVersion;
        const tokenRefreshLeaseConflict = hostedRuntimeCredentialMutationRequiresTokenFence(update)
          && hasHostedRuntimeRefreshLeaseForTokenVersion(record, baselineTokenVersion);
        const preparedTokenWriteMissing = update.credential?.kind === "oauth_tokens"
          && !preparedConnection.tokenWrite;
        const versionMismatch =
          (connectionWriteRequested && preparedSecretAuthorityMismatch)
          || !preparedTokenRootCurrent
          || preparedTokenWriteMissing
          || !providerApplicationBindingCurrent
          || disconnectInProgress
          || preparedConnectionEpochMismatch
          || connectionEpochMismatch
          || connectionVersionMismatch
          || tokenVersionMismatch
          || tokenRefreshLeaseConflict
          || (stateMutationRequested && sourceVersionMismatch)
          || historicalMetadataResolution?.rejected === true
          || historicalResetStateMismatch;
        const credentialUpdate = update.credential === undefined
          ? undefined
          : resolveHostedRuntimeCredentialUpdate(update.credential);
        if (
          credentialUpdate
          && (credentialUpdate.kind !== "oauth_tokens" || secretAuthorityCurrent)
        ) {
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
            nextAccount.metadata = historicalMetadataResolution?.metadata
              ?? sanitizeStoredDeviceSyncMetadata(update.connection.metadata ?? {});
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
        if (versionMismatch && update.credential !== undefined) {
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

        const writeUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["writeUpdate"] =
          versionMismatch || sourceVersionMismatch
          ? "skipped_version_mismatch"
          : connectionWriteRequested
            ? "applied"
            : "unchanged";
        let writtenRecord: HostedConnectionRecord | null = null;

        if (!versionMismatch && stateMutationRequested) {
          writtenRecord = await controlPlane.store.syncDurableConnectionState(nextAccount, tx);
        }

        if (!versionMismatch && sourceMutationRequested) {
          for (const source of sourceUpdates.toApply) {
            await controlPlane.store.upsertConnectionSource({
              connectionId: update.connectionId,
              sourceInstanceKey: source.sourceInstanceKey,
              sourceProviderSlug: source.sourceProviderSlug,
              ...(Object.prototype.hasOwnProperty.call(source, "displayName")
                ? { displayName: source.displayName ?? null }
                : {}),
              status: source.status,
              ...(Object.prototype.hasOwnProperty.call(source, "resourceAvailabilitySummary")
                ? { resourceAvailabilitySummary: source.resourceAvailabilitySummary ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(source, "lastErrorCode")
                ? { lastErrorCode: source.lastErrorCode ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(source, "lastErrorMessage")
                ? { lastErrorMessage: source.lastErrorMessage ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(source, "firstSeenAt")
                ? { firstSeenAt: source.firstSeenAt ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(source, "lastDataAt")
                ? { lastDataAt: source.lastDataAt ?? null }
                : {}),
              lastSeenAt: source.lastSeenAt,
              tx,
            });
          }
        }

        if (!versionMismatch && credentialToPersist) {
          writtenRecord = await persistHostedRuntimeCredentialSnapshot({
            connectionId: update.connectionId,
            credential: credentialToPersist,
            tx,
          });
        } else if (!versionMismatch && tokenBundlePersistenceRequested) {
          const preparedTokenWrite = preparedConnection.tokenWrite;
          if (!preparedTokenWrite) {
            throw new TypeError("Hosted device-sync runtime apply token write was not prepared.");
          }
          assertHostedRuntimePreparedTokenWriteMatches({
            prepared: preparedTokenWrite,
            tokenBundle: tokenBundleToPersist ?? null,
          });
          writtenRecord = await controlPlane.store.persistPreparedRuntimeApplyTokenWrite({
            prepared: preparedTokenWrite,
            record,
            tx,
          });
        }

        const failureDiagnostic =
          !versionMismatch && (stateMutationRequested || credentialMutationRequested)
            ? buildHostedRuntimeFailureApplyDiagnostic({
                appliedAt,
                baseline,
                nextAccount,
                update,
              })
            : null;

        return {
          failureDiagnostic,
          update: {
            connection: buildHostedRuntimeConnectionSnapshot(
              writtenRecord ?? record,
              null,
              durableExternalAccountId,
              [],
              {
                forceReauthorizationRequired:
                  !providerApplicationBindingCurrent,
                includeCredentialMaterial: false,
              },
            ).connection,
            connectionId: update.connectionId,
            status: "updated",
            tokenUpdate,
            writeUpdate,
          },
        } satisfies HostedRuntimeFailureApplyResult;
      },
    ).catch(async (error: unknown) => {
      await flushHostedRuntimeFailureApplyDiagnostics({
        entries: failureDiagnostics,
        schedule: input.scheduleFailureDiagnostics,
        userId: input.trustedUserId,
      });
      throw error;
    });
    updates.push(applied.update);
    if (applied.failureDiagnostic) {
      failureDiagnostics.push(applied.failureDiagnostic);
    }
  }
  await flushHostedRuntimeFailureApplyDiagnostics({
    entries: failureDiagnostics,
    schedule: input.scheduleFailureDiagnostics,
    userId: input.trustedUserId,
  });

  return {
    appliedAt,
    updates,
    userId: input.trustedUserId,
  };
}

async function prepareHostedRuntimeApplyConnections(input: {
  store: PrismaDeviceSyncControlPlaneStore;
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionUpdate[];
  userId: string;
}): Promise<Map<string, HostedRuntimePreparedApplyConnection>> {
  const connectionIds = input.updates.map((update) => update.connectionId);

  return runWithHostedDomainRootUnwrapCache(async () => {
    const records = await input.store.prisma.deviceConnection.findMany({
      where: {
        id: { in: connectionIds },
        userId: input.userId,
      },
      ...hostedConnectionRecordArgs,
    });
    const secretMaterial = await input.store.readRuntimeApplyConnectionSecretMaterial(records);

    const prepared = new Map<string, HostedRuntimePreparedApplyConnection>();
    for (const record of records) {
      const material = secretMaterial.get(record.id);
      if (!material) {
        throw new TypeError("Hosted device-sync runtime apply preparation lost connection secrets.");
      }
      prepared.set(record.id, {
        record,
        secretMaterial: material,
        tokenWrite: null,
      });
    }

    const tokenWritePreparations = input.updates.flatMap((update) => {
      if (update.credential?.kind !== "oauth_tokens") {
        return [];
      }
      const connection = prepared.get(update.connectionId);
      if (!connection) {
        return [];
      }
      const storedAccount = buildHostedRuntimePreparedStoredAccount(
        connection.record,
        connection.secretMaterial,
      );
      const baseline = buildHostedRuntimeConnectionSnapshot(
        connection.record,
        storedAccount,
        connection.secretMaterial.externalAccountId,
        [],
        { includeCredentialMaterial: true },
      );
      const credential = resolveHostedRuntimeCredentialUpdate(update.credential);
      if (credential.kind !== "oauth_tokens") {
        throw new TypeError("Hosted device-sync runtime apply token preparation received a non-token credential.");
      }
      validateHostedRuntimeCredentialMutation({
        baseline,
        credential,
        provider: connection.record.provider,
      });
      const tokenBundle = "clearTokens" in credential
        ? null
        : {
            ...credential.tokenBundle,
            tokenVersion: computeNextHostedTokenVersion(
              getHostedRuntimeOAuthTokenBundle(baseline.credential),
              credential.tokenBundle,
            ),
          };
      return [{
        externalAccountId: connection.secretMaterial.externalAccountId,
        record: connection.record,
        tokenBundle,
      }];
    });
    const tokenWrites = tokenWritePreparations.length > 0
      ? await input.store.prepareRuntimeApplyTokenWrites(tokenWritePreparations)
      : new Map<string, HostedRuntimeApplyPreparedTokenWrite>();
    for (const [connectionId, tokenWrite] of tokenWrites) {
      const connection = prepared.get(connectionId);
      if (!connection) {
        throw new TypeError("Hosted device-sync runtime apply token preparation lost its connection.");
      }
      connection.tokenWrite = tokenWrite;
    }

    return prepared;
  });
}

function buildHostedRuntimePreparedStoredAccount(
  record: HostedConnectionRecord,
  material: HostedRuntimeApplyConnectionSecretMaterial,
): HostedStoredDeviceSyncAccount | null {
  const mappedRecord = mapHostedConnectionRecord(record);
  mappedRecord.externalAccountId = material.externalAccountId;
  const publicConnection = buildHostedPublicDeviceSyncAccount({
    record: mappedRecord,
  });

  switch (mappedRecord.credentialKind) {
    case "oauth_tokens":
      return material.tokenBundle
        ? {
            ...publicConnection,
            credential: {
              kind: "oauth_tokens",
              tokens: {
                accessToken: material.tokenBundle.accessToken,
                accessTokenExpiresAt: material.tokenBundle.accessTokenExpiresAt,
                refreshToken: material.tokenBundle.refreshToken,
              },
            },
            disconnectGeneration: 0,
            keyVersion: material.tokenBundle.keyVersion,
            tokenVersion: material.tokenBundle.tokenVersion,
          }
        : null;
    case "provider_config":
      return mappedRecord.providerConfigKey
        ? {
            ...publicConnection,
            credential: {
              credentialMetadata: mappedRecord.credentialMetadata,
              kind: "provider_config",
              providerConfigKey: mappedRecord.providerConfigKey,
            },
            disconnectGeneration: 0,
            keyVersion: null,
            tokenVersion: null,
          }
        : null;
    case "none":
      return {
        ...publicConnection,
        credential: {
          credentialMetadata: mappedRecord.credentialMetadata,
          kind: "none",
        },
        disconnectGeneration: 0,
        keyVersion: null,
        tokenVersion: null,
      };
  }
}

function isHostedRuntimeApplySecretAuthorityCurrent(
  prepared: HostedConnectionRecord,
  live: HostedConnectionRecord,
): boolean {
  return prepared.id === live.id
    && prepared.userId === live.userId
    && prepared.provider === live.provider
    && prepared.credentialKind === live.credentialKind
    && prepared.accessTokenEncrypted === live.accessTokenEncrypted
    && prepared.refreshTokenEncrypted === live.refreshTokenEncrypted
    && prepared.externalAccountIdEncrypted === live.externalAccountIdEncrypted
    && prepared.keyVersion === live.keyVersion
    && prepared.tokenVersion === live.tokenVersion
    && sameHostedRuntimeApplyTimestamp(
      prepared.accessTokenExpiresAt,
      live.accessTokenExpiresAt,
    )
    && prepared.providerConfigKey === live.providerConfigKey
    && sameHostedRuntimeApplyJson(
      prepared.credentialMetadataJson,
      live.credentialMetadataJson,
    );
}

function sameHostedRuntimeApplyTimestamp(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
): boolean {
  return normalizeHostedRuntimeApplyTimestamp(left)
    === normalizeHostedRuntimeApplyTimestamp(right);
}

function normalizeHostedRuntimeApplyTimestamp(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function sameHostedRuntimeApplyJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeHostedRuntimeApplyJson(left))
    === JSON.stringify(canonicalizeHostedRuntimeApplyJson(right));
}

function canonicalizeHostedRuntimeApplyJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeHostedRuntimeApplyJson);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value ?? null;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeHostedRuntimeApplyJson(entry)]),
  );
}

function assertHostedRuntimePreparedTokenWriteMatches(input: {
  prepared: HostedRuntimeApplyPreparedTokenWrite;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}): void {
  if (!input.tokenBundle) {
    if (
      input.prepared.accessTokenEncrypted !== null
      || input.prepared.accessTokenExpiresAt !== null
      || input.prepared.keyVersion !== null
      || input.prepared.refreshTokenEncrypted !== null
      || input.prepared.tokenVersion !== null
    ) {
      throw new TypeError("Hosted device-sync runtime apply token clear preparation drifted.");
    }
    return;
  }

  if (
    !input.prepared.accessTokenEncrypted
    || input.prepared.accessTokenExpiresAt !== input.tokenBundle.accessTokenExpiresAt
    || !input.prepared.keyVersion
    || Boolean(input.prepared.refreshTokenEncrypted) !== Boolean(input.tokenBundle.refreshToken)
    || input.prepared.tokenVersion !== input.tokenBundle.tokenVersion
  ) {
    throw new TypeError("Hosted device-sync runtime apply token preparation drifted.");
  }
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
    ...(parsed.stagedDirtyAcks ? { stagedDirtyAcks: parsed.stagedDirtyAcks } : {}),
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
    ...(parsed.processedDirtyPayloadIds
      ? { processedDirtyPayloadIds: parsed.processedDirtyPayloadIds }
      : {}),
    processedRevision: BigInt(parsed.processedRevision),
    userId: input.trustedUserId,
  });
  const stillDirty = dirty?.stillDirty ?? false;
  const hasPendingDirty = stillDirty
    || await hasPendingHostedDeviceSyncDirtyWorkAfterStagedAcks({
      stagedDirtyAcks: parsed.stagedDirtyAcks ?? [],
      store: controlPlane.store,
      userId: input.trustedUserId,
    });

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

async function hasPendingHostedDeviceSyncDirtyWorkAfterStagedAcks(input: {
  stagedDirtyAcks: readonly HostedExecutionDeviceSyncStagedDirtyAck[];
  store: ReturnType<typeof createHostedDeviceSyncControlPlane>["store"];
  userId: string;
}): Promise<boolean> {
  if (input.stagedDirtyAcks.length === 0) {
    return await input.store.hasPendingDirtyConnectionForUser(input.userId);
  }

  const pending = await input.store.listPendingDirtyConnectionsForUser({
    limit: 1,
    stagedDirtyAcks: input.stagedDirtyAcks,
    userId: input.userId,
  });
  return pending.items.length > 0 || pending.hasMore;
}

async function isHostedProviderApplicationBindingCurrent(input: {
  record: HostedConnectionRecord;
  tx: HostedPrismaTransactionClient | PrismaClient;
  userId: string;
}): Promise<boolean> {
  const applicationId = normalizeNullableString(
    input.record.providerApplicationId,
  );
  const revision = input.record.providerApplicationRevision ?? null;
  if (!applicationId && revision === null) {
    return true;
  }
  if (
    !applicationId
    || revision === null
    || !isMemberOwnedDeviceProviderApplicationProvider(input.record.provider)
  ) {
    return false;
  }

  const application = await input.tx.deviceProviderApplication.findFirst({
    select: { id: true },
    where: {
      id: applicationId,
      memberId: input.userId,
      provider: input.record.provider,
      revision,
    },
  });
  return application !== null;
}

interface HostedRuntimeProviderApplicationResolution {
  blockedConnectionIds: Set<string>;
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
}

async function resolveHostedRuntimeProviderApplications(input: {
  includeCredentialMaterial: boolean;
  prisma: PrismaClient;
  records: readonly HostedConnectionRecord[];
  userId: string;
}): Promise<HostedRuntimeProviderApplicationResolution> {
  const blockedConnectionIds = new Set<string>();
  const providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs = {};
  const providerIdentity = new Map<
    string,
    { connectionIds: string[]; identity: string | null }
  >();

  // Resolve sequentially to avoid turning one runtime snapshot into a burst of
  // secure-box/KMS and database reads. No secret or decryption error is logged.
  for (const record of input.records) {
    if (record.status !== "active") {
      continue;
    }
    const applicationId = normalizeNullableString(
      record.providerApplicationId,
    );
    const revision = record.providerApplicationRevision ?? null;
    if (!applicationId && revision === null) {
      continue;
    }
    if (!applicationId || revision === null) {
      blockedConnectionIds.add(record.id);
      continue;
    }

    if (!input.includeCredentialMaterial) {
      if (!(await isHostedProviderApplicationBindingCurrent({
        record,
        tx: input.prisma,
        userId: input.userId,
      }))) {
        blockedConnectionIds.add(record.id);
      }
      continue;
    }

    try {
      const application = await resolveDeviceProviderApplication({
        applicationId,
        expectedRevision: revision,
        memberId: input.userId,
        prisma: input.prisma,
        provider: record.provider,
      });
      const config = application.providerConfigs[application.provider];
      if (!config) {
        blockedConnectionIds.add(record.id);
        continue;
      }

      const identity = `${application.applicationId}:r${application.revision}`;
      const existing = providerIdentity.get(application.provider);
      if (existing?.identity === null) {
        existing.connectionIds.push(record.id);
        blockedConnectionIds.add(record.id);
        continue;
      }
      if (existing && existing.identity !== identity) {
        for (const connectionId of existing.connectionIds) {
          blockedConnectionIds.add(connectionId);
        }
        blockedConnectionIds.add(record.id);
        providerIdentity.set(application.provider, {
          connectionIds: [...existing.connectionIds, record.id],
          identity: null,
        });
        delete providerConfigs[application.provider];
        continue;
      }

      providerIdentity.set(application.provider, {
        connectionIds: [...(existing?.connectionIds ?? []), record.id],
        identity,
      });
      providerConfigs[application.provider] = config as never;
    } catch (error) {
      if (isDeviceProviderApplicationError(error)) {
        blockedConnectionIds.add(record.id);
        continue;
      }
      throw error;
    }
  }

  return { blockedConnectionIds, providerConfigs };
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
    forceReauthorizationRequired?: boolean;
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
  const withholdRuntimeTokenMaterial =
    options.forceReauthorizationRequired === true
    || shouldWithholdHostedRuntimeTokenMaterial({
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
      status: options.forceReauthorizationRequired
        ? "reauthorization_required"
        : publicConnection.status,
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
    lastDataAt: source.lastDataAt,
    resourceCount: countHostedRuntimeConnectionSourceResources(
      source.resourceAvailabilitySummary,
    ),
    resourceAvailabilitySummary: source.resourceAvailabilitySummary ?? {},
    sourceInstanceKey: source.sourceInstanceKey,
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

function resolveHostedRuntimeHistoricalMetadata(input: {
  baselineMetadata: Record<string, unknown>;
  candidateMetadata: Record<string, unknown> | undefined;
  provider: string;
}): { metadata: Record<string, unknown>; rejected: boolean } | null {
  if (input.candidateMetadata === undefined) {
    return null;
  }

  const candidateMetadata = sanitizeStoredDeviceSyncMetadata(input.candidateMetadata);
  if (input.provider.trim().toLowerCase() !== "junction") {
    return { metadata: candidateMetadata, rejected: false };
  }

  const baselineMetadata = sanitizeStoredDeviceSyncMetadata(input.baselineMetadata);
  const baselineProgressMutable = canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(
    baselineMetadata,
  );
  const resolvedMetadata = baselineProgressMutable
    ? mergeHostedDeviceSyncConnectionMetadata({
        hostedMetadata: baselineMetadata,
        localConnectionStateUnpublished: true,
        localMetadata: candidateMetadata,
      }).metadata
    : baselineMetadata;
  const metadata: Record<string, unknown> = { ...candidateMetadata };
  let rejected = false;

  for (const key of Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS)) {
    const candidateHasKey = Object.prototype.hasOwnProperty.call(candidateMetadata, key);
    const resolvedHasKey = Object.prototype.hasOwnProperty.call(resolvedMetadata, key);
    if (
      candidateHasKey !== resolvedHasKey
      || (candidateHasKey && !Object.is(candidateMetadata[key], resolvedMetadata[key]))
    ) {
      if (
        !baselineProgressMutable
        || key !== JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence
      ) {
        rejected = true;
      }
    }

    if (resolvedHasKey) {
      metadata[key] = resolvedMetadata[key];
    } else {
      delete metadata[key];
    }
  }

  return { metadata, rejected };
}

function isHostedRuntimeHistoricalResetStateInconsistent(input: {
  currentSources: readonly HostedDeviceConnectionSource[];
  historicalMetadata: Record<string, unknown>;
  provider: string;
  sourceUpdates: readonly HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate[];
}): boolean {
  if (input.provider.trim().toLowerCase() !== "junction") {
    return false;
  }

  if (!canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(input.historicalMetadata)) {
    return false;
  }

  const sourcesByProvider = new Map<
    string,
    HostedDeviceConnectionSource | HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate
  >();
  for (const source of input.currentSources) {
    sourcesByProvider.set(source.sourceProviderSlug.trim().toLowerCase(), source);
  }
  for (const source of input.sourceUpdates) {
    sourcesByProvider.set(source.sourceProviderSlug.trim().toLowerCase(), source);
  }

  const historicalStatus = readJunctionHistoricalBackfillProgress(
    input.historicalMetadata,
  )?.status ?? null;
  const resetPresent = [...sourcesByProvider.values()].some(requiresHistoricalResetDeviceSyncSource);
  if (historicalStatus === "retrying") {
    return false;
  }
  if (historicalStatus === "exhausted") {
    return !resetPresent;
  }
  return resetPresent;
}

function resolveHostedRuntimeSourceUpdatesToApply(input: {
  connectionId: string;
  currentSources: readonly HostedDeviceConnectionSource[];
  historicalMetadata: Record<string, unknown>;
  provider: string;
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate[];
}): {
  staleCount: number;
  toApply: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate[];
} {
  const currentByInstanceKey = new Map(
    input.currentSources.map((source) => [source.sourceInstanceKey, source]),
  );
  const toApply: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate[] = [];
  let staleCount = 0;
  const historicalProgressMutable =
    canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(input.historicalMetadata);
  const historicalResetRequired = historicalProgressMutable
    && readJunctionHistoricalBackfillProgress(input.historicalMetadata)?.status === "exhausted";

  for (const rawUpdate of input.updates) {
    const normalized = normalizeHostedRuntimeSourceUpdateForProvider({
      connectionId: input.connectionId,
      provider: input.provider,
      update: rawUpdate,
    });
    const sourceInstanceKeyCanonicalized = normalized.sourceInstanceKeyCanonicalized;
    let update = normalized.update;
    const current = currentByInstanceKey.get(update.sourceInstanceKey) ?? null;
    const currentLastSeenAt = current?.lastSeenAt ?? null;

    if (current && isHostedSourceDisconnectFenced(current)) {
      staleCount += 1;
      continue;
    }

    // The runner's snapshot can predate an arrival Web already recorded, so an
    // otherwise valid update must not carry the older value back. Forward-only
    // is the whole basis of the stall signal: a rewind reopens a silence window
    // that already closed and can manufacture a false stall alert.
    if (Object.prototype.hasOwnProperty.call(update, "lastDataAt")) {
      const mergedLastDataAt = laterHostedRuntimeTimestamp(
        update.lastDataAt ?? null,
        current?.lastDataAt ?? null,
      );

      if (mergedLastDataAt !== (update.lastDataAt ?? null)) {
        update = { ...update, lastDataAt: mergedLastDataAt };
      }
    }

    if (
      (historicalResetRequired || !historicalProgressMutable)
      && current
      && requiresHistoricalResetDeviceSyncSource(current)
      && !requiresHistoricalResetDeviceSyncSource(update)
    ) {
      update = {
        ...update,
        lastErrorCode: current.lastErrorCode,
        lastErrorMessage: current.lastErrorMessage,
        status: "error",
      };
    }

    if (sourceInstanceKeyCanonicalized) {
      if (current && isHostedRuntimeTimestampOlder(update.lastSeenAt, currentLastSeenAt)) {
        staleCount += 1;
        continue;
      }
    } else if (currentLastSeenAt !== update.observedLastSeenAt) {
      staleCount += 1;
      continue;
    }

    if (current && hostedRuntimeSourceUpdateMatchesCurrent(update, current)) {
      continue;
    }

    toApply.push(update);
  }

  return { staleCount, toApply };
}

function normalizeHostedRuntimeSourceUpdateForProvider(input: {
  connectionId: string;
  provider: string;
  update: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate;
}): {
  sourceInstanceKeyCanonicalized: boolean;
  update: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate;
} {
  if (input.provider.trim().toLowerCase() !== "junction") {
    return {
      sourceInstanceKeyCanonicalized: false,
      update: input.update,
    };
  }

  const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.connectionId,
    sourceProviderSlug: input.update.sourceProviderSlug,
  });

  if (!canonicalSourceInstanceKey || canonicalSourceInstanceKey === input.update.sourceInstanceKey) {
    return {
      sourceInstanceKeyCanonicalized: false,
      update: input.update,
    };
  }

  return {
    sourceInstanceKeyCanonicalized: true,
    update: {
      ...input.update,
      sourceInstanceKey: canonicalSourceInstanceKey,
    },
  };
}

/** Returns whichever ISO timestamp is later, treating null as "never". */
function laterHostedRuntimeTimestamp(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function isHostedRuntimeTimestampOlder(
  candidate: string | null | undefined,
  reference: string | null | undefined,
): boolean {
  if (!candidate || !reference) {
    return false;
  }

  const candidateTime = Date.parse(candidate);
  const referenceTime = Date.parse(reference);
  return !Number.isNaN(candidateTime)
    && !Number.isNaN(referenceTime)
    && candidateTime < referenceTime;
}

function hostedRuntimeSourceUpdateMatchesCurrent(
  update: HostedExecutionDeviceSyncRuntimeConnectionSourceUpdate,
  current: HostedDeviceConnectionSource,
): boolean {
  return current.sourceProviderSlug === update.sourceProviderSlug
    && current.displayName === (update.displayName ?? null)
    && current.status === update.status
    && equalHostedRuntimeSourceSummaries(
      current.resourceAvailabilitySummary ?? {},
      update.resourceAvailabilitySummary ?? {},
    )
    && current.lastErrorCode === (update.lastErrorCode ?? null)
    && current.lastErrorMessage === (update.lastErrorMessage ?? null)
    && current.firstSeenAt === (update.firstSeenAt ?? null)
    && current.lastSeenAt === update.lastSeenAt
    // A push carrier can deliver without any other field moving, so an
    // arrival-only update must not be dropped as a no-op.
    && (update.lastDataAt === undefined || current.lastDataAt === update.lastDataAt);
}

function equalHostedRuntimeSourceSummaries(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(sortHostedRuntimeJsonRecord(left))
    === JSON.stringify(sortHostedRuntimeJsonRecord(right));
}

function sortHostedRuntimeJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
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

function buildHostedRuntimeFailureApplyDiagnostic(input: {
  appliedAt: string;
  baseline: HostedRuntimeConnectionSnapshot;
  nextAccount: PublicDeviceSyncAccount;
  update: HostedExecutionDeviceSyncRuntimeConnectionUpdate;
}): HostedRuntimeLogEntry | null {
  if (!didHostedRuntimeFailureStateAdvance(
    input.baseline.localState.lastSyncErrorAt,
    input.nextAccount.lastSyncErrorAt,
  )) {
    return null;
  }

  return {
    at: input.nextAccount.lastSyncErrorAt ?? input.appliedAt,
    component: "device-sync",
    errorCode: toHostedRuntimeApplyLogCode(
      input.nextAccount.lastErrorCode ?? input.update.failureDiagnostic?.code ?? null,
    ),
    eventCode: "device-sync.job_failed",
    level: "warn",
    phase: "invoke",
    redactedJson: buildHostedRuntimeFailureApplyRedactedJson(input),
  };
}

async function writeHostedRuntimeFailureApplyDiagnosticsBestEffort(input: {
  entries: readonly HostedRuntimeLogEntry[];
  userId: string;
}): Promise<void> {
  for (
    let offset = 0;
    offset < input.entries.length;
    offset += HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES
  ) {
    const entries = input.entries.slice(
      offset,
      offset + HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
    );
    try {
      await writeHostedRuntimeLogs({
        entries,
        userId: input.userId,
      });
    } catch (error) {
      const first = entries[0];
      const provider = first?.redactedJson?.provider;
      console.warn("Hosted device-sync failure diagnostic log write failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_DEVICE_SYNC_FAILURE_DIAGNOSTIC_LOG_WRITE_FAILED",
        }),
        batchSize: entries.length,
        provider: typeof provider === "string" ? provider : null,
        runtimeFailureCode: first?.errorCode ?? null,
      });
    }
  }
}

async function flushHostedRuntimeFailureApplyDiagnostics(input: {
  entries: readonly HostedRuntimeLogEntry[];
  schedule?: (task: () => Promise<void>) => void;
  userId: string;
}): Promise<void> {
  if (input.entries.length === 0) {
    return;
  }

  const entries = [...input.entries];
  const task = async () => {
    await writeHostedRuntimeFailureApplyDiagnosticsBestEffort({
      entries,
      userId: input.userId,
    });
  };
  if (!input.schedule) {
    await task();
    return;
  }

  try {
    input.schedule(task);
  } catch (error) {
    console.warn(
      "Hosted device-sync failure diagnostic scheduling failed.",
      formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_DEVICE_SYNC_FAILURE_DIAGNOSTIC_SCHEDULING_FAILED",
      }),
    );
  }
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
    failureSummary: summary ?? "Hosted device-sync runtime failure state advanced.",
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
  const policy = resolveConfiguredDeviceSyncProviderCredentialPolicy(input.provider);

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
}): Promise<HostedConnectionRecord> {
  if (input.credential.kind === "provider_config" && !input.credential.providerConfigKey.trim()) {
    throw new TypeError("Hosted provider-config device-sync credential is missing providerConfigKey.");
  }

  const credentialMetadataJson = sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata(
    input.credential.credentialMetadata,
  );

  return input.tx.deviceConnection.update({
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
    ...hostedConnectionRecordArgs,
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
