import { describe, expect, it } from "vitest";

import { parseHostedRuntimeOwnerResponse } from "../src/runtime-owner.ts";

describe("parseHostedRuntimeOwnerResponse blockedReason", () => {
  it("keeps a known reason on a blocked claim", () => {
    expect(parseHostedRuntimeOwnerResponse({
      cutover: "postgres", status: "blocked", owner: null, blockedReason: "admission",
    })).toEqual({ cutover: "postgres", status: "blocked", owner: null, blockedReason: "admission" });
  });

  it.each([
    ["an older Web", "blocked", undefined],
    ["a newer Web reason", "blocked", "future_reason"],
    ["a non-blocked status", "observed", "admission"],
  ])("omits the reason for %s", (_label, status, blockedReason) => {
    expect(parseHostedRuntimeOwnerResponse({ cutover: "postgres", status, owner: null, blockedReason }))
      .toEqual({ cutover: "postgres", status, owner: null });
  });
});
