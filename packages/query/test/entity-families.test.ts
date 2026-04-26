import { describe, expect, it } from "vitest";

import * as queryRoot from "@murphai/query";
import { ALL_QUERY_ENTITY_FAMILIES } from "@murphai/query/entity-families";

describe("query entity-family metadata", () => {
  it("stays on the dedicated entity-families subpath", () => {
    expect(ALL_QUERY_ENTITY_FAMILIES).toContain("sample");
    expect(ALL_QUERY_ENTITY_FAMILIES).toContain("protocol");
    expect(ALL_QUERY_ENTITY_FAMILIES).toContain("workout_format");
    expect("ALL_QUERY_ENTITY_FAMILIES" in queryRoot).toBe(false);
  });
});
