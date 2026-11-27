import { afterEach, expect, it, vi } from "vitest";
import type { CardSpec } from "./engine";
import {
  freezeHealthSelections, healthCandidateDisplay, prepareHealthCandidates, prepareSeeYoursCandidate,
  previewHealthCandidate, previewRecordedCandidate, resolveRecordedSelection, specDigest, withDistanceTrendUnits,
} from "./card-options";
import { rankHealthCards } from "./decisions";

const post = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { post = post; } }));

const record: CardSpec = {
  id: "fixture-private-id", kind: "personal_record", filter: "Sleep", theme: "sleep",
  title: { number: "2h 33m", measure: "deep sleep" }, subtitle: "A personal best.",
  source_note: "Fixture measurement on a private date.", share: { caption_tips: ["Measured for 153 min."] },
  chart: { type: "record", unit: "min", series: [{ date: "2031-04-07", value: 153 }],
    highlight: { date: "2031-04-07", value: 153, label: "Apr 7, 2031" }, pills: ["Apr 7, 2031"] },
};
const challenge: CardSpec = { ...record, id: "second-fixture", filter: "Challenges", theme: "challenges" };
afterEach(() => { post.mockReset(); vi.unstubAllEnvs(); });

it("converts a duration's title, chart and highlight together and freezes the preview revision", () => {
  const [candidate] = prepareHealthCandidates("member-fixture", [record]);
  const preview = previewHealthCandidate(candidate, "hours");
  const [saved] = freezeHealthSelections([candidate], [{ candidateId: candidate.id, option: "hours" }]);
  expect(preview.title.number).toBe("2.6 hr");
  expect(saved.specRevision).toBe(preview.specRevision);
  expect(saved.spec.chart).toEqual({ type: "record", unit: "hr", series: [{ date: "2031-04-07", value: 2.55 }],
    highlight: { date: "2031-04-07", value: 2.55, label: "Apr 7, 2031" }, pills: ["Apr 7, 2031"] });
  expect(previewHealthCandidate(candidate).chart).toEqual(record.chart);
});

it("subtracts the displayed tenths of an hour for trend titles and keeps the measured chart values", () => {
  const trend: CardSpec = { ...record, kind: "trend_change", title: { number: "+40 min", measure: "sleep" },
    chart: { type: "trend", unit: "min", baseline: 375.12, delta: 39.42,
      series: [{ month: "2031-03", value: 375.12, days: 22 }, { month: "2031-04", value: 414.54, days: 18 }],
      pills: ["Usual 6h 15m", "Apr 6h 55m"] } };
  const [candidate] = prepareHealthCandidates("member-fixture", [trend]);
  const converted = previewHealthCandidate(candidate, "hours");
  expect(converted.title.number).toBe("+0.6 hr");
  expect(converted.chart).toMatchObject({ unit: "hr", baseline: 375.12 / 60, delta: 39.42 / 60,
    series: [{ value: 375.12 / 60 }, { value: 414.54 / 60 }], pills: ["Usual 6.3 hr", "Apr 6.9 hr"] });
  expect(previewHealthCandidate(candidate).chart).toEqual(trend.chart);
});

it("rounds the best month's hours headline to the nearest tenth", () => {
  const best: CardSpec = { ...record, kind: "best_month", chart: { type: "monthly_bars", unit: "min",
    highlight: "2031-04", series: [{ month: "2031-04", value: 105.8, days: 23 }] } };
  const [candidate] = prepareHealthCandidates("member-fixture", [best]);
  expect(previewHealthCandidate(candidate, "hours")).toMatchObject({
    title: { number: "1.8 hr" }, chart: { unit: "hr", series: [{ value: 105.8 / 60 }] },
  });
});

it("removes every value-bearing field, including the engine id, raw arrays, source notes and tips", () => {
  const [candidate] = prepareHealthCandidates("member-fixture", [record]);
  const hidden = previewHealthCandidate(candidate, "hide_numbers");
  expect(hidden.id).not.toContain(record.id);
  expect(hidden).toMatchObject({ title: { number: "", measure: "Sleep milestone" }, subtitle: "Shared without numbers.",
    source_note: "", chart: { type: "hidden" } });
  const { id, specRevision, ...display } = hidden;
  expect(id).not.toBe(record.id);
  expect(specRevision).not.toBe(previewHealthCandidate(candidate).specRevision);
  expect(JSON.stringify(display)).not.toMatch(/153|2031|private date|fixture-private/u);
});

