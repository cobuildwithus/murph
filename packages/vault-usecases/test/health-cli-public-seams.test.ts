import { describe, expect, it } from "vitest";

import {
  createHealthScaffoldResultSchema,
  findHealthDescriptorForLookup,
  healthListFiltersSchema,
  healthListResultSchema,
} from "@murphai/vault-usecases";

describe("health CLI descriptors", () => {
  it("resolves a supported health identifier and rejects an unknown lookup", () => {
    expect(findHealthDescriptorForLookup("goal_sleep")?.kind).toBe("goal");
    expect(findHealthDescriptorForLookup("unknown_lookup")).toBeNull();
  });

  it("parses scaffold and list payload shapes", () => {
    expect(
      createHealthScaffoldResultSchema("goal").parse({
        vault: "./vault",
        noun: "goal",
        payload: {
          title: "Sleep better",
        },
      }),
    ).toEqual({
      vault: "./vault",
      noun: "goal",
      payload: {
        title: "Sleep better",
      },
    });

    expect(() =>
      createHealthScaffoldResultSchema("goal").parse({
        vault: "./vault",
        noun: "blood-test",
        payload: {},
      }),
    ).toThrow();

    expect(healthListFiltersSchema.parse({ from: "2026-03-01", kind: "goal" })).toEqual({
      from: "2026-03-01",
      kind: "goal",
      limit: 10,
    });

    expect(
      healthListResultSchema.parse({
        vault: "./vault",
        filters: {
          limit: 10,
        },
        items: [],
        count: 0,
        nextCursor: null,
      }),
    ).toEqual({
      vault: "./vault",
      filters: {
        limit: 10,
      },
      items: [],
      count: 0,
      nextCursor: null,
    });
  });
});
