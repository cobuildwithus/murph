import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
  isValidIanaTimeZone,
} from "@murphai/contracts";

import { daysBetweenIsoDates, uniqueStrings } from "./shared.ts";
import type {
  WearableResolvedMetric,
  WearableSleepClockPattern,
  WearableSleepNight,
  WearableSleepNumericPattern,
  WearableSleepPatternFilters,
  WearableSleepPatternSummary,
  WearableSleepReportingTimeZoneSource,
  WearableSleepSessionType,
  WearableSleepSourceFreshness,
  WearableSleepWindowEvidence,
  WearableFilters,
  WearableSourceHealth,
} from "./types.ts";

const DEFAULT_SLEEP_PATTERN_WINDOW_DAYS = 28;
const MIN_VARIABILITY_SAMPLE_COUNT = 3;
const MIN_WEEKDAY_WEEKEND_SAMPLE_COUNT = 2;
const SLEEP_SOURCE_STALE_AFTER_DAYS = 2;
const SAME_WINDOW_TOLERANCE_MS = 2 * 60 * 1_000;
const LATE_ARRIVAL_AFTER_MS = 24 * 60 * 60 * 1_000;

interface PreparedSleepNight {
  analysisDate: string;
  awakeMinutes: number | null;
  bedtimeMinutes: number | null;
  endAt: string;
  endMs: number;
  localDateMismatch: boolean;
  midpointMinutes: number | null;
  night: WearableSleepNight;
  provider: string;
  recordedAt: string | null;
  recordedAtMs: number | null;
  sessionDurationMinutes: number;
  sleepLatencyMinutes: number | null;
  sleepType: WearableSleepSessionType;
  startAt: string;
  startMs: number;
  timeZone: string | null;
  timeZoneSource: "canonical" | "none" | "reporting_fallback";
  totalSleepMinutes: number | null;
  upstreamExactDuplicateCount: number;
  wakeMinutes: number | null;
}

export interface WearableSleepPatternBuildContext {
  reportingTimeZoneSource?: Extract<
    WearableSleepReportingTimeZoneSource,
    "user_filter" | "vault_metadata"
  >;
}

export function isWearableSleepPatternEligibleNight(
  night: { sleepType: WearableSleepSessionType },
): boolean {
  return night.sleepType !== "nap";
}

export function resolveWearableSleepAnalysisDate(
  night: Pick<WearableSleepNight, "date" | "sleepEndAt" | "timeZone">,
  fallbackTimeZone: string | null,
): string {
  const canonicalTimeZone = typeof night.timeZone === "string" && isValidIanaTimeZone(night.timeZone)
    ? night.timeZone
    : null;
  const timeZone = canonicalTimeZone ?? fallbackTimeZone;
  const endAt = typeof night.sleepEndAt === "string" ? night.sleepEndAt : null;
  if (!timeZone || !endAt || !Number.isFinite(Date.parse(endAt))) return night.date;
  return formatTimeZoneDateTimeParts(endAt, timeZone).dayKey;
}

/**
 * Sleep rows are stored under a provider date, while pattern membership is
 * anchored to the sleep end localized in the night's canonical/reporting zone.
 * Read one adjacent stored day on either side, then let the pattern builder
 * apply the exact canonical analysis window.
 */
export function resolveWearableSleepPatternReadFilters(
  filters: WearableSleepPatternFilters = {},
): WearableFilters {
  const asOf = parseAsOfInstant(filters.now);
  const reportingTimeZone = resolveExplicitReportingTimeZone(filters.timeZone);
  const asOfDate = reportingTimeZone
    ? formatTimeZoneDateTimeParts(asOf, reportingTimeZone).dayKey
    : asOf.toISOString().slice(0, 10);
  const window = resolveWindow(filters, asOfDate, asOfDate);

  return {
    from: addDaysToIsoDate(window.from, -1),
    providers: filters.providers,
    to: addDaysToIsoDate(window.to, 1),
  };
}

