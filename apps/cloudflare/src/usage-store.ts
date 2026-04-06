import { encodeBase64 } from "./base64.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import type { R2BucketLike } from "./bundle-store.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";

const HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA = "murph.hosted-pending-usage-dirty.v1";
const HOSTED_PENDING_USAGE_RECORD_SCHEMA = "murph.hosted-pending-usage-record.v2";
const HOSTED_PENDING_USAGE_DIRTY_PREFIX = "transient/assistant-usage-dirty/";
const HOSTED_PENDING_USAGE_RECORD_PREFIX = "transient/assistant-usage/";

interface StoredHostedPendingUsageDirtyUser {
  schema: typeof HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA;
  updatedAt: string;
  userId: string;
}

interface StoredHostedPendingUsageRecord {
  record: Record<string, unknown>;
  schema: typeof HOSTED_PENDING_USAGE_RECORD_SCHEMA;
  updatedAt: string;
  usageId: string;
  userId: string;
}

interface HostedPendingUsageState {
  records: Record<string, unknown>[];
}

export interface HostedPendingUsageStore {
  appendUsage(input: {
    usage: readonly Record<string, unknown>[];
    userId: string;
  }): Promise<{ recorded: number; usageIds: string[] }>;
  deleteUsage(input: {
    usageIds: readonly string[];
    userId: string;
  }): Promise<void>;
  readUsage(input: {
    limit?: number;
    userId: string;
  }): Promise<Record<string, unknown>[]>;
}

export interface HostedPendingUsageDirtyUserStore {
  listDirtyUsers(input?: { limit?: number | null }): Promise<string[]>;
}

