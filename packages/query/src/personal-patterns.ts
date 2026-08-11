import {
  isValidIanaTimeZone,
  normalizeActivityKindToken,
} from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";
import {
  resolveAdherenceObservationActivityKind,
  resolveActivityEvidenceLocalDate,
  resolveInterventionSessionLocalDate,
} from "./experiment-adherence.ts";
import {
  selectMetricSeries,
  type MetricPoint,
} from "./metrics/index.ts";
import type { VaultReadModel } from "./read-model.ts";
import { buildWearableSummaryBundle } from "./wearables.ts";
import type {
  WearableResolvedMetric,
  WearableSummaryBundle,
} from "./wearables.ts";
import {
  isWearableSleepPatternEligibleNight,
  resolveWearableSleepAnalysisDate,
} from "./wearables/sleep-pattern.ts";

const DEFAULT_WINDOW_DAYS = 120;
const MAX_FACTORS = 6;
const MIN_MATCHED_DAYS = 5;
const MIN_WINDOW_DAYS = 21;
const COMPARISON_SEARCH_DAYS = 35;
const OUTCOME_LIKE_FACTOR_TOKENS = new Set([
  "heart-rate-variability",
  "hrv",
  "readiness",
  "readiness-score",
  "recovery",
  "recovery-score",
  "resting-heart-rate",
  "rhr",
  "sleep",
  "sleep-efficiency",
  "sleep-score",
  "total-sleep",
]);

export type PersonalPatternStage =
  | "insufficient"
  | "no_clear_pattern"
  | "new_clue"
  | "seen_again"
  | "worth_testing";

export interface PersonalPatternFactor {
  id: string;
  kind: "activity" | "intervention" | "mixed";
  label: string;
  observedDays: number;
}

export interface PersonalPatternOutcome {
  id: string;
  label: string;
  unit: string;
}

export interface PersonalPatternCell {
  comparisonDays: number;
  comparisonMean: number | null;
  delta: number | null;
  deltaPercent: number | null;
  direction: "higher" | "lower" | "flat";
  exposedDays: number;
  exposedMean: number | null;
  factorId: string;
  firstExposedDate: string | null;
  lastExposedDate: string | null;
  outcomeId: string;
  repeatedDirection: boolean;
  stage: PersonalPatternStage;
}

export interface PersonalPatternReport {
  asOfDate: string;
  cells: PersonalPatternCell[];
  factors: PersonalPatternFactor[];
  lagDays: 1;
  notes: string[];
  outcomes: PersonalPatternOutcome[];
  repeatableCellCount: number;
  testedCellCount: number;
  windowDays: number;
}

interface FactorAccumulator {
  dates: Set<string>;
  kinds: Set<"activity" | "intervention">;
  token: string;
}

interface OutcomeSeries extends PersonalPatternOutcome {
  values: Map<string, number>;
  meaningfulAbsoluteDelta: number;
  meaningfulRelativeDelta: number;
}

interface MatchedPair {
  comparisonDate: string;
  comparisonValue: number;
  exposedDate: string;
  exposedValue: number;
}

interface PatternWindow {
  fromDate: string;
  outcomeToDate: string;
}

export function buildPersonalPatternReport(
  vault: VaultReadModel,
  options: { asOf?: Date | string; windowDays?: number } = {},
): PersonalPatternReport {
  return buildPersonalPatternReportFromWearableBundle(
    vault,
    buildWearableSummaryBundle(vault),
    options,
  );
}

export function buildPersonalPatternReportFromWearableBundle(
  vault: VaultReadModel,
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  options: { asOf?: Date | string; windowDays?: number } = {},
): PersonalPatternReport {
  return buildPersonalPatternReportFromOutcomeSeries(
    vault,
    collectOutcomeSeries(
      wearableBundle,
      resolveWindow(options),
      readVaultTimeZone(vault),
    ),
    options,
  );
}

