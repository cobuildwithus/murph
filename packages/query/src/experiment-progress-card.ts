import {
  EXPERIMENT_PROGRESS_CARD_DAY_CODES,
  EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS,
  EXPERIMENT_PROGRESS_CARD_MAX_MOVERS,
  EXPERIMENT_PROGRESS_CARD_MAX_WEEKS,
  EXPERIMENT_PROGRESS_CARD_VERSION,
  experimentProgressCardSchema,
  type ExperimentProgressCardData,
} from "@murphai/contracts";

import type {
  ExperimentAdherenceCalendarResult,
  ExperimentAdherenceCellStatus,
} from "./experiment-adherence.ts";
import { resolveExperimentAdherenceRollupTarget } from "./experiment-adherence.ts";
import {
  collectExperimentAdherenceCalendar,
  summarizeExperimentProgress,
  type ExperimentMetricResult,
  type ExperimentProgressSummary,
} from "./experiments.ts";
import type { MetricPoint } from "./metrics/index.ts";
import type { VaultReadModel } from "./read-model.ts";

/**
 * Derive the shareable progress-card snapshot for one in-progress experiment.
 *
 * The card is a compact projection of machinery that already exists in this
 * package: day cells come from the adherence calendar, the session counts come
 * from the progress summary, and movers come from the same metric results that
 * outcome analysis reports. Anything that has to be dropped to fit the card
 * contract (weeks, movers, label lengths) is surfaced in `warnings` instead of
 * being truncated silently.
 */

export interface ExperimentProgressCardConfounderInput {
  date: string;
  label: string;
}

export interface BuildExperimentProgressCardOptions {
  asOf?: string;
  confounders?: readonly ExperimentProgressCardConfounderInput[];
  metricPoints?: readonly MetricPoint[];
}

export interface ExperimentProgressCardBuildResult {
  card: ExperimentProgressCardData;
  warnings: string[];
}

const DAY_CODES = EXPERIMENT_PROGRESS_CARD_DAY_CODES;

export function buildExperimentProgressCard(
  vault: VaultReadModel,
  slug: string,
  options: BuildExperimentProgressCardOptions = {},
): ExperimentProgressCardBuildResult {
  const warnings: string[] = [];
  const progress = summarizeExperimentProgress(vault, slug, {
    asOf: options.asOf,
    metricPoints: options.metricPoints,
  });
  const calendar = collectExperimentAdherenceCalendar(vault, slug, {
    asOf: options.asOf,
    metricPoints: options.metricPoints,
  });
  const windows = progress.windows;
  const runStart = windows.baselineStart ?? windows.interventionStart;
  if (!runStart) {
    throw new Error(
      `Experiment "${slug}" has no baseline or intervention start date; a progress card needs a run window.`,
    );
  }

  const windowEnd = windows.interventionEnd ?? windows.baselineEnd;
  const asOf = progress.asOf;
  const card = experimentProgressCardSchema.parse({
    v: EXPERIMENT_PROGRESS_CARD_VERSION,
    title: clampCardText(progress.experiment.title, 80, "title", warnings),
    asOf,
    phase: buildCardPhase(runStart, windowEnd, asOf),
    sessions: buildCardSessions(progress.adherence),
    weeks: buildCardWeeks({ asOf, calendar, runStart, warnings, windowEnd, windows }),
    movers: buildCardMovers(progress.signals, warnings),
    confounders: clampCardConfounders(options.confounders ?? [], warnings),
  });

  return { card, warnings };
}

function buildCardPhase(
  runStart: string,
  windowEnd: string | null,
  asOf: string,
): ExperimentProgressCardData["phase"] {
  const totalDays = windowEnd ? Math.max(1, daysBetweenInclusive(runStart, windowEnd)) : null;
  let day = daysBetweenInclusive(runStart, asOf);
  if (day < 1) {
    day = 1;
  }
  if (totalDays !== null && day > totalDays) {
    day = totalDays;
  }

  return { day, totalDays };
}

function buildCardSessions(
  adherence: ExperimentProgressSummary["adherence"],
): ExperimentProgressCardData["sessions"] {
  const loggedSessions =
    adherence.loggedSessions ??
    adherence.completedSessions + (adherence.partialSessions ?? 0);

  return {
    logged: Math.max(0, loggedSessions),
    target:
      adherence.targetSessions !== null && adherence.targetSessions >= 1
        ? adherence.targetSessions
        : null,
  };
}

