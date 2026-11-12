import { describe, expect, it } from "vitest";

import { parseHostedRuntimeOwnerCommand, parseHostedRuntimeOwnerResponse } from "../src/runtime-owner.ts";

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

  it("preserves a precise background retry only for the new reason", () => {
    const retryAt = "2026-11-10T12:05:00.000Z";
    expect(parseHostedRuntimeOwnerResponse({ cutover: "postgres", status: "blocked", owner: null,
      blockedReason: "background_rate_limited", retryAt })).toEqual({
      cutover: "postgres", status: "blocked", owner: null, blockedReason: "background_rate_limited", retryAt,
    });
    expect(parseHostedRuntimeOwnerResponse({ cutover: "postgres", status: "blocked", owner: null,
      blockedReason: "future_reason", retryAt })).toEqual({ cutover: "postgres", status: "blocked", owner: null });
    expect(() => parseHostedRuntimeOwnerResponse({ cutover: "postgres", status: "blocked", owner: null,
      blockedReason: "background_rate_limited", retryAt: "tomorrow" })).toThrow();
  });

  it("keeps an old claim unchanged and accepts only a positive autonomous marker", () => {
    const oldClaim = { operation: "claim", processingMode: "default" };
    expect(parseHostedRuntimeOwnerCommand(oldClaim)).toEqual(oldClaim);
    expect(parseHostedRuntimeOwnerCommand({ ...oldClaim, autonomousWake: true }))
      .toEqual({ ...oldClaim, autonomousWake: true });
    expect(() => parseHostedRuntimeOwnerCommand({ ...oldClaim, autonomousWake: false })).toThrow();
  });
});
