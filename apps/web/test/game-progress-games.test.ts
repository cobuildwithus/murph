import { describe, expect, it } from "vitest";
import { gameSeries, cumulativePoints } from "../src/lib/game/progress/series";
import { gameDays } from "../src/lib/game/progress/game-days";
import { BANK, ladder, search, rungEntry } from "../src/lib/game/progress/bank";
import { measureLadder, projection, roundValues, rungFor } from "../src/lib/game/progress/goals";
import { formatAmount, formatNumber } from "../src/lib/game/progress/format";
import { ACHIEVEMENTS } from "../src/lib/game/progress/registry";
import { achievementContext, medalView, medalsView, measureView, momentsView, visibleAwards } from "../src/lib/game/progress/view";
import { retiredAward, type StoredAward } from "../src/lib/game/progress/awards";
import { game, memberId, post, task } from "./support/progress-games";

const reps = task("40 pushups", { quantity: 40, unit: "reps", name: "pushups" });
const stored = (candidates: ReturnType<(typeof ACHIEVEMENTS)[number]>): StoredAward[] => candidates.map(candidate => ({ ...candidate,
  id: candidate.key, createdAt: new Date("2026-11-05T12:00:00Z"), seenAt: null }));

describe("Progress source contributions", () => {
  it("names Move's typed walk and pushups immediately while only words and heart rate are pending", () => {
    const source = game("move", task("Move", null));
    post(source, 0, "words", null);
    post(source, 1, "heart_rate", { durationSec: 600, avgBpm: 90, lowBpm: 70, peakBpm: 110 });
    post(source, 2, "route", { activity: "walk", distanceM: 1609.344, durationSec: 600 });
    post(source, 3, "reps", { exercise: "pushups", count: 40, reps: [] });
    const measures = gameSeries([source], memberId, new Map());
    expect(measures.map(measure => [measure.id, measure.pending, measure.amounts.reduce((sum, item) => sum + item.amount, 0)]))
      .toEqual([["h123456789012.days", true, 2], ["walk.meters", false, 1609.344], ["pushups.reps", false, 40]]);
    expect(measures[1].amounts).toEqual([{ measureId: "walk.meters", date: "2026-11-03", amount: 1609.344 }]);
    expect(ACHIEVEMENTS.flatMap(evaluate => evaluate(achievementContext(measures, new Map())))).toEqual([
      expect.objectContaining({ measureId: "walk.meters", on: "2026-11-03", data: expect.objectContaining({ value: 1609.344 }) }),
    ]);
  });

  it("uses the day's terms and seat task, counts retakes once and never adds stated to measured", () => {
    const source = game("versions", reps);
    source.state.game.seats = 10;
    source.state.game.terms.versions.push({ n: 2, fromDay: 2, schedule: { count: 4 }, stakes: [] });
    source.tasks.set(2, task("10 min pushups", { quantity: 10, unit: "minutes", name: "pushups" }));
    post(source, 0, "photo", null);
    post(source, 1, "reps", { exercise: "pushups", count: 12, reps: [] });
    source.state.entries[1].withdrawnAt = source.now;
    post(source, 1, "reps", { exercise: "pushups", count: 15, reps: [] });
    source.state.entries[2].attempt = 2;
    post(source, 2, "photo", null);
    post(source, 3, "words", null); source.state.entries[4].incomplete = true;
    post(source, 4, "excuse", null);
    expect(gameSeries([source], memberId, new Map()).map(measure => [measure.id, cumulativePoints(measure.amounts)]))
      .toEqual([["pushups.reps", [["2026-11-01", 40], ["2026-11-02", 55]]], ["pushups.seconds", [["2026-11-03", 600]]]]);
  });

  it.each([
    ["2 hours of yoga", { quantity: 2, unit: "hours" as const, name: "yoga" }, "yoga.seconds", 7200],
    ["3 km walk", { quantity: 3, unit: "km" as const, name: "walk" }, "walk.meters", 3000],
    ["2 miles run", { quantity: 2, unit: "miles" as const, name: "run" }, "run.meters", 3218.688],
    ["20 burpees", { quantity: 20, unit: "reps" as const, name: "burpees" }, "burpees.reps", 20],
    ["Lights out by 11", { quantity: null, unit: "days" as const, name: null }, "h123456789012.days", 1],
  ])("keeps canonical units for %s", (text, inference, id, amount) => {
    const source = game("units", task(text, inference)); post(source, 0, "photo", null);
    expect(gameSeries([source], memberId, new Map())[0]).toMatchObject({ id, amounts: [{ measureId: id, date: "2026-11-01", amount }] });
  });

  it("applies an added per-day amount to old completed days, preserving the original day awards", () => {
    const source = game("days", task("Pushups every day", { quantity: null, unit: "days", name: "pushups" }));
    post(source, 0, "photo", null); post(source, 2, "photo", null);
    const before = gameSeries([source], memberId, new Map())[0];
    expect(before).toMatchObject({ needsPerDay: true, unit: "days" });
    const after = gameSeries([source], memberId, new Map([[before.id, { perDay: 50 }]]))[0];
    expect(after).toMatchObject({ id: "pushups.reps", needsPerDay: false });
    expect(cumulativePoints(after.amounts)).toEqual([["2026-11-01", 50], ["2026-11-03", 100]]);
  });
  it.each([10, 20])("keeps %s total posted days across gaps after retiring streaks", count => {
    const source = game("days", task("Yoga", { quantity: null, unit: "days", name: "yoga" }));
    source.state.game.lengthDays = 40;
    source.now = new Date("2026-12-15T12:00:00Z");
    for (let day = 0; day < count; day++) post(source, day * 2, "photo", null);
    const measures = gameSeries([source], memberId, new Map());
    const awards = ACHIEVEMENTS.flatMap(evaluate => evaluate(achievementContext(measures, new Map())));
    expect(awards.map(award => [award.kind, award.data.value])).toEqual(count === 10 ? [["days", 10]] : [["days", 10], ["days", 20]]);
  });
  it("resumes a projection when another live game has the same measure but no posts yet", () => {
    const old = game("old", reps); old.state.game.status = "settled";
    post(old, 0, "photo", null);
    const next = game("next", reps);
    expect(gameSeries([old], memberId, new Map())[0].gameOn).toBe(false);
    expect(gameSeries([old, next], memberId, new Map())[0].gameOn).toBe(true);
  });
});

