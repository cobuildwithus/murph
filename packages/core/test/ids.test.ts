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

import { generateRecordId, generateVaultId } from "../src/ids.js";

test("generateRecordId preserves alias mapping and local underscore normalization", () => {
  assert.equal(generateRecordId("event", 0), "evt_00000000000123456789ABCDEF");
  assert.equal(generateRecordId("Custom Prefix", 0), "custom_prefix_00000000000123456789ABCDEF");
  assert.equal(generateRecordId("___", 0), "rec_00000000000123456789ABCDEF");
  assert.equal(generateRecordId(undefined, 0), "record_00000000000123456789ABCDEF");
  assert.equal(generateVaultId(0), "vault_00000000000123456789ABCDEF");
});
