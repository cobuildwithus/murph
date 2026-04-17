import { parseHostedCipherEnvelope, type HostedCipherEnvelope } from "@murphai/runtime-state";

import { buildHostedStorageAad } from "./crypto-context.js";
import {
  writeEncryptedR2Payload,
  type EncryptedR2BucketLike,
} from "./crypto.js";
import { hostedBrowserVaultSnapshotObjectKey } from "./storage-paths.js";

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export interface HostedBrowserVaultSnapshotStorageRef {
  aadFields: {
    key: string;
    purpose: "browser-vault-snapshot";
    userId: string;
  };
  objectKey: string;
}

export interface HostedBrowserVaultSnapshotStore {
  readBrowserVaultSnapshotEnvelope(userId: string): Promise<HostedCipherEnvelope | null>;
  writeBrowserVaultSnapshot(userId: string, snapshot: unknown): Promise<void>;
}

export async function resolveHostedBrowserVaultSnapshotStorageRef(input: {
  rootKey: Uint8Array;
  userId: string;
}): Promise<HostedBrowserVaultSnapshotStorageRef> {
  const objectKey = await hostedBrowserVaultSnapshotObjectKey(input.rootKey, input.userId);

  return {
    aadFields: {
      key: objectKey,
      purpose: "browser-vault-snapshot",
      userId: input.userId,
    },
    objectKey,
  };
}

export function createHostedBrowserVaultSnapshotStore(input: {
  bucket: EncryptedR2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedBrowserVaultSnapshotStore {
  return {
    async readBrowserVaultSnapshotEnvelope(userId) {
      const storageRef = await resolveHostedBrowserVaultSnapshotStorageRef({
        rootKey: input.key,
        userId,
      });
      const object = await input.bucket.get(storageRef.objectKey);

      if (!object) {
        return null;
      }

      return parseHostedCipherEnvelope(
        JSON.parse(utf8Decoder.decode(await object.arrayBuffer())) as unknown,
        "Hosted browser vault snapshot envelope",
      );
    },

    async writeBrowserVaultSnapshot(userId, snapshot) {
      const storageRef = await resolveHostedBrowserVaultSnapshotStorageRef({
        rootKey: input.key,
        userId,
      });
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad(storageRef.aadFields),
        bucket: input.bucket,
        cryptoKey: input.key,
        key: storageRef.objectKey,
        keyId: input.keyId,
        plaintext: utf8Encoder.encode(JSON.stringify(snapshot)),
        scope: "browser-vault-snapshot",
      });
    },
  };
}