describe("credited game dates", () => {
  it.each([false, true])("keeps real earlier misses and the terminal day's completed post: %s", completed => {
    const source = game("cancelled", reps);
    source.state.game.status = "void";
    source.state.players[0].timeZone = "America/New_York";
    source.endedAt = new Date("2026-11-04T02:00:00Z");
    post(source, 0, "photo", null);
    if (completed) post(source, 2, "photo", null);
    const days = gameDays(source, memberId)!;
    expect(days.map(day => [day.date, day.done])).toEqual([
      ["2026-11-01", true], ["2026-11-02", false], ...(completed ? [["2026-11-03", true]] : []),
    ]);
    expect(gameSeries([source], memberId, new Map())[0].amounts).toHaveLength(completed ? 2 : 1);
  });
  it.each([
    ["before leaving day's post", false, [0, 1]],
    ["after leaving day's post", true, [0, 1, 2]],
  ])("keeps group history %s and excludes later obligations", (_label, postOnDeparture, expected) => {
    const source = game("left", reps); source.state.game.seats = 10;
    source.state.players[0].leftAt = new Date("2026-11-03T18:00:00Z");
    post(source, 0, "photo", null); post(source, 1, "photo", null);
    if (postOnDeparture) post(source, 2, "photo", null);
    expect(gameDays(source, memberId)?.map(day => day.dayIndex)).toEqual(expected);
    expect(gameSeries([source], memberId, new Map())[0].amounts).toHaveLength(expected.length);
  });
  it("clips join, settlement and natural end, and keeps the frozen timezone over DST", () => {
    const source = game("late", reps); source.state.game.seats = 10;
    source.state.players[0].timeZone = "America/New_York";
    source.state.players[0].joinedAt = new Date("2026-11-02T08:00:00Z");
    source.state.game.status = "settled"; source.settledAt = new Date("2026-11-04T02:00:00Z");
    post(source, 1, "photo", null); post(source, 2, "photo", null);
    expect(gameDays(source, memberId)?.map(day => day.date)).toEqual(["2026-11-02", "2026-11-03"]);
    source.state.game.lengthDays = 2;
    expect(gameDays(source, memberId)).toHaveLength(1);
  });
});