function buildCardWeeks(input: {
  asOf: string;
  calendar: ExperimentAdherenceCalendarResult | null;
  runStart: string;
  warnings: string[];
  windowEnd: string | null;
  windows: ExperimentProgressSummary["windows"];
}): Array<{ start: string; cells: string }> {
  const statusesByDate = new Map<string, ExperimentAdherenceCellStatus[]>();
  const targets = input.calendar?.targets ?? [];
  const rollupTarget = resolveExperimentAdherenceRollupTarget(targets);
  const hasAmbiguousTargets = targets.length > 1 && !rollupTarget;
  if (hasAmbiguousTargets) {
    input.warnings.push("calendar omitted because multiple adherence targets define no single rollup");
  }
  for (const cell of input.calendar?.cells ?? []) {
    if (hasAmbiguousTargets || (rollupTarget && cell.targetId !== rollupTarget.targetId)) {
      continue;
    }
    const statuses = statusesByDate.get(cell.localDate) ?? [];
    statuses.push(cell.status);
    statusesByDate.set(cell.localDate, statuses);
  }

  // The sessions strip is about logged intervention sessions, so the grid runs
  // over the intervention window only — baseline is a measurement-only period
  // with nothing to log, and showing it just adds dead cells.
  const gridStart = input.windows.interventionStart ?? input.runStart;
  const gridEnd = input.windowEnd ?? maxIsoDate(input.asOf, gridStart);
  const totalWeeks = Math.ceil(daysBetweenInclusive(gridStart, gridEnd) / 7);
  const asOfInGrid = minIsoDate(maxIsoDate(input.asOf, gridStart), gridEnd);
  const asOfWeekIndex = Math.floor(
    (daysBetweenInclusive(gridStart, asOfInGrid) - 1) / 7,
  );
  let lastWeekIndex = totalWeeks - 1;
  let firstWeekIndex = 0;
  if (totalWeeks > EXPERIMENT_PROGRESS_CARD_MAX_WEEKS) {
    lastWeekIndex = Math.max(asOfWeekIndex, EXPERIMENT_PROGRESS_CARD_MAX_WEEKS - 1);
    firstWeekIndex = lastWeekIndex - (EXPERIMENT_PROGRESS_CARD_MAX_WEEKS - 1);
    input.warnings.push(
      `calendar clamped to last ${EXPERIMENT_PROGRESS_CARD_MAX_WEEKS} weeks ` +
        `(weeks ${firstWeekIndex + 1}-${lastWeekIndex + 1} of ${totalWeeks})`,
    );
  }

  const weeks: Array<{ start: string; cells: string }> = [];
  for (let weekIndex = firstWeekIndex; weekIndex <= lastWeekIndex; weekIndex += 1) {
    const start = addDaysToIsoDate(gridStart, weekIndex * 7);
    let cells = "";
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const date = addDaysToIsoDate(start, dayOffset);
      cells += resolveDayCode({
        asOf: input.asOf,
        date,
        gridEnd,
        statuses: statusesByDate.get(date) ?? null,
      });
    }
    weeks.push({ start, cells });
  }

  return weeks;
}

function resolveDayCode(input: {
  asOf: string;
  date: string;
  gridEnd: string;
  statuses: readonly ExperimentAdherenceCellStatus[] | null;
}): string {
  if (input.date > input.gridEnd) {
    return DAY_CODES.outOfWindow;
  }

  const statuses = input.statuses;
  if (!statuses || statuses.length === 0) {
    return input.date > input.asOf ? DAY_CODES.scheduled : DAY_CODES.noEvidence;
  }

  const satisfied = countStatuses(statuses, "satisfied") + countStatuses(statuses, "assumed");
  const partial = countStatuses(statuses, "partial");
  const missedOrFailed = countStatuses(statuses, "missed") + countStatuses(statuses, "failed");
  if (satisfied === statuses.length) {
    return DAY_CODES.completed;
  }
  if (satisfied > 0 || partial > 0) {
    return DAY_CODES.partial;
  }
  if (missedOrFailed > 0) {
    return DAY_CODES.missed;
  }
  if (countStatuses(statuses, "scheduled") === statuses.length) {
    return DAY_CODES.scheduled;
  }

  return DAY_CODES.noEvidence;
}

function countStatuses(
  statuses: readonly ExperimentAdherenceCellStatus[],
  status: ExperimentAdherenceCellStatus,
): number {
  return statuses.filter((candidate) => candidate === status).length;
}

interface RankedMoverCandidate {
  baselineMean: number;
  deltaAbs: number;
  interventionMean: number;
  normalizedMove: number;
  signal: ExperimentMetricResult;
}

