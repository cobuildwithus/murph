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
              dailyMetric("2026-07-06", "activity-minutes", 60, "minutes", "broad-movement"),
              dailyMetric("2026-07-07", "activity-minutes", 0, "minutes", "broad-movement"),
              dailyMetric("2026-07-07", "activity-minutes", 74, "minutes"),
            ],
          },
          {
            projectionScopeKey: "steps-days.v0",
            records: [dailyMetric("2026-07-05", "steps", 5_000, "count")],
          },
          {
            projectionScopeKey: "workout-days.v0",
            records: [
              workoutDay("2026-07-06", 60),
              unmarkedWorkoutDay("2026-07-07", 55),
            ],
          },
        ],
      }],
      referenceAt: "2026-07-12T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([
      weeklyStat("activity-minutes", 30, ["2026-07-06", "2026-07-07"], "minutes"),
      weeklyStat("workout-count", 1, ["2026-07-06"], "count"),
      weeklyStat("workout-minutes", 60, ["2026-07-06"], "minutes"),
    ]);
    expect(member?.weeklyStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stream: "steps" }),
    ]));
  });

  it("exposes exact completed dates for equal-date comparisons and excludes the open local day", () => {
    const records = [
      workoutDay("2022-07-21", 61),
      workoutDay("2022-07-18", 82),
      workoutDay("2022-07-20", 43),
      workoutDay("2022-07-19", 58),
      workoutDay("2022-07-22", 75, 2),
    ];
    const openDayStat = workoutMinutesStat(
      records,
      "2022-07-22T23:30:00.000Z",
      "UTC",
    );

    expect(openDayStat).toEqual(
      weeklyStat("workout-minutes", 61, [
        "2022-07-18",
        "2022-07-19",
        "2022-07-20",
        "2022-07-21",
      ], "minutes"),
    );
    expect(workoutMinutesStat(
      records,
      "2022-07-23T12:00:00.000Z",
      "UTC",
    )).toEqual(
      weeklyStat("workout-minutes", 63.8, [
        "2022-07-18",
        "2022-07-19",
        "2022-07-20",
        "2022-07-21",
        "2022-07-22",
      ], "minutes"),
    );
    expect(workoutMinutesStat(
      [workoutDay("2022-07-22", 75, 2)],
      "2022-07-22T12:00:00.000Z",
      "UTC",
    )).toBeUndefined();
  });

  it("uses the reporting timezone to identify the open local day", () => {
    expect(workoutMinutesStat(
      [
        workoutDay("2026-05-12", 100),
        workoutDay("2026-05-13", 200),
      ],
      "2026-05-14T02:00:00.000Z",
      "America/New_York",
    )).toEqual(
      weeklyStat("workout-minutes", 100, ["2026-05-12"], "minutes"),
    );
  });
});

function workoutDay(
  date: string,
  workoutMinutes: number,
  workoutCount = 1,
) {
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
) {
  return {
    displayName: "Member A",
    memberId: "member-a",
    shares: [{
      projectionScopeKey: "workout-days.v0",
      records,
    }],
  };
}

function workoutMinutesStat(
  records: ReturnType<typeof workoutDay>[],
  referenceAt: string,
  timeZone: string,
) {
  const [member] = buildSharedGroupWeeklyMembers({
    members: [workoutMember(records)],
    referenceAt,
    timeZone,
  });
  return member?.weeklyStats.find((stat) => stat.stream === "workout-minutes");
}

function dailyMetric(
  date: string,
  metricKey: string,
  value: number,
  unit: string,
  metricSemantics?: string,
) {
  return {
    data: {
      date,
      metricKey,
      ...(metricSemantics ? { metricSemantics } : {}),
      unit,
      value,
    },
  };
}

function unmarkedWorkoutDay(date: string, workoutMinutes: number) {
  return { data: { date, workoutCount: 1, workoutMinutes } };
}

function weeklyStat(
  stream: string,
  currentWeekAvg: number,
  observedDates: [string, ...string[]],
  unit: string,
) {
  return {
    currentWeekAvg,
    observedDayCount: observedDates.length,
    observedDates,
    stream,
    throughDate: observedDates.at(-1),
    unit,
  };
}
