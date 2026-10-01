import { describe, expect, it } from "vitest";

import {
  buildHostedGrowthGroupPrivateDailySeries,
  findHostedGrowthGroupPrivateConversions,
} from "../src/lib/hosted-ops/growth-group-private-attribution";

describe("group-to-private growth attribution", () => {
  it("counts each member once only when group activity precedes private activation", () => {
    const conversions = findHostedGrowthGroupPrivateConversions({
      activations: [
        {
          memberId: "member_converted",
          privateActivatedAt: new Date("2026-08-15T08:00:00.000Z"),
        },
        {
          memberId: "member_existing",
          privateActivatedAt: new Date("2026-08-01T08:00:00.000Z"),
        },
        {
          memberId: "member_not_activated",
          privateActivatedAt: null,
        },
      ],
      messages: [
        {
          memberId: "member_converted",
          observedAt: new Date("2026-08-14T08:00:00.000Z"),
        },
        {
          memberId: "member_converted",
          observedAt: new Date("2026-08-14T10:00:00.000Z"),
        },
        {
          memberId: "member_existing",
          observedAt: new Date("2026-08-12T08:00:00.000Z"),
        },
        {
          memberId: "member_not_activated",
          observedAt: new Date("2026-08-13T08:00:00.000Z"),
        },
        {
          memberId: null,
          observedAt: new Date("2026-08-13T09:00:00.000Z"),
        },
      ],
    });

    expect(conversions).toEqual(["member_converted"]);
  });

  it("builds a zero-filled 30-day conversion series", () => {
    const series = buildHostedGrowthGroupPrivateDailySeries({
      dayCount: 30,
      trackingRows: [
        { groupPrivateConversionTrackedAt: new Date("2026-08-24T08:00:00.000Z") },
        { groupPrivateConversionTrackedAt: new Date("2026-08-24T18:00:00.000Z") },
        { groupPrivateConversionTrackedAt: new Date("2026-08-25T09:00:00.000Z") },
        { groupPrivateConversionTrackedAt: new Date("2026-07-01T09:00:00.000Z") },
        { groupPrivateConversionTrackedAt: null },
      ],
      windowEnd: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ conversions: 0, date: "2026-07-27" });
    expect(series.at(-2)).toEqual({ conversions: 2, date: "2026-08-24" });
    expect(series.at(-1)).toEqual({ conversions: 1, date: "2026-08-25" });
  });
});
