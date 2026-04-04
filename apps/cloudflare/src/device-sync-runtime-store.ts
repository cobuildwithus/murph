import type {
  HostedExecutionDeviceSyncRuntimeApplyEntry,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/hosted-execution";
import { parseHostedExecutionDeviceSyncRuntimeSnapshotResponse } from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

const DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA = "murph.hosted-device-sync-runtime-mirror.v1";

interface StoredDeviceSyncRuntimeMirror {
  generatedAt: string;
  schema: typeof DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA;
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse;
}

export interface HostedDeviceSyncRuntimeStore {
  applyUpdates(request: HostedExecutionDeviceSyncRuntimeApplyRequest): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  mergeSnapshot(snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
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
      const current = await readStoredDeviceSyncRuntimeMirror({
        ...input,
        userId: request.userId,
      });
      const snapshot = current?.snapshot ?? emptySnapshot(request.userId, appliedAt);
      const byConnectionId = new Map(snapshot.connections.map((entry) => [entry.connection.id, cloneConnectionSnapshot(entry)]));
      const updates: HostedExecutionDeviceSyncRuntimeApplyEntry[] = [];

      for (const update of request.updates) {
        const currentConnection = byConnectionId.get(update.connectionId);
        if (!currentConnection) {
          updates.push({
            connection: null,
            connectionId: update.connectionId,
            status: "missing",
            tokenUpdate: "missing",
          });
          continue;
        }

        const nextConnection = cloneConnectionSnapshot(currentConnection);
        const connectionMutationRequested = Boolean(update.connection) || update.tokenBundle !== undefined;
        const localStateMutationRequested = Boolean(update.localState);
        const connectionVersionMismatch = Boolean(
          connectionMutationRequested
          && update.observedUpdatedAt !== undefined
          && update.observedUpdatedAt !== null
          && (nextConnection.connection.updatedAt ?? null) !== update.observedUpdatedAt,
        );
        const tokenVersionMismatch = Boolean(
          update.tokenBundle !== undefined
          && update.tokenBundle !== null
          && nextConnection.tokenBundle
          && update.observedTokenVersion !== undefined
          && update.observedTokenVersion !== null
          && nextConnection.tokenBundle.tokenVersion !== update.observedTokenVersion
        );

        if (!connectionVersionMismatch && update.connection) {
          if (Object.prototype.hasOwnProperty.call(update.connection, "displayName")) {
            nextConnection.connection.displayName = update.connection.displayName ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "metadata")) {
            nextConnection.connection.metadata = structuredClone(update.connection.metadata ?? {});
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "scopes")) {
            nextConnection.connection.scopes = [...(update.connection.scopes ?? [])];
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "status") && update.connection.status) {
            nextConnection.connection.status = update.connection.status;
          }
        }

        if (update.localState) {
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
        } else if (connectionVersionMismatch || tokenVersionMismatch) {
          tokenUpdate = "skipped_version_mismatch";
        } else if (update.connection?.status === "disconnected") {
          nextConnection.tokenBundle = null;
          tokenUpdate = currentConnection.tokenBundle ? "cleared" : "missing";
        } else if (update.tokenBundle === null) {
          nextConnection.tokenBundle = null;
          tokenUpdate = currentConnection.tokenBundle ? "cleared" : "missing";
        } else {
          nextConnection.tokenBundle = {
            ...update.tokenBundle,
          };
          nextConnection.connection.accessTokenExpiresAt = update.tokenBundle.accessTokenExpiresAt;
          tokenUpdate = "applied";
        }

        if (!connectionVersionMismatch && connectionMutationRequested) {
          nextConnection.connection.updatedAt = appliedAt;
        } else if (!nextConnection.connection.updatedAt) {
          nextConnection.connection.updatedAt = appliedAt;
        }

        byConnectionId.set(update.connectionId, nextConnection);
        updates.push({
          connection: nextConnection.connection,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate,
        });
      }

      const nextSnapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse = {
        connections: sortConnectionSnapshots([...byConnectionId.values()]),
        generatedAt: appliedAt,
        userId: request.userId,
      };

      await writeStoredDeviceSyncRuntimeMirror({
        ...input,
        mirror: {
          generatedAt: appliedAt,
          schema: DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA,
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

    async mergeSnapshot(snapshot) {
      const current = await readStoredDeviceSyncRuntimeMirror({
        ...input,
        userId: snapshot.userId,
      });
      const currentByConnectionId = new Map(
        (current?.snapshot.connections ?? []).map((entry) => [entry.connection.id, cloneConnectionSnapshot(entry)]),
      );

      for (const incoming of snapshot.connections) {
        const existing = currentByConnectionId.get(incoming.connection.id);
        currentByConnectionId.set(
          incoming.connection.id,
          selectPreferredConnectionSnapshot(existing ?? null, incoming),
        );
      }

      const mergedSnapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse = {
        connections: sortConnectionSnapshots([...currentByConnectionId.values()]),
        generatedAt: snapshot.generatedAt,
        userId: snapshot.userId,
      };

      await writeStoredDeviceSyncRuntimeMirror({
        ...input,
        mirror: {
          generatedAt: snapshot.generatedAt,
          schema: DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA,
          snapshot: mergedSnapshot,
        },
        userId: snapshot.userId,
      });

      return mergedSnapshot;
    },

    async readSnapshot(request) {
      const current = await readStoredDeviceSyncRuntimeMirror({
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

function selectPreferredConnectionSnapshot(
  existing: HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null,
  incoming: HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  if (!existing) {
    return cloneConnectionSnapshot(incoming);
  }

  const existingUpdatedAt = existing.connection.updatedAt ?? existing.connection.createdAt;
  const incomingUpdatedAt = incoming.connection.updatedAt ?? incoming.connection.createdAt;

  if (existingUpdatedAt.localeCompare(incomingUpdatedAt) > 0) {
    return cloneConnectionSnapshot(existing);
  }

  if (existingUpdatedAt === incomingUpdatedAt) {
    const existingTokenVersion = existing.tokenBundle?.tokenVersion ?? -1;
    const incomingTokenVersion = incoming.tokenBundle?.tokenVersion ?? -1;

    if (existingTokenVersion > incomingTokenVersion) {
      return cloneConnectionSnapshot(existing);
    }
  }

  return cloneConnectionSnapshot(incoming);
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

async function readStoredDeviceSyncRuntimeMirror(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<StoredDeviceSyncRuntimeMirror | null> {
  for (const key of await deviceSyncRuntimeMirrorObjectKeys(input.key, input.keysById, input.userId)) {
    const value = await readEncryptedR2Json({
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
        return parseStoredDeviceSyncRuntimeMirror(value);
      },
      scope: "device-sync-runtime",
    });

    if (value) {
      return value;
    }
  }

  return null;
}

async function writeStoredDeviceSyncRuntimeMirror(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  mirror: StoredDeviceSyncRuntimeMirror;
  userId: string;
}): Promise<void> {
  const key = await deviceSyncRuntimeMirrorObjectKey(input.key, input.userId);
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
    value: input.mirror,
  });
}

function parseStoredDeviceSyncRuntimeMirror(value: unknown): StoredDeviceSyncRuntimeMirror {
  const record = requireRecord(value, "Hosted device-sync runtime mirror");

  return {
    generatedAt: requireString(record.generatedAt, "Hosted device-sync runtime mirror generatedAt"),
    schema: requireSchema(record.schema, "Hosted device-sync runtime mirror schema"),
    snapshot: requireSnapshot(record.snapshot),
  };
}

function requireSnapshot(value: unknown): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(value);
}

function requireSchema(value: unknown, label: string): typeof DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA {
  const schema = requireString(value, label);
  if (schema !== DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA) {
    throw new TypeError(`${label} must be ${DEVICE_SYNC_RUNTIME_MIRROR_SCHEMA}.`);
  }
  return schema;
}

async function deviceSyncRuntimeMirrorObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "device-sync-runtime-path",
    value: `user:${userId}`,
  });

  return `transient/device-sync-runtime/${userSegment}.json`;
}

async function deviceSyncRuntimeMirrorObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    deviceSyncRuntimeMirrorObjectKey(candidateRootKey, userId)
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}
