import assert from "node:assert/strict";
import { test, vi } from "vitest";

const { randomBytesMock } = vi.hoisted(() => ({
  randomBytesMock: vi.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => index))),
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: randomBytesMock,
  };
});

import { generatePrefixedId, sanitizeObjectKey } from "../src/shared.js";

test("inboxd id helpers preserve underscore sanitation", () => {
  assert.equal(generatePrefixedId("Capture Name", 0), "capture_name_00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(sanitizeObjectKey("Capture Name"), "capture_name");
  assert.equal(sanitizeObjectKey("___"), "field");
});
