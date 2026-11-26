import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserVaultMetricRow } from "@murphai/query/browser-replica-client";
import type { ExperimentOutcome } from "@murphai/contracts";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({
  session: vi.fn(), authority: vi.fn(), games: vi.fn(),
  states: vi.fn(), artRows: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ gamePlaceArt: { findMany: mock.artRows } }) }));
vi.mock("../src/lib/game/progress/state", () => ({ readMeasureStates: mock.states }));
vi.mock("../src/lib/device-sync/companion-numbers", () => ({
  COMPANION_HEALTH_METRICS: { sleep: { key: "total-sleep-minutes" }, restingHeartRate: { key: "resting-heart-rate" },
    steps: { key: "steps" }, vo2Max: { key: "estimated-vo2-max" } },
  loadPublishedCompanionMetricReplica: mock.session,
}));
vi.mock("../src/lib/health-wins/game-inputs", () => ({ readHealthWinGameInputs: mock.games }));
import { readHealthWinInputs } from "../src/lib/health-wins/inputs";
import { retainedDailySamples } from "../src/lib/health-wins/wearable-inputs";
import { readHealthWinExperiments } from "../src/lib/health-wins/experiment-inputs";
import { generateHealthWins } from "../src/lib/health-wins/engine";
import { mapKey } from "../src/lib/game/progress/place-art-make";
import { artPath } from "../src/lib/game/progress/place-art";

const today = "2026-09-24";
const signal = new AbortController().signal;
const memberId = "m-unit";

function hr(date: string, sourceLabel: string, value: number, method = ""): BrowserVaultMetricRow {
  return { date, sourceLabel, value, biomarkerKey: null, metricKey: "resting-heart-rate", unit: "bpm", sourceFamily: "event",
    sourceKind: "observation", comparator: null, confidence: "high", context: { measurementMethodKey: method },
    grain: "day", id: "metric", observedAt: date + "T12:00:00Z", pointIds: [], recordIds: [],
    rowSchema: "murph.browser-vault.metric-row.v1", statistic: "value", valueLabel: null };
}

