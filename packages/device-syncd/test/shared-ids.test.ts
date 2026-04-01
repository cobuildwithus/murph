import assert from "node:assert/strict";
import { generateUlid } from "@murph/runtime-state";
import { afterEach, beforeEach, test, vi } from "vitest";

import { generatePrefixedId, generateStateCode, normalizeString, sanitizeKey } from "../src/shared.ts";

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

test("device-syncd id helpers preserve dash sanitation and state-code format", () => {
  assert.equal(generateUlid(0), "00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("Worker Name", 0), "worker-name_00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(generateStateCode(24), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(normalizeString("Worker Name"), "Worker Name");
  assert.equal(normalizeString("   "), undefined);
  assert.equal(sanitizeKey("Worker Name"), "worker-name");
  assert.equal(sanitizeKey("___"), "item");
});
