import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { generateRecordId, generateVaultId } from "../src/ids.ts";

beforeEach(() => {
  vi.stubGlobal("crypto", {
    getRandomValues(target: Uint8Array) {
      target.set(Uint8Array.from(Array.from({ length: target.length }, (_, index) => index)));
      return target;
    },
  } as Crypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("generateRecordId preserves alias mapping and local underscore normalization", () => {
  assert.equal(generateRecordId("event", 0), "evt_00000000000123456789ABCDEF");
  assert.equal(generateRecordId("Custom Prefix", 0), "custom_prefix_00000000000123456789ABCDEF");
  assert.equal(generateRecordId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(generateRecordId(undefined, 0), "record_00000000000123456789ABCDEF");
  assert.equal(generateVaultId(0), "vault_00000000000123456789ABCDEF");
});