describe("checked ladders and permanent crossings", () => {
  it("uses only checked entries, exactly the curated ladders and lets search find non-ladder goals", () => {
    expect(BANK).toHaveLength(505);
    expect(ladder("height", "")).toHaveLength(70);
    expect(ladder("time", "plank")).toHaveLength(30);
    expect(ladder("time", "sleep")).toHaveLength(30);
    expect(ladder("time", "sleep").some(entry => entry.id === "plank-record")).toBe(false);
    expect(search("half dome").map(entry => entry.id)).toContain("half-dome");
    expect(search("Iceland")).toMatchObject([{ id: "around-iceland", kind: "route", name: "Around Iceland", at: 1322000 }]);
  });
  it("dates every crossed rung and round to the crossing day, then keeps passes after a correction", () => {
    const source = game("big", task("1400 pushups", { quantity: 1400, unit: "reps", name: "pushups" }));
    post(source, 1, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    const context = achievementContext([series], new Map());
    const awards = stored(ACHIEVEMENTS.flatMap(evaluate => evaluate(context)));
    expect(awards.every(award => award.on === "2026-11-02")).toBe(true);
    expect(awards.filter(award => award.kind === "landmark").length).toBeGreaterThan(5);
    expect(awards.filter(award => award.kind === "total").map(award => award.data.value)).toEqual([100, 200, 500, 1000]);
    const corrected = { ...series, amounts: [{ measureId: series.id, date: "2026-11-02", amount: 20 }] };
    const next = measureLadder(corrected, {}, awards, "us")!;
    expect(next.passed).toHaveLength(awards.filter(award => award.kind === "landmark").length);
    expect(new Set(next.passed.map(rung => rung.shareAwardId))).toEqual(new Set(awards.filter(award => award.kind === "landmark").map(award => award.id)));
    expect(next.next!.shareAwardId).toBeNull();
    expect(next.next!.at).toBeGreaterThan(Math.max(...next.passed.map(rung => rung.at)));
    expect(momentsView(awards, [measureView(corrected, {}, awards, "2026-11-05", "us")], "us")).toMatchObject([{ kind: "bigDay", medalIds: awards.map(award => award.id) }]);
  });
  it("uses two feet per pull-up, a selected nondefault rung and no ladder for days", () => {
    const source = game("pullups", task("380 pullups", { quantity: 380, unit: "reps", name: "pullups" })); post(source, 0, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    const context = achievementContext([series], new Map([[series.id, { goal: { rungId: "half-dome" } }]]));
    expect(context.measures[0].rungs.find(rung => rungEntry(rung).id === "golden-gate-bridge-towers")?.at).toBe(373);
    expect(measureLadder(series, { goal: { rungId: "half-dome" } }, [], "us")).toMatchObject({ goalPicked: true, next: { id: "half-dome" } });
    expect(measureLadder({ ...series, unit: "days" }, {}, [], "us")).toBeNull();
  });
  it.each([
    ["reps", 40, 100], ["reps", 60, 100], ["reps", 1400, 2000], ["days", 23, 50],
    ["meters", 1609.344, 3218.688], ["steps", 240, 500],
    ["seconds", 0, 600], ["seconds", 60, 600], ["seconds", 120, 600], ["seconds", 300, 600], ["seconds", 480, 600], ["seconds", 599, 600],
    ["seconds", 600, 900], ["seconds", 900, 1800], ["seconds", 1800, 3600],
    ["seconds", 3600, 7200], ["seconds", 7200, 18000], ["seconds", 18000, 36000],
    ["seconds", 13800, 18000],
  ] as const)("chooses the next %s round above %s", (unit, total, expected) => {
    expect(roundValues(total, { id: `exercise.${unit}`, unit }).at(-1)).toBe(expected);
  });
  it("preserves the separate wearable Sleep rounds", () => {
    expect(roundValues(480, { id: "sleep", unit: "seconds" })).toEqual([3600]);
  });
  it("keeps ten minutes next at eight minutes without earning a time-total medal", () => {
    const source = game("time", task("4 min planks", { quantity: 4, unit: "minutes", name: "planks" }));
    post(source, 0, "photo", null); post(source, 2, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    const awards = ACHIEVEMENTS.flatMap(evaluate => evaluate(achievementContext([series], new Map())));
    expect(awards.filter(award => award.kind === "total")).toEqual([]);
    expect(projection({ ...series, gameOn: false }, "2026-11-05", "us")).toEqual({ value: 600, label: "10m next", on: null });
  });
  it("earns minute medals on their crossing dates and retains earlier hour medals after correction", () => {
    const source = game("time", task("10 min planks", { quantity: 10, unit: "minutes", name: "planks" }));
    post(source, 0, "photo", null); post(source, 2, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    const awards = stored(ACHIEVEMENTS.flatMap(evaluate => evaluate(achievementContext([series], new Map()))));
    expect(awards.filter(award => award.kind === "total").map(award => [award.data.value, award.on])).toEqual([
      [600, "2026-11-01"], [900, "2026-11-03"],
    ]);
    expect(projection({ ...series, gameOn: false }, "2026-11-05", "us")).toEqual({ value: 1800, label: "30m next", on: null });
    const prior = stored([{ key: "total:planks.seconds:10800", kind: "total", measureId: "planks.seconds",
      subjectMemberId: null, on: "2026-10-30", data: { value: 10800, unit: "seconds", noun: "planked", page: "totals" } }]);
    expect(medalsView([...awards, ...prior], "us").find(medal => medal.id === prior[0].id))
      .toMatchObject({ face: { number: "3h" }, earnedOn: "2026-10-30" });
    expect(medalView(awards.find(award => award.data.value === 600)!, false, "us").title).toBe("10 minutes");
  });
  it.each(["us", "metric"] as const)("groups totals by exercise, largest amount first despite saved dates, for %s", units => {
    const inputs = [
      ["pushups.reps", 100, "2026-11-05"], ["planks.seconds", 900, "2026-11-04"],
      ["pushups.reps", 1000, "2026-11-03"], ["pushups.reps", 500, "2026-11-02"],
      ["pushups.reps", 200, "2026-11-01"], ["planks.seconds", 600, "2026-11-05"],
    ] as const;
    const awards = stored(inputs.map(([measureId, value, on]) => ({ key: `${measureId}:${value}`, kind: "total",
      measureId, subjectMemberId: null, on, data: { value, unit: measureId.split(".")[1], noun: "exercise", page: "totals" } })));
    const medals = medalsView(awards, units);
    expect(medals.map(medal => medal.id)).toEqual([
      "pushups.reps:1000", "pushups.reps:500", "pushups.reps:200", "pushups.reps:100", "planks.seconds:900", "planks.seconds:600",
    ]);
    expect(medals.filter(medal => medal.gold)).toHaveLength(1);
    expect(medals.find(medal => medal.gold)?.id).toBe("pushups.reps:1000");
    expect(medals.find(medal => medal.open.measureId === "planks.seconds")?.face).toEqual({ number: "15m" });
  });
  it("projects fourteen calendar days and keeps a dateless next round with no game or no rate", () => {
    const source = game("rate", reps); post(source, 0, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    expect(projection(series, "2026-11-05", "us")).toEqual({ value: 100, label: "100 by Nov 26", on: "2026-11-26" });
    expect(projection({ ...series, gameOn: false }, "2026-11-05", "us")).toEqual({ value: 100, label: "100 next", on: null });
    expect(projection(series, "2026-12-05", "us")).toEqual({ value: 100, label: "100 next", on: null });
  });
  it("removes all health-derived awards and their moments after authority loss", () => {
    const awards: StoredAward[] = stored(["health", "healthAge", "total"].map((kind, i) => ({ key: kind, kind,
      measureId: i === 2 ? "pushups.reps" : "restingHeartRate", subjectMemberId: null, on: "2026-11-05", data: { value: 1000, unit: "reps", noun: "pushups", page: "totals" } })));
    const visible = visibleAwards(awards, false);
    expect(visible.map(award => award.kind)).toEqual(["total"]);
    expect(momentsView(visible, [], "us")[0].medalIds).toEqual(["total"]);
  });
});

describe("shared Progress numbers", () => {
  it.each([
    [18120, "full", "18,120"], [187700, "full", "187,700"], [31240, "full", "31,240"],
    [9999, "compact", "9,999"], [10000, "compact", "10k"], [20000, "compact", "20k"],
    [10989, "compact", "11k"], [31240, "compact", "31.2k"], [200000, "compact", "200k"],
    [187700, "compact", "188k"], [1400, "compact", "1,400"], [1400, "delta", "+1.4k"],
    [-1400, "delta", "-1.4k"], [60, "delta", "+60"],
  ] as const)("formats %s as %s", (value, style, expected) => expect(formatNumber(value, style)).toBe(expected));
  it.each([
    [3, "compact", "3 mi"], [8.4, "compact", "8.4 mi"], [10.4, "compact", "10 mi"], [116.4, "compact", "116 mi"],
    [10000, "compact", "10k mi"], [31240, "compact", "31.2k mi"], [31240, "full", "31,240 mi"],
  ] as const)("formats %s miles as %s", (miles, style, expected) => {
    expect(formatAmount(miles * 1609.344, "meters", style, "us").text).toBe(expected);
  });
  it("uses full hero digits and compact projections, goals and medals", () => {
    const source = game("large", task("3124 pushups", { quantity: 3124, unit: "reps", name: "pushups" }));
    post(source, 0, "photo", null);
    const [series] = gameSeries([source], memberId, new Map());
    series.amounts[0].amount = 31240;
    const context = achievementContext([series], new Map([[series.id, { goal: { rungId: "half-dome" } }]]));
    const awards = stored(ACHIEVEMENTS.flatMap(evaluate => evaluate(context)));
    expect(medalView(awards.find(award => award.key === "total:pushups.reps:20000")!, false, "us")).toMatchObject({ face: { number: "20k" }, title: "20k" });
    expect(measureView(series, {}, [], "2026-11-05", "us")).toMatchObject({ total: { text: "31,240" }, projection: { label: expect.stringMatching(/^50k by /u) } });
    expect(rungFor(context.measures[0].rungs.find(rung => rungEntry(rung).id === "mount-everest")!, 0, null, "us").atText).toBe("29,032 ft");
  });
});

describe("moment words", () => {
  it.each([
    [25, "Beat 1 in 4", "women your age"],
    [100 / 3, "Beat 1 in 3", "women your age"],
    [50, "Beat half", "men your age"],
  ])("says the age audience once for saved and new %s-percent medals", (percentile, title, detail) => {
    const full = `${title}${percentile === 50 ? " of" : ""} ${detail}`;
    for (const savedTitle of [title, full]) {
      const awards = stored([{ key: "age", kind: "healthAge", measureId: "restingHeartRate", subjectMemberId: null,
        on: "2026-11-05", data: { percentile, title: savedTitle, detail, page: "health", face: { delta: { icon: "age", text: "1 in 3" } } } }]);
      expect(momentsView(awards, [], "us")[0].title).toBe(full);
      expect(medalView(awards[0], true, "us")).toMatchObject({ title, detail });
      expect(awards[0].data.title).toBe(savedTitle);
    }
  });
  it.each([
    ["landmark", "goal", { rung: { at: 1776, target: { kind: "height", id: "one-world-trade-center" } }, noun: "pushups" }, "One World Trade Center", BANK.find(entry => entry.id === "one-world-trade-center")!.blurb],
    ["time", "held", { rung: { at: 10800, target: { kind: "time", id: "concorde" } }, noun: "planked" }, "Concorde", BANK.find(entry => entry.id === "concorde" && entry.kind === "time")!.blurb],
    ["route", "route", { from: "San Diego", to: "San Francisco", distanceM: 501 * 1609.344 }, "San Francisco", "501 mi from San Diego"],
    ["health", "medal", { title: "Heart rate", detail: "down 3 bpm", face: { delta: { icon: "heart", text: "3" } } }, "Heart rate down 3 bpm", "Your best since you joined. It's your newest medal, so it's the gold one on Prizes."],
    ["total", "medal", { value: 20000, unit: "reps", noun: "pushups" }, "20k pushups", null],
  ] as const)("renders %s drawer copy from earned facts", (kind, momentKind, data, title, line) => {
    const awards = stored([{ key: "one", kind, measureId: "pushups.reps", subjectMemberId: null, on: "2026-11-05", data: { ...data, page: "totals" } }]);
    expect(momentsView(awards, [], "us")[0]).toMatchObject({ kind: momentKind, title, line });
  });
});

describe("Medal words and pages", () => {
  const award = (kind: string, measureId: string, data: Record<string, unknown>) => stored([{ key: `${kind}:${measureId}`, kind, measureId,
    subjectMemberId: kind === "friend" ? "leo" : null, on: "2026-11-05", data: data as never }])[0];

  it("names the exercise on landmark and time medals", () => {
    const tower = { rung: { at: 1776, target: { kind: "height", id: "one-world-trade-center" } }, page: "totals" };
    expect(medalView(award("landmark", "pullups.reps", { ...tower, noun: "pull-ups" }), false, "us").detail).toBe("1,776 pull-ups");
    expect(medalView(award("time", "planks.seconds", { rung: { at: 10800, target: { kind: "time", id: "concorde" } },
      noun: "planked", page: "totals" }), false, "us").detail).toMatch(/ planked$/);
  });

  it("says what a friend was passed in, all time", () => {
    const passed = award("friend", "pullups.reps", { title: "Passed Leo", detail: "all-time total", page: "friends",
      face: { member: { memberId: "leo", firstName: "Leo", avatarUrl: null } } });
    expect(medalView(passed, false, "us", [{ id: "pullups.reps", label: "Pull-ups" }])).toMatchObject({ title: "Passed Leo",
      detail: "in pull-ups, all time", open: { page: "friends", measureId: "pullups.reps" } });
    expect(momentsView([passed], [{ id: "pullups.reps", label: "Pull-ups" } as never], "us")[0].title).toBe("Passed Leo in pull-ups, all time");
  });

  it("opens Health for a health number's totals and journeys, Totals for a game's", () => {
    const total = (measureId: string) => award("total", measureId, { value: 10000, unit: "steps", noun: "steps", page: "totals" });
    expect(medalView(total("steps"), false, "us").open).toEqual({ page: "health", measureId: "steps" });
    expect(medalView(total("pushups.reps"), false, "us").open).toEqual({ page: "totals", measureId: "pushups.reps" });
  });
});

it("retires streaks, hours slept and anything VO2 max; keeps steps totals and sleep journeys", () => {
  expect(([["streak", null], ["total", "sleep"], ["health", "vo2Max"], ["healthAge", "vo2Max"],
    ["total", "steps"], ["time", "sleep"], ["health", "sleep"]] as const).map(([kind, measureId]) => retiredAward({ kind, measureId })))
    .toEqual([true, true, true, true, false, false, false]);
});
