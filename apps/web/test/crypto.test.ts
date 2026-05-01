import { afterEach, describe, expect, it } from "vitest";

import { createHostedSecretCodec, decodeHostedEncryptionKey } from "@/src/lib/device-sync/crypto";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "@/src/lib/hosted-web/encryption";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY = process.env.HOSTED_WEB_ENCRYPTION_KEY;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEYRING_JSON = process.env.HOSTED_WEB_ENCRYPTION_KEYRING_JSON;
const ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY_VERSION = process.env.HOSTED_WEB_ENCRYPTION_KEY_VERSION;

afterEach(() => {
  restoreEnvValue("NODE_ENV", ORIGINAL_NODE_ENV);
  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEY", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY);
  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEYRING_JSON", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEYRING_JSON);
  restoreEnvValue("HOSTED_WEB_ENCRYPTION_KEY_VERSION", ORIGINAL_HOSTED_WEB_ENCRYPTION_KEY_VERSION);
  clearHostedWebEncryptionCodecCache();
});

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

  it("round-trips hosted member private fields through the secure-box string wrapper", async () => {
    const encrypted = await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member_test",
      value: "+15551234567",
    });

    expect(encrypted).toEqual(expect.any(String));
    await expect(decryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member_test",
      value: encrypted,
    })).resolves.toBe("+15551234567");
  });
});

function clearHostedWebEncryptionCodecCache(): void {
  delete (globalThis as typeof globalThis & {
    __murphHostedWebEncryptionCodec?: unknown;
  }).__murphHostedWebEncryptionCodec;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
