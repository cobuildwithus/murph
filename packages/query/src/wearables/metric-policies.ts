import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
  isStrictIsoDate,
  normalizeIanaTimeZone,
  resolveFloatingIsoTimestampInTimeZone,
} from "@murphai/contracts";

import { normalizeWearableOriginSourceSlug } from "./origin.ts";
import { isActivitySummaryResource } from "./provider-policy.ts";
import { compareIsoDesc, normalizeLowercaseString } from "./shared.ts";
import type { WearableMetricCandidate, WearableMetricKey } from "./types.ts";

const WHOOP_DAY_STRAIN_FRAGMENT_PENALTY = -8;
// Outranks every other score, including the Junction duplicate penalty.
const PASSED_OVER_STEPS_PENALTY = -10_000;
const WORN_SOURCE_TYPES: ReadonlySet<string> = new Set(["ring", "watch"]);
const MERGED_SOURCE_TYPES: ReadonlySet<string> = new Set(["multiple-sources"]);
const MINIMUM_WORN_SHARE_OF_MERGED_STEPS = 0.5;

export function scoreMetricPolicy(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
  candidates: readonly WearableMetricCandidate[],
): number {
  if (metric === "steps") {
    // Keep every source as evidence, but only let plausible counts compete for the day.
    const eligible = candidates.filter(point => point.value > 0 && point.value <= 1_000_000);
    const dailyTotals = selectDailyStepsTotals(eligible) ?? eligible;
    return dailyTotals.length === 0 || dailyTotals.some((total) => total.candidateId === candidate.candidateId)
      ? 0
      : PASSED_OVER_STEPS_PENALTY;
  }

  if (!isWhoopDayStrainCycleCandidate(metric, candidate)) {
    return 0;
  }

  const sameDayCandidates = collectSameDayWhoopDayStrainCycleCandidates(metric, candidate, candidates);
  if (sameDayCandidates.length < 2) {
    return 0;
  }

  const representative = selectWhoopDayStrainCycleRepresentative(sameDayCandidates);
  return representative?.candidateId === candidate.candidateId
    ? 0
    : WHOOP_DAY_STRAIN_FRAGMENT_PENALTY;
}

/**
 * The candidates still in the running for a day's steps; null leaves all in.
 *
 * A merged total combines every app writing to a health store, so it can count
 * a device twice or miss a walk without the phone. A worn device's own daily
 * total is the day's count, unless it is so far below the merged total that the
 * device came off or reported nothing, or it is a partial count of a finished
 * day. Without a merged total to weigh it against, a worn total that counts
 * still passes over sums of a source's samples, which cover part of a day.
 */
function selectDailyStepsTotals(
  candidates: readonly WearableMetricCandidate[],
): readonly WearableMetricCandidate[] | null {
  const dailyTotals = candidates.filter((candidate) => isActivitySummaryResource(candidate.externalRef?.resourceType));
  const withSourceType = (sourceTypes: ReadonlySet<string>) => dailyTotals
    .filter((candidate) => sourceTypes.has(normalizeWearableOriginSourceSlug(candidate.dataOrigin?.sourceType) ?? ""));
  const highest = (totals: readonly WearableMetricCandidate[]) =>
    [...totals].sort((left, right) => right.value - left.value)[0];
  const wornTotals = withSourceType(WORN_SOURCE_TYPES);
  if (wornTotals.length === 0) {
    return null;
  }

  const worn = highest(wornTotals.filter((candidate) => !candidate.partialCountOfFinishedDay));
  const merged = highest(withSourceType(MERGED_SOURCE_TYPES));
  if (merged) {
    return [worn && worn.value >= merged.value * MINIMUM_WORN_SHARE_OF_MERGED_STEPS ? worn : merged];
  }

  return worn && worn.value > 0 ? dailyTotals : null;
}

/**
 * When a record's own calendar day ends. The record's time zone decides, so a
 * day that gains or loses an hour ends on time; its UTC offset is the fallback.
 * Null when neither gives one instant, and the record then keeps its standing.
 */
export function resolveLocalDayEndMs(
  date: string,
  timeZone: string | null | undefined,
  timeZoneOffsetMinutes: number | null | undefined,
): number | null {
  if (!isStrictIsoDate(date)) {
    return null;
  }

  const nextDate = addDaysToIsoDate(date, 1);
  const nextDateUtcMs = Date.parse(`${nextDate}T00:00:00.000Z`);
  if (!Number.isFinite(nextDateUtcMs)) {
    return null;
  }

  const offsetEndMs = typeof timeZoneOffsetMinutes === "number" && Number.isFinite(timeZoneOffsetMinutes)
    ? nextDateUtcMs - timeZoneOffsetMinutes * 60_000
    : null;
  const zone = normalizeIanaTimeZone(timeZone);
  if (!zone) {
    return offsetEndMs;
  }

  // The record's offset is its zone's offset at that midnight on all but the
  // days the clocks change, and one lookup confirms it without a search.
  if (offsetEndMs !== null) {
    const local = formatTimeZoneDateTimeParts(offsetEndMs, zone);
    if (local.dayKey === nextDate && local.hour === 0 && local.minute === 0 && local.second === 0) {
      return offsetEndMs;
    }
  }

  const zoned = resolveFloatingIsoTimestampInTimeZone(`${nextDate}T00:00:00`, zone);
  return zoned ? Date.parse(zoned.timestamp) : offsetEndMs;
}

/**
 * A daily total last recorded before its own day ended counts only part of that
 * day. The day is finished once the vault holds a steps total recorded after it
 * ended; until then the day may still be open and the total keeps its standing.
 */
export function isPartialCountOfFinishedDay(input: {
  dayEndMs: number | null;
  evidenceThroughMs: number;
  recordedAt: string | null;
}): boolean {
  const recordedMs = input.recordedAt ? Date.parse(input.recordedAt) : Number.NaN;
  return input.dayEndMs !== null
    && Number.isFinite(recordedMs)
    && recordedMs < input.dayEndMs
    && input.dayEndMs <= input.evidenceThroughMs;
}

function collectSameDayWhoopDayStrainCycleCandidates(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  if (!isWhoopDayStrainCycleCandidate(metric, candidate)) {
    return [];
  }

  const provider = normalizeLowercaseString(candidate.provider);
  return candidates.filter((other) =>
    isWhoopDayStrainCycleCandidate(metric, other)
    && other.date === candidate.date
    && normalizeLowercaseString(other.provider) === provider
  );
}

function selectWhoopDayStrainCycleRepresentative(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate | null {
  return [...candidates].sort(compareWhoopDayStrainCycleRepresentativeCandidates)[0] ?? null;
}

function compareWhoopDayStrainCycleRepresentativeCandidates(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  if (left.value !== right.value) {
    return right.value - left.value;
  }

  const timestampDifference = compareIsoDesc(
    left.recordedAt ?? left.occurredAt,
    right.recordedAt ?? right.occurredAt,
  );
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.candidateId.localeCompare(right.candidateId);
}

function isWhoopDayStrainCycleCandidate(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
): boolean {
  const provider = normalizeLowercaseString(candidate.provider);
  const resourceType = normalizeLowercaseString(candidate.externalRef?.resourceType);
  const facet = normalizeLowercaseString(candidate.externalRef?.facet);
  const sourceKind = normalizeLowercaseString(candidate.sourceKind);

  return metric === "dayStrain"
    && candidate.metric === "dayStrain"
    && provider === "whoop"
    && resourceType === "cycle"
    && (sourceKind === "observation:day-strain" || facet === "day-strain");
}