export function buildWearableSleepPatternSummary(
  input: {
    sleepNights: readonly WearableSleepNight[];
    sourceHealth: readonly WearableSourceHealth[];
  },
  filters: WearableSleepPatternFilters = {},
  context: WearableSleepPatternBuildContext = {},
): WearableSleepPatternSummary {
  const asOf = parseAsOfInstant(filters.now);
  const explicitReportingTimeZone = resolveExplicitReportingTimeZone(filters.timeZone);
  const newestCanonicalTimeZone = newestCompletedNonNapCanonicalTimeZone(
    input.sleepNights,
    asOf.getTime(),
  );
  const reportingTimeZone = explicitReportingTimeZone ?? newestCanonicalTimeZone;
  const reportingTimeZoneSource: WearableSleepReportingTimeZoneSource = explicitReportingTimeZone
    ? context.reportingTimeZoneSource ?? "user_filter"
    : newestCanonicalTimeZone
      ? "canonical"
      : "none";
  const asOfDate = reportingTimeZone
    ? formatTimeZoneDateTimeParts(asOf, reportingTimeZone).dayKey
    : asOf.toISOString().slice(0, 10);
  assertIsoDate(asOfDate, "as-of date");

  const prepared = input.sleepNights
    .map((night) => prepareSleepNight(night, explicitReportingTimeZone, asOf.getTime()))
    .filter((night): night is PreparedSleepNight => night !== null);
  const window = resolveWindow(filters, asOfDate, asOfDate);
  const preparedInWindow = prepared.filter((night) =>
    night.analysisDate >= window.from && night.analysisDate <= window.to
  );
  const nonNapPreparedInWindow = preparedInWindow.filter(isWearableSleepPatternEligibleNight);
  const collapsed = collapseDuplicateAndOverlappingNights(nonNapPreparedInWindow);
  const sameDateCollapsed = selectOneNightPerAnalysisDate(collapsed.nights);
  const nights = sameDateCollapsed.nights;
  const suppressionPreparedInWindow = input.sleepNights
    .flatMap((night) => prepareSleepSuppressionEvidence(
      night,
      explicitReportingTimeZone,
      asOf.getTime(),
    ))
    .filter((night) => night.analysisDate >= window.from && night.analysisDate <= window.to)
    .filter(isWearableSleepPatternEligibleNight);
  const suppressionCollapsed = collapseDuplicateAndOverlappingNights(suppressionPreparedInWindow);
  const suppressionSameDateCollapsed = selectOneNightPerAnalysisDate(suppressionCollapsed.nights);
  const omittedEvidenceCount = preparedInWindow.reduce(
    (count, night) => count + (night.night.sleepWindowEvidenceOmittedCount ?? 0),
    0,
  );
  const omittedExactDuplicateCount = nonNapPreparedInWindow.reduce(
    (count, night) => count + (night.night.sleepWindowEvidenceOmittedExactDuplicateCount ?? 0),
    0,
  );
  const nonNapDatesInWindow = new Set(nonNapPreparedInWindow.map((night) => night.analysisDate));
  const excludedNapOnlyDateCount = new Set(
    preparedInWindow
      .filter((night) => night.sleepType === "nap" && !nonNapDatesInWindow.has(night.analysisDate))
      .map((night) => night.analysisDate),
  ).size;
  const expectedNightCount = inclusiveIsoDateCount(window.from, window.to);
  const validDates = new Set(nights.map((night) => night.analysisDate));
  const latestNightDate = latestIsoDate([...validDates]);
  const timingNights = nights.filter((night) => night.bedtimeMinutes !== null);
  const providers = uniqueStrings(nights.map((night) => night.provider)).sort();
  const timeZones = uniqueStrings(timingNights.map((night) => night.timeZone ?? "")).sort();
  const sourceFreshnessResult = buildSleepSourceFreshness(input.sourceHealth, asOfDate);
  const sourceFreshness = sourceFreshnessResult.sources;
  const allSourcesStale = sourceFreshness.length > 0 && sourceFreshness.every(
    (source) => source.stalenessVsNowDays > SLEEP_SOURCE_STALE_AFTER_DAYS,
  );
  const latestSleepEnd = latestTimestamp(nights.map((night) => ({
    timestamp: night.endAt,
    time: night.endMs,
  })));
  const latestRecorded = latestTimestamp(
    nights
      .filter((night) => night.recordedAt !== null && night.recordedAtMs !== null)
      .map((night) => ({
        timestamp: night.recordedAt as string,
        time: night.recordedAtMs as number,
      })),
  );
  const weekdayMidpoints = timingNights
    .filter((night) => !isWeekendIsoDate(night.analysisDate))
    .map((night) => night.midpointMinutes as number);
  const weekendMidpoints = timingNights
    .filter((night) => isWeekendIsoDate(night.analysisDate))
    .map((night) => night.midpointMinutes as number);
  const awakeMinutes = nights
    .map((night) => night.awakeMinutes)
    .filter((value): value is number => value !== null);
  const sleepLatencyMinutes = nights
    .map((night) => night.sleepLatencyMinutes)
    .filter((value): value is number => value !== null);
  const totalSleepMinutes = nights
    .map((night) => night.totalSleepMinutes)
    .filter((value): value is number => value !== null);
  const unknownSleepTypeNightCount = nights.filter((night) => night.sleepType === "unknown").length;
  const localDateMismatchCount = nights.filter((night) => night.localDateMismatch).length;
  const reportingTimeZoneFallbackNightCount = nights.filter(
    (night) => night.timeZoneSource === "reporting_fallback",
  ).length;
  const timingOmittedNightCount = nights.filter((night) => night.timeZoneSource === "none").length;
  const lateArrivingNightCount = nights.filter((night) =>
    night.recordedAtMs !== null && night.recordedAtMs - night.endMs > LATE_ARRIVAL_AFTER_MS
  ).length;
  const overlappingNightCount = suppressionCollapsed.overlapSuppressedCount;
  const conflictingNightCount = nights.filter((night) =>
    (night.night.sessionMinutes?.confidence.conflictingProviders.length ?? 0) > 0
  ).length;
  const suppressedExactDuplicateCount = suppressionCollapsed.duplicateSuppressedCount
    + suppressionPreparedInWindow.reduce(
      (count, night) => count + night.upstreamExactDuplicateCount,
      0,
    )
    + omittedExactDuplicateCount;
  const notes = buildPatternNotes({
    allSourcesStale,
    awakeCount: awakeMinutes.length,
    collapsedOverlapCount: suppressionCollapsed.overlapSuppressedCount,
    expectedNightCount,
    excludedNapOnlyDateCount,
    reportingTimeZoneFallbackNightCount,
    lateArrivingNightCount,
    localDateMismatchCount,
    omittedEvidenceCount,
    timingOmittedNightCount,
    providerMix: providers.length > 1,
    reportingTimeZone,
    reportingTimeZoneSource,
    requestedToCappedAtAsOf: window.requestedToCappedAtAsOf,
    sameDateSessionSuppressedCount: suppressionSameDateCollapsed.suppressedCount,
    sourceFreshnessCount: sourceFreshness.length,
    futureSourceEvidenceExcludedCount: sourceFreshnessResult.futureEvidenceExcludedCount,
    timeZones,
    unknownSleepTypeNightCount,
    validNightCount: validDates.size,
  });

  return {
    allSourcesStale,
    asOfDate,
    asOfInstant: asOf.toISOString(),
    awakeMinutes: numericPattern(awakeMinutes),
    bedtime: clockPattern(timingNights.map((night) => night.bedtimeMinutes as number)),
    conflictingNightCount,
    coveragePercent: expectedNightCount === 0
      ? 0
      : round((validDates.size / expectedNightCount) * 100),
    excludedNapOnlyDateCount,
    reportingTimeZoneFallbackNightCount,
    expectedNightCount,
    from: window.from,
    lateArrivingNightCount,
    latestNightAgeDays: latestNightDate ? Math.max(0, daysBetweenIsoDates(latestNightDate, asOfDate)) : null,
    latestNightDate,
    latestRecordedAt: latestRecorded,
    latestSleepEndAt: latestSleepEnd,
    midpoint: clockPattern(timingNights.map((night) => night.midpointMinutes as number)),
    missingNightCount: Math.max(0, expectedNightCount - validDates.size),
    notes,
    overlappingNightCount,
    providerMix: providers.length > 1,
    providers,
    reportingTimeZone,
    reportingTimeZoneSource,
    sameDateSessionSuppressedCount: suppressionSameDateCollapsed.suppressedCount,
    sessionDurationMinutes: numericPattern(nights.map((night) => night.sessionDurationMinutes)),
    sleepLatencyMinutes: numericPattern(sleepLatencyMinutes),
    sourceFreshness,
    staleAfterDays: SLEEP_SOURCE_STALE_AFTER_DAYS,
    suppressedExactDuplicateCount,
    timeZones,
    timingTimeZoneMode: "per_night_canonical_with_reporting_fallback",
    timingOmittedNightCount,
    to: window.to,
    totalSleepMinutes: numericPattern(totalSleepMinutes),
    unknownSleepTypeNightCount,
    validNightCount: validDates.size,
    wakeTime: clockPattern(timingNights.map((night) => night.wakeMinutes as number)),
    weekdayWeekendMidpointDriftMinutes: weekdayWeekendDrift(weekdayMidpoints, weekendMidpoints),
    weekdayWeekendMidpointSampleCounts: {
      weekday: weekdayMidpoints.length,
      weekend: weekendMidpoints.length,
    },
  };
}

