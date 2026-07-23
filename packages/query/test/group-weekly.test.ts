import { describe, expect, it } from "vitest";

import { buildSharedGroupWeeklyMembers } from "../src/group-weekly.ts";

const CANONICAL_WORKOUT_DAY_SEMANTICS = "canonical-workout-day" as const;

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
                  metricSemantics: "broad-movement",
                  unit: "minutes",
                  value: 60,
                },
              },
              {
                data: {
                  date: "2026-07-07",
                  metricKey: "activity-minutes",
                  metricSemantics: "broad-movement",
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
                  metricSemantics: CANONICAL_WORKOUT_DAY_SEMANTICS,
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
        observedDayCount: 2,
        observedDates: ["2026-07-06", "2026-07-07"],
        stream: "activity-minutes",
        throughDate: "2026-07-07",
        unit: "minutes",
      },
      {
        currentWeekAvg: 1,
        observedDayCount: 1,
        observedDates: ["2026-07-06"],
        stream: "workout-count",
        throughDate: "2026-07-06",
        unit: "count",
      },
      {
        currentWeekAvg: 60,
        observedDayCount: 1,
        observedDates: ["2026-07-06"],
        stream: "workout-minutes",
        throughDate: "2026-07-06",
        unit: "minutes",
      },
    ]);
    expect(member?.weeklyStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stream: "steps" }),
    ]));
  });

  it("excludes the open local day from the weekly average", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [workoutMember([
        workoutDay("2022-07-21", 61),
        workoutDay("2022-07-18", 82),
        workoutDay("2022-07-20", 43),
        workoutDay("2022-07-19", 58),
        workoutDay("2022-07-22", 15),
      ])],
      referenceAt: "2022-07-22T23:30:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual(expect.arrayContaining([
      {
        currentWeekAvg: 61,
        observedDayCount: 4,
        observedDates: [
          "2022-07-18",
          "2022-07-19",
          "2022-07-20",
          "2022-07-21",
        ],
        stream: "workout-minutes",
        throughDate: "2022-07-21",
        unit: "minutes",
      },
    ]));
  });

  it("includes a completed corrected day on the following local day", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [workoutMember([
        workoutDay("2022-07-18", 82),
        workoutDay("2022-07-19", 58),
        workoutDay("2022-07-20", 43),
        workoutDay("2022-07-21", 61),
        workoutDay("2022-07-22", 75, 2),
      ])],
      referenceAt: "2022-07-23T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual(expect.arrayContaining([
      {
        currentWeekAvg: 63.8,
        observedDayCount: 5,
        observedDates: [
          "2022-07-18",
          "2022-07-19",
          "2022-07-20",
          "2022-07-21",
          "2022-07-22",
        ],
        stream: "workout-minutes",
        throughDate: "2022-07-22",
        unit: "minutes",
      },
    ]));
  });

  it("returns no weekly stat when only the current local day is present", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [workoutMember([
        workoutDay("2022-07-22", 75, 2),
      ])],
      referenceAt: "2022-07-22T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([]);
  });

  it("uses the reporting timezone to identify the open local day", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [workoutMember([
        workoutDay("2026-05-12", 100),
        workoutDay("2026-05-13", 200),
      ])],
      referenceAt: "2026-05-14T02:00:00.000Z",
      timeZone: "America/New_York",
    });

    expect(member?.weeklyStats).toEqual(expect.arrayContaining([
      {
        currentWeekAvg: 100,
        observedDayCount: 1,
        observedDates: ["2026-05-12"],
        stream: "workout-minutes",
        throughDate: "2026-05-12",
        unit: "minutes",
      },
    ]));
  });

  it("ignores legacy unmarked activity minutes", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [{
        displayName: "Member A",
        memberId: "member-a",
        shares: [{
          projectionScopeKey: "activity-days.v0",
          records: [{
            data: {
              date: "2026-07-07",
              metricKey: "activity-minutes",
              unit: "minutes",
              value: 74,
            },
          }],
        }],
      }],
      referenceAt: "2026-07-08T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([]);
  });

  it("ignores unmarked legacy workout days", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [{
        displayName: "Member A",
        memberId: "member-a",
        shares: [{
          projectionScopeKey: "workout-days.v0",
          records: [{
            data: {
              date: "2026-07-07",
              workoutCount: 1,
              workoutMinutes: 55,
            },
          }],
        }],
      }],
      referenceAt: "2026-07-08T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([]);
  });
});

function workoutDay(
  date: string,
  workoutMinutes: number,
  workoutCount = 1,
): {
  data: {
    date: string;
    metricSemantics: typeof CANONICAL_WORKOUT_DAY_SEMANTICS;
    workoutCount: number;
    workoutMinutes: number;
  };
} {
  return {
    data: {
      date,
      metricSemantics: CANONICAL_WORKOUT_DAY_SEMANTICS,
      workoutCount,
      workoutMinutes,
    },
  };
}

function workoutMember(
  records: ReturnType<typeof workoutDay>[],
): {
  displayName: string;
  memberId: string;
  shares: {
    projectionScopeKey: string;
    records: ReturnType<typeof workoutDay>[];
  }[];
} {
  return {
    displayName: "Member A",
    memberId: "member-a",
    shares: [{
      projectionScopeKey: "workout-days.v0",
      records,
    }],
  };
}
