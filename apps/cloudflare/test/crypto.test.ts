import { describe, expect, it } from "vitest";

import {
  encryptHostedBundle,
  readEncryptedR2Payload,
} from "../src/crypto.js";

describe("readEncryptedR2Payload", () => {
  it("reads older envelopes without rewriting them on read", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const nextKey = Uint8Array.from({ length: 32 }, () => 7);
    const plaintext = new TextEncoder().encode("{\"ok\":true}");
    const envelope = await encryptHostedBundle({
      key: previousKey,
      keyId: "v1",
      plaintext,
    });
    let putAttempts = 0;

    const payload = new TextEncoder().encode(JSON.stringify(envelope));
    const bucket = {
      async get() {
        return {
          async arrayBuffer() {
            return payload.buffer.slice(
              payload.byteOffset,
              payload.byteOffset + payload.byteLength,
            );
          },
        };
      },
      async put() {
        putAttempts += 1;
        throw new Error("simulated rewrite failure");
      },
    };

    await expect(readEncryptedR2Payload({
      bucket,
      cryptoKey: nextKey,
      cryptoKeysById: {
        v1: previousKey,
        v2: nextKey,
      },
      expectedKeyId: "v2",
      key: "users/member_123/bundle.json",
    })).resolves.toEqual(plaintext);
    expect(putAttempts).toBe(0);
  });
});