export function createHostedPendingUsageStore(input: {
  bucket: R2BucketLike;
  dirtyKey: Uint8Array;
  dirtyKeyId: string;
  dirtyKeysById?: Readonly<Record<string, Uint8Array>>;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedPendingUsageStore {
  return {
    async appendUsage(request) {
      const state = await readHostedPendingUsageState({
        ...input,
        userId: request.userId,
      });
      const existingUsageIds = new Set(state.records.map((record) => readUsageId(record)));
      const acceptedUsageIds = new Set<string>();
      const accepted = request.usage
        .map((record, index) => cloneUsageRecord(requireRecord(record, `usage[${index}]`)))
        .filter((record) => {
          const usageId = readUsageId(record);
          if (existingUsageIds.has(usageId) || acceptedUsageIds.has(usageId)) {
            return false;
          }

          acceptedUsageIds.add(usageId);
          return true;
        });

      const now = new Date().toISOString();

      for (const record of accepted) {
        await writeStoredHostedPendingUsageRecord({
          ...input,
          record,
          updatedAt: now,
          userId: request.userId,
        });
      }

      const totalRecords = state.records.length + accepted.length;
      if (totalRecords > 0 && accepted.length > 0) {
        await writeHostedPendingUsageDirtyUser({
          bucket: input.bucket,
          key: input.dirtyKey,
          keyId: input.dirtyKeyId,
          updatedAt: now,
          userId: request.userId,
        });
      }

      return {
        recorded: accepted.length,
        usageIds: accepted.map((record) => readUsageId(record)),
      };
    },

    async deleteUsage(request) {
      const usageIds = new Set(
        request.usageIds.map((entry) => normalizeRequiredString(entry, "usageIds[]")),
      );
      if (usageIds.size === 0) {
        return;
      }

      const state = await readHostedPendingUsageState({
        ...input,
        userId: request.userId,
      });
      const now = new Date().toISOString();

      if (input.bucket.delete) {
        for (const usageId of usageIds) {
          for (const key of await pendingUsageRecordObjectKeys(
            input.key,
            input.keysById,
            request.userId,
            usageId,
          )) {
            await input.bucket.delete(key);
          }
        }
      }

      const remainingCount = state.records.filter(
        (record) => !usageIds.has(readUsageId(record)),
      ).length;

      if (remainingCount === 0) {
        await deleteHostedPendingUsageDirtyUser({
          bucket: input.bucket,
          key: input.dirtyKey,
          keysById: input.dirtyKeysById,
          userId: request.userId,
        });
        return;
      }

      await writeHostedPendingUsageDirtyUser({
        bucket: input.bucket,
        key: input.dirtyKey,
        keyId: input.dirtyKeyId,
        updatedAt: now,
        userId: request.userId,
      });
    },

    async readUsage(request) {
      const state = await readHostedPendingUsageState({
        ...input,
        requireListing: true,
        userId: request.userId,
      });
      const limit = request.limit ?? null;
      const sorted = sortHostedPendingUsageRecords(state.records);
      const selected = limit === null ? sorted : sorted.slice(0, limit);
      return selected.map((record) => cloneUsageRecord(record));
    },
  };
}

export function createHostedPendingUsageDirtyUserStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedPendingUsageDirtyUserStore {
  return {
    async listDirtyUsers(request = {}) {
      const keys = await listHostedR2ObjectKeys({
        bucket: input.bucket,
        prefix: HOSTED_PENDING_USAGE_DIRTY_PREFIX,
      });
      const seen = new Set<string>();
      const dirtyUsers: StoredHostedPendingUsageDirtyUser[] = [];

      for (const key of keys) {
        const record: StoredHostedPendingUsageDirtyUser | null = await readEncryptedR2Json({
          aad: buildHostedStorageAad({
            key,
            purpose: "assistant-usage-dirty",
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          parse(value) {
            return parseStoredHostedPendingUsageDirtyUser(value);
          },
          scope: "assistant-usage-dirty",
        });

        if (!record || seen.has(record.userId)) {
          continue;
        }

        seen.add(record.userId);
        dirtyUsers.push(record);
      }

      return dirtyUsers
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.userId.localeCompare(right.userId))
        .slice(0, request.limit ?? undefined)
        .map((record) => record.userId);
    },
  };
}

async function readHostedPendingUsageState(input: {
  bucket: R2BucketLike;
  dirtyKey: Uint8Array;
  dirtyKeyId: string;
  dirtyKeysById?: Readonly<Record<string, Uint8Array>>;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  requireListing?: boolean;
  userId: string;
}): Promise<HostedPendingUsageState> {
  const perRecordRecords = await readStoredHostedPendingUsageRecords({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
    requireListing: input.requireListing ?? false,
    userId: input.userId,
  });
  const recordsByUsageId = new Map(
    perRecordRecords.map((record) => [readUsageId(record), cloneUsageRecord(record)]),
  );

  return {
    records: [...recordsByUsageId.values()],
  };
}

async function readStoredHostedPendingUsageRecords(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  requireListing: boolean;
  userId: string;
}): Promise<Record<string, unknown>[]> {
  if (!input.bucket.list) {
    if (input.requireListing) {
      throw new Error("Hosted pending usage reads require bucket.list support.");
    }

    return [];
  }

  const keys = new Set<string>();
  for (const prefix of await pendingUsageRecordObjectPrefixes(input.key, input.keysById, input.userId)) {
    for (const key of await listHostedR2ObjectKeys({
      bucket: input.bucket,
      prefix,
    })) {
      keys.add(key);
    }
  }

  const recordsByUsageId = new Map<string, Record<string, unknown>>();

  for (const key of keys) {
    const stored = await readEncryptedR2Json({
      aad: buildHostedStorageAad({
        key,
        purpose: "assistant-usage",
        userId: input.userId,
      }),
      bucket: input.bucket,
      cryptoKey: input.key,
      cryptoKeysById: input.keysById,
      expectedKeyId: input.keyId,
      key,
      parse(value) {
        return parseStoredHostedPendingUsageRecord(value);
      },
      scope: "assistant-usage",
    });

    if (!stored) {
      continue;
    }

    recordsByUsageId.set(stored.usageId, cloneUsageRecord(stored.record));
  }

  return [...recordsByUsageId.values()];
}

async function writeStoredHostedPendingUsageRecord(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  record: Record<string, unknown>;
  updatedAt: string;
  userId: string;
}): Promise<void> {
  const usageId = readUsageId(input.record);
  const key = await pendingUsageRecordObjectKey(input.key, input.userId, usageId);
  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "assistant-usage",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    scope: "assistant-usage",
    value: {
      record: cloneUsageRecord(input.record),
      schema: HOSTED_PENDING_USAGE_RECORD_SCHEMA,
      updatedAt: input.updatedAt,
      usageId,
      userId: input.userId,
    } satisfies StoredHostedPendingUsageRecord,
  });
}

async function writeHostedPendingUsageDirtyUser(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  updatedAt: string;
  userId: string;
}): Promise<void> {
  const key = await pendingUsageDirtyUserObjectKey(input.key, input.userId);
  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "assistant-usage-dirty",
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    scope: "assistant-usage-dirty",
    value: {
      schema: HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA,
      updatedAt: input.updatedAt,
      userId: input.userId,
    } satisfies StoredHostedPendingUsageDirtyUser,
  });
}

async function deleteHostedPendingUsageDirtyUser(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  for (const key of await pendingUsageDirtyUserObjectKeys(input.key, input.keysById, input.userId)) {
    await input.bucket.delete(key);
  }
}

