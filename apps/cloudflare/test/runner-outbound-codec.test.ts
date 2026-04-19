import { describe, expect, it } from "vitest";

import {
  readNullableIsoTimestamp,
  readNullableString,
  requireNonNegativeInteger,
} from "../src/runner-outbound/codec.ts";

describe("runner outbound codec helpers", () => {
  it("treats zero as valid for non-negative integers", () => {
    expect(requireNonNegativeInteger(0, "attempts")).toBe(0);
    expect(() => requireNonNegativeInteger(-1, "attempts")).toThrow(
      "attempts must be a non-negative integer.",
    );
  });

  it("does not infer timestamp validation from field labels", () => {
    expect(readNullableString(" not-a-timestamp ", "createdAt")).toBe("not-a-timestamp");
  });

  it("requires explicit ISO timestamp parsing for timestamp fields", () => {
    expect(readNullableIsoTimestamp("2026-04-19T12:34:56.000Z", "createdAt")).toBe(
      "2026-04-19T12:34:56.000Z",
    );
    expect(() => readNullableIsoTimestamp("2026-04-19", "createdAt")).toThrow(
      "createdAt must be an ISO timestamp.",
    );
  });
});
