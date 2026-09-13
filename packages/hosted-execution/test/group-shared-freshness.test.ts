import { describe, expect, it } from "vitest";
import { getHostedGroupWearableReportingGaps, type HostedRuntimeGroupSharedProjection } from "../src/runtime-control.ts";
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


describe("shared reporting history", () => {
  const day = (date: string) => ({ recordKey: date, occurredAt: `${date}T00:00:00.000Z`,
    data: { date, metricKey: "total-sleep-minutes", value: 435, unit: "minutes" } });
  const projection = (overrides: Partial<HostedRuntimeGroupSharedProjection> = {}): HostedRuntimeGroupSharedProjection => ({
    projectionScope: scope, projectionScopeKey: scope.projectionKind,
    grantStatus: "granted", grantedAt: "2026-07-01T00:00:00.000Z", dataStatus: "available", records: [], ...overrides,
  });
  it.each([
    { label: "recent contributor", records: [day("2026-08-03")], expected: "recent_reporting" },
    { label: "seven-day boundary", records: [day("2026-07-28")], expected: "recent_reporting" },
    { label: "older records", records: [day("2026-07-27")], expected: "no_recent_reporting" },
    { label: "established empty history", records: [], expected: "no_recent_reporting" },
    { label: "future records", records: [day("2026-08-05")], expected: "no_recent_reporting" },
  ])("classifies $label using only the preceding dates", ({ records, expected }) => {
    expect(getHostedGroupWearableReportingGaps(projection({ records }), [requirement]))
      .toEqual([{ date: requirement.date, reportingHistory: expected }]);
  });
  it.each([
    { grantedAt: undefined }, { grantedAt: "2026-08-03T00:00:00.000Z" },
    { grantedAt: "2026-07-28T00:00:00.000Z" }, { dataStatus: "pending" as const },
  ])("keeps new, pending, and legacy history unknown (%j)", (overrides) => {
    expect(getHostedGroupWearableReportingGaps(projection(overrides), [requirement]))
      .toEqual([{ date: requirement.date, reportingHistory: "unknown_history" }]);
  });
  it("does not invent a gap for a present day, another scope, or revoked sharing", () => {
    expect(getHostedGroupWearableReportingGaps(projection({ records: [day(requirement.date)] }), [requirement])).toEqual([]);
    expect(getHostedGroupWearableReportingGaps(projection(), [{ ...requirement, projectionScopeKey: "steps-days.v0" }])).toEqual([]);
    expect(getHostedGroupWearableReportingGaps(projection({ grantStatus: "not_granted", records: [day("2026-08-03")] }), [requirement])).toEqual([]);
  });
});
