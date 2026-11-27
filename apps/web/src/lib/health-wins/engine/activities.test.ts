import { describe, expect, it } from "vitest";

import { activityCandidates, gameClimbMetricDisplay } from "./activities";
import { generateHealthWins } from "./index";
import type { Experiment, Game, HealthWinsInput, Session } from "./types";

const member: HealthWinsInput["member"] = {
  today: "2025-04-19", age: null, sex: null, wearableProvider: null,
};

const baseExperiment: Experiment = {
  slug: "morning-sketch", title: "Morning sketching", metric: "sleep_score",
  baseline: { start: "2025-02-01", end: "2025-02-28" },
  intervention: { start: "2025-03-02", end: "2025-03-17" },
  baselineMean: 78.5, interventionMean: 81.75, expectedDirection: "increase",
  adherence: { done: 3, target: 8 },
};

function cards(data: Omit<HealthWinsInput, "member">) {
  return activityCandidates({ member, ...data }).map(candidate => candidate.card);
}

describe("finished experiments", () => {
  it("reports both observed means and low adherence with an overlapping intervention (audit 11)", () => {
    const concurrent: Experiment = {
      ...baseExperiment, slug: "wind-down", title: "Quiet drawing",
      intervention: { start: "2025-03-17", end: "2025-04-27" },
    };
    const separate: Experiment = {
      ...baseExperiment, slug: "candle", title: "Candlelight",
      baseline: { start: "2025-03-02", end: "2025-03-17" }, // Only its baseline overlaps.
      intervention: { start: "2025-03-18", end: "2025-04-27" },
    };
    expect(cards({ experiments: [baseExperiment, concurrent, separate] })).toEqual([
      expect.objectContaining({
        kind: "experiment_result", title: { number: "Morning sketching", measure: "" },
        subtitle: "Sleep score was higher during the experiment. 3 of 8 logged. Ran alongside Quiet drawing.",
        chart: {
          type: "two_bars", barWidth: "thin", unit: "points", metric: "sleep_score", label: "Sleep score", expectedDirection: "increase",
          series: [
            { label: "Before", start: "2025-02-01", end: "2025-02-28", mean: 78.5 },
            { label: "During", start: "2025-03-02", end: "2025-03-17", mean: 81.75 },
          ],
          adherence: { done: 3, target: 8 }, overlap: "Quiet drawing",
        },
      }),
    ]);
  });

  it("returns unchanged results without a causal claim and omits unfinished or invalid comparisons", () => {
    const unchanged = { ...baseExperiment, interventionMean: baseExperiment.baselineMean };
    const [card] = cards({ experiments: [unchanged] });
    expect(card.title.number).toBe("Morning sketching");
    expect(card.subtitle).toBe("Sleep stayed about the same. 3 of 8 logged.");
    expect(card.chart).not.toHaveProperty("overlap");
    for (const experiment of [
      { ...baseExperiment, intervention: { ...baseExperiment.intervention, end: "2025-04-20" } },
      { ...baseExperiment, baselineMean: NaN },
      { ...baseExperiment, baseline: { start: "2025-02-30", end: "2025-03-01" } },
    ]) {
      expect(cards({ experiments: [experiment] })).toEqual([]);
    }
  });

  it("withholds sensitive experiment topics and their overlapping readouts", () => {
    const categories = ["medications", "conditions", "genetics", "weight"] as const;
    for (const sensitiveCategory of categories) {
      const privateExperiment = { ...baseExperiment, slug: "private", title: "Private routine", sensitiveCategory };
      expect(cards({ experiments: [privateExperiment, baseExperiment] })).toEqual([]);
      const secondOutcome: Experiment = { ...baseExperiment, slug: privateExperiment.slug, metric: "hrv_ms" };
      expect(cards({ experiments: [secondOutcome, privateExperiment] })).toEqual([]);
      const disjoint = { ...privateExperiment, intervention: { start: "2025-03-18", end: "2025-03-22" } };
      expect(cards({ experiments: [disjoint, baseExperiment] })).toEqual(cards({ experiments: [baseExperiment] }));
    }
  });

  it("rejects out-of-bounds means while disclosing the overlapping intervention", () => {
    const walking: Experiment = {
      ...baseExperiment, slug: "neighborhood-loop", title: "Neighborhood loop",
      metric: "distance_km", baselineMean: 0, interventionMean: 60,
    };
    expect(cards({ experiments: [walking] })).toMatchObject([{ chart: { label: "Distance on foot" } }]);
    for (const comparison of [{ ...walking, baselineMean: -1 }, { ...walking, interventionMean: 61 }]) {
      expect(cards({ experiments: [baseExperiment, comparison] })).toEqual([expect.objectContaining({
        title: expect.objectContaining({ number: baseExperiment.title }),
        chart: expect.objectContaining({ overlap: walking.title }),
      })]);
    }
  });

  it("shows actual logs beside zero or exceeded targets without capping adherence", () => {
    for (const [done, target] of [[0, 0], [2, 0], [11, 8]]) {
      const adherence = { done, target };
      const [card] = cards({ experiments: [{ ...baseExperiment, adherence }] });
      expect(card.subtitle).toContain(`${done} logged against a target of ${target}.`);
      expect(card.chart).toHaveProperty("adherence", adherence);
    }
  });

  it("headlines the intervention and keeps measured values on before and during bars (audit 16)", () => {
    const evening = {
      ...baseExperiment, title: "Paper puzzles before bed", baselineMean: 81.4, interventionMean: 81.8,
    };
    const alongside = { ...baseExperiment, slug: "book-club", title: "Read → reflect" };
    const [card] = cards({ experiments: [evening, alongside] });
    expect(card).toMatchObject({
      title: { number: "Paper puzzles", measure: "before bed" },
      subtitle: "Sleep stayed about the same. 3 of 8 nights logged. Ran alongside Read reflect.",
      chart: { type: "two_bars", barWidth: "thin", series: [
        { label: "Before", mean: 81.4 }, { label: "During", mean: 81.8 },
      ] },
    });
    expect(JSON.stringify(cards({ experiments: [evening, alongside] }))).not.toMatch(/[←-⇿]/u);

    const runs = {
      ...baseExperiment, title: "Running drills block", metric: "rhr_bpm" as const,
      baselineMean: 62, interventionMean: 60, adherence: { done: 11, target: 15 },
      intervention: { start: "2025-03-26", end: "2025-04-15" },
    };
    expect(cards({ experiments: [runs] })[0]).toMatchObject({
      title: { number: "11 runs", measure: "in 3 weeks" },
      subtitle: "RHR was lower during the experiment. 11 of 15 runs logged.",
    });
    expect(cards({ experiments: [{ ...runs, intervention: { ...runs.intervention, end: "2025-04-12" } }] })[0].title)
      .toEqual({ number: "11 runs", measure: "in 18 days" });
  });

  it("accepts sleep efficiency as a percent and rejects means outside zero to one hundred (audit 18)", () => {
    const trial: Experiment = {
      ...baseExperiment, metric: "sleep_efficiency", baselineMean: 88.7, interventionMean: 92.4,
    };
    expect(cards({ experiments: [trial] })[0]).toMatchObject({
      subtitle: "Sleep efficiency was higher during the experiment. 3 of 8 logged.",
      chart: { metric: "sleep_efficiency", unit: "%", series: [{ mean: 88.7 }, { mean: 92.4 }] },
    });
    expect(cards({ experiments: [{ ...trial, baselineMean: 0, interventionMean: 100 }] })).toHaveLength(1);
    expect(cards({ experiments: [{ ...trial, baselineMean: -0.1 }, { ...trial, interventionMean: 100.1 }] })).toEqual([]);
  });

  it.each([
    { metric: "rhr_bpm", mean: 68, step: 2, favorable: -1, subject: "RHR", label: "Resting heart rate" },
    { metric: "hrv_ms", mean: 50, step: 5, favorable: 1, subject: "Heart rate variability", label: "Heart rate variability" },
    { metric: "sleep_efficiency", mean: 83, step: 1, favorable: 1, subject: "Sleep efficiency", label: "Sleep efficiency" },
    { metric: "sleep_score", mean: 75, step: 2, favorable: 1, subject: "Sleep", label: "Sleep score" },
    { metric: "sleep_total_min", mean: 434, step: 15, favorable: 1, subject: "Sleep", label: "Sleep" },
  ] as const)("offers neutral and favorable $metric outcomes only (audit 26)", ({ metric, mean, step, favorable, subject, label }) => {
    const trial = {
      ...baseExperiment, title: "Running technique block", metric, baselineMean: mean,
      adherence: { done: 5, target: 7 },
    };
    const result = (change: number) => cards({ experiments: [{ ...trial, interventionMean: mean + change }] });
    for (const change of [step - 0.1, 0.1 - step]) {
      expect(result(change)[0]).toMatchObject({
        subtitle: `${subject} stayed about the same. 5 of 7 runs logged.`,
        chart: { label, series: [{ mean }, { mean: mean + change }] },
      });
    }
    expect(result(-favorable * step)).toEqual([]);
    expect(result(-favorable * (step + 1))).toEqual([]);
    expect(result(favorable * step)[0].subtitle).toContain(favorable > 0 ? "was higher" : "was lower");
  });
});