function prepareSleepNight(
  night: WearableSleepNight,
  explicitReportingTimeZone: string | null,
  asOfMs: number,
): PreparedSleepNight | null {
  const startAt = typeof night.sleepStartAt === "string" ? night.sleepStartAt : null;
  const endAt = typeof night.sleepEndAt === "string" ? night.sleepEndAt : null;
  const startMs = startAt ? Date.parse(startAt) : Number.NaN;
  const endMs = endAt ? Date.parse(endAt) : Number.NaN;
  if (!startAt || !endAt || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs > asOfMs) {
    return null;
  }

  const canonicalTimeZone = typeof night.timeZone === "string" && isValidIanaTimeZone(night.timeZone)
    ? night.timeZone
    : null;
  const timeZone = canonicalTimeZone ?? explicitReportingTimeZone;
  const timeZoneSource = canonicalTimeZone
    ? "canonical"
    : explicitReportingTimeZone
      ? "reporting_fallback"
      : "none";
  const endParts = timeZone ? formatTimeZoneDateTimeParts(endAt, timeZone) : null;
  const startParts = timeZone ? formatTimeZoneDateTimeParts(startAt, timeZone) : null;
  const midpointParts = timeZone
    ? formatTimeZoneDateTimeParts(new Date(startMs + (endMs - startMs) / 2), timeZone)
    : null;
  const recordedAt = night.sessionMinutes?.selection.recordedAt ?? null;
  const recordedAtMs = recordedAt ? Date.parse(recordedAt) : Number.NaN;

  return {
    analysisDate: resolveWearableSleepAnalysisDate(night, explicitReportingTimeZone),
    awakeMinutes: directMetricValue(night.awakeMinutes),
    bedtimeMinutes: startParts ? startParts.hour * 60 + startParts.minute : null,
    endAt,
    endMs,
    localDateMismatch: endParts !== null && endParts.dayKey !== night.date,
    midpointMinutes: midpointParts ? midpointParts.hour * 60 + midpointParts.minute : null,
    night,
    provider: night.sleepWindowProvider ?? night.provider ?? "unknown",
    recordedAt,
    recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : null,
    sessionDurationMinutes: (endMs - startMs) / 60_000,
    sleepLatencyMinutes: directMetricValue(night.sleepLatencyMinutes),
    sleepType: resolveSleepType(night),
    startAt,
    startMs,
    timeZone,
    timeZoneSource,
    totalSleepMinutes: selectedMetricValue(night.totalSleepMinutes),
    upstreamExactDuplicateCount: 0,
    wakeMinutes: endParts ? endParts.hour * 60 + endParts.minute : null,
  };
}

