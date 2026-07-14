import { describe, expect, it } from "vitest";

import { buildSharedGroupWeeklyMembers } from "../src/group-weekly.ts";

describe("buildSharedGroupWeeklyMembers", () => {
  it("keeps broad activity and workout minutes distinct and omits prior-week claims", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [{
        displayName: "Member A",
        memberId: "member-a",
        shares: [
          {
            projectionScopeKey: "activity-days.v0",
            records: [
              {
                data: {
                  date: "2026-07-06",
                  metricKey: "activity-minutes",
                  unit: "minutes",
                  value: 60,
                },
              },
              {
                data: {
                  date: "2026-07-07",
                  metricKey: "activity-minutes",
                  unit: "minutes",
                  value: 0,
                },
              },
            ],
          },
          {
            projectionScopeKey: "steps-days.v0",
            records: [
              {
                data: {
                  date: "2026-07-05",
                  metricKey: "steps",
                  unit: "count",
                  value: 5_000,
                },
              },
            ],
          },
          {
            projectionScopeKey: "workout-days.v0",
            records: [
              {
                data: {
                  date: "2026-07-06",
                  workoutCount: 1,
                  workoutMinutes: 60,
                },
              },
            ],
          },
        ],
      }],
      referenceAt: "2026-07-12T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([
      {
        currentWeekAvg: 30,
        stream: "activity-minutes",
        unit: "minutes",
      },
      {
        currentWeekAvg: 1,
        stream: "workout-count",
        unit: "count",
      },
      {
        currentWeekAvg: 60,
        stream: "workout-minutes",
        unit: "minutes",
      },
    ]);
    expect(member?.weeklyStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stream: "steps" }),
    ]));
  });
});