describe("game achievements", () => {
  const game: Game = {
    exercise: "pullups", total: 317, unit: "reps",
    landmarksPassed: [{ id: "hollywood-sign", height: 45 }, { id: "space-needle", height: 605 }],
    next: { id: "empire-state-building", height: 1250, toGo: 28 },
    bestStreak: { days: 9, start: "2025-01-01", end: "2025-01-09", missedOn: "2025-01-10" },
  };

  function climbCard(game: Game) {
    const card = generateHealthWins({ member, games: [game] }).find(card => card.kind === "game_climb");
    if (!card) throw new Error("Expected a game total card");
    return card;
  }

  it.each(["run", "walk"])("preserves the whole-mile %s headline and converts the unrounded total for metric cards", exercise => {
    const card = climbCard({ ...game, exercise, unit: "miles", total: 17.49, landmarksPassed: [], next: null });
    expect(card.title.number).toBe("17 miles");
    expect(card.chart).toMatchObject({ total: 17.49, unit: "miles" });
    const display = gameClimbMetricDisplay(card);
    expect(display).toMatchObject({ units: "kilometers", card: {
      title: { number: "28 km", measure: card.title.measure },
      chart: { total: 17.49 * 1.609344, unit: "km" },
    } });
  });

  it("gives the member and each landmark the same height units, with reps in the headline and chart total", () => {
    const card = climbCard({
      ...game, exercise: "pushups", total: 76, landmarksPassed: [{ id: "first-rung", height: 40 }],
      next: { id: "next-rung", height: 100, toGo: 24 },
    });
    expect(card).toMatchObject({ title: { number: "76" }, chart: {
      unit: "reps", total: 76, landmarksPassed: [{ height: 40, heightUnit: "ft" }], next: { height: 100, heightUnit: "ft", toGo: 24 },
    } });
    const display = gameClimbMetricDisplay(card);
    expect(display).toMatchObject({ units: "meters", card: { title: card.title, chart: {
      unit: "reps", total: 76, landmarksPassed: [{ height: 40 * 0.3048, heightUnit: "m" }],
      next: { height: 100 * 0.3048, heightUnit: "m", toGo: 24 * 0.3048 },
    } } });
    const chart = display?.card.chart;
    if (chart?.type !== "skyline" || !chart.next) throw new Error("Expected a skyline with a next landmark");
    expect(chart.next.height - chart.next.toGo).toBeCloseTo(76 * 0.3048);
  });

  it("offers a game streak from the second scheduled day in both current and older game inputs", () => {
    const firstDay = { days: 1, start: "2025-03-10", end: "2025-03-10", missedOn: null };
    const secondDay = { ...firstDay, days: 2, end: "2025-03-12" };
    for (const value of [firstDay, secondDay]) {
      for (const data of [{ gameStreak: value }, { games: [{ ...game, bestStreak: value }] }]) {
        const streaks = cards(data).filter(card => card.kind === "game_streak");
        expect(streaks.map(card => card.title)).toEqual(value.days === 1 ? [] : [{ number: "2", measure: "days" }]);
      }
    }
  });

  it.each([
    ["2025-03-22", "2025-03-22"],
    [undefined, member.today],
    ["2025-02-30", member.today],
    ["2025-04-20", member.today],
  ])("dates game totals by their contribution day %s, or the summary day for undated totals", (latestDay, eventDate) => {
    const [climb] = activityCandidates({ member, games: [{ ...game, latestDay }] });
    expect(climb).toMatchObject({ date: member.today, card: { kind: "game_climb" } });
    expect(climb.eventDate ?? climb.date).toBe(eventDate);
  });

  it("carries the supplied climb, next landmark and best streak without rebuilding game totals", () => {
    expect(cards({ games: [game] })).toEqual([
      expect.objectContaining({
        kind: "game_climb", title: { number: "317", measure: "pull-ups" },
        chart: { type: "skyline", exercise: "pullups", total: 317, unit: "reps",
          landmarksPassed: [
            { id: "hollywood-sign", name: "Hollywood Sign", height: 45, heightUnit: "ft" },
            { id: "space-needle", name: "Space Needle", height: 605, heightUnit: "ft" },
          ],
          next: { id: "empire-state-building", name: "Empire State Building", height: 1250, heightUnit: "ft", toGo: 28 } },
      }),
      expect.objectContaining({
        kind: "game_streak", title: { number: "9", measure: "days" },
        chart: { type: "week_dots", days: 9, start: "2025-01-01", end: "2025-01-09", missedOn: "2025-01-10" },
      }),
    ]);
  });

  it("draws whole Monday–Sunday weeks from game-day evidence, including dates around the run", () => {
    const bestStreak = {
      days: 3, start: "2024-12-29", end: "2025-01-02", missedOn: "2025-01-03",
      calendar: [
        { date: "2025-01-07", state: "posted" },
        { date: "2025-01-03", state: "missed" },
        { date: "2025-01-02", state: "posted" },
        { date: "2025-01-01", state: "no_game" },
        { date: "2024-12-31", state: "posted" },
        { date: "2024-12-29", state: "posted" },
        { date: "2024-12-28", state: "missed" },
        { date: "2024-12-27", state: "posted" },
      ],
    } as const;
    const detailed = { ...game, bestStreak };
    const streaks = (games: Game[]) => generateHealthWins({ member, games }).filter(card => card.kind === "game_streak");
    const [streak] = streaks([detailed]);
    expect(streak?.chart).toMatchObject({ days: 3, start: "2024-12-29", end: "2025-01-02", missedOn: "2025-01-03" });
    expect(streak?.chart.calendar?.map(day => [day.date, day.state])).toEqual([
      ["2024-12-23", "no_game"], ["2024-12-24", "no_game"], ["2024-12-25", "no_game"],
      ["2024-12-26", "no_game"], ["2024-12-27", "posted"], ["2024-12-28", "missed"], ["2024-12-29", "posted"],
      ["2024-12-30", "no_game"], ["2024-12-31", "posted"], ["2025-01-01", "no_game"], ["2025-01-02", "posted"],
      ["2025-01-03", "missed"], ["2025-01-04", "no_game"], ["2025-01-05", "no_game"],
    ]);
    const { calendar, ...summary } = bestStreak;
    const legacy = { ...game, exercise: "squats", bestStreak: summary };
    expect(streaks([legacy, detailed])).toEqual([streak]);
    expect(streaks([detailed, legacy])).toEqual([streak]);
    const otherCalendar = calendar.filter(day => day.date !== "2024-12-27");
    expect(streaks([detailed, { ...legacy, bestStreak: { ...summary, calendar: otherCalendar } }])).toEqual([]);
    expect(generateHealthWins({ member, games: [game], gameStreak: bestStreak })
      .filter(card => card.kind === "game_streak")).toEqual([streak]);
    expect(generateHealthWins({ member, games: [detailed], gameStreak: null })
      .some(card => card.kind === "game_streak")).toBe(false);
  });

  it("shows a named exercise unit once, preserving grouping and distinct distance units", () => {
    for (const unit of ["reps", "pullups", "Pull-Ups", "pull ups"]) {
      const [climb] = cards({ games: [{ ...game, unit, total: 2486 }] });
      expect(climb.title).toEqual({ number: "2,486", measure: "pull-ups" });
      expect(climb.chart).toMatchObject({ unit, total: 2486 });
    }
    const distance = { ...game, exercise: "walk", unit: "miles", total: 38.72 };
    expect(cards({ games: [distance] })[0].title).toEqual({ number: "39 miles", measure: "walking" });
  });

  it("names the highest passed skyline landmark from the Progress bank, in either input order (audit 29)", () => {
    const passed = [{ id: "hollywood-sign", height: 45 }, { id: "space-needle", height: 605 }];
    const subtitle = (landmarksPassed: Game["landmarksPassed"]) => generateHealthWins({
      member, games: [{ ...game, landmarksPassed, bestStreak: null }],
    })[0].subtitle;
    expect(subtitle(passed)).toBe("enough to climb past the Space Needle");
    expect(subtitle([...passed].reverse())).toBe(subtitle(passed));
    expect(subtitle(passed.slice(0, 1))).toBe("enough to climb the Hollywood Sign");
    expect(subtitle([{ id: "unlisted-landmark", height: 200 }])).toBe("game total so far");
  });

  it("compares plank time with passed and upcoming rungs from the plank ladder (audit 32)", () => {
    const climb = (total: number, unit: string) => generateHealthWins({
      member, games: [{ ...game, exercise: "planks", unit, total, landmarksPassed: [], next: null, bestStreak: null }],
    })[0];
    const near = climb(473, "seconds");
    expect(near).toMatchObject({
      kind: "game_climb", title: { number: "8 min", measure: "planked" },
      subtitle: "nearly as long as sunlight takes to reach Earth",
      chart: {
        type: "ladder", total: 473, unit: "seconds",
        next: { id: "sunlight-earth", name: "Sunlight's trip to Earth", seconds: 499, toGo: 26 },
      },
    });
    if (near.kind !== "game_climb" || near.chart.type !== "ladder") throw new Error("Expected a plank time ladder");
    expect(near.chart.rungsPassed.map(rung => rung.id)).toEqual([
      "bull-ride", "wright-first-flight", "paper-plane", "wilbur-59", "secretariat", "four-minute-mile",
    ]);
    expect(climb(7, "minutes")).toEqual(climb(420, "sec"));
    expect(climb(499, "seconds")).toMatchObject({
      subtitle: "as long as sunlight takes to reach Earth",
      chart: { next: { id: "first-spacewalk" }, rungsPassed: expect.arrayContaining([
        expect.objectContaining({ id: "sunlight-earth", seconds: 499 }),
      ]) },
    });
    expect(climb(3, "sec")).toMatchObject({ chart: { next: { id: "bull-ride" }, rungsPassed: [] } });
    expect(climb(520, "sec").subtitle).toBe("longer than sunlight takes to reach Earth");
    expect(climb(50, "hr")).toMatchObject({ chart: { next: null } });
  });

  it("shows one best streak across games and withholds conflicting streak snapshots", () => {
    const other = { ...game, exercise: "burpees" };
    const streaks = (games: Game[]) => generateHealthWins({ member, games }).filter(card => card.kind === "game_streak");
    expect(streaks([game, other])).toEqual([expect.objectContaining({
      subtitle: "posted in every game, best run yet",
      chart: { type: "week_dots", days: 9, start: "2025-01-01", end: "2025-01-09", missedOn: "2025-01-10" },
    })]);
    const different = { ...other, bestStreak: { days: 5, start: "2025-03-02", end: "2025-03-06", missedOn: null } };
    expect(streaks([game, different])).toEqual([]);
  });

  it("accepts another registered exercise and keeps empty, future or sensitive records out", () => {
    const yoga: Game = { ...game, exercise: "yoga", unit: "minutes", bestStreak: null, landmarksPassed: [], next: null };
    expect(cards({ games: [yoga] })[0].title).toEqual({ number: "5h 17m", measure: "yoga" });
    expect(cards({ games: [{ ...yoga, total: 0 }, { ...game, exercise: "weight" }] })).toEqual([]);
    const future = { ...game, total: 0, bestStreak: { days: 2, start: "2025-04-20", end: "2025-04-21", missedOn: null } };
    expect(cards({ games: [future] })).toEqual([]);
  });
});

