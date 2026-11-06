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
    const dailyTotal = selectDailyStepsTotal(candidates);
    return !dailyTotal || dailyTotal.candidateId === candidate.candidateId ? 0 : PASSED_OVER_STEPS_PENALTY;
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
 * A merged total combines every app writing to a health store, so it can count
 * a device twice or miss a walk without the phone. A worn device's own daily
 * total is the day's count, unless it is so far below the merged total that the
 * device came off. Days without both keep the standard ranking.
 */
function selectDailyStepsTotal(candidates: readonly WearableMetricCandidate[]): WearableMetricCandidate | null {
  const dailyTotals = candidates.filter((candidate) => isActivitySummaryResource(candidate.externalRef?.resourceType));
  const highest = (sourceTypes: ReadonlySet<string>) => dailyTotals
    .filter((candidate) => sourceTypes.has(normalizeWearableOriginSourceSlug(candidate.dataOrigin?.sourceType) ?? ""))
    .sort((left, right) => right.value - left.value)[0];
  const worn = highest(WORN_SOURCE_TYPES);
  const merged = highest(MERGED_SOURCE_TYPES);
  if (!worn || worn.value <= 0 || !merged) {
    return null;
  }

  return worn.value >= merged.value * MINIMUM_WORN_SHARE_OF_MERGED_STEPS ? worn : merged;
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
