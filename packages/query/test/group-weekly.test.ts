import { describe, expect, it } from "vitest";

import { buildSharedGroupWeeklyMembers } from "../src/group-weekly.ts";

const CANONICAL_WORKOUT_DAY_SEMANTICS = "canonical-workout-day" as const;

describe("buildSharedGroupWeeklyMembers", () => {
  it("keeps activity and workout minutes distinct while reading legacy unmarked rows", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [{
        displayName: "Member A",
        memberId: "member-a",
        shares: [
          {
            projectionScopeKey: "activity-days.v0",
            records: [
              dailyMetric("2026-07-06", "activity-minutes", 60, "minutes", "broad-movement"),
              dailyMetric("2026-07-07", "activity-minutes", 40, "minutes"),
            ],
          },
          {
            projectionScopeKey: "steps-days.v0",
            records: [dailyMetric("2026-07-04", "steps", 5_000, "count")],
          },
          {
            projectionScopeKey: "workout-days.v0",
            records: [
              workoutDay("2026-07-06", 60),
              unmarkedWorkoutDay("2026-07-07", 40),
            ],
          },
        ],
      }],
      referenceAt: "2026-07-12T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([
      weeklyStat("activity-minutes", 50, ["2026-07-06", "2026-07-07"], "minutes"),
      weeklyStat("workout-count", 1, ["2026-07-06", "2026-07-07"], "count"),
      weeklyStat("workout-minutes", 50, ["2026-07-06", "2026-07-07"], "minutes"),
    ]);
    expect(member?.weeklyStats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stream: "steps" }),
    ]));
  });

  it("summarizes completed workout details by kind without exposing event times", () => {
    const [member] = buildSharedGroupWeeklyMembers({
      members: [{
        displayName: "Member A",
        memberId: "member-a",
        shares: [
          {
            projectionScopeKey: "steps-days.v0",
            records: [dailyMetric("2026-07-05", "steps", 9_000, "count")],
          },
          {
            projectionScopeKey: "workouts.v0",
            records: [
              workoutsDay("2026-06-30", [workout("running", 90, 1_000)]),
              workoutsDay("2026-07-01", []),
              workoutsDay("2026-07-04", [
                workout("running", 20, 2_000),
                workout("running", 40, 3_000),
                workout("strength", 30, 4_000),
              ]),
              workoutsDay("2026-07-06", [workout("running", 30, 5_000)]),
              workoutsDay("2026-07-08", [workout("running", 500, 6_000)]),
            ],
          },
        ],
      }],
      referenceAt: "2026-07-09T12:00:00.000Z",
      timeZone: "UTC",
    });

    expect(member?.weeklyStats).toEqual([
      weeklyStat("steps", 9_000, ["2026-07-05"], "count"),
      weeklyStat("workout-kind-running-count", 1.5, [
        "2026-07-04",
        "2026-07-06",
      ], "count"),
      weeklyStat("workout-kind-running-minutes", 45, [
        "2026-07-04",
        "2026-07-06",
      ], "minutes"),
      weeklyStat("workout-kind-strength-count", 1, ["2026-07-04"], "count"),
      weeklyStat("workout-kind-strength-minutes", 30, ["2026-07-04"], "minutes"),
    ]);
    expect(JSON.stringify(member)).not.toContain("startLocalMs");
    expect(JSON.stringify(member)).not.toContain("calendarClosedThroughDate");
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

  it("uses the seven completed days before a Monday run", () => {
    const records = [
      workoutDay("2026-07-19", 10),
      workoutDay("2026-07-20", 20),
      workoutDay("2026-07-21", 30),
      workoutDay("2026-07-22", 40),
      workoutDay("2026-07-23", 50),
      workoutDay("2026-07-24", 60),
      workoutDay("2026-07-25", 70),
      workoutDay("2026-07-26", 80),
      workoutDay("2026-07-27", 90),
    ];

    expect(workoutMinutesStat(
      records,
      "2026-07-27T16:15:00.000-04:00",
      "America/New_York",
    )).toEqual(
      weeklyStat("workout-minutes", 50, [
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
        "2026-07-24",
        "2026-07-25",
        "2026-07-26",
      ], "minutes"),
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

function workout(kind: string, minutes: number, startLocalMs: number) {
  return { kind, minutes, startLocalMs };
}

function workoutsDay(
  date: string,
  workouts: ReturnType<typeof workout>[],
) {
  return {
    data: {
      calendarClosedThroughDate: "2026-07-07",
      date,
      timeSemantics: "canonical-event-zone-or-vault-zone.v0",
      workouts,
    },
  };
}

function weeklyStat(
  stream: string,
  completedDaysAvg: number,
  observedDates: [string, ...string[]],
  unit: string,
) {
  return {
    completedDaysAvg,
    observedDayCount: observedDates.length,
    observedDates,
    stream,
    throughDate: observedDates.at(-1),
    unit,
  };
}
