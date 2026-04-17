import { parseHostedCipherEnvelope, type HostedCipherEnvelope } from "@murphai/runtime-state";

import { buildHostedStorageAad } from "./crypto-context.js";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
  type EncryptedR2BucketLike,
} from "./crypto.js";
import { hostedBrowserVaultSnapshotObjectKey } from "./storage-paths.js";

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export interface HostedBrowserVaultSnapshotStore {
  readBrowserVaultSnapshot(userId: string): Promise<unknown | null>;
  readBrowserVaultSnapshotEnvelope(userId: string): Promise<HostedCipherEnvelope | null>;
  writeBrowserVaultSnapshot(userId: string, snapshot: unknown): Promise<void>;
}

export function createHostedBrowserVaultSnapshotStore(input: {
  bucket: EncryptedR2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedBrowserVaultSnapshotStore {
  return {
    async readBrowserVaultSnapshot(userId) {
      const key = await hostedBrowserVaultSnapshotObjectKey(input.key, userId);
      const plaintext = await readEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "browser-vault-snapshot",
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key,
        scope: "browser-vault-snapshot",
      });

      if (!plaintext) {
        return null;
      }

      return JSON.parse(utf8Decoder.decode(plaintext)) as unknown;
    },

    async readBrowserVaultSnapshotEnvelope(userId) {
      const key = await hostedBrowserVaultSnapshotObjectKey(input.key, userId);
      const object = await input.bucket.get(key);

      if (!object) {
        return null;
      }

      return parseHostedCipherEnvelope(
        JSON.parse(utf8Decoder.decode(await object.arrayBuffer())) as unknown,
        "Hosted browser vault snapshot envelope",
      );
    },

    async writeBrowserVaultSnapshot(userId, snapshot) {
      const key = await hostedBrowserVaultSnapshotObjectKey(input.key, userId);
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "browser-vault-snapshot",
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext: utf8Encoder.encode(JSON.stringify(snapshot)),
        scope: "browser-vault-snapshot",
      });
    },
  };
}
