import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";
import type { R2BucketLike } from "./bundle-store.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

const HOSTED_PENDING_USAGE_SCHEMA = "murph.hosted-pending-usage.v1";

interface StoredHostedPendingUsage {
  records: Record<string, unknown>[];
  schema: typeof HOSTED_PENDING_USAGE_SCHEMA;
  updatedAt: string;
  userId: string;
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

export function createHostedPendingUsageStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedPendingUsageStore {
  return {
    async appendUsage(request) {
      const current = await readStoredHostedPendingUsage({
        ...input,
        userId: request.userId,
      });
      const existingUsageIds = new Set((current?.records ?? []).map((record) => readUsageId(record)));
      const accepted = request.usage
        .map((record, index) => cloneUsageRecord(requireRecord(record, `usage[${index}]`)))
        .filter((record) => {
          const usageId = readUsageId(record);
          if (existingUsageIds.has(usageId)) {
            return false;
          }
          existingUsageIds.add(usageId);
          return true;
        });
      const nextRecords = [
        ...(current?.records ?? []),
        ...accepted,
      ];
      const updatedAt = new Date().toISOString();

      await writeStoredHostedPendingUsage({
        ...input,
        record: {
          records: nextRecords,
          schema: HOSTED_PENDING_USAGE_SCHEMA,
          updatedAt,
          userId: request.userId,
        },
        userId: request.userId,
      });

      return {
        recorded: accepted.length,
        usageIds: accepted.map((record) => readUsageId(record)),
      };
    },

    async deleteUsage(request) {
      const current = await readStoredHostedPendingUsage({
        ...input,
        userId: request.userId,
      });
      if (!current) {
        return;
      }

      const usageIds = new Set(request.usageIds.map((entry) => normalizeRequiredString(entry, "usageIds[]")));
      const nextRecords = current.records.filter((record) => !usageIds.has(readUsageId(record)));

      if (nextRecords.length === current.records.length) {
        return;
      }

      await writeStoredHostedPendingUsage({
        ...input,
        record: {
          ...current,
          records: nextRecords,
          updatedAt: new Date().toISOString(),
        },
        userId: request.userId,
      });
    },

    async readUsage(request) {
      const current = await readStoredHostedPendingUsage({
        ...input,
        userId: request.userId,
      });
      const records = current?.records ?? [];
      const limit = request.limit ?? null;

      return (limit === null ? records : records.slice(0, limit)).map((record) => cloneUsageRecord(record));
    },
  };
}

async function readStoredHostedPendingUsage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<StoredHostedPendingUsage | null> {
  for (const key of await pendingUsageObjectKeys(input.key, input.keysById, input.userId)) {
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
        return parseStoredHostedPendingUsage(value);
      },
      scope: "assistant-usage",
    });

    if (record) {
      return record;
    }
  }

  return null;
}

async function writeStoredHostedPendingUsage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  record: StoredHostedPendingUsage;
  userId: string;
}): Promise<void> {
  const key = await pendingUsageObjectKey(input.key, input.userId);
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
    value: input.record,
  });
}

function parseStoredHostedPendingUsage(value: unknown): StoredHostedPendingUsage {
  const record = requireRecord(value, "Hosted pending usage record");
  const records = requireArray(record.records, "Hosted pending usage records").map((entry, index) =>
    cloneUsageRecord(requireRecord(entry, `Hosted pending usage records[${index}]`))
  );

  return {
    records,
    schema: requireSchema(record.schema, "Hosted pending usage schema"),
    updatedAt: normalizeRequiredString(record.updatedAt, "Hosted pending usage updatedAt"),
    userId: normalizeRequiredString(record.userId, "Hosted pending usage userId"),
  };
}

function readUsageId(record: Record<string, unknown>): string {
  return normalizeRequiredString(record.usageId, "usageId");
}

function cloneUsageRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record);
}

function requireSchema(value: unknown, label: string): typeof HOSTED_PENDING_USAGE_SCHEMA {
  const schema = normalizeRequiredString(value, label);
  if (schema !== HOSTED_PENDING_USAGE_SCHEMA) {
    throw new TypeError(`${label} must be ${HOSTED_PENDING_USAGE_SCHEMA}.`);
  }
  return schema;
}

async function pendingUsageObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "assistant-usage-path",
    value: `user:${userId}`,
  });

  return `transient/assistant-usage/${userSegment}.json`;
}

async function pendingUsageObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    pendingUsageObjectKey(candidateRootKey, userId)
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

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}
