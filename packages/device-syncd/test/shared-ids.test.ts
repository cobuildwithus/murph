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

import { generatePrefixedId, generateStateCode, generateUlid, sanitizeKey } from "../src/shared.js";

test("device-syncd id helpers preserve dash sanitation and state-code format", () => {
  assert.equal(generateUlid(0), "00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("Worker Name", 0), "worker-name_00000000000123456789ABCDEF");
  assert.equal(generatePrefixedId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(generateStateCode(24), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(sanitizeKey("Worker Name"), "worker-name");
  assert.equal(sanitizeKey("___"), "item");
});
