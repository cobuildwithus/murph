import { describe, expect, it } from "vitest";

import { decodeBase64, decodeBase64Key } from "../src/base64.ts";

describe("cloudflare base64 helpers", () => {
  it("accepts canonical base64 payloads with surrounding whitespace", () => {
    expect(Buffer.from(decodeBase64(" Zm9v "))).toEqual(Buffer.from("foo"));
  });

  it("rejects malformed payload base64", () => {
    expect(() => decodeBase64("%%%")).toThrow("Hosted execution payload must be valid base64.");
    expect(() => decodeBase64("Zg")).toThrow("Hosted execution payload must be valid base64.");
  });

  it("accepts base64url keys but rejects malformed key material", () => {
    expect(Buffer.from(decodeBase64Key(Buffer.alloc(32, 7).toString("base64url")))).toEqual(Buffer.alloc(32, 7));
    expect(() => decodeBase64Key("bad key===")).toThrow(
      "Hosted execution platform envelope keys must be valid 32-byte base64 or base64url values.",
    );
    expect(() => decodeBase64Key(Buffer.alloc(16, 7).toString("base64url"))).toThrow(
      "Hosted execution platform envelope keys must be valid 32-byte base64 or base64url values.",
    );
  });
});
