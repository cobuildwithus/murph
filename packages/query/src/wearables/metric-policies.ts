import { compareIsoDesc, normalizeLowercaseString } from "./shared.ts";
import type { WearableMetricCandidate, WearableMetricKey } from "./types.ts";

const WHOOP_DAY_STRAIN_FRAGMENT_PENALTY = -8;

export function scoreMetricPolicy(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
  candidates: readonly WearableMetricCandidate[],
): number {
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
