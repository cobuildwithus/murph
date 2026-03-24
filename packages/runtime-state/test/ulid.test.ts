import assert from "node:assert/strict";
import { test } from "vitest";

import { encodeCrockford, encodeRandomCrockford, generateUlid } from "../src/ulid.js";

function deterministicRandomBytes(length: number): Uint8Array {
  return Uint8Array.from(Array.from({ length }, (_, index) => index));
}

test("shared Crockford helpers preserve the duplicated low-level encoding behavior", () => {
  assert.equal(encodeCrockford(0, 10), "0000000000");
  assert.equal(encodeCrockford(32, 4), "0010");
  assert.equal(encodeRandomCrockford(24, deterministicRandomBytes), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(generateUlid(0, deterministicRandomBytes), "00000000000123456789ABCDEF");
});
