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
    expect(Buffer.from(decodeBase64Key("AQIDBA"))).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(() => decodeBase64Key("bad key===")).toThrow(
      "Hosted execution bundle encryption keys must be valid base64 or base64url.",
    );
  });
});
