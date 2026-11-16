import { describe, expect, it } from "vitest";
import type { Response } from "openai/resources/responses/responses";
import { BANK, rungEntry } from "../src/lib/game/progress/bank";
import { formatAmount, formatHeight, formatRungTime } from "../src/lib/game/progress/format";
import { checkedGoalLookup, foundEntry, measureLadder, rungDefinition, rungFor } from "../src/lib/game/progress/goals";
import { achievementContext, medalView, momentsView } from "../src/lib/game/progress/view";
import { ACHIEVEMENTS } from "../src/lib/game/progress/registry";
import { describeMeasure } from "../src/lib/game/progress/series";
import type { MeasureSeries } from "../src/lib/game/progress/series";
import type { StoredAward } from "../src/lib/game/progress/awards";
import responseFixture from "./fixtures/progress-goal-lookup-response.json";

const response = responseFixture as Pick<Response, "status" | "output" | "output_text">;
const proposed = JSON.parse(response.output_text).found as {
  name: string; short: string; tagline: string; value: number; where: string; blurb: string; sourceUrl: string;
};
const source = (exercise = "pushups", unit: MeasureSeries["unit"] = "reps"): MeasureSeries => ({
  ...describeMeasure(`${exercise}.${unit}`, exercise, exercise), pending: false, gameOn: true, needsPerDay: false, amounts: [],
});
const stored = (measure: MeasureSeries, goal = foundEntry("height", proposed)): StoredAward[] => {
  const context = achievementContext([measure], new Map([[measure.id, { goal: { found: goal } }]]), []);
  return ACHIEVEMENTS.flatMap(evaluate => evaluate(context)).map(award => ({ ...award, id: award.key, createdAt: new Date("2026-11-16"), seenAt: null }));
};

describe("Progress reader units", () => {
  it.each([
    [9.58, "9.58 sec"], [60, "1 min"], [3660, "1 hr 1 min"], [7200, "2 hr"],
    [86400, "1 day"], [172800, "2 days"],
  ] as const)("renders a found duration of %s seconds", (seconds, text) => {
    expect(formatRungTime(seconds)).toBe(text);
  });
  it.each([
    ["us", "1 mi", "1,000 ft"], ["uk", "1 mi", "305 m"], ["metric", "1.6 km", "305 m"],
  ] as const)("formats distance and height separately for %s", (units, distance, height) => {
    expect(formatAmount(1609.344, "meters", "compact", units)).toEqual({ value: 1609.344, unit: "meters", text: distance });
    expect(formatHeight(1000, units)).toBe(height);
    expect(formatAmount(7200, "seconds", "full", units).text).toBe("2h");
    expect(formatAmount(18120, "reps", "full", units).text).toBe("18,120");
  });
  it.each([
    [9999, "10 km"], [10400, "10 km"], [10000000, "10k km"], [8400, "8.4 km"],
  ])("applies D20 distance rounding in metric at %s m", (value, text) => {
    expect(formatAmount(value as number, "meters", "compact", "metric").text).toBe(text);
  });
  it.each(["us", "uk", "metric"] as const)("uses the prescribed bank prose for %s", units => {
    for (const [kind, id] of [["height", "karman-line"], ["time", "marathon"]] as const) {
      const entry = BANK.find(entry => entry.kind === kind && entry.id === id)!;
      const rung = rungFor(rungDefinition(entry, source("pushups", kind === "height" ? "reps" : "seconds")), 0, null, units);
      expect(rung.blurb).toBe(units === "metric" ? entry.blurbMetric : entry.blurb);
    }
  });
  it("gives every checked entry short text and translates every imperial dimension", () => {
    for (const entry of BANK) {
      for (const text of [entry.short, entry.tagline]) {
        expect(text.length).toBeGreaterThan(0); expect(text.length).toBeLessThanOrEqual(40);
        expect(text).not.toMatch(/[\d\r\n\u2014]/u);
      }
      if (/\b(?:miles?|feet|ft)\b|\d+-foot/iu.test(entry.blurb)) expect(entry.blurbMetric).not.toBeNull();
      if (entry.blurbMetric) expect(entry.blurbMetric).not.toMatch(/\b(?:miles?|feet|ft)\b|\d+-foot/iu);
    }
    expect(BANK.find(entry => entry.id === "one-world-trade-center")!.short).toBe("One World Trade");
  });
});