function prepareSleepSuppressionEvidence(
  night: WearableSleepNight,
  explicitReportingTimeZone: string | null,
  asOfMs: number,
): PreparedSleepNight[] {
  const evidence = night.sleepWindowEvidence ?? [];
  if (evidence.length === 0) {
    const prepared = prepareSleepNight(night, explicitReportingTimeZone, asOfMs);
    return prepared ? [prepared] : [];
  }

  return evidence.flatMap((window) => {
    const prepared = prepareSleepWindowEvidence(
      night,
      window,
      explicitReportingTimeZone,
      asOfMs,
    );
    return prepared ? [prepared] : [];
  });
}

function prepareSleepWindowEvidence(
  night: WearableSleepNight,
  evidence: WearableSleepWindowEvidence,
  explicitReportingTimeZone: string | null,
  asOfMs: number,
): PreparedSleepNight | null {
  const evidenceNight: WearableSleepNight = {
    ...night,
    date: evidence.date,
    provider: evidence.provider,
    sessionMinutes: {
      ...night.sessionMinutes,
      selection: {
        ...night.sessionMinutes.selection,
        provider: evidence.provider,
        recordedAt: evidence.recordedAt,
        resolution: "direct",
        sourceFamily: "derived",
        sourceKind: "sleep-window-evidence",
        value: evidence.durationMinutes,
      },
    },
    sleepEndAt: evidence.endAt,
    sleepStartAt: evidence.startAt,
    sleepType: evidence.sleepType,
    sleepWindowProvider: evidence.provider,
    timeZone: evidence.timeZone,
  };
  const prepared = prepareSleepNight(evidenceNight, explicitReportingTimeZone, asOfMs);
  return prepared
    ? { ...prepared, upstreamExactDuplicateCount: evidence.exactDuplicateCount }
    : null;
}

