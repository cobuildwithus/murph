import { createCipheriv, createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

import { test } from "vitest";

import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "../src/local-secret-codec.ts";

test("secret codec round-trips encrypted values and rejects malformed payloads", () => {
  const codec = createSecretCodec("secret-for-tests");
  const encrypted = codec.encrypt("refresh-token-value");

  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(codec.decrypt(encrypted), "refresh-token-value");
  assert.throws(() => codec.decrypt("short"), /Encrypted payload is invalid\./u);
});

test("secret codec binds structured ciphertext to account context and token purpose", () => {
  const codec = createSecretCodec("secret-for-tests");
  const accessOptions = buildDeviceSyncTokenCipherOptions({
    externalAccountId: "account-1",
    provider: "oura",
    purpose: "device-sync-access-token",
  });
  const refreshOptions = buildDeviceSyncTokenCipherOptions({
    externalAccountId: "account-1",
    provider: "oura",
    purpose: "device-sync-refresh-token",
  });
  const ciphertext = codec.encrypt("access-token-value", accessOptions);

  assert.equal(codec.decrypt(ciphertext, accessOptions), "access-token-value");
  assert.throws(() => codec.decrypt(ciphertext, refreshOptions));
  assert.throws(() =>
    codec.decrypt(
      ciphertext,
      buildDeviceSyncTokenCipherOptions({
        externalAccountId: "account-2",
        provider: "oura",
        purpose: "device-sync-access-token",
      }),
    ));
});

test("secret codec rejects unscoped ciphertext from the removed pre-v1 format", () => {
  const secret = "secret-for-tests";
  const codec = createSecretCodec(secret);
  const unscopedCiphertext = encryptUnscopedSecretForTest(secret, "stale-refresh-token");

  assert.throws(
    () =>
      codec.decrypt(
        unscopedCiphertext,
        buildDeviceSyncTokenCipherOptions({
          externalAccountId: "account-1",
          provider: "whoop",
          purpose: "device-sync-refresh-token",
        }),
      ),
    /Encrypted payload is invalid\./u,
  );
});

test("secret codec rejects malformed structured payload segments", () => {
  const codec = createSecretCodec("secret-for-tests");

  assert.throws(
    () => codec.decrypt("mdss:v1:abc=:def:ghi"),
    /Encrypted payload IV is invalid\./u,
  );

  const structuredCiphertext = codec.encrypt(
    "scoped-token",
    buildDeviceSyncTokenCipherOptions({
      externalAccountId: "account-1",
      provider: "oura",
      purpose: "device-sync-access-token",
    }),
  );

  assert.throws(
    () => codec.decrypt(`${structuredCiphertext}:junk`),
    /Encrypted payload is invalid\./u,
  );

  assert.throws(
    () => codec.decrypt(encryptUnscopedSecretForTest("secret-for-tests", "stale-refresh-token")),
    /Encrypted payload is invalid\./u,
  );
});

function encryptUnscopedSecretForTest(secret: string, value: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}