it("asks how a recording went when its card carries no caption tips of its own", () => {
  const tips = (kind: string, option?: string) => {
    const [candidate] = prepareHealthCandidates("member-fixture", [{ ...record, kind, share: { caption_tips: [] } } as CardSpec]);
    return previewHealthCandidate(candidate, option).caption_tips;
  };
  expect(tips("activity_time")).toEqual(["How did it feel?"]);
  expect(tips("activity_heart_rate", "hide_numbers")).toEqual(["How did it feel?"]);
  expect(tips("activity_route")).toEqual(["How did it feel?", "Where did you go?"]);
  expect(tips("activity_splits")).toEqual(["How did it feel?", "Where did you go?"]);
  expect(tips("personal_record")).toEqual(["What helped you get here?", "How did it feel?"]);
  const [own] = prepareHealthCandidates("member-fixture", [record]);
  expect(previewHealthCandidate(own).caption_tips).toEqual(["Measured for 153 min."]);
});

it("binds each See yours revision to the member's displayed spec, including hours", () => {
  const measured: CardSpec = { ...record, measure: "sleep_deep_min" };
  const [set] = prepareHealthCandidates("fixture-owner", [measured]);
  const make = (memberId: string) => prepareSeeYoursCandidate(memberId, measured, "metric");
  const candidate = make("fixture-owner");
  const preview = previewRecordedCandidate(candidate);
  expect(preview).toMatchObject({ id: set.id, candidateId: "mine:sleep_deep_min:personal_record" });
  expect(candidate).toEqual(make("fixture-owner"));
  expect(make("other-fixture-owner").variants[0].specRevision).not.toBe(preview.specRevision);
  expect(candidate.variants.map(v => v.option)).toEqual(["original", "hours", "hide_numbers"]);
  for (const variant of candidate.variants) {
    expect(variant.specRevision).toBe(specDigest(variant.spec));
    expect(variant.spec?.id).toBe(set.id);
    const selection = { candidateId: candidate.id, option: variant.option, specRevision: variant.specRevision };
    const frozen = resolveRecordedSelection([make("fixture-owner")], selection);
    expect(frozen).toEqual({ id: set.id, specRevision: variant.specRevision, spec: variant.spec });
    expect(JSON.stringify(frozen)).not.toContain("mine:");
  }
  expect(preview.change_options).toContainEqual(expect.objectContaining({
    id: "hours", spec: expect.objectContaining({ measure: measured.measure, chart: expect.objectContaining({ unit: "hr" }) }),
  }));
});

it("keeps the hidden milestone generic and strips the percentile measure and method", () => {
  const heart: CardSpec = {
    ...record, kind: "percentile", filter: "Heart", theme: "heart", measure: "rhr_bpm",
    chart: { type: "percentile", value: 54, unit: "bpm", group: "fixture group", topPercent: 12,
      lowerIsBetter: true, cuts: [], referenceKey: "oura_sleeping_hr" },
  };
  const candidate = prepareSeeYoursCandidate("fixture-owner", heart, "us");
  const safe = previewHealthCandidate(candidate, "hide_numbers");
  expect(safe).toMatchObject({ title: { number: "", measure: "Heart health milestone" }, chart: { type: "hidden" } });
  expect(safe).not.toHaveProperty("measure");
  expect(JSON.stringify(safe)).not.toMatch(/rhr_bpm|oura_sleeping_hr|fixture-private-id|fixture group/);
});

it.each(["insulin", "glucose", "a1c"] as const)("omits %s and the draw date from the complete hidden lab envelope", measure => {
  const lab: CardSpec = {
    ...record, id: `percentile-${measure}-20320518`, kind: "percentile", filter: "Labs", theme: "labs", measure,
    title: { number: "Top 20%", measure }, source_note: "Fixture reading on 2032-05-18.",
    chart: { type: "percentile", value: 5, unit: "fixture unit", group: "fixture group", topPercent: 20,
      lowerIsBetter: true, cuts: [], referenceKey: "nhanes_labs" },
  };
  const candidate = prepareSeeYoursCandidate("fixture-owner", lab, "us");
  const option = previewHealthCandidate(candidate, "hide_numbers");
  const frozen = resolveRecordedSelection([candidate], { candidateId: candidate.id, option: "hide_numbers", specRevision: option.specRevision });
  expect(frozen).toMatchObject({ id: option.id, spec: { id: option.id, title: { measure: "Lab milestone" }, chart: { type: "hidden" } } });
  expect(frozen?.spec).not.toHaveProperty("measure");
  const json = JSON.stringify(frozen);
  expect(json).not.toContain(JSON.stringify(measure));
  expect(json).not.toContain(lab.id);
  expect(json).not.toMatch(/mine:|20320518|2032-05-18|nhanes_labs|fixture unit/);
});

