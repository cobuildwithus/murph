import { describe, expect, it } from "vitest";

import { generateHealthWins, type DailySample, type Experiment, type Game, type HealthWinsInput } from "./index";
import { rankCandidates } from "./ranking";
import type { Candidate } from "./types";

const member = { today: "2034-05-16", age: 37, sex: "female", wearableProvider: "garmin" } as const;

function experiment(index: number): Experiment {
  return {
    slug: `sketch-${index}`, title: `Sketch break ${index}`, metric: "sleep_score",
    baseline: { start: "2034-03-01", end: "2034-03-10" },
    intervention: { start: "2034-04-01", end: "2034-04-10" },
    baselineMean: 76, interventionMean: 77, expectedDirection: "increase", adherence: { done: 7, target: 10 },
  };
}

function game(exercise: string): Game {
  return {
    exercise, total: 246, unit: "reps", landmarksPassed: [], next: null,
    bestStreak: { days: 4, start: "2034-05-01", end: "2034-05-04", missedOn: "2034-05-05" },
  };
}

describe("generateHealthWins", () => {
  it("returns an empty selection for missing evidence or an invalid as-of day", () => {
    expect(generateHealthWins({ member })).toEqual([]);
    expect(generateHealthWins({ member: { ...member, today: "2034-02-31" }, games: [game("squats")] })).toEqual([]);
  });

  it("uses cleaned wearable evidence for the record and sourced percentile cards", () => {
    const daily: HealthWinsInput["daily"] = [
      ...Array.from({ length: 27 }, (_, i): DailySample => ({
        metric: "steps", date: `2034-04-${String(i + 1).padStart(2, "0")}`, provider: "garmin", value: 3845,
      })),
      { metric: "steps", date: member.today, provider: "whoop", value: 8150 },
      { metric: "steps", date: member.today, provider: "apple", value: 12020 },
      { metric: "vo2max", date: member.today, provider: "garmin", value: 46 },
    ];
    const cards = generateHealthWins({ member, daily });
    expect(cards.find(card => card.kind === "personal_record")?.chart.highlight.value).toBe(8150);
    expect(cards.find(card => card.kind === "percentile")).toMatchObject({
      title: { measure: "VO2 max" }, source_note: expect.stringContaining("FRIEND"),
    });
    expect(generateHealthWins({ member, daily: [...daily].reverse() })).toEqual(cards);
  });

  it("prioritizes distinct daily claims by kind and includes the remaining claims", () => {
    const months = ["2033-12", "2034-01", "2034-02", "2034-03", "2034-04", "2034-05"];
    const daily = months.flatMap((month, monthIndex) => Array.from({ length: 16 }, (_, i): DailySample[] => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      const current = monthIndex === months.length - 1;
      const sleep = current ? (i % 6 === 0 ? 457 : 496) : 448 + (i % 2 ? 19 : -19);
      const score = (current ? 84 : 67) + (i % 2 ? 5 : -5);
      return [
        { metric: "sleep_total_min", date, value: sleep, provider: "garmin" },
        { metric: "sleep_score", date, value: score, provider: "garmin" },
      ];
    }).flat());
    const kinds = (samples: DailySample[]) => generateHealthWins({ member, daily: samples }).map(card => card.kind);

    // The sleep score monthly best follows the three higher-priority duration claims.
    expect(kinds(daily)).toEqual(["trend_change", "threshold_count", "streak", "best_month"]);
    expect(kinds([...daily].reverse())).toEqual(kinds(daily));
    expect(kinds(daily.filter(row => row.metric === "sleep_score"))).toEqual(["best_month"]);

    // With spare slots, a second account of this month's sleep average is still withheld.
    const shorterNights = daily.filter(row => row.metric === "sleep_total_min")
      .map(row => ({ ...row, value: row.value - 60 }));
    expect(kinds(shorterNights)).toEqual(["trend_change"]);
    expect(kinds([...shorterNights, ...daily.filter(row => row.metric === "sleep_score")]))
      .toEqual(["trend_change", "best_month"]);

    const deepSleep = shorterNights.map(row => ({ ...row, metric: "sleep_deep_min" as const, value: row.value - 290 }));
    expect(kinds(deepSleep)).toEqual(["trend_change", "personal_record"]);
    // Without three consecutive baseline months, the monthly best leads the single-night record.
    expect(kinds(deepSleep.map(row => ({ ...row, date: row.date.replace(/^2034-02/u, "2033-11") }))))
      .toEqual(["best_month", "personal_record"]);
  });

  it("admits only supported measures and omits private categories from all card fields", () => {
    const privateCategories = ["medications", "genetics", "conditions", "weight"] as const;
    const input: HealthWinsInput = {
      member,
      experiments: privateCategories.map((sensitiveCategory, index) => ({ ...experiment(index), sensitiveCategory })),
      games: privateCategories.map(game),
      // @ts-expect-error An untyped upstream source may include measures outside the union.
      daily: privateCategories.map(metric => ({ date: member.today, provider: "apple", value: 50, metric })),
      // @ts-expect-error Extra analytes must also fail closed at runtime.
      labs: privateCategories.map(analyte => ({ analyte, date: member.today, unit: "mg/dL", value: 50,
        referenceRange: { low: 40, high: 60 } })),
    };
    expect(generateHealthWins(input)).toEqual([]);
    expect(generateHealthWins({ member, ...Object.fromEntries(privateCategories.map(key => [key, [1]])) })).toEqual([]);
  });

  it("balances twelve cards, includes every remaining claim and preserves input order", () => {
    const experiments = [1, 2, 3, 4].map(experiment);
    const games = ["squats", "pushups", "lunges", "burpees"].map(game);
    const labs = (["ldl", "hdl", "triglycerides", "total_chol"] as const).map(analyte => ({
      analyte, value: 83, unit: "mg/dL", date: member.today, referenceRange: { low: 48, high: 123 },
    }));
    const sessions = (["hiit", "walk", "sauna", "basketball"] as const).flatMap(type =>
      [2, 9, 12].map(day => ({ type, date: `2034-05-${String(day).padStart(2, "0")}`, minutes: 25 })));
    const input = { member, experiments, games, labs, sessions };
    const original = structuredClone(input);
    const cards = generateHealthWins(input);
    expect(input).toEqual(original);
    expect(cards).toHaveLength(17);
    expect(new Set(cards.map(card => card.id)).size).toBe(cards.length);
    for (const filter of ["Challenges", "Experiments", "Fitness", "Labs"]) {
      expect(cards.slice(0, 12).filter(card => card.filter === filter)).toHaveLength(3);
      expect(cards.slice(12).some(card => card.filter === filter)).toBe(true);
    }
    // The remaining session, game streak and experiment have equal effects and successively older dates.
    expect(cards.slice(-3).map(card => card.kind)).toEqual(["sessions", "game_streak", "experiment_result"]);
    expect(cards.every(card => card.theme && card.source_note && card.title.number &&
      (card.kind === "experiment_result" || card.title.measure))).toBe(true);
    for (const card of cards) expect(card.source_note).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/u);
    expect(generateHealthWins({ member, experiments: experiments.reverse(), games: games.reverse(),
      labs: labs.reverse(), sessions: sessions.reverse() })).toEqual(cards);
    const bars = cards.find(card => card.kind === "experiment_result");
    expect(bars?.chart.series.map(bar => bar.mean)).toEqual([76, 77]);
  });

  it("caps a crowded filter at 24 distinct claims and orders its remaining cards by score", () => {
    const experiments = Array.from({ length: 28 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return { ...experiment(index), intervention: { start: `2034-04-${day}`, end: `2034-04-${day}` } };
    });
    const cards = generateHealthWins({ member, experiments });
    expect(cards.map(card => card.title.number))
      .toEqual(experiments.slice(-24).reverse().map(item => item.title));
  });

  it("keeps a distance trend and the highest monthly mileage as distinct claims", () => {
    const months = ["01", "02", "03", "04", "05", "06", "07"];
    const daily = months.flatMap((month, index) => Array.from({ length: 20 }, (_, i): DailySample => ({
      metric: "distance_km", provider: "garmin", date: `2034-${month}-${String(i + 1).padStart(2, "0")}`,
      value: index === 0 ? 10 : index === 6 ? 5 : 2,
    })));
    const cards = generateHealthWins({ member: { ...member, today: "2034-07-24" }, daily });
    expect(cards.map(card => card.kind)).toEqual(expect.arrayContaining(["trend_change", "best_month"]));
  });

  it("withholds conflicting snapshots and accepts repeated identical achievements once", () => {
    const first = game("squats");
    const second = { ...first, total: 222 };
    const result = generateHealthWins({ member, games: [first, second, first] });
    expect(result.map(card => card.kind)).toEqual(["game_streak"]);
    expect(generateHealthWins({ member, games: [second, first] })).toEqual(result);
  });
});

