import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";
import {
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncRuntimeApplyEntry,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionSeed,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "./crypto-context.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";

const DEVICE_SYNC_RUNTIME_SCHEMA = "murph.hosted-device-sync-runtime.v1";

interface StoredDeviceSyncRuntimeState {
  generatedAt: string;
  schema: typeof DEVICE_SYNC_RUNTIME_SCHEMA;
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse;
}

export interface HostedDeviceSyncRuntimeStore {
  applyUpdates(request: HostedExecutionDeviceSyncRuntimeApplyRequest): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  readSnapshot(request: HostedExecutionDeviceSyncRuntimeSnapshotRequest): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
}

export function createHostedDeviceSyncRuntimeStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedDeviceSyncRuntimeStore {
  return {
    async applyUpdates(request) {
      const appliedAt = request.occurredAt ?? new Date().toISOString();
      const current = await readStoredDeviceSyncRuntimeState({
        ...input,
        userId: request.userId,
      });
      const snapshot = current?.snapshot ?? emptySnapshot(request.userId, appliedAt);
      const byConnectionId = new Map(
        snapshot.connections.map((entry) => [entry.connection.id, cloneConnectionSnapshot(entry)]),
      );
      const updates: HostedExecutionDeviceSyncRuntimeApplyEntry[] = [];

      for (const update of request.updates) {
        const currentConnection = byConnectionId.get(update.connectionId) ?? null;
        const createdFromSeed = !currentConnection && Boolean(update.seed);

        if (!currentConnection && !update.seed) {
          updates.push({
            connection: null,
            connectionId: update.connectionId,
            status: "missing",
            tokenUpdate: "missing",
          });
          continue;
        }

        const baseConnection = currentConnection
          ? cloneConnectionSnapshot(currentConnection)
          : createSeededConnectionSnapshot(update.connectionId, update.seed!, appliedAt);
        const nextConnection = cloneConnectionSnapshot(baseConnection);
        const stateMutationRequested = Boolean(update.connection)
          || Boolean(update.localState)
          || update.tokenBundle !== undefined;
        const connectionVersionMismatch = Boolean(
          currentConnection
          && stateMutationRequested
          && update.observedUpdatedAt !== undefined
          && update.observedUpdatedAt !== null
          && (nextConnection.connection.updatedAt ?? null) !== update.observedUpdatedAt,
        );
        const tokenMutationRequested = update.tokenBundle !== undefined || update.connection?.status === "disconnected";
        const tokenVersionMismatch = Boolean(
          currentConnection
          && tokenMutationRequested
          && nextConnection.tokenBundle
          && update.observedTokenVersion !== undefined
          && update.observedTokenVersion !== null
          && nextConnection.tokenBundle.tokenVersion !== update.observedTokenVersion,
        );
        const versionMismatch = connectionVersionMismatch || tokenVersionMismatch;

        if (!versionMismatch && update.connection) {
          if (Object.prototype.hasOwnProperty.call(update.connection, "displayName")) {
            nextConnection.connection.displayName = update.connection.displayName ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "metadata")) {
            nextConnection.connection.metadata = sanitizeStoredDeviceSyncMetadata(
              update.connection.metadata ?? {},
            );
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "scopes")) {
            nextConnection.connection.scopes = [...(update.connection.scopes ?? [])];
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "status") && update.connection.status) {
            nextConnection.connection.status = update.connection.status;
          }
        }

        if (!versionMismatch && update.localState) {
          if (update.localState.clearError) {
            nextConnection.localState.lastErrorCode = null;
            nextConnection.localState.lastErrorMessage = null;
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
              nextConnection.localState[field] = update.localState[field] ?? null;
            }
          }
        }

        let tokenUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["tokenUpdate"];
        if (update.tokenBundle === undefined) {
          tokenUpdate = nextConnection.tokenBundle ? "unchanged" : "missing";
        } else if (versionMismatch) {
          tokenUpdate = "skipped_version_mismatch";
        } else if (update.connection?.status === "disconnected") {
          nextConnection.tokenBundle = null;
          tokenUpdate = baseConnection.tokenBundle ? "cleared" : "missing";
        } else if (update.tokenBundle === null) {
          nextConnection.tokenBundle = null;
          tokenUpdate = baseConnection.tokenBundle ? "cleared" : "missing";
        } else {
          const nextTokenVersion = baseConnection.tokenBundle
            ? hasSameTokenBundle(baseConnection.tokenBundle, update.tokenBundle)
              ? baseConnection.tokenBundle.tokenVersion
              : baseConnection.tokenBundle.tokenVersion + 1
            : Math.max(1, update.tokenBundle.tokenVersion);

          nextConnection.tokenBundle = {
            ...update.tokenBundle,
            tokenVersion: nextTokenVersion,
          };
          nextConnection.connection.accessTokenExpiresAt = update.tokenBundle.accessTokenExpiresAt;
          tokenUpdate = "applied";
        }

        if (!nextConnection.connection.updatedAt) {
          nextConnection.connection.updatedAt = baseConnection.connection.updatedAt ?? appliedAt;
        }

        if (!versionMismatch && stateMutationRequested) {
          nextConnection.connection.updatedAt = appliedAt;
        }

        if (createdFromSeed && !nextConnection.connection.updatedAt) {
          nextConnection.connection.updatedAt = appliedAt;
        }

        byConnectionId.set(update.connectionId, nextConnection);
        updates.push({
          connection: nextConnection.connection,
          connectionId: update.connectionId,
          status: createdFromSeed ? "created" : "updated",
          tokenUpdate,
        });
      }

      const nextSnapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse = {
        connections: sortConnectionSnapshots([...byConnectionId.values()]),
        generatedAt: appliedAt,
        userId: request.userId,
      };

      await writeStoredDeviceSyncRuntimeState({
        ...input,
        state: {
          generatedAt: appliedAt,
          schema: DEVICE_SYNC_RUNTIME_SCHEMA,
          snapshot: nextSnapshot,
        },
        userId: request.userId,
      });

      return {
        appliedAt,
        updates,
        userId: request.userId,
      };
    },

    async readSnapshot(request) {
      const current = await readStoredDeviceSyncRuntimeState({
        ...input,
        userId: request.userId,
      });
      const snapshot = current?.snapshot ?? emptySnapshot(request.userId, new Date().toISOString());

      return {
        connections: sortConnectionSnapshots(
          snapshot.connections.filter((entry) => (
            (!request.connectionId || entry.connection.id === request.connectionId)
            && (!request.provider || entry.connection.provider === request.provider)
          )).map((entry) => cloneConnectionSnapshot(entry)),
        ),
        generatedAt: snapshot.generatedAt,
        userId: request.userId,
      };
    },
  };
}

