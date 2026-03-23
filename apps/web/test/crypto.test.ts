import { describe, expect, it } from "vitest";

import { createHostedSecretCodec, decodeHostedEncryptionKey } from "@/src/lib/device-sync/crypto";

describe("hosted device-sync secret codec", () => {
  it("round-trips encrypted secrets", () => {
    const codec = createHostedSecretCodec({
      key: Buffer.alloc(32, 7),
      keyVersion: "v1",
    });

    const encrypted = codec.encrypt("top-secret-token");
    expect(encrypted).toContain("hbds:v1:");
    expect(codec.decrypt(encrypted)).toBe("top-secret-token");
  });

  it("accepts base64url key material", () => {
    const key = Buffer.alloc(32, 3);
    expect(decodeHostedEncryptionKey(key.toString("base64url"))).toEqual(key);
  });
});