export function buildPersonalPatternReportFromWearableBundleAndMetricPoints(
  vault: VaultReadModel,
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  metricPoints: readonly MetricPoint[],
  options: { asOf?: Date | string; windowDays?: number } = {},
): PersonalPatternReport {
  const window = resolveWindow(options);
  const wearableOutcomes = collectOutcomeSeries(
    wearableBundle,
    window,
    readVaultTimeZone(vault),
  );
  const wearableOutcomeIds = new Set(wearableOutcomes.map((outcome) => outcome.id));
  const fallbackOutcomes = collectMetricPointRecoveryOutcomeSeries(metricPoints, window)
    .filter((outcome) => !wearableOutcomeIds.has(outcome.id));

  return buildPersonalPatternReportFromOutcomeSeries(
    vault,
    [...wearableOutcomes, ...fallbackOutcomes],
    options,
  );
}

function buildPersonalPatternReportFromOutcomeSeries(
  vault: VaultReadModel,
  outcomes: readonly OutcomeSeries[],
  options: { asOf?: Date | string; windowDays?: number },
): PersonalPatternReport {
  const asOfDate = resolveAsOfDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  const fromDate = addDays(asOfDate, -(windowDays - 1));
  const factorAccumulators = collectFactorAccumulators(vault.events, fromDate, asOfDate);
  const candidateFactors = collectFactors(factorAccumulators)
    .filter((factor) => factor.observedDays >= MIN_MATCHED_DAYS);
  const factorDatesById = new Map(
    [...factorAccumulators.values()].map((factor) => [factor.token, factor.dates] as const),
  );
  const candidateCells = candidateFactors.flatMap((factor) =>
    outcomes.map((outcome) => buildPatternCell(
      factor,
      factorDatesById.get(factor.id) ?? new Set<string>(),
      outcome,
    ))
  );
  const eligibleFactorIds = new Set(
    candidateCells
      .filter((cell) => cell.stage !== "insufficient")
      .map((cell) => cell.factorId),
  );
  const factors = candidateFactors
    .filter((factor) => eligibleFactorIds.has(factor.id))
    .sort((left, right) =>
      right.observedDays - left.observedDays || left.label.localeCompare(right.label)
    )
    .slice(0, MAX_FACTORS);
  const visibleFactorIds = new Set(factors.map((factor) => factor.id));
  const selectedCells = candidateCells.filter((cell) => visibleFactorIds.has(cell.factorId));
  const testedCells = selectedCells.filter((cell) => cell.stage !== "insufficient");
  const visibleOutcomeIds = new Set(testedCells.map((cell) => cell.outcomeId));

  return {
    asOfDate,
    cells: selectedCells.filter((cell) =>
      visibleFactorIds.has(cell.factorId) && visibleOutcomeIds.has(cell.outcomeId)
    ),
    factors,
    lagDays: 1,
    notes: [
      "Each cell compares an action day with the next day's outcome.",
      "Comparison days use the same weekday when a nearby match is available.",
      "A repeated link is still an association, not proof that the action caused the change.",
    ],
    outcomes: outcomes
      .filter((outcome) => visibleOutcomeIds.has(outcome.id))
      .map(({ values: _values, meaningfulAbsoluteDelta: _absolute, meaningfulRelativeDelta: _relative, ...outcome }) => outcome),
    repeatableCellCount: testedCells.filter((cell) =>
      cell.stage === "new_clue" || cell.stage === "seen_again" || cell.stage === "worth_testing"
    ).length,
    testedCellCount: testedCells.length,
    windowDays,
  };
}

export function emptyPersonalPatternReport(asOfDate: string): PersonalPatternReport {
  return {
    asOfDate,
    cells: [],
    factors: [],
    lagDays: 1,
    notes: [],
    outcomes: [],
    repeatableCellCount: 0,
    testedCellCount: 0,
    windowDays: DEFAULT_WINDOW_DAYS,
  };
}