function outcome(id: string, modality: string | null): ExperimentOutcome {
  return {
    schemaVersion: "murph.experiment-outcome.v1", asOf: today,
    adherenceSummary: { completedSessions: 2, targetSessions: 8, minimumUsefulSessions: 4, status: "behind" },
    conclusion: { headline: "Private summary", plainLanguage: "Private summary", caveats: [] },
    confidence: { level: "low", reasons: [] }, confounders: [],
    experiment: { id, slug: "custom-slug", title: "Custom intervention", status: "completed" },
    commonsProtocolRef: null, effectiveProtocolSnapshot: modality === null ? null : { modality, doseSignature: "", effectiveSpecHash: "" },
    windows: { baselineStart: "2026-07-01", baselineEnd: "2026-07-04",
      interventionStart: "2026-07-05", interventionEnd: "2026-07-12" },
    metricResults: [{ baselineMean: 62, interventionMean: 60, baselineDayCount: 4, interventionDayCount: 6,
      unit: "bpm", label: "Resting heart rate", deltaAbs: -2, deltaPct: null, expectedDirection: "decrease",
      movedAsExpected: true, completeness: "partial", biomarkerKey: "biomarker:resting-heart-rate" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.games.mockResolvedValue({ games: [], sourceRevision: "game-state", complete: true });
  mock.authority.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("selects a single source and method before daily collapse, ignoring unusable readings", () => {
  const rows = [
    hr("2026-09-13", "Oura", 48), hr("2026-09-12", "WHOOP", 61, "method-1"),
    hr("2026-09-12", "WHOOP", 66, "method-2"), hr("2026-09-14", "WHOOP", 59, "method-1"),
    hr("2026-09-15", "WHOOP", 300, "method-2"),
  ];
  expect(retainedDailySamples("rhr_bpm", rows).map(({ date, value }) => [date, value])).toEqual([
    ["2026-09-12", 61], ["2026-09-14", 59],
  ]);
});

it("skips a preferred source whose only retained day has conflicting measurements", () => {
  const rows = [hr(today, "WHOOP", 57), hr(today, "WHOOP", 61), hr(today, "Oura", 59)];
  expect(retainedDailySamples("rhr_bpm", rows)).toEqual([{ metric: "rhr_bpm", date: today, provider: "oura", value: 59 }]);
});

it("excludes workout rollups that may include cycling from on-foot distance", () => {
  const apple = { ...hr(today, "Apple Health", 2.7), metricKey: "distance-km", unit: "km" };
  const workout = { ...apple, date: "2026-09-10", context: { sourceKind: "activity-session-day-rollup" } };
  expect(retainedDailySamples("distance_km", [apple, workout])).toEqual([
    { metric: "distance_km", date: today, provider: "apple", value: 2.7 },
  ]);
});

it("adapts canonical means, overlap windows and adherence, withholding private concurrent interventions", () => {
  const first = outcome("exp_first", "Walking");
  const second = outcome("exp_second", "Sauna");
  const result = readHealthWinExperiments([first, second], [], today);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ title: "Walking", baselineMean: 62, interventionMean: 60,
    adherence: { done: 2, target: 8 }, intervention: { start: "2026-07-05", end: "2026-07-12" } });
  expect(JSON.stringify(result)).not.toContain("custom-slug");
  expect(readHealthWinExperiments([first, outcome("exp_unknown", "Unclassified")], [], today)).toEqual([]);
  expect(readHealthWinExperiments([{ ...first, metricResults: [{ ...first.metricResults[0]!, statistic: "sum" }] }], [], today)).toEqual([]);
});

it.each([
  ["tabata_interval_training", ["Tabata intervals"]],
  ["personal circuit notes", []],
] as const)("uses only an allowed custom run plan modality for a win (%s)", async (modality, titles) => {
  const trial = outcome("exp_circuit", null);
  const { interventionStart, interventionEnd } = trial.windows;
  mock.session.mockResolvedValue({ state: "ready", client: {
    replica: { source: { dataVersion: "custom-plan" }, meals: { timeZone: "UTC" }, experimentOutcomes: [trial] },
    entities: { list: () => [{ id: trial.experiment.id, status: "completed",
      attributes: { runPlan: { modality, interventionStart, interventionEnd } } }] },
    metrics: { series: () => [] }, labResults: { list: () => [] },
  } });
  const { input } = await readHealthWinInputs(memberId, mock.authority, today, signal);
  const cards = generateHealthWins(input).filter(card => card.kind === "experiment_result");
  expect(cards.map(card => card.title.number)).toEqual(titles);
});

it("uses canonical experiment aliases and percentage units for sleep efficiency", () => {
  const trial = outcome("exp_evening", "Meditation");
  const metric = { ...trial.metricResults[0]!, biomarkerKey: "biomarker:sleep-efficiency-percent",
    unit: "%", baselineMean: 88, interventionMean: 91 };
  const [read] = readHealthWinExperiments([{ ...trial, metricResults: [metric] }], [], today);
  expect(read).toMatchObject({ metric: "sleep_efficiency", baselineMean: 88, interventionMean: 91 });
  const daily = { ...hr(today, "Oura", 87), metricKey: "sleep-efficiency", unit: "percent" };
  expect(retainedDailySamples("sleep_efficiency", [daily])).toEqual([
    { metric: "sleep_efficiency", provider: "oura", date: today, value: 87 },
  ]);
});

it("builds each experiment card from its own recorded metric and comparison", () => {
  const trial = outcome("exp_sleep", "Meditation");
  const heart = trial.metricResults[0]!;
  const efficiency: ExperimentOutcome["metricResults"][number] = {
    ...heart, biomarkerKey: "biomarker:sleep-efficiency-percent", label: "Sleep efficiency",
    unit: "%", baselineMean: 86, interventionMean: 90, expectedDirection: "increase", deltaAbs: 4,
  };
  const experiments = readHealthWinExperiments([{ ...trial, metricResults: [efficiency, heart] }], [], today);
  const cards = generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null }, experiments });
  expect(cards).toHaveLength(2);
  expect(cards).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "experiment_result", subtitle: expect.stringContaining("Sleep efficiency"),
      chart: expect.objectContaining({ metric: "sleep_efficiency", unit: "%", expectedDirection: "increase",
        series: [expect.objectContaining({ mean: 86 }), expect.objectContaining({ mean: 90 })] }) }),
    expect.objectContaining({ kind: "experiment_result",
      chart: expect.objectContaining({ metric: "rhr_bpm", unit: "bpm", expectedDirection: "decrease",
        series: [expect.objectContaining({ mean: 62 }), expect.objectContaining({ mean: 60 })] }) }),
  ]));
});

