import type { HostedRuntimeUsageRecordResponse } from "@murphai/assistant-runtime";

import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import type { R2BucketLike } from "./bundle-store.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";
import {
  deleteHostedPendingUsageDirtyUser,
  writeHostedPendingUsageDirtyUser,
} from "./usage-store/dirty-users.ts";

const HOSTED_PENDING_USAGE_RECORD_SCHEMA = "murph.hosted-pending-usage-record.v1";
const HOSTED_PENDING_USAGE_RECORD_PREFIX = "transient/assistant-usage/";

interface StoredHostedPendingUsageRecord {
  record: Record<string, unknown>;
  schema: typeof HOSTED_PENDING_USAGE_RECORD_SCHEMA;
}

interface HostedPendingUsageState {
  records: Record<string, unknown>[];
}

export interface HostedPendingUsageStore {
  appendUsage(input: {
    usage: readonly Record<string, unknown>[];
    userId: string;
  }): Promise<HostedRuntimeUsageRecordResponse>;
  deleteUsage(input: {
    usageIds: readonly string[];
    userId: string;
  }): Promise<void>;
  readUsage(input: {
    limit?: number;
    userId: string;
  }): Promise<Record<string, unknown>[]>;
}

export function createHostedPendingUsageStore(input: {
  bucket: R2BucketLike;
  dirtyKey: Uint8Array;
  dirtyKeyId: string;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedPendingUsageStore {
  return {
    async appendUsage(request) {
      const acceptedUsageIds = new Set<string>();
      const uniqueRecords = request.usage
        .map((record, index) => cloneUsageRecord(requireRecord(record, `usage[${index}]`)))
        .filter((record) => {
          const usageId = readUsageId(record);
          if (acceptedUsageIds.has(usageId)) {
            return false;
          }

          acceptedUsageIds.add(usageId);
          return true;
        });
      const now = new Date().toISOString();
      const recordedIds: string[] = [];

      for (const record of uniqueRecords) {
        const usageId = readUsageId(record);
        const existing = await readStoredHostedPendingUsageRecordByUsageId({
          bucket: input.bucket,
          key: input.key,
          keyId: input.keyId,
          keysById: input.keysById,
          usageId,
          userId: request.userId,
        });

        if (existing) {
          continue;
        }

        await writeStoredHostedPendingUsageRecord({
          bucket: input.bucket,
          key: input.key,
          keyId: input.keyId,
          record,
          userId: request.userId,
        });
        recordedIds.push(usageId);
      }

      if (recordedIds.length > 0) {
        await writeHostedPendingUsageDirtyUser({
          bucket: input.bucket,
          key: input.dirtyKey,
          keyId: input.dirtyKeyId,
          updatedAt: now,
          userId: request.userId,
        });
      }

      return {
        recorded: recordedIds.length,
        usageIds: recordedIds,
      };
    },

    async deleteUsage(request) {
      const usageIds = new Set(
        request.usageIds.map((entry) => normalizeRequiredString(entry, "usageIds[]")),
      );
      const shouldVacuumDirtyMarker = usageIds.size === 0;
      const state = await readHostedPendingUsageState({
        bucket: input.bucket,
        key: input.key,
        keyId: input.keyId,
        keysById: input.keysById,
        requireListing: shouldVacuumDirtyMarker,
        userId: request.userId,
      });
      const now = new Date().toISOString();

      if (input.bucket.delete) {
        for (const usageId of usageIds) {
          const key = await pendingUsageRecordObjectKey(input.key, request.userId, usageId);
          await input.bucket.delete(key);
        }
      }

      const remainingCount = state.records.filter(
        (record) => !usageIds.has(readUsageId(record)),
      ).length;

      if (remainingCount === 0) {
        await deleteHostedPendingUsageDirtyUser({
          bucket: input.bucket,
          key: input.dirtyKey,
          userId: request.userId,
        });
        return;
      }

      if (shouldVacuumDirtyMarker) {
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
        bucket: input.bucket,
        key: input.key,
        keyId: input.keyId,
        keysById: input.keysById,
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

async function readHostedPendingUsageState(input: {
  bucket: R2BucketLike;
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

  const keys = new Set(
    await listHostedR2ObjectKeys({
      bucket: input.bucket,
      prefix: await pendingUsageRecordObjectPrefix(input.key, input.userId),
    }),
  );

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

    recordsByUsageId.set(readUsageId(stored.record), cloneUsageRecord(stored.record));
  }

  return [...recordsByUsageId.values()];
}

async function readStoredHostedPendingUsageRecordByUsageId(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  usageId: string;
  userId: string;
}): Promise<Record<string, unknown> | null> {
  const key = await pendingUsageRecordObjectKey(input.key, input.userId, input.usageId);
  const record = await readEncryptedR2Json({
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
      return parseStoredHostedPendingUsageRecord(value).record;
    },
    scope: "assistant-usage",
  });

  return record ? cloneUsageRecord(record) : null;
}

async function writeStoredHostedPendingUsageRecord(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  record: Record<string, unknown>;
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
    } satisfies StoredHostedPendingUsageRecord,
  });
}

function parseStoredHostedPendingUsageRecord(value: unknown): StoredHostedPendingUsageRecord {
  const record = requireRecord(value, "Hosted pending usage record");
  const usageRecord = cloneUsageRecord(
    requireRecord(record.record, "Hosted pending usage record.record"),
  );
  const usageId = readOptionalNormalizedString(record.usageId);

  if (usageId && readUsageId(usageRecord) !== usageId) {
    throw new TypeError("Hosted pending usage record.usageId must match record.usageId.");
  }

  return {
    record: usageRecord,
    schema: requireSchema(
      record.schema,
      "Hosted pending usage record.schema",
      HOSTED_PENDING_USAGE_RECORD_SCHEMA,
    ),
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

async function pendingUsageRecordObjectPrefix(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "assistant-usage-path",
    value: `user:${userId}`,
  });

  return `${HOSTED_PENDING_USAGE_RECORD_PREFIX}${userSegment}/`;
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

function readOptionalNormalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