function emptySnapshot(userId: string, generatedAt: string): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return {
    connections: [],
    generatedAt,
    userId,
  };
}

function cloneConnectionSnapshot(
  entry: HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  return structuredClone(entry);
}

function createSeededConnectionSnapshot(
  connectionId: string,
  seed: HostedExecutionDeviceSyncRuntimeConnectionSeed,
  appliedAt: string,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  if (seed.connection.id !== connectionId) {
    throw new TypeError(
      `Hosted device-sync runtime seed connectionId mismatch: expected ${connectionId}, received ${seed.connection.id}.`,
    );
  }

  return {
    connection: {
      ...structuredClone(seed.connection),
      accessTokenExpiresAt: seed.tokenBundle?.accessTokenExpiresAt ?? seed.connection.accessTokenExpiresAt,
      metadata: sanitizeStoredDeviceSyncMetadata(seed.connection.metadata ?? {}),
      updatedAt: seed.connection.updatedAt ?? seed.connection.createdAt ?? appliedAt,
    },
    localState: structuredClone(seed.localState),
    tokenBundle: seed.tokenBundle ? structuredClone(seed.tokenBundle) : null,
  };
}

function sortConnectionSnapshots(
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[],
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot[] {
  return [...connections].sort((left, right) => {
    const leftUpdatedAt = left.connection.updatedAt ?? left.connection.createdAt;
    const rightUpdatedAt = right.connection.updatedAt ?? right.connection.createdAt;
    return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.connection.id.localeCompare(right.connection.id);
  });
}

function hasSameTokenBundle(
  left: HostedExecutionDeviceSyncRuntimeConnectionSnapshot["tokenBundle"],
  right: HostedExecutionDeviceSyncRuntimeConnectionSnapshot["tokenBundle"],
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.accessToken === right.accessToken
    && left.accessTokenExpiresAt === right.accessTokenExpiresAt
    && left.keyVersion === right.keyVersion
    && left.refreshToken === right.refreshToken;
}

async function readStoredDeviceSyncRuntimeState(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<StoredDeviceSyncRuntimeState | null> {
  const key = await deviceSyncRuntimeStateObjectKey(input.key, input.userId);
  return readEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "device-sync-runtime",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key,
    parse(value) {
      return parseStoredDeviceSyncRuntimeState(value);
    },
    scope: "device-sync-runtime",
  });
}

async function writeStoredDeviceSyncRuntimeState(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  state: StoredDeviceSyncRuntimeState;
  userId: string;
}): Promise<void> {
  const key = await deviceSyncRuntimeStateObjectKey(input.key, input.userId);
  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "device-sync-runtime",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    scope: "device-sync-runtime",
    value: input.state,
  });
}

function parseStoredDeviceSyncRuntimeState(value: unknown): StoredDeviceSyncRuntimeState {
  const record = requireRecord(value, "Hosted device-sync runtime state");

  return {
    generatedAt: requireString(record.generatedAt, "Hosted device-sync runtime state.generatedAt"),
    schema: requireSchema(record.schema, "Hosted device-sync runtime state.schema"),
    snapshot: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(record.snapshot),
  };
}

function requireSchema(
  value: unknown,
  label: string,
): StoredDeviceSyncRuntimeState["schema"] {
  const schema = requireString(value, label);
  if (schema !== DEVICE_SYNC_RUNTIME_SCHEMA) {
    throw new TypeError(`${label} must be ${DEVICE_SYNC_RUNTIME_SCHEMA}.`);
  }
  return schema;
}

async function deviceSyncRuntimeStateObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "device-sync-runtime-path",
    value: `user:${userId}`,
  });

  return `transient/device-sync-runtime/${userSegment}.json`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}
