import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { generatePrefixedId, sanitizeObjectKey } from "../src/shared.ts";

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

test("inboxd id helpers preserve underscore sanitation", () => {
  assert.equal(generatePrefixedId("Capture Name", 0), "capture_name_00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(sanitizeObjectKey("Capture Name"), "capture_name");
  assert.equal(sanitizeObjectKey("___"), "field");
});
