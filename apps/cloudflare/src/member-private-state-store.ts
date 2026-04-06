import {
  parseHostedMemberPrivateState,
  type HostedMemberPrivateState,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad } from "./crypto-context.js";
import { readEncryptedR2Json, writeEncryptedR2Json } from "./crypto.js";
import {
  hostedMemberPrivateStateObjectKey,
  hostedMemberPrivateStateObjectKeys,
} from "./storage-paths.js";

export interface HostedMemberPrivateStateStore {
  deleteState(): Promise<void>;
  readState(): Promise<HostedMemberPrivateState | null>;
  writeState(state: HostedMemberPrivateState): Promise<HostedMemberPrivateState>;
}

export function createHostedMemberPrivateStateStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): HostedMemberPrivateStateStore {
  return {
    async deleteState() {
      if (!input.bucket.delete) {
        return;
      }

      for (const key of await hostedMemberPrivateStateObjectKeys(
        input.key,
        input.keysById,
        input.userId,
      )) {
        await input.bucket.delete(key);
      }
    },

    async readState() {
      for (const key of await hostedMemberPrivateStateObjectKeys(
        input.key,
        input.keysById,
        input.userId,
      )) {
        const state = await readEncryptedR2Json({
          aad: buildHostedStorageAad({
            key,
            purpose: "member-private-state",
            userId: input.userId,
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          parse: parseHostedMemberPrivateState,
          scope: "member-private-state",
        });

        if (state) {
          if (state.memberId !== input.userId) {
            throw new Error(
              `Hosted member private state owner mismatch: expected ${input.userId}, received ${state.memberId}.`,
            );
          }

          return state;
        }
      }

      return null;
    },

    async writeState(state) {
      const normalized = parseHostedMemberPrivateState(state);

      if (normalized.memberId !== input.userId) {
        throw new Error(
          `Hosted member private state owner mismatch: expected ${input.userId}, received ${normalized.memberId}.`,
        );
      }

      const key = await hostedMemberPrivateStateObjectKey(input.key, input.userId);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          key,
          purpose: "member-private-state",
          userId: input.userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "member-private-state",
        value: normalized,
      });

      return normalized;
    },
  };
}