function buildCardMovers(
  signals: readonly ExperimentMetricResult[],
  warnings: string[],
): ExperimentProgressCardData["movers"] {
  const candidates: RankedMoverCandidate[] = [];
  for (const signal of signals) {
    if (
      signal.completeness === "insufficient" ||
      signal.baselineMean === null ||
      signal.baselineMean === 0 ||
      signal.interventionMean === null ||
      signal.deltaAbs === null
    ) {
      continue;
    }

    candidates.push({
      baselineMean: signal.baselineMean,
      deltaAbs: signal.deltaAbs,
      interventionMean: signal.interventionMean,
      // |delta| / |baseline mean|; deltaPct is the same ratio when present.
      normalizedMove:
        signal.deltaPct !== null
          ? Math.abs(signal.deltaPct) / 100
          : Math.abs(signal.deltaAbs) / Math.abs(signal.baselineMean),
      signal,
    });
  }

  const skippedCount = signals.length - candidates.length;
  if (skippedCount > 0) {
    warnings.push(
      `${skippedCount} metric(s) skipped as movers (missing baseline mean or insufficient data)`,
    );
  }

  const ranked = [...candidates].sort((left, right) => right.normalizedMove - left.normalizedMove);
  if (ranked.length > EXPERIMENT_PROGRESS_CARD_MAX_MOVERS) {
    warnings.push(
      `movers clamped to top ${EXPERIMENT_PROGRESS_CARD_MAX_MOVERS} of ${ranked.length} qualifying metrics`,
    );
  }

  return ranked
    .slice(0, EXPERIMENT_PROGRESS_CARD_MAX_MOVERS)
    .map((candidate) => buildCardMover(candidate, warnings));
}

function buildCardMover(
  candidate: RankedMoverCandidate,
  warnings: string[],
): ExperimentProgressCardData["movers"][number] {
  const { signal } = candidate;
  let unit = signal.unit ?? null;
  if (unit !== null && unit.length > 12) {
    warnings.push(`mover unit "${unit}" dropped (longer than 12 characters)`);
    unit = null;
  }

  return {
    label: clampCardText(signal.label, 40, `mover label "${signal.label}"`, warnings),
    changePct: formatPercentMagnitude(candidate.normalizedMove),
    value: formatCompactNumber(candidate.interventionMean).slice(0, 16),
    unit,
    delta: formatSignedDelta(candidate.deltaAbs, unit),
    direction: candidate.deltaAbs > 0 ? "up" : candidate.deltaAbs < 0 ? "down" : "neutral",
    sentiment:
      signal.movedAsExpected === true
        ? "positive"
        : signal.movedAsExpected === false
          ? "negative"
          : "neutral",
  };
}

function clampCardConfounders(
  confounders: readonly ExperimentProgressCardConfounderInput[],
  warnings: string[],
): ExperimentProgressCardData["confounders"] {
  let entries = [...confounders];
  if (entries.length > EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS) {
    warnings.push(
      `confounders clamped to first ${EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS} of ${entries.length}`,
    );
    entries = entries.slice(0, EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS);
  }

  return entries.map((entry) => ({
    date: entry.date,
    label: clampCardText(entry.label, 60, `confounder label "${entry.label}"`, warnings),
  }));
}

function clampCardText(
  value: string,
  maxLength: number,
  fieldDescription: string,
  warnings: string[],
): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  warnings.push(`${fieldDescription} truncated to ${maxLength} characters`);
  return trimmed.slice(0, maxLength).trimEnd();
}

/**
 * Round display numbers to the precision a reader actually wants: whole units
 * for typical magnitudes (47 bpm, 117 minutes), one decimal for small values
 * where the integer would lose meaningful resolution (1.7 kg). Two-decimal
 * trailing digits in a headline card just read as noise.
 */
function formatCompactNumber(value: number): string {
  const decimals = Math.abs(value) >= 10 ? 0 : 1;
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

/**
 * Format the headline percent-change magnitude. `normalizedMove` is the
 * unsigned |delta| / |baseline| ratio; the card draws a directional arrow, so
 * the number itself stays unsigned. Whole percents read cleanest, but sub-1%
 * moves keep one decimal so a real change never shows as 0%.
 */
function formatPercentMagnitude(normalizedMove: number): string {
  const magnitude = normalizedMove * 100;
  const rounded = magnitude >= 1 ? Math.round(magnitude) : Math.round(magnitude * 10) / 10;
  return `${rounded}%`;
}

/** Signed raw change with its unit, e.g. "+18 min" or "−1.2 bpm". */
function formatSignedDelta(deltaAbs: number, unit: string | null): string {
  const sign = deltaAbs > 0 ? "+" : deltaAbs < 0 ? "−" : "";
  const magnitude = formatCompactNumber(Math.abs(deltaAbs));
  const withUnit = unit ? `${sign}${magnitude} ${unit}` : `${sign}${magnitude}`;
  return withUnit.length <= 20 ? withUnit : `${sign}${magnitude}`.slice(0, 20);
}

function maxIsoDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minIsoDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function addDaysToIsoDate(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00.000Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  const startStamp = new Date(`${start}T00:00:00.000Z`);
  const endStamp = new Date(`${end}T00:00:00.000Z`);
  return Math.floor((endStamp.valueOf() - startStamp.valueOf()) / 86_400_000) + 1;
}