function collapseDuplicateAndOverlappingNights(nights: readonly PreparedSleepNight[]): {
  duplicateSuppressedCount: number;
  nights: PreparedSleepNight[];
  overlapSuppressedCount: number;
} {
  const deduped: PreparedSleepNight[] = [];
  let duplicateSuppressedCount = 0;

  for (const night of [...nights].sort(comparePreparedNight)) {
    const duplicateIndex = deduped.findIndex((candidate) =>
      Math.abs(candidate.startMs - night.startMs) <= SAME_WINDOW_TOLERANCE_MS
      && Math.abs(candidate.endMs - night.endMs) <= SAME_WINDOW_TOLERANCE_MS
    );
    if (duplicateIndex < 0) {
      deduped.push(night);
      continue;
    }

    duplicateSuppressedCount += 1;
    if (compareNightPreference(night, deduped[duplicateIndex] as PreparedSleepNight) < 0) {
      deduped[duplicateIndex] = night;
    }
  }

  const retained: PreparedSleepNight[] = [];
  let overlapSuppressedCount = 0;
  const preferenceOrdered = deduped.sort((left, right) =>
    compareNightPreference(left, right) || comparePreparedNight(left, right)
  );
  for (const night of preferenceOrdered) {
    const overlapsRetained = retained.some((candidate) =>
      candidate.startMs < night.endMs && night.startMs < candidate.endMs
    );
    if (!overlapsRetained) {
      retained.push(night);
      continue;
    }

    overlapSuppressedCount += 1;
  }

  return {
    duplicateSuppressedCount,
    nights: retained.sort((left, right) => right.analysisDate.localeCompare(left.analysisDate)),
    overlapSuppressedCount,
  };
}

function selectOneNightPerAnalysisDate(nights: readonly PreparedSleepNight[]): {
  nights: PreparedSleepNight[];
  suppressedCount: number;
} {
  const byDate = new Map<string, PreparedSleepNight[]>();
  for (const night of nights) {
    const sameDate = byDate.get(night.analysisDate);
    if (sameDate) {
      sameDate.push(night);
    } else {
      byDate.set(night.analysisDate, [night]);
    }
  }

  let suppressedCount = 0;
  const selected = [...byDate.values()].map((sameDate) => {
    suppressedCount += sameDate.length - 1;
    return sameDate.sort((left, right) =>
      compareNightPreference(left, right) || comparePreparedNight(left, right)
    )[0] as PreparedSleepNight;
  });

  return {
    nights: selected.sort((left, right) => right.analysisDate.localeCompare(left.analysisDate)),
    suppressedCount,
  };
}

function comparePreparedNight(left: PreparedSleepNight, right: PreparedSleepNight): number {
  return left.startMs - right.startMs || left.endMs - right.endMs || left.analysisDate.localeCompare(right.analysisDate);
}

function compareNightPreference(left: PreparedSleepNight, right: PreparedSleepNight): number {
  const typeDifference = sleepTypeRank(right.sleepType) - sleepTypeRank(left.sleepType);
  if (typeDifference !== 0) return typeDifference;
  const confidenceDifference = confidenceRank(right.night.summaryConfidence.level)
    - confidenceRank(left.night.summaryConfidence.level);
  if (confidenceDifference !== 0) return confidenceDifference;
  if (left.sessionDurationMinutes !== right.sessionDurationMinutes) {
    return right.sessionDurationMinutes - left.sessionDurationMinutes;
  }
  return (right.recordedAtMs ?? 0) - (left.recordedAtMs ?? 0);
}

function sleepTypeRank(value: WearableSleepSessionType): number {
  if (value === "main_sleep") return 2;
  if (value === "unknown") return 1;
  return 0;
}

function confidenceRank(value: WearableSleepNight["summaryConfidence"]["level"]): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

function resolveSleepType(night: WearableSleepNight): WearableSleepSessionType {
  return night.sleepType === "main_sleep" || night.sleepType === "nap" ? night.sleepType : "unknown";
}

