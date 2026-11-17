import { describe, expect, it } from "vitest";

import { parseHostedRuntimeOwnerResponse } from "../src/runtime-owner.ts";

describe("parseHostedRuntimeOwnerResponse blockedReason", () => {
  it("round-trips a start budget retry time", () => {
    const response = { cutover: "postgres", status: "blocked", owner: null,
      blockedReason: "start_budget", retryAt: "2026-11-12T14:03:00.000Z" };
    expect(parseHostedRuntimeOwnerResponse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it.each([undefined, null, 42, "", "unreadable", "999999-01-01T00:00:00Z"])("omits an invalid retry time (%s)", retryAt => {
    expect(parseHostedRuntimeOwnerResponse({ cutover: "postgres", status: "blocked", owner: null,
      blockedReason: "start_budget", retryAt }))
      .toEqual({ cutover: "postgres", status: "blocked", owner: null, blockedReason: "start_budget" });
  });

  it.each([
    ["blocked", "admission"], ["blocked", "future_reason"], ["observed", "start_budget"],
  ])("omits retryAt for %s / %s", (status, blockedReason) => {
    expect(parseHostedRuntimeOwnerResponse({ cutover: "postgres", status, owner: null,
      blockedReason, retryAt: "2026-11-12T14:03:00.000Z" })).not.toHaveProperty("retryAt");
  });

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
