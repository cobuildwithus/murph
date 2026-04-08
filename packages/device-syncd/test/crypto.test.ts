import assert from "node:assert/strict";

import { test } from "vitest";

import { createSecretCodec } from "../src/crypto.ts";

test("secret codec round-trips encrypted values and rejects malformed payloads", () => {
  const codec = createSecretCodec("secret-for-tests");
  const encrypted = codec.encrypt("refresh-token-value");

  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(codec.decrypt(encrypted), "refresh-token-value");
  assert.throws(() => codec.decrypt("short"), /Encrypted payload is invalid\./u);
});