function newestCompletedNonNapCanonicalTimeZone(
  nights: readonly WearableSleepNight[],
  asOfMs: number,
): string | null {
  return nights
    .filter((night) => resolveSleepType(night) !== "nap")
    .map((night) => ({
      endMs: Date.parse(night.sleepEndAt ?? ""),
      startMs: Date.parse(night.sleepStartAt ?? ""),
      timeZone: night.timeZone,
    }))
    .filter((night): night is { endMs: number; startMs: number; timeZone: string } =>
      Number.isFinite(night.endMs)
      && Number.isFinite(night.startMs)
      && night.endMs > night.startMs
      && night.endMs <= asOfMs
      && typeof night.timeZone === "string"
      && isValidIanaTimeZone(night.timeZone)
    )
    .sort((left, right) => right.endMs - left.endMs)[0]?.timeZone ?? null;
}

function directMetricValue(metric: WearableResolvedMetric | undefined): number | null {
  if (metric?.selection.resolution !== "direct") return null;
  return finiteMetricValue(metric.selection.value);
}

function selectedMetricValue(metric: WearableResolvedMetric | undefined): number | null {
  return finiteMetricValue(metric?.selection.value ?? null);
}

function finiteMetricValue(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveExplicitReportingTimeZone(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!isValidIanaTimeZone(value)) {
    throw new RangeError(`Invalid IANA reporting time zone: ${value}`);
  }
  return value;
}

function parseAsOfInstant(value: string | undefined): Date {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`Invalid sleep-pattern as-of instant: ${String(value)}`);
  }
  return date;
}

function resolveWindow(
  filters: WearableSleepPatternFilters,
  defaultTo: string,
  asOfDate: string,
): { from: string; requestedToCappedAtAsOf: boolean; to: string } {
  const windowDays = filters.windowDays ?? DEFAULT_SLEEP_PATTERN_WINDOW_DAYS;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
    throw new RangeError("Sleep-pattern windowDays must be an integer from 1 through 366.");
  }
  const requestedTo = filters.date ?? filters.to ?? defaultTo;
  assertIsoDate(requestedTo, "sleep-pattern to date");
  const requestedToCappedAtAsOf = requestedTo > asOfDate;
  const to = requestedToCappedAtAsOf ? asOfDate : requestedTo;
  const from = filters.date ?? filters.from ?? addDaysToIsoDate(to, -(windowDays - 1));
  assertIsoDate(from, "sleep-pattern from date");
  if (from > to) {
    throw new RangeError("Sleep-pattern from date must be on or before the effective to/as-of date.");
  }
  return { from, requestedToCappedAtAsOf, to };
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RangeError(`Invalid ${label}: ${value}`);
  }
  addDaysToIsoDate(value, 0);
}

function inclusiveIsoDateCount(from: string, to: string): number {
  return Math.max(0, daysBetweenIsoDates(from, to) + 1);
}

function latestIsoDate(values: readonly string[]): string | null {
  return [...values].sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function latestTimestamp(values: readonly { time: number; timestamp: string }[]): string | null {
  return [...values].sort((left, right) => right.time - left.time)[0]?.timestamp ?? null;
}

function buildSleepSourceFreshness(
  sourceHealth: readonly WearableSourceHealth[],
  asOfDate: string,
): {
  futureEvidenceExcludedCount: number;
  sources: WearableSleepSourceFreshness[];
} {
  const futureEvidenceExcludedCount = sourceHealth.filter(
    (source) => source.lastSleepDate !== null && source.lastSleepDate > asOfDate,
  ).length;
  const acceptedSources = sourceHealth
    .filter((source) => source.provider !== "unknown" && source.lastSleepDate !== null)
    .filter((source) => (source.lastSleepDate as string) <= asOfDate);
  const newestAcceptedSleepDate = latestIsoDate(
    acceptedSources.map((source) => source.lastSleepDate as string),
  );
  const sources = acceptedSources
    .map((source) => ({
      lastSleepEvidenceDate: source.lastSleepDate as string,
      provider: source.provider,
      stalenessVsNewestDays: newestAcceptedSleepDate
        ? Math.max(0, daysBetweenIsoDates(source.lastSleepDate as string, newestAcceptedSleepDate))
        : 0,
      stalenessVsNowDays: Math.max(0, daysBetweenIsoDates(source.lastSleepDate as string, asOfDate)),
    }))
    .sort((left, right) =>
      right.lastSleepEvidenceDate.localeCompare(left.lastSleepEvidenceDate)
      || left.provider.localeCompare(right.provider)
    );
  return { futureEvidenceExcludedCount, sources };
}

function numericPattern(values: readonly number[]): WearableSleepNumericPattern {
  if (values.length === 0) {
    return { average: null, count: 0, median: null, standardDeviation: null };
  }
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return {
    average: round(average),
    count: values.length,
    median: round(median(values)),
    standardDeviation: values.length >= MIN_VARIABILITY_SAMPLE_COUNT
      ? round(Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length))
      : null,
  };
}

