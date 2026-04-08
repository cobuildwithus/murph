import { describe, expect, it } from "vitest";
import * as sharedQuery from "@murphai/query";

import {
  ALL_QUERY_ENTITY_FAMILIES,
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
  loadQueryRuntime,
} from "../src/query-runtime.ts";

describe("query runtime compatibility surface", () => {
  it("reuses the shared query entity-family owner", () => {
    expect(ALL_QUERY_ENTITY_FAMILIES).toBe(sharedQuery.ALL_QUERY_ENTITY_FAMILIES);
  });

  it("keeps the local lookup helpers as thin aliases over the shared query owner", () => {
    const lookupId = "evt_01JABCDEF0123456789ABCDEF";

    expect(inferQueryIdEntityKind(lookupId)).toBe(sharedQuery.inferIdEntityKind(lookupId));
    expect(isQueryableQueryLookupId(lookupId)).toBe(sharedQuery.isQueryableLookupId(lookupId));
    expect(describeQueryLookupConstraint(lookupId)).toBe(
      sharedQuery.describeLookupConstraint(lookupId),
    );
  });

  it("loads the shared query runtime surface without a second local function layer", async () => {
    const runtime = await loadQueryRuntime();

    expect(runtime.ALL_QUERY_ENTITY_FAMILIES).toBe(sharedQuery.ALL_QUERY_ENTITY_FAMILIES);
    expect(runtime.buildExportPack).toBe(sharedQuery.buildExportPack);
    expect(runtime.buildTimeline).toBe(sharedQuery.buildTimeline);
    expect(runtime.listSupplements).toBe(sharedQuery.listSupplements);
    expect(runtime.searchVaultRuntime).toBe(sharedQuery.searchVaultRuntime);
    expect(runtime.showSupplement).toBe(sharedQuery.showSupplement);
    expect(runtime.showSupplementCompound).toBe(sharedQuery.showSupplementCompound);
  });
});