describe("checked lookup boundary", () => {
  const eligible = BANK.filter(entry => entry.kind === "height");
  it("accepts the documented Responses output_text citation shape and normalizes metres once", () => {
    expect(checkedGoalLookup(response, "height", eligible).found).toMatchObject({ at: 1000, sourceUrl: proposed.sourceUrl });
  });
  it.each([
    ["fictional", null, [], null],
    ["uncited", { ...proposed, sourceUrl: "https://uncited.example.test/tower" }, [], null],
    ["too low", { ...proposed, value: 0.9 }, [], null],
    ["too high", { ...proposed, value: 400000001 }, [], null],
    ["invented closest", proposed, ["invented"], null],
  ])("rejects %s facts without inventing a rung", (_label, found, closest, expected) => {
    expect(checkedGoalLookup({ ...response, output_text: JSON.stringify({ found, closest, note: null }) }, "height", eligible).found).toBe(expected);
  });
  it.each([[1, true], [31536000, true], [31536001, false], [0, false]])("checks duration range at %s seconds", (value, accepted) => {
    const parsed = checkedGoalLookup({ ...response, output_text: JSON.stringify({ found: { ...proposed, value }, closest: [], note: null }) }, "time", []);
    expect(parsed.found !== null).toBe(accepted);
    if (parsed.found) expect(parsed.found.at).toBe(value);
  });
  it("retains only eligible closest ids and the note for a fictional target", () => {
    const parsed = checkedGoalLookup({ ...response, output_text: JSON.stringify({ found: null, closest: ["half-dome", "half-dome", "invented"], note: "Try a real mountain." }) }, "height", eligible);
    expect(parsed).toEqual({ found: null, closest: ["half-dome"], note: "Try a real mountain." });
  });
  it("drops the markdown source links web search appends to prose", () => {
    const link = " ([facts.example.test](https://facts.example.test/tower?utm_source=openai))";
    const fictional = JSON.stringify({ found: null, closest: ["half-dome"], note: `${"A made-up tower. ".repeat(13)}Try a real one.${link}` });
    expect(checkedGoalLookup({ ...response, output_text: fictional }, "height", eligible)).toEqual(
      { found: null, closest: ["half-dome"], note: `${"A made-up tower. ".repeat(13)}Try a real one.` });
    const found = JSON.stringify({ found: { ...proposed, blurb: `${proposed.blurb}${link}`, tagline: `${proposed.tagline}${link}` }, closest: [], note: null });
    expect(checkedGoalLookup({ ...response, output_text: found }, "height", eligible).found)
      .toMatchObject({ blurb: proposed.blurb, tagline: proposed.tagline, sourceUrl: proposed.sourceUrl });
  });
  it("accepts a page the search read even without an inline citation", () => {
    expect(checkedGoalLookup({ ...response, output: response.output.filter(item => item.type === "web_search_call") }, "height", eligible).found).toMatchObject({ at: 1000 });
  });
  it("matches the provider's decorated URL to the model's plain one, and nothing looser", () => {
    const decorated = { ...response, output: response.output.map(item => item.type === "web_search_call" && item.action.type === "search"
      ? { ...item, action: { ...item.action, sources: [{ type: "url" as const, url: "https://FACTS.example.test/tower/?utm_source=openai#top" }] } } : item)
      .filter(item => item.type === "web_search_call") };
    expect(checkedGoalLookup(decorated, "height", eligible).found).toMatchObject({ at: 1000 });
    const otherPage = JSON.stringify({ found: { ...proposed, sourceUrl: "https://facts.example.test/tower?page=2" }, closest: [], note: null });
    expect(checkedGoalLookup({ ...decorated, output_text: otherPage }, "height", eligible).found).toBeNull();
    const notAUrl = JSON.stringify({ found: { ...proposed, sourceUrl: "facts" }, closest: [], note: null });
    expect(checkedGoalLookup({ ...decorated, output_text: notAUrl }, "height", eligible).found).toBeNull();
  });
  it.each(["short", "tagline", "blurb"] as const)("rejects numeric or multiline provider %s", field => {
    for (const text of ["A 10 story tower", "A tower\nabove town", "A tower — above town"]) {
      expect(() => checkedGoalLookup({ ...response, output_text: JSON.stringify({ found: { ...proposed, [field]: text }, closest: [], note: null }) }, "height", eligible)).toThrow();
    }
  });
  it("binds found identity to kind, normalized name and location, value and source", () => {
    const a = foundEntry("height", proposed);
    for (const change of [{ where: "Another town" }, { value: 320 }, { sourceUrl: "https://facts.example.test/other" }, { name: "Another tower" }]) {
      expect(foundEntry("height", { ...proposed, ...change }).id).not.toBe(a.id);
    }
    expect(foundEntry("time", proposed).id).not.toBe(a.id);
    expect(foundEntry("height", { ...proposed, name: "  SYNTHETIC   TOWER ", where: "  SAMPLE TOWN  ", blurb: "A new description.", short: "The tower", tagline: "Above the rooftops" }).id).toBe(a.id);
  });
});