function clockPattern(values: readonly number[]): WearableSleepClockPattern {
  if (values.length === 0) {
    return {
      count: 0,
      medianLocalMinutes: null,
      medianLocalTime: null,
      standardDeviationMinutes: null,
    };
  }
  const center = circularMedian(values);
  const deviations = values.map((value) => shortestClockDifference(value, center));
  const meanDeviation = deviations.reduce((total, value) => total + value, 0) / deviations.length;
  const standardDeviation = deviations.length >= MIN_VARIABILITY_SAMPLE_COUNT
    ? Math.sqrt(deviations.reduce((total, value) => total + (value - meanDeviation) ** 2, 0) / deviations.length)
    : null;
  const normalizedCenter = normalizeClockMinutes(center);
  return {
    count: values.length,
    medianLocalMinutes: round(normalizedCenter),
    medianLocalTime: formatClockTime(normalizedCenter),
    standardDeviationMinutes: standardDeviation === null ? null : round(standardDeviation),
  };
}

function circularMedian(values: readonly number[]): number {
  const sorted = values.map(normalizeClockMinutes).sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0] as number;

  let largestGapIndex = 0;
  let largestGap = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index] as number;
    const next = index === sorted.length - 1
      ? (sorted[0] as number) + 1_440
      : sorted[index + 1] as number;
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const startIndex = (largestGapIndex + 1) % sorted.length;
  const unwrapped = Array.from({ length: sorted.length }, (_, offset) => {
    const index = (startIndex + offset) % sorted.length;
    const value = sorted[index] as number;
    return index < startIndex ? value + 1_440 : value;
  });
  return normalizeClockMinutes(median(unwrapped));
}

function weekdayWeekendDrift(weekday: readonly number[], weekend: readonly number[]): number | null {
  if (weekday.length < MIN_WEEKDAY_WEEKEND_SAMPLE_COUNT || weekend.length < MIN_WEEKDAY_WEEKEND_SAMPLE_COUNT) {
    return null;
  }
  return round(Math.abs(shortestClockDifference(circularMedian(weekend), circularMedian(weekday))));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : sorted[middle] as number;
}

function shortestClockDifference(value: number, center: number): number {
  return ((value - center + 720) % 1_440 + 1_440) % 1_440 - 720;
}

function normalizeClockMinutes(value: number): number {
  return ((value % 1_440) + 1_440) % 1_440;
}