function collectFactors(
  accumulators: ReadonlyMap<string, FactorAccumulator>,
): PersonalPatternFactor[] {
  return [...accumulators.values()].map((factor) => ({
    id: factor.token,
    kind: factor.kinds.size === 2
      ? "mixed"
      : factor.kinds.has("activity") ? "activity" : "intervention",
    label: humanizeToken(factor.token),
    observedDays: factor.dates.size,
  }));
}

function collectFactorAccumulators(
  events: readonly CanonicalEntity[],
  fromDate: string,
  toDate: string,
): Map<string, FactorAccumulator> {
  const factors = new Map<string, FactorAccumulator>();

  for (const event of events) {
    const candidate = readFactorCandidate(event);
    if (!candidate) continue;
    const date = candidate.kind === "intervention"
      ? resolveInterventionSessionLocalDate(event)
      : resolveActivityEvidenceLocalDate(event);
    if (!date || date < fromDate || date > toDate) continue;

    const existing = factors.get(candidate.token);
    if (existing) {
      existing.dates.add(date);
      existing.kinds.add(candidate.kind);
      continue;
    }

    factors.set(candidate.token, {
      dates: new Set([date]),
      kinds: new Set([candidate.kind]),
      token: candidate.token,
    });
  }

  return factors;
}

function readFactorCandidate(
  event: CanonicalEntity,
): { kind: "activity" | "intervention"; token: string } | null {
  if (event.kind === "activity_session") {
    const token = canonicalFactorToken(resolveAdherenceObservationActivityKind({
      attributes: event.attributes,
    }));
    return token && !OUTCOME_LIKE_FACTOR_TOKENS.has(token)
      ? { kind: "activity", token }
      : null;
  }

  if (event.kind === "intervention_session") {
    const status = readString(event.attributes.sessionStatus);
    if (status === "missed" || status === "skipped") return null;
    const token = canonicalFactorToken(
      normalizeActivityKindToken(readString(event.attributes.interventionType)),
    );
    return token && !OUTCOME_LIKE_FACTOR_TOKENS.has(token)
      ? { kind: "intervention", token }
      : null;
  }

  return null;
}

function collectOutcomeSeries(
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  window: PatternWindow,
  fallbackTimeZone: string | null,
): OutcomeSeries[] {
  const { fromDate, outcomeToDate: toDate } = window;
  const sleep = wearableBundle.sleepNights
    .filter(isWearableSleepPatternEligibleNight)
    .filter((day) => {
      const outcomeDate = resolveWearableSleepAnalysisDate(day, fallbackTimeZone);
      return outcomeDate >= fromDate && outcomeDate <= toDate;
    });
  const recovery = wearableBundle.recoveryDays.filter((day) => day.date >= fromDate && day.date <= toDate);

  return [
    outcome("total-sleep", "Total sleep", "min", 15, 0.03, sleep, (day) => day.totalSleepMinutes, (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone)),
    outcome("sleep-score", "Sleep score", "score", 3, 0.03, sleep, (day) => day.sleepScore, (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone)),
    outcome("sleep-efficiency", "Sleep efficiency", "%", 2, 0.02, sleep, (day) => day.sleepEfficiency, (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone)),
    outcome("recovery-score", "Recovery score", "score", 3, 0.03, recovery, (day) => day.recoveryScore),
    outcome("readiness-score", "Readiness score", "score", 3, 0.03, recovery, (day) => day.readinessScore),
    outcome("hrv", "HRV", "ms", 2, 0.05, recovery, (day) => day.hrv),
    outcome("resting-heart-rate", "Resting heart rate", "bpm", 2, 0.03, recovery, (day) => day.restingHeartRate),
  ].filter((series) => series.values.size >= MIN_MATCHED_DAYS * 2);
}

