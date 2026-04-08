import assert from "node:assert/strict";
import { test } from "vitest";

import { encodeCrockford, encodeRandomCrockford, generateUlid } from "../src/ulid.ts";

function deterministicRandomBytes(length: number): Uint8Array {
  return Uint8Array.from(Array.from({ length }, (_, index) => index));
}

test("shared Crockford helpers preserve the duplicated low-level encoding behavior", () => {
  assert.equal(encodeCrockford(0, 10), "0000000000");
  assert.equal(encodeCrockford(32, 4), "0010");
  assert.equal(encodeCrockford(1024, 1), "0");
  assert.equal(encodeRandomCrockford(24, deterministicRandomBytes), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(encodeRandomCrockford(0, deterministicRandomBytes), "");
  assert.equal(generateUlid(0, deterministicRandomBytes), "00000000000123456789ABCDEF");
});

test("shared Crockford helpers use Web Crypto by default and fail closed when it is unavailable", () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(buffer: Uint8Array): Uint8Array {
        buffer.fill(31);
        return buffer;
      },
    },
  });

  try {
    assert.equal(encodeRandomCrockford(4), "ZZZZ");

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    assert.throws(
      () => encodeRandomCrockford(1),
      /Web Crypto getRandomValues is unavailable/u,
    );
  } finally {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    }
  }
});