function formatClockTime(value: number): string {
  const rounded = Math.round(normalizeClockMinutes(value)) % 1_440;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isWeekendIsoDate(value: string): boolean {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function buildPatternNotes(input: {
  allSourcesStale: boolean;
  awakeCount: number;
  collapsedOverlapCount: number;
  expectedNightCount: number;
  excludedNapOnlyDateCount: number;
  reportingTimeZoneFallbackNightCount: number;
  lateArrivingNightCount: number;
  localDateMismatchCount: number;
  omittedEvidenceCount: number;
  timingOmittedNightCount: number;
  providerMix: boolean;
  reportingTimeZone: string | null;
  reportingTimeZoneSource: WearableSleepReportingTimeZoneSource;
  requestedToCappedAtAsOf: boolean;
  sameDateSessionSuppressedCount: number;
  sourceFreshnessCount: number;
  futureSourceEvidenceExcludedCount: number;
  timeZones: readonly string[];
  unknownSleepTypeNightCount: number;
  validNightCount: number;
}): string[] {
  const notes = [
    `Coverage counts usable wearable sleep summaries across ${input.expectedNightCount} calendar dates; missing dates do not mean the user did not sleep.`,
  ];
  if (input.reportingTimeZone === null) {
    notes.push("No validated reporting time zone was available; freshness calendar boundaries use UTC, while local clock statistics remain omitted.");
  }
  if (input.reportingTimeZoneSource === "vault_metadata") {
    notes.push(`The validated reporting time zone (${input.reportingTimeZone}) came from vault metadata.`);
  }
  if (input.requestedToCappedAtAsOf) {
    notes.push("The requested end date was after the as-of date, so coverage and missing-night counts stop at the as-of date.");
  }
  if (input.futureSourceEvidenceExcludedCount > 0) {
    notes.push(`Ignored ${input.futureSourceEvidenceExcludedCount} provider freshness row${input.futureSourceEvidenceExcludedCount === 1 ? "" : "s"} dated after the as-of date.`);
  }
  if (input.validNightCount === 0) {
    notes.push("No completed, usable non-nap sleep windows were available in this range.");
  } else if (input.validNightCount < MIN_VARIABILITY_SAMPLE_COUNT) {
    notes.push(`Only ${input.validNightCount} usable nights were available; variability remains unavailable until at least ${MIN_VARIABILITY_SAMPLE_COUNT} nights are present.`);
  }
  if (input.unknownSleepTypeNightCount > 0) {
    notes.push(`${input.unknownSleepTypeNightCount} included night${input.unknownSleepTypeNightCount === 1 ? " had" : "s had"} no explicit main-sleep or nap identity; presentation titles were not used to guess.`);
  }
  if (input.excludedNapOnlyDateCount > 0) {
    notes.push(`Excluded ${input.excludedNapOnlyDateCount} date${input.excludedNapOnlyDateCount === 1 ? "" : "s"} whose selected sleep summary was explicitly a nap.`);
  }
  if (input.reportingTimeZoneFallbackNightCount > 0) {
    notes.push(`${input.reportingTimeZoneFallbackNightCount} usable night${input.reportingTimeZoneFallbackNightCount === 1 ? " lacked" : "s lacked"} a canonical IANA time zone and used the validated reporting-zone fallback.`);
  }
  if (input.timingOmittedNightCount > 0) {
    notes.push(`${input.timingOmittedNightCount} usable night${input.timingOmittedNightCount === 1 ? " lacked" : "s lacked"} a canonical IANA time zone; clock timing was omitted for those nights.`);
  }
  if (input.timeZones.length > 1) {
    notes.push("Clock statistics combine each night's canonical local time across multiple time zones; travel or timezone changes may contribute to variability.");
  }
  if (input.providerMix) {
    notes.push("Selected sleep windows came from multiple providers; provider changes may contribute to apparent shifts.");
  }
  if (input.collapsedOverlapCount > 0) {
    notes.push(`Suppressed ${input.collapsedOverlapCount} non-identical overlapping sleep window${input.collapsedOverlapCount === 1 ? "" : "s"} instead of averaging both into the pattern.`);
  }
  if (input.sameDateSessionSuppressedCount > 0) {
    notes.push(`Suppressed ${input.sameDateSessionSuppressedCount} additional non-overlapping sleep session${input.sameDateSessionSuppressedCount === 1 ? "" : "s"} on dates that already had a preferred main-sleep window, so nightly statistics weight each date once.`);
  }
  if (input.omittedEvidenceCount > 0) {
    notes.push(`Sleep-window support evidence was capped per stored summary; ${input.omittedEvidenceCount} additional candidate window${input.omittedEvidenceCount === 1 ? " was" : "s were"} omitted from overlap and same-date classification.`);
  }
  if (input.localDateMismatchCount > 0) {
    notes.push(`${input.localDateMismatchCount} stored sleep date${input.localDateMismatchCount === 1 ? " differed" : "s differed"} from the localized sleep-end date; localized end dates anchor this analysis.`);
  }
  if (input.lateArrivingNightCount > 0) {
    notes.push(`${input.lateArrivingNightCount} sleep summar${input.lateArrivingNightCount === 1 ? "y arrived" : "ies arrived"} more than 24 hours after the selected sleep window ended.`);
  }
  if (input.awakeCount > 0) {
    notes.push("Awake minutes remain provider-reported awake time and are not relabeled as WASO or awakening count.");
  }
  if (input.allSourcesStale) {
    notes.push(`Every wearable source with sleep evidence is more than ${SLEEP_SOURCE_STALE_AFTER_DAYS} days behind the as-of date.`);
  } else if (input.sourceFreshnessCount === 0) {
    notes.push("Per-source sleep freshness was unavailable.");
  }
  return notes;
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