function collectMetricPointRecoveryOutcomeSeries(
  metricPoints: readonly MetricPoint[],
  window: PatternWindow,
): OutcomeSeries[] {
  return [
    metricPointOutcome("recovery-score", "Recovery score", "score", 3, 0.03, "recovery-score", metricPoints, window),
    metricPointOutcome("readiness-score", "Readiness score", "score", 3, 0.03, "readiness-score", metricPoints, window),
    metricPointOutcome("hrv", "HRV", "ms", 2, 0.05, "hrv-rmssd", metricPoints, window),
    metricPointOutcome("resting-heart-rate", "Resting heart rate", "bpm", 2, 0.03, "resting-heart-rate", metricPoints, window),
  ].filter((series) => series.values.size >= MIN_MATCHED_DAYS * 2);
}

function metricPointOutcome(
  id: string,
  label: string,
  unit: string,
  meaningfulAbsoluteDelta: number,
  meaningfulRelativeDelta: number,
  metricKey: string,
  metricPoints: readonly MetricPoint[],
  window: PatternWindow,
): OutcomeSeries {
  const rows = selectMetricSeries({
    from: window.fromDate,
    metricKey,
    points: metricPoints,
    to: window.outcomeToDate,
  }).rows;
  return {
    id,
    label,
    meaningfulAbsoluteDelta,
    meaningfulRelativeDelta,
    unit,
    values: new Map(
      rows.flatMap((row) =>
        row.confidence !== "none" && row.value !== null
          ? [[row.date, row.value] as const]
          : []
      ),
    ),
  };
}

function outcome<T extends { date: string }>(
  id: string,
  label: string,
  unit: string,
  meaningfulAbsoluteDelta: number,
  meaningfulRelativeDelta: number,
  days: readonly T[],
  select: (day: T) => WearableResolvedMetric,
  selectDate: (day: T) => string = (day) => day.date,
): OutcomeSeries {
  const values = new Map<string, number>();
  for (const day of days) {
    const metric = select(day);
    const value = metric.selection.value;
    if (value === null || metric.confidence.level === "none") continue;
    values.set(selectDate(day), value);
  }
  return { id, label, meaningfulAbsoluteDelta, meaningfulRelativeDelta, unit, values };
}

function readVaultTimeZone(vault: VaultReadModel): string | null {
  const value = vault.metadata?.timezone;
  return typeof value === "string" && isValidIanaTimeZone(value) ? value : null;
}

function buildPatternCell(
  factor: PersonalPatternFactor,
  factorDates: ReadonlySet<string>,
  outcome: OutcomeSeries,
): PersonalPatternCell {
  const pairs = matchComparisonDays(factorDates, outcome.values);
  const exposedDates = pairs.map((pair) => pair.exposedDate).sort();
  const base = {
    comparisonDays: pairs.length,
    exposedDays: pairs.length,
    factorId: factor.id,
    firstExposedDate: exposedDates[0] ?? null,
    lastExposedDate: exposedDates.at(-1) ?? null,
    outcomeId: outcome.id,
  };

  if (
    pairs.length < MIN_MATCHED_DAYS
    || !base.firstExposedDate
    || !base.lastExposedDate
    || daysBetween(base.firstExposedDate, base.lastExposedDate) < MIN_WINDOW_DAYS
  ) {
    return {
      ...base,
      comparisonMean: null,
      delta: null,
      deltaPercent: null,
      direction: "flat",
      exposedMean: null,
      repeatedDirection: false,
      stage: "insufficient",
    };
  }

  const exposedMean = mean(pairs.map((pair) => pair.exposedValue));
  const comparisonMean = mean(pairs.map((pair) => pair.comparisonValue));
  const delta = exposedMean - comparisonMean;
  const deltaPercent = comparisonMean === 0
    ? null
    : (delta / Math.abs(comparisonMean)) * 100;
  const meaningfulDelta = Math.max(
    outcome.meaningfulAbsoluteDelta,
    Math.abs(comparisonMean) * outcome.meaningfulRelativeDelta,
  );
  const repeatedDirection = hasRepeatedDirection(pairs, delta);
  const direction = Math.abs(delta) < meaningfulDelta
    ? "flat"
    : delta > 0 ? "higher" : "lower";
  const spanDays = daysBetween(base.firstExposedDate, base.lastExposedDate);
  let stage: PersonalPatternStage = "no_clear_pattern";

  if (direction !== "flat" && repeatedDirection) {
    stage = pairs.length >= 12 && spanDays >= 56 && Math.abs(delta) >= meaningfulDelta * 1.5
      ? "worth_testing"
      : pairs.length >= 8 && spanDays >= 42
      ? "seen_again"
      : "new_clue";
  }

  return {
    ...base,
    comparisonMean: round(comparisonMean),
    delta: round(delta),
    deltaPercent: deltaPercent === null ? null : round(deltaPercent),
    direction,
    exposedMean: round(exposedMean),
    repeatedDirection,
    stage,
  };
}

