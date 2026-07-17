import { describe, expect, it } from "vitest";

import {
  decodePublicProductRef,
  encodePublicProductRef,
} from "../src/lib/public-products/product-ref";

describe("public product references", () => {
  it.each([
    ["supplement", "supplements:alpha-123"],
    ["food", "12345678"],
    ["food", "open_food_facts:brand/product-1"],
  ] as const)("round trips a %s product ID", (kind, id) => {
    const ref = encodePublicProductRef(kind, id);

    expect(ref).toBe(`${kind}_${Buffer.from(id, "utf8").toString("base64url")}`);
    expect(decodePublicProductRef(ref)).toEqual({ kind, id });
  });

  it.each([
    "",
    "supplements_c3VwcGxlbWVudHM6MQ",
    "Supplement_c3VwcGxlbWVudHM6MQ",
    "food",
    "food_",
    "food_c3VwcGxlbWVudHM6MQ=",
    "food_c3VwcGxlbWVudHM6MQ+",
    "food_A",
    "food_MR",
    "food____",
  ])("rejects malformed or noncanonical ref %j", (ref) => {
    expect(decodePublicProductRef(ref)).toBeNull();
  });

  it("rejects invalid UTF-8", () => {
    const invalidUtf8 = Buffer.from([0xc3, 0x28]).toString("base64url");

    expect(decodePublicProductRef(`food_${invalidUtf8}`)).toBeNull();
  });

  it.each([
    "plain-id",
    "source:",
    "Source:item",
    "source:item with spaces",
    "source:item\u0000suffix",
    "source:item\u007fsuffix",
  ])("rejects an invalid decoded product ID %j", (id) => {
    const encodedId = Buffer.from(id, "utf8").toString("base64url");

    expect(decodePublicProductRef(`food_${encodedId}`)).toBeNull();
    expect(() => encodePublicProductRef("food", id)).toThrow(TypeError);
  });

  it("rejects IDs and refs beyond the existing lookup bound", () => {
    const validBoundaryId = `source:${"x".repeat(256 - "source:".length)}`;
    const overlongId = `${validBoundaryId}x`;

    expect(
      decodePublicProductRef(encodePublicProductRef("food", validBoundaryId)),
    ).toEqual({
      kind: "food",
      id: validBoundaryId,
    });
    expect(() => encodePublicProductRef("food", overlongId)).toThrow(TypeError);
    expect(
      decodePublicProductRef(
        `food_${Buffer.from(overlongId, "utf8").toString("base64url")}`,
      ),
    ).toBeNull();
    expect(decodePublicProductRef(`food_${"A".repeat(1_025)}`)).toBeNull();
  });

  it("rejects IDs that cannot round trip through canonical UTF-8", () => {
    const loneSurrogateId = "source:\ud800";

    expect(() => encodePublicProductRef("supplement", loneSurrogateId)).toThrow(
      TypeError,
    );
  });
});