it("ranks by effect versus noise, recency and record bonus, breaking ties by card ID", () => {
  const base: Candidate = {
    card: { id: "base", kind: "sessions", filter: "Fitness", title: { number: "3", measure: "walks" },
      subtitle: "48 minutes", source_note: member.today,
      chart: { type: "sessions", sessionType: "walk", series: [], totalMinutes: 48 } },
    effect: 2, noise: 2, date: member.today,
  };
  function sample(id: string, effect: number, noise: number, date: string = member.today): Candidate {
    return { card: { ...base.card, id }, effect, noise, date };
  }
  const record: Candidate = {
    ...base, card: { ...base.card, id: "record", kind: "personal_record",
      chart: { type: "record", unit: "steps", series: [], highlight: { date: member.today, value: 7200, label: "May 16" }, pills: [] } },
  };
  function ids(...candidates: Candidate[]) {
    return rankCandidates(candidates, member.today).map(card => card.id);
  }
  expect(ids(sample("noisier", 5, 4), sample("quieter", 3, 2))).toEqual(["quieter", "noisier"]);
  expect(ids(sample("older", 1, 1, "2034-04-01"), sample("recent", 1, 1))).toEqual(["recent", "older"]);
  expect(ids(sample("comparison", 1, 1), record)).toEqual(["record", "comparison"]);
  expect(ids(sample("z", 1, 2), sample("a", 1, 2), sample("a", 1, 2))).toEqual(["a", "z"]);
});
