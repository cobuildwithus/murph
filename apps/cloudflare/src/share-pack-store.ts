import {
  parseHostedExecutionSharePackResponse,
  type HostedExecutionSharePackResponse,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "./crypto-context.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";

export interface HostedSharePackStore {
  readSharePack(input: { shareId: string; userId: string }): Promise<HostedExecutionSharePackResponse | null>;
  writeSharePack(input: HostedExecutionSharePackResponse & { userId: string }): Promise<HostedExecutionSharePackResponse>;
}

export function createHostedSharePackStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedSharePackStore {
  return {
    async readSharePack(request) {
      for (const objectKey of await hostedSharePackObjectKeys(
        input.key,
        input.keysById,
        request.userId,
        request.shareId,
      )) {
        const pack = await readEncryptedR2Json({
          aad: buildHostedStorageAad({
            key: objectKey,
            purpose: "share-pack",
            shareId: request.shareId,
            userId: request.userId,
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key: objectKey,
          parse: parseHostedExecutionSharePackResponse,
          scope: "share-pack",
        });

        if (pack) {
          return pack;
        }
      }

      return null;
    },

    async writeSharePack(request) {
      const objectKey = await hostedSharePackObjectKey(input.key, request.userId, request.shareId);
      const pack = parseHostedExecutionSharePackResponse(request);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          key: objectKey,
          purpose: "share-pack",
          shareId: request.shareId,
          userId: request.userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key: objectKey,
        keyId: input.keyId,
        scope: "share-pack",
        value: pack,
      });
      return pack;
    },
  };
}

async function hostedSharePackObjectKey(
  rootKey: Uint8Array,
  userId: string,
  shareId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "share-pack-path",
    value: `user:${userId}`,
  });
  const shareSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "share-pack-path",
    value: `share:${userId}:${shareId}`,
  });

  return `transient/share-packs/${userSegment}/${shareSegment}.json`;
}

async function hostedSharePackObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  shareId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedSharePackObjectKey(candidateRootKey, userId, shareId)
  );
}
