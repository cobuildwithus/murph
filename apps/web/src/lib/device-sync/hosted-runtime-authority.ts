import {
  sanitizeStoredDeviceSyncMetadata,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  sanitizeHostedExecutionDeviceSyncRuntimeCredentialMetadata,
  type HostedExecutionDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  type HostedExecutionDeviceSyncRuntimeCredentialUpdate,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";
import { resolveConfiguredDeviceSyncProviderManifest } from "@murphai/device-syncd/config";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import {
  buildHostedPublicDeviceSyncAccount,
  type HostedStaticDeviceSyncConnectionRecord,
} from "./internal-runtime";
import { buildStoredTokenBundle } from "./agent-session-token-bundle";
import {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
  type HostedConnectionRecord,
  type HostedPrismaTransactionClient,
  type HostedStoredDeviceSyncAccount,
} from "./prisma-store";
import {
  normalizeHostedDeviceSyncLifecycleStatus,
} from "./prisma-store/connection-records";
import { toPrismaJsonObject } from "./prisma-store/prisma-json";

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

      return buildHostedRuntimeConnectionSnapshot(
        record,
        storedAccount,
        storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null,
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
    parsed.updates.map(async (update) =>
      controlPlane.store.withConnectionRefreshLock(update.connectionId, async (tx) => {
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
          : await controlPlane.store.getConnectionForUser(input.trustedUserId, update.connectionId);
        const durableExternalAccountId =
          storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null;
        const baseline = buildHostedRuntimeConnectionSnapshot(
          record,
          storedAccount,
          durableExternalAccountId,
        );
        const stateMutationRequested = update.connection !== undefined || update.localState !== undefined;
        const credentialMutationRequested = update.credential !== undefined;
        const connectionWriteRequested = stateMutationRequested || credentialMutationRequested;
        const connectionVersionMismatch = stateMutationRequested
          && (baseline.connection.updatedAt ?? null) !== update.observedUpdatedAt;
        const tokenVersionMismatch = hostedRuntimeCredentialMutationRequiresTokenFence(update)
          && (getHostedRuntimeOAuthTokenBundle(baseline.credential)?.tokenVersion ?? null) !== update.observedTokenVersion;
        const versionMismatch = connectionVersionMismatch || tokenVersionMismatch;
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
          | Exclude<HostedExecutionDeviceSyncRuntimeCredentialSnapshot, { kind: "oauth_tokens" }>
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

        return {
          connection: refreshedRecord
            ? buildHostedRuntimeConnectionSnapshot(
                refreshedRecord,
                refreshedStoredAccount,
                durableExternalAccountId,
              ).connection
            : null,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate,
          writeUpdate,
        } satisfies HostedExecutionDeviceSyncRuntimeApplyEntry;
      })),
  );

  return {
    appliedAt,
    updates,
    userId: input.trustedUserId,
  };
}

function buildHostedRuntimeConnectionSnapshot(
  record: HostedConnectionRecord,
  storedAccount: HostedStoredDeviceSyncAccount | null,
  fallbackExternalAccountId: string | null = null,
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
  const credential = buildHostedRuntimeCredentialSnapshot({
    record: mappedRecord,
    storedAccount,
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
    setupExpiresAt: snapshot.connection.setupExpiresAt ?? null,
    setupPhase: snapshot.connection.setupPhase ?? null,
    status: normalizeHostedDeviceSyncLifecycleStatus(snapshot.connection.status),
    updatedAt: snapshot.connection.updatedAt ?? snapshot.connection.createdAt,
  };
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
  record: HostedStaticDeviceSyncConnectionRecord;
  storedAccount: HostedStoredDeviceSyncAccount | null;
}): HostedExecutionDeviceSyncRuntimeCredentialSnapshot {
  const storedTokenBundle = buildStoredTokenBundle(input.storedAccount);

  if (storedTokenBundle) {
    return {
      kind: "oauth_tokens",
      tokenBundle: storedTokenBundle,
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

function resolveHostedRuntimeCredentialUpdate(
  credential: HostedExecutionDeviceSyncRuntimeCredentialUpdate,
): HostedExecutionDeviceSyncRuntimeCredentialSnapshot | Extract<
  HostedExecutionDeviceSyncRuntimeCredentialUpdate,
  { clearTokens: true; kind: "oauth_tokens" }
> {
  if (credential.kind === "oauth_tokens" && "clearTokens" in credential) {
    return credential;
  }

  return credential;
}

function validateHostedRuntimeCredentialMutation(input: {
  baseline: HostedRuntimeConnectionSnapshot;
  credential: HostedExecutionDeviceSyncRuntimeCredentialSnapshot | Extract<
    HostedExecutionDeviceSyncRuntimeCredentialUpdate,
    { clearTokens: true; kind: "oauth_tokens" }
  >;
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
  credential: Exclude<HostedExecutionDeviceSyncRuntimeCredentialSnapshot, { kind: "oauth_tokens" }>;
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
      refreshTokenEncrypted: null,
      tokenVersion: null,
    },
  });
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