it("uses the matching set display and opaque identity for distance trends in both unit systems", () => {
  const distance: CardSpec = {
    ...record, kind: "trend_change", measure: "distance_km", filter: "Fitness", theme: "fitness",
    chart: { type: "trend", unit: "km", baseline: 3, delta: 2, pills: [],
      series: [{ month: "2031-03", value: 3, days: 20 }, { month: "2031-04", value: 5, days: 16 }] },
  };
  const [set] = prepareHealthCandidates("fixture-owner", [distance]);
  expect(set.miles?.id).toBeTruthy();
  expect(set.miles?.id).not.toBe(set.id);
  const legacy = withDistanceTrendUnits({ id: set.id, variants: set.variants });
  expect(legacy.miles?.id).toBe(set.miles?.id);
  expect(previewHealthCandidate(healthCandidateDisplay(legacy, "us")).title.number).toBe("+1.2 mi");
  expect(withDistanceTrendUnits(legacy)).toBe(legacy);
  expect(previewHealthCandidate(healthCandidateDisplay(set, "us")).title.number).toBe("+1.25 mi");
  for (const units of ["metric", "us", "uk"] as const) {
    const candidate = prepareSeeYoursCandidate("fixture-owner", distance, units);
    const expected = units === "metric" ? set : set.miles!;
    expect(candidate.id).toBe("mine:distance_km:trend_change");
    expect(candidate.variants.map(v => v.spec)).toEqual(expected.variants.map(v => v.spec));
    expect(candidate.variants[0].spec).toMatchObject({ id: expected.id, chart: { unit: units === "metric" ? "km" : "mi" } });
    expect(candidate.variants.map(v => v.specRevision)).toEqual(expected.variants.map(v => specDigest(v.spec)));
  }
});

it("uses one bounded Decisions call with fixed choices and orders only the supplied cards", async () => {
  vi.stubEnv("MURPH_HEALTH_WINS_RANKING", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
  post.mockResolvedValueOnce({ answers: [
    { type: "choice", name: "lead", probabilities: [{ value: "c1", probability: 0.9 }, { value: "c0", probability: 0.1 }] },
    { type: "predicate", name: "c1", probability: 0.8 }, { type: "predicate", name: "c0", probability: 0.9 },
  ] });
  const options = [record, challenge].map(card => ({ card, eventDate: "2032-05-17" }));
  const signal = new AbortController().signal;
  expect(await rankHealthCards(options, signal)).toEqual([challenge, record]);
  expect(post).toHaveBeenCalledExactlyOnceWith("/decisions", expect.objectContaining({ timeout: 3000, maxRetries: 0, signal: expect.any(AbortSignal) }));
  const request = JSON.stringify(post.mock.calls[0][1].body);
  expect(request).toContain("personal_record");
  expect(request).not.toMatch(/fixture-private|153|2031|2032|deep sleep/u);
  post.mockResolvedValueOnce({ answers: [{ type: "choice", name: "lead", probabilities: [] }] });
  expect(await rankHealthCards(options, signal)).toEqual([record, challenge]);
  post.mockRejectedValueOnce(new Error("fixture timeout"));
  expect(await rankHealthCards(options, signal)).toEqual([record, challenge]);
});

it("sorts the whole catalog by date after Decisions and uses its order for same-day ties", async () => {
  vi.stubEnv("MURPH_HEALTH_WINS_RANKING", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
  const catalog = Array.from({ length: 24 }, (_, index) => ({ ...record, id: `sample-${index}` }));
  // These two recent cards start on opposite sides of the balanced first twelve.
  const selected = catalog.map((card, index) => ({
    card, eventDate: index === 0 || index === 12 ? "2032-06-16" : "2032-06-09",
  }));
  const probabilities = catalog.map((_, index) => ({ value: `c${index}`, probability: (index + 1) / 300 }));
  post.mockResolvedValueOnce({ answers: [
    { type: "choice", name: "lead", probabilities },
    ...probabilities.map(({ value }) => ({ type: "predicate", name: value, probability: 1 })),
  ] });
  expect(await rankHealthCards(selected, new AbortController().signal)).toEqual([
    catalog[0], catalog[12], ...catalog.slice(1, 12).reverse(), ...catalog.slice(13).reverse(),
  ]);
});