describe("monthly sessions", () => {
  it("counts three sessions of one type this month and sums minutes, including separate sessions on one day", () => {
    const sessions: Session[] = [
      { type: "run", date: "2025-03-31", minutes: 40 }, { type: "walk", date: "2025-04-01", minutes: 10 },
      { type: "run", date: "2025-04-19", minutes: 15 }, { type: "run", date: "2025-04-20", minutes: 80 },
      { type: "walk", date: "2025-04-02", minutes: 12 }, { type: "run", date: "2025-04-01", minutes: 29 },
      { type: "run", date: "2025-04-01", minutes: 21.5 }, { type: "run", date: "2025-04-03", minutes: NaN },
    ];
    const result = cards({ sessions });
    expect(result).toEqual([expect.objectContaining({
      kind: "sessions", title: { number: "3 runs", measure: "in April so far" },
      subtitle: "1h 6m of running, the longest 29 min",
      chart: { type: "sessions", sessionType: "run", totalMinutes: 65.5, series: [
        { date: "2025-04-01", minutes: 21.5 }, { date: "2025-04-01", minutes: 29 }, { date: "2025-04-19", minutes: 15 },
      ] },
    })]);
    expect(cards({ sessions: [...sessions].reverse() })).toEqual(result);
  });

  it("calls an hour-long session a full hour", () => {
    const sessions: Session[] = [18, 60, 25].map((minutes, i) => ({
      type: "walk", date: `2025-04-0${i + 1}`, minutes,
    }));
    expect(cards({ sessions })[0]).toMatchObject({
      title: { number: "3 walks", measure: "in April so far" },
      subtitle: "1h 43m of walking, the longest a full hour",
    });
  });
});
