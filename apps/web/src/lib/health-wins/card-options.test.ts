import { afterEach, expect, it, vi } from "vitest";
import type { CardSpec } from "./engine";
import { prepareHealthCandidates, previewHealthCandidate, freezeHealthSelections } from "./card-options";
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
