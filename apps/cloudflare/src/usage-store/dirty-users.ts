import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../crypto-context.js";
import type { R2BucketLike } from "../bundle-store.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "../crypto.js";

const HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA = "murph.hosted-pending-usage-dirty.v1";
const HOSTED_PENDING_USAGE_DIRTY_PREFIX = "transient/assistant-usage-dirty/";

interface StoredHostedPendingUsageDirtyUser {
  schema: typeof HOSTED_PENDING_USAGE_DIRTY_USER_SCHEMA;
  updatedAt: string;
  userId: string;
}

export interface HostedPendingUsageDirtyUserStore {
  listDirtyUsers(input?: { limit?: number | null }): Promise<string[]>;
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

export async function writeHostedPendingUsageDirtyUser(input: {
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

export async function deleteHostedPendingUsageDirtyUser(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  const key = await pendingUsageDirtyUserObjectKey(input.key, input.userId);
  await input.bucket.delete(key);
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

async function pendingUsageDirtyUserObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "assistant-usage-dirty-path",
    value: `user:${userId}`,
  });

  return `${HOSTED_PENDING_USAGE_DIRTY_PREFIX}${userSegment}.json`;
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

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}