it("ranks a covered RHR month when its selected provider has no readings in the latest fortnight", async () => {
  const monthEnd = "2026-09-30";
  const rows = Array.from({ length: 14 }, (_, index) => hr(`2026-09-${String(index + 1).padStart(2, "0")}`, "WHOOP", 52));
  mock.session.mockResolvedValue({ state: "ready", client: {
    replica: { source: { dataVersion: "month-revision" }, meals: { timeZone: "UTC" },
      demographics: { birthYear: 1982, biologicalSex: "female" }, experimentOutcomes: [] },
    metrics: { series: ({ metricKey }: { metricKey: string }) => metricKey === "resting-heart-rate" ? rows : [] },
    entities: { list: () => [] }, labResults: { list: () => [] },
  } });
  const { input } = await readHealthWinInputs(memberId, mock.authority, monthEnd, signal);
  expect(generateHealthWins(input)).toContainEqual(expect.objectContaining({
    kind: "percentile", filter: "Heart", source_note: expect.stringContaining("14 recorded days this month"),
    chart: expect.objectContaining({ value: 52 }),
  }));
});

it("loads one union, retains independent inputs when labs fail and checks authority after decryption", async () => {
  const metric = { series: vi.fn(({ metricKey }) => metricKey === "resting-heart-rate" ? [hr(today, "WHOOP", 60)] : []) };
  mock.session.mockResolvedValue({ state: "ready", client: { replica: {
    source: { dataVersion: "revision-a" }, meals: { timeZone: "UTC" }, experimentOutcomes: [outcome("exp_walk", "Walking")],
    activitySessions: [{ type: "run", date: today, minutes: 17 }],
  }, metrics: metric, entities: { list: () => [] }, labResults: { list() { throw Error("lab read failed"); } } } });
  const { input, complete } = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(mock.session).toHaveBeenCalledExactlyOnceWith({ memberId: "m-unit", signal, metricKeys: expect.arrayContaining([
    "estimated-vo2-max", "resting-heart-rate", "deep-sleep-minutes", "floors-climbed", "sleep-efficiency",
  ]), requestedShards: ["core", "metricsIndex", "labs"], timeoutMs: expect.any(Number) });
  expect(mock.games).toHaveBeenCalledOnce();
  expect(complete).toBe(false);
  expect(input.daily).toHaveLength(1);
  expect(input.member.wearableProvider).toBe("whoop");
  expect(input.experiments).toHaveLength(1);
  expect(input.sessions).toHaveLength(1);
  expect(mock.authority).toHaveBeenCalledTimes(2);
});

it("propagates withdrawal even when the shared ciphertext load fails", async () => {
  mock.session.mockRejectedValueOnce(Error("transport failed"));
  const denied = hostedOnboardingError({ code: "CONSENT_REQUIRED", message: "Consent required", httpStatus: 403 });
  mock.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
  await expect(readHealthWinInputs(memberId, mock.authority, today, signal)).rejects.toBe(denied);
});