function matchComparisonDays(
  factorDates: ReadonlySet<string>,
  outcomeValues: ReadonlyMap<string, number>,
): MatchedPair[] {
  const usedComparisonDates = new Set<string>();
  const eligibleComparisonDates = [...outcomeValues.keys()]
    .map((outcomeDate) => addDays(outcomeDate, -1))
    .filter((date) => !factorDates.has(date));
  const pairs: MatchedPair[] = [];

  for (const exposedDate of [...factorDates].sort()) {
    const exposedValue = outcomeValues.get(addDays(exposedDate, 1));
    if (exposedValue === undefined) continue;

    const comparisonDate = eligibleComparisonDates
      .filter((date) => !usedComparisonDates.has(date))
      .filter((date) => weekday(date) === weekday(exposedDate))
      .filter((date) => Math.abs(daysBetween(date, exposedDate)) <= COMPARISON_SEARCH_DAYS)
      .sort((left, right) =>
        Math.abs(daysBetween(left, exposedDate)) - Math.abs(daysBetween(right, exposedDate))
        || left.localeCompare(right)
      )[0];
    if (!comparisonDate) continue;

    const comparisonValue = outcomeValues.get(addDays(comparisonDate, 1));
    if (comparisonValue === undefined) continue;
    usedComparisonDates.add(comparisonDate);
    pairs.push({ comparisonDate, comparisonValue, exposedDate, exposedValue });
  }

  return pairs;
}

function hasRepeatedDirection(pairs: readonly MatchedPair[], fullDelta: number): boolean {
  const midpoint = Math.floor(pairs.length / 2);
  const first = pairs.slice(0, midpoint);
  const second = pairs.slice(midpoint);
  if (first.length < 2 || second.length < 2 || fullDelta === 0) return false;
  const firstDelta = mean(first.map((pair) => pair.exposedValue - pair.comparisonValue));
  const secondDelta = mean(second.map((pair) => pair.exposedValue - pair.comparisonValue));
  return Math.sign(firstDelta) === Math.sign(fullDelta) && Math.sign(secondDelta) === Math.sign(fullDelta);
}

function resolveWindow(
  options: { asOf?: Date | string; windowDays?: number },
): PatternWindow {
  const asOfDate = resolveAsOfDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  return {
    fromDate: addDays(asOfDate, -(windowDays - 1)),
    outcomeToDate: addDays(asOfDate, 1),
  };
}

function resolveAsOfDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf())) throw new TypeError("Personal Patterns asOf must be a valid date.");
  return date.toISOString().slice(0, 10);
}

function normalizeWindowDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(value) || value < 28 || value > 366) {
    throw new RangeError("Personal Patterns windowDays must be an integer from 28 through 366.");
  }
  return value;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86400000);
}

function weekday(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalFactorToken(value: string | null): string | null {
  switch (value) {
    case "run": return "running";
    case "walk": return "walking";
    case "bike":
    case "biking":
    case "cycle":
    case "ride": return "cycling";
    case "swim": return "swimming";
    case "hike": return "hiking";
    case "row": return "rowing";
    case "strength-training":
    case "weightlifting":
    case "weights": return "strength";
    default: return value;
  }
}

function humanizeToken(value: string): string {
  const words = value.replace(/[-_]+/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
