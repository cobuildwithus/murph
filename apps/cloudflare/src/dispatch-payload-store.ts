import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad } from "./crypto-context.js";
import {
  hostedDispatchPayloadObjectKeyForSignature,
} from "./storage-paths.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";
import { stringifyStructuredJson } from "./structured-json.js";

export type HostedExecutionDispatchPayloadRef = {
  stagedPayloadId: string;
};

export interface HostedDispatchPayloadStore {
  deleteDispatchPayload(ref: HostedExecutionDispatchPayloadRef): Promise<void>;
  readDispatchPayload(
    ref: HostedExecutionDispatchPayloadRef,
  ): Promise<HostedExecutionDispatchRequest | null>;
  writeDispatchPayload(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchPayloadRef>;
}

const textEncoder = new TextEncoder();

export function createHostedDispatchPayloadStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedDispatchPayloadStore {
  return {
    async deleteDispatchPayload(ref) {
      if (!input.bucket.delete) {
        return;
      }

      await input.bucket.delete(ref.stagedPayloadId);
    },

    async readDispatchPayload(ref) {
      return readEncryptedR2Json({
        aad: buildDispatchPayloadAad(ref.stagedPayloadId),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: ref.stagedPayloadId,
        parse(value) {
          return parseHostedExecutionDispatchRequest(value);
        },
        scope: "dispatch-payload",
      });
    },

    async writeDispatchPayload(dispatch) {
      const normalizedDispatch = parseHostedExecutionDispatchRequest(dispatch);
      const stagedPayloadId = await hostedDispatchPayloadObjectKeyForSignature(
        input.key,
        normalizedDispatch.event.userId,
        normalizedDispatch.eventId,
        await createHostedDispatchPayloadSignature(normalizedDispatch),
      );
      await writeEncryptedR2Json({
        aad: buildDispatchPayloadAad(stagedPayloadId),
        bucket: input.bucket,
        cryptoKey: input.key,
        key: stagedPayloadId,
        keyId: input.keyId,
        scope: "dispatch-payload",
        value: normalizedDispatch,
      });

      return { stagedPayloadId };
    },
  };
}

async function createHostedDispatchPayloadSignature(
  dispatch: HostedExecutionDispatchRequest,
): Promise<string> {
  const canonicalJson = stringifyStructuredJson(parseHostedExecutionDispatchRequest(dispatch));
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(canonicalJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildDispatchPayloadAad(key: string): Uint8Array {
  return buildHostedStorageAad({
    key,
    purpose: "dispatch-payload",
  });
}
