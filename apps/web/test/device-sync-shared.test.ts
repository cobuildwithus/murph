import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";

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

import {
  generateHostedRandomPrefixedId,
  normalizeNullableString,
  toIsoTimestamp,
} from "@/src/lib/device-sync/shared";

describe("device-sync shared helpers", () => {
  it("reuses the canonical device-syncd timestamp validation", () => {
    assert.equal(toIsoTimestamp("2026-03-26T12:00:00Z"), "2026-03-26T12:00:00.000Z");
    expect(() => toIsoTimestamp("not-a-date")).toThrowError(new TypeError("Invalid timestamp: not-a-date"));
  });

  it("keeps hosted nullable string normalization distinct from device-syncd optional normalization", () => {
    assert.equal(normalizeNullableString("  hosted  "), "hosted");
    assert.equal(normalizeNullableString("   "), null);
    assert.equal(normalizeNullableString(undefined), null);
  });

  it("keeps hosted random ids prefix-preserving instead of device-syncd ulid-based", () => {
    const suffix = Buffer.from(Array.from({ length: 12 }, (_, index) => index)).toString("base64url");

    assert.equal(generateHostedRandomPrefixedId("Worker Name"), `Worker Name_${suffix}`);
    expect(generateHostedRandomPrefixedId("Worker Name")).not.toMatch(/^[a-z0-9-]+_[0-9A-HJKMNP-TV-Z]{26}$/u);
  });
});