it("distinguishes an empty vault from a published replica that failed to open", async () => {
  mock.session.mockResolvedValueOnce({ state: "unpublished" }).mockResolvedValueOnce({ state: "not_ready" });
  const empty = await readHealthWinInputs(memberId, mock.authority, today, signal);
  const partial = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(empty.complete).toBe(true);
  expect(partial.complete).toBe(false);
  expect(empty.sourceRevision).not.toBe(partial.sourceRevision);
});

it("reads meal days only when generating Diet wins and keys the source revision to that choice", async () => {
  const days = vi.fn(() => [{ date: today, meals: [{ proteinGrams: 17.25, fiberGrams: 3 }] }]);
  mock.session.mockResolvedValue({ state: "ready", client: {
    replica: { source: { dataVersion: "meal-fixture" }, meals: { timeZone: "UTC", get days() { return days(); } },
      experimentOutcomes: [] },
    entities: { list: () => [] }, metrics: { series: () => [] }, labResults: { list: () => [] },
  } });
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_DIET_MEMBER_IDS", "");
  const off = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(off.input.meals).toBeUndefined();
  expect(days).not.toHaveBeenCalled();
  vi.stubEnv("MURPH_HEALTH_DIET_MEMBER_IDS", memberId);
  const on = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(on.input.meals).toEqual([{ date: today, proteinG: 17.25, fiberG: 3 }]);
  expect(days).toHaveBeenCalledOnce();
  expect(on.sourceRevision).not.toBe(off.sourceRevision);
});

it("keeps canonical outcomes when a legacy replica lacks a lab shard or health time zone", async () => {
  mock.session.mockResolvedValueOnce({ state: "ready", client: { replica: {
    source: { dataVersion: "legacy" }, experimentOutcomes: [outcome("exp_walk", "Walking")],
  }, metrics: { series: vi.fn() }, entities: { list: () => [] } } });
  const { complete, input } = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(complete).toBe(false);
  expect(input.experiments).toHaveLength(1);
  expect(input.daily).toEqual([]);
  expect(input.labs).toEqual([]);
});

it("includes the author's ready regional card painting in the source revision", async () => {
  const distance = { ...hr(today, "Apple Health", 3), metricKey: "distance-km", unit: "km" };
  mock.session.mockResolvedValue({ state: "ready", client: { replica: {
    source: { dataVersion: "art-revision" }, meals: { timeZone: "UTC" }, experimentOutcomes: [],
  }, metrics: { series: ({ metricKey }: { metricKey: string }) => metricKey === "distance-km" ? [distance] : [] },
  entities: { list: () => [] }, labResults: { list: () => [] } } });
  const leg = { distanceM: 82_000, straightLine: false, polyline: "fixture-region" };
  const key = mapKey(leg.polyline, "card");
  mock.states.mockResolvedValue(new Map([
    ["steps", { legs: [{ ...leg, polyline: "fixture-street", distanceM: 600 }] }],
    ["walk.meters", { legs: [leg] }],
  ]));
  mock.artRows.mockResolvedValueOnce([{ key, status: "making", startedAt: new Date() }])
    .mockResolvedValueOnce([{ key, status: "ready" }]);
  const waiting = await readHealthWinInputs(memberId, mock.authority, today, signal);
  const ready = await readHealthWinInputs(memberId, mock.authority, today, signal);
  expect(mock.states).toHaveBeenCalledWith(memberId, expect.arrayContaining(["steps", "walk.meters"]), signal);
  expect(mock.artRows).toHaveBeenCalledWith(expect.objectContaining({ where: { key: { in: [key] } } }));
  expect(waiting.distanceArtUrl).toBeNull();
  expect(ready.distanceArtUrl).toBe(artPath(key));
  expect(ready.sourceRevision).not.toBe(waiting.sourceRevision);
});
