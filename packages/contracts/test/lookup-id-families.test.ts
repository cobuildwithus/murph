import { describe, expect, it } from "vitest";

import {
  LOOKUP_ID_FAMILY_REGISTRY,
  describeLookupIdConstraint,
  inferLookupIdEntityKind,
  isQueryableLookupId,
} from "../src/index.ts";

describe("lookup ID families", () => {
  it.each([
    ["core", "core", true],
    [" current ", "core", true],
    ["journal:2026-07-15", "journal", true],
    ["hab_sleep-environment", "habitat", true],
    ["xfm_batch_1", "transform", false],
    ["pack_export_1", "export_pack", false],
    ["unknown_lookup", "entity", false],
    ["audit:legacy", "entity", false],
  ] as const)("classifies %s as %s", (id, entityKind, queryable) => {
    expect(inferLookupIdEntityKind(id)).toBe(entityKind);
    expect(isQueryableLookupId(id)).toBe(queryable);
  });

  it("keeps the canonical family catalog and special lookup guidance together", () => {
    expect(Object.isFrozen(LOOKUP_ID_FAMILY_REGISTRY)).toBe(true);
    expect(LOOKUP_ID_FAMILY_REGISTRY.map((family) => family.family)).toContain("habitat");
    expect(describeLookupIdConstraint("hab_sleep-environment")).toBeNull();
    expect(describeLookupIdConstraint("xfm_batch_1")).toBe(
      "Transform ids identify an import batch, not a query-layer record. Use returned sample ids with `samples show` or inspect them with `samples list` instead.",
    );
    expect(describeLookupIdConstraint("pack_export_1")).toBe(
      "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.",
    );
  });
});
