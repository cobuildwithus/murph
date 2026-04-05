import { parseHostedExecutionSharePack } from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad } from "./crypto-context.js";
import { hostedSharePackObjectKey, hostedSharePackObjectKeys } from "./storage-paths.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";

const HOSTED_SHARE_PACK_SCHEMA = "murph.hosted-share-pack.v1";

type HostedExecutionSharePack = ReturnType<typeof parseHostedExecutionSharePack>;

interface StoredHostedSharePack {
  pack: HostedExecutionSharePack;
  schema: typeof HOSTED_SHARE_PACK_SCHEMA;
  shareId: string;
  updatedAt: string;
}

export interface HostedShareStore {
  deleteSharePack(shareId: string): Promise<void>;
  readSharePack(shareId: string): Promise<HostedExecutionSharePack | null>;
  writeSharePack(
    shareId: string,
    pack: HostedExecutionSharePack,
  ): Promise<HostedExecutionSharePack>;
}

export function createHostedShareStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedShareStore {
  return {
    async deleteSharePack(shareId) {
      if (!input.bucket.delete) {
        return;
      }

      for (const key of await hostedSharePackObjectKeys(input.key, input.keysById, shareId)) {
        await input.bucket.delete(key);
      }
    },

    async readSharePack(shareId) {
      for (const key of await hostedSharePackObjectKeys(input.key, input.keysById, shareId)) {
        const stored = await readEncryptedR2Json({
          aad: buildSharePackAad(key, shareId),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          parse: parseStoredHostedSharePack,
          scope: "share-pack",
        });

        if (stored) {
          return stored.pack;
        }
      }

      return null;
    },

    async writeSharePack(shareId, pack) {
      const normalizedPack = parseHostedExecutionSharePack(pack);
      const key = await hostedSharePackObjectKey(input.key, shareId);

      await writeEncryptedR2Json({
        aad: buildSharePackAad(key, shareId),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "share-pack",
        value: {
          pack: normalizedPack,
          schema: HOSTED_SHARE_PACK_SCHEMA,
          shareId,
          updatedAt: new Date().toISOString(),
        } satisfies StoredHostedSharePack,
      });

      return normalizedPack;
    },
  };
}

function buildSharePackAad(key: string, shareId: string): Uint8Array {
  return buildHostedStorageAad({
    key,
    purpose: "share-pack",
    userId: shareId,
  });
}

function parseStoredHostedSharePack(value: unknown): StoredHostedSharePack {
  const record = requireRecord(value, "Hosted share pack");
  const schema = requireString(record.schema, "Hosted share pack schema");
  if (schema !== HOSTED_SHARE_PACK_SCHEMA) {
    throw new TypeError(`Hosted share pack schema must be ${HOSTED_SHARE_PACK_SCHEMA}.`);
  }

  return {
    pack: parseHostedExecutionSharePack(record.pack),
    schema: HOSTED_SHARE_PACK_SCHEMA,
    shareId: requireString(record.shareId, "Hosted share pack shareId"),
    updatedAt: requireString(record.updatedAt, "Hosted share pack updatedAt"),
  };
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

  return value;
}
