import { describe, expect, it } from "vitest";

import {
  decodeHostedWakeInlinePayload,
  encodeHostedWakeInlinePayload,
} from "@/src/lib/hosted-wake/payload";

describe("hosted wake inline payload codec", () => {
  it("round-trips an encrypted inline wake payload for the owning user", () => {
    const value = {
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      userId: "member_123",
    };

    const encoded = encodeHostedWakeInlinePayload({
      userId: "member_123",
      value,
    });

    expect(encoded.payloadBytes).toBeGreaterThan(0);
    expect(encoded.payloadInlineCiphertext).not.toHaveLength(0);
    expect(decodeHostedWakeInlinePayload({
      payloadInlineCiphertext: encoded.payloadInlineCiphertext,
      userId: "member_123",
    })).toEqual(value);
  });

  it("rejects inline wake payloads that exceed the maximum serialized size", () => {
    expect(() =>
      encodeHostedWakeInlinePayload({
        userId: "member_123",
        value: {
          body: "x".repeat(16 * 1024 + 1),
        },
      }),
    ).toThrow("Hosted wake payload exceeds the 16384 byte inline limit.");
  });
});