function parseStoredHostedPendingUsageRecord(value: unknown): StoredHostedPendingUsageRecord {
  const record = requireRecord(value, "Hosted pending usage record");
  const usageRecord = cloneUsageRecord(
    requireRecord(record.record, "Hosted pending usage record.record"),
  );
  const usageId = normalizeRequiredString(record.usageId, "Hosted pending usage record.usageId");

  if (readUsageId(usageRecord) !== usageId) {
    throw new TypeError("Hosted pending usage record.usageId must match record.usageId.");
  }

  return {
    record: usageRecord,
    schema: requireSchema(
      record.schema,
      "Hosted pending usage record.schema",
      HOSTED_PENDING_USAGE_RECORD_SCHEMA,
    ),
    updatedAt: normalizeRequiredString(record.updatedAt, "Hosted pending usage record.updatedAt"),
    usageId,
    userId: normalizeRequiredString(record.userId, "Hosted pending usage record.userId"),
  };
}

function parseStoredHostedPendingUsageDirtyUser(value: unknown): StoredHostedPendingUsageDirtyUser {
  const record = requireRecord(value, "Hosted pending usage dirty user record");

  return {
    schema: requireSchema(
      record.schema,
      "Hosted pending usage dirty user record.schema",
      HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA,
    ),
    updatedAt: normalizeRequiredString(
      record.updatedAt,
      "Hosted pending usage dirty user record.updatedAt",
    ),
    userId: normalizeRequiredString(record.userId, "Hosted pending usage dirty user record.userId"),
  };
}

function sortHostedPendingUsageRecords(
  records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...records].sort((left, right) => {
    const leftOccurredAt = readOccurredAt(left);
    const rightOccurredAt = readOccurredAt(right);
    return leftOccurredAt.localeCompare(rightOccurredAt) || readUsageId(left).localeCompare(readUsageId(right));
  });
}

function readOccurredAt(record: Record<string, unknown>): string {
  return typeof record.occurredAt === "string" ? record.occurredAt : "";
}

function readUsageId(record: Record<string, unknown>): string {
  return normalizeRequiredString(record.usageId, "usageId");
}

function cloneUsageRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record);
}

async function pendingUsageRecordObjectKey(
  rootKey: Uint8Array,
  userId: string,
  usageId: string,
): Promise<string> {
  const prefix = await pendingUsageRecordObjectPrefix(rootKey, userId);
  const usageSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "assistant-usage-path",
    value: `usage:${userId}:${usageId}`,
  });

  return `${prefix}${usageSegment}.json`;
}

async function pendingUsageRecordObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  usageId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    pendingUsageRecordObjectKey(candidateRootKey, userId, usageId)
  );
}

async function pendingUsageRecordObjectPrefix(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "assistant-usage-path",
    value: `user:${userId}`,
  });

  return `${HOSTED_PENDING_USAGE_RECORD_PREFIX}${userSegment}/`;
}

async function pendingUsageRecordObjectPrefixes(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return Promise.all(
    listHostedStorageRootKeys(rootKey, keysById).map((candidateRootKey) =>
      pendingUsageRecordObjectPrefix(candidateRootKey, userId)
    ),
  );
}

async function pendingUsageDirtyUserObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "assistant-usage-dirty-path",
    value: `user:${userId}`,
  });

  return `${HOSTED_PENDING_USAGE_DIRTY_PREFIX}${userSegment}.json`;
}

async function pendingUsageDirtyUserObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    pendingUsageDirtyUserObjectKey(candidateRootKey, userId)
  );
}

async function listHostedR2ObjectKeys(input: {
  bucket: R2BucketLike;
  limit?: number | null;
  prefix: string;
}): Promise<string[]> {
  if (!input.bucket.list) {
    throw new Error("Hosted pending usage listing requires bucket.list support.");
  }

  const limit = input.limit ?? null;
  const keys: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await input.bucket.list({
      ...(cursor ? { cursor } : {}),
      ...(limit !== null
        ? { limit: Math.max(1, Math.min(1000, Math.max(1, limit - keys.length))) }
        : {}),
      prefix: input.prefix,
    });
    keys.push(...page.objects.map((entry) => entry.key));

    if ((limit !== null && keys.length >= limit) || !page.truncated || !page.cursor) {
      break;
    }

    cursor = page.cursor;
  }

  return limit === null ? keys : keys.slice(0, limit);
}

function listHostedStorageRootKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [rootKey, ...Object.values(keysById ?? {})]) {
    const signature = encodeBase64(key);
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
}

function requireSchema<T extends string>(value: unknown, label: string, expected: T): T {
  const schema = normalizeRequiredString(value, label);
  if (schema !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
  }
  return expected;
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

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}