describe("immutable awards rendered for each reader", () => {
  it.each(["pushups", "pullups"])("keeps the same found threshold and crossing for %s in every unit system", exercise => {
    const measure = source(exercise), a = foundEntry("height", proposed);
    const threshold = exercise === "pushups" ? 1000 : 500;
    measure.amounts = [{ measureId: measure.id, date: "2026-11-14", amount: threshold - 1 }, { measureId: measure.id, date: "2026-11-15", amount: 1 }];
    const award = stored(measure).find(award => award.key === `rung:${measure.id}:${a.id}`)!;
    const b = foundEntry("height", { ...proposed, name: "Another tower", value: 600 });
    const corrected = { ...measure, amounts: [] };
    for (const units of ["us", "uk", "metric"] as const) {
      const view = measureLadder(corrected, { found: b, goal: { found: b } }, [award], units)!;
      expect(view.passed[0]).toMatchObject({ id: a.id, name: a.name, at: threshold, on: "2026-11-15", drawing: null,
        atText: units === "us" ? "1,000 ft" : "305 m", blurb: a.blurb, short: a.short, tagline: a.tagline, toGo: null });
      expect(view.next!.id).toBe(b.id);
      expect(medalView(award, true, units)).toMatchObject({ face: { generic: true }, title: a.name, earnedOn: "2026-11-15" });
      expect(momentsView([award], [], units)[0]).toMatchObject({ title: a.name, line: a.blurb });
    }
    expect(award.data).not.toHaveProperty("title"); expect(award.data).not.toHaveProperty("face");
  });
  it("renders one permanent mile medal as kilometres without minting another award", () => {
    const measure = source("walk", "meters");
    measure.amounts = [{ measureId: measure.id, date: "2026-11-14", amount: 1609.344 }];
    const awards = stored(measure), [award] = awards;
    expect(awards).toHaveLength(1);
    expect(medalView(award, true, "us")).toMatchObject({ title: "1 mi", face: { number: "1 mi" } });
    expect(medalView(award, true, "metric")).toMatchObject({ id: award.id, title: "1.6 km", face: { number: "1.6 km" }, earnedOn: "2026-11-14" });
    expect(stored(measure)).toEqual(awards);
  });
  it("resolves duplicate bank ids by kind", () => {
    for (const kind of ["time", "height"] as const) {
      const definition = { at: 100, target: { kind, id: "concorde" } };
      expect(rungEntry(definition).kind).toBe(kind);
      expect(rungFor(definition, 0, "2026-11-14", "us").atText).toMatch(kind === "time" ? /hr/u : /ft/u);
    }
    expect(rungEntry({ at: 100, target: { kind: "time", id: "marathon" } }).kind).toBe("time");
  });
});
