import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  decodeHostedWakeStoredPayload,
  encodeHostedWakeStoredPayload,
  HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES,
} from "@/src/lib/hosted-wake/payload";

describe("Hosted wake payload storage", () => {
  it("keeps small payloads inline and decryptable", () => {
    const value = {
      kind: "member.activated",
      nested: {
        count: 1,
        ok: true,
      },
    };
    const encoded = encodeHostedWakeStoredPayload({
      userId: "member-inline",
      value,
    });

    expect(encoded.storage).toBe("inline");
    expect(encoded.payloadInlineCiphertext).toEqual(expect.any(String));
    expect(encoded.payloadRefCiphertext).toBeNull();
    expect(encoded.payloadBytes).toBe(Buffer.byteLength(JSON.stringify(value), "utf8"));
    expect(decodeHostedWakeStoredPayload({
      payloadInlineCiphertext: encoded.payloadInlineCiphertext,
      userId: "member-inline",
    })).toEqual(value);
  });

  it("spills oversized payloads to ref ciphertext and round-trips them", () => {
    const value = {
      kind: "telegram.message.received",
      text: "x".repeat(HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES + 256),
    };
    const encoded = encodeHostedWakeStoredPayload({
      userId: "member-spill",
      value,
    });

    expect(encoded.storage).toBe("ref");
    expect(encoded.payloadInlineCiphertext).toBeNull();
    expect(encoded.payloadRefCiphertext).toEqual(expect.any(String));
    expect(encoded.payloadBytes).toBeGreaterThan(HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES);
    expect(decodeHostedWakeStoredPayload({
      payloadRefCiphertext: encoded.payloadRefCiphertext,
      userId: "member-spill",
    })).toEqual(value);
  });

  it("returns null when no encrypted payload is present", () => {
    expect(decodeHostedWakeStoredPayload({ userId: "member-empty" })).toBeNull();
  });
});
