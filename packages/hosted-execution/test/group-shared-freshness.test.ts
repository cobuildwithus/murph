import { describe, expect, it } from "vitest";
import {
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";

const scope = { projectionKind: "sleep-duration-days.v0" } as const;
const requirement = { projectionScopeKey: scope.projectionKind, date: "2026-08-04" };

describe("shared wearable freshness protocol", () => {
  it("roundtrips additive requirements and checked metadata without changing ordinary reads", () => {
    const ordinary = { action: "read_shared", projectionScopes: [scope] };
    expect(parseHostedRuntimeGroupToolRequest(ordinary)).toEqual(ordinary);
    const request = { ...ordinary, freshness: [requirement] };
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    for (const refreshStatus of ["requested", "unavailable", "not_needed"]) {
      const response = { action: "read_shared", result: {
        status: "ok", members: [], requestedProjectionScopeKeys: [scope.projectionKind],
        freshness: { checkedAt: "2026-08-04T14:20:00.000Z", refreshStatus },
      } };
      expect(parseHostedRuntimeGroupToolResponse(response)).toEqual(response);
    }
  });

  it.each([
    [], [requirement, requirement],
    [{ ...requirement, date: "2026-02-30" }],
    [{ ...requirement, date: "tomorrow" }],
    [{ ...requirement, projectionScopeKey: "steps-days.v0" }],
    [{ ...requirement, memberId: "untrusted" }],
    Array.from({ length: 22 }, (_, day) => ({ ...requirement, date: `2026-08-${String(day + 1).padStart(2, "0")}` })),
  ].map((freshness) => ({ freshness })))("rejects invalid or unbounded freshness requirements (%j)", ({ freshness }) => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "read_shared", projectionScopes: [scope], freshness,
    })).toThrow();
  });

  it("rejects non-wearable refreshes and invalid check claims", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "read_shared", projectionScopes: [{ projectionKind: "profile-name.v0" }],
      freshness: [{ ...requirement, projectionScopeKey: "profile-name.v0" }],
    })).toThrow();
    expect(() => parseHostedRuntimeGroupToolResponse({ action: "read_shared", result: {
      status: "ok", members: [], requestedProjectionScopeKeys: [scope.projectionKind],
      freshness: { checkedAt: "2026-08-04T14:20:00.000Z", refreshStatus: "synced" },
    } })).toThrow();
  });
});
