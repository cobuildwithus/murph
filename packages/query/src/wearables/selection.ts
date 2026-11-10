import { canonicalizeWearableProviderSlug } from "@murphai/health-metrics";

import { dedupeExactMetricCandidates } from "./dedupe.ts";
import {
  compareWearableProviders,
  hasDirectWearableProviderForSource,
  resolveMetricTolerance,
  resourceTypeScore,
  sourceFamilyScore,
} from "./provider-policy.ts";
import { isAppleWatchWearableSource, normalizeWearableOriginSourceSlug, resolveWearablePublicSourceProvider } from "./origin.ts";
import {
  scoreMetricPolicy,
} from "./metric-policies.ts";
import { compareIsoDesc, normalizeLowercaseString } from "./shared.ts";
import type {
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricKey,
  WearableMetricPolicyFamily,
  WearableMetricScorecard,
  WearableMetricSelection,
  WearableResolvedMetric,
  WearableSleepWindowScorecard,
  WearableSleepWindowCandidate,
} from "./types.ts";

const JUNCTION_UNSUPPORTED_SOURCE_PRIORITY_BOOST = 3;
const JUNCTION_DIRECT_DUPLICATE_PENALTY = -1_000;
const HEALTH_STORE_FALLBACK_PENALTY = -1_000;
const HEALTH_STORES: ReadonlySet<string> = new Set([
  "apple-health", "apple-health-kit", "google-health", "google-fit", "health-connect", "samsung-health",
]);

export function resolveMetric(
  metric: WearableMetricKey,
  candidates: readonly WearableMetricCandidate[],
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): WearableResolvedMetric {
  const deduped = dedupeExactMetricCandidates(candidates);
  const rankedCandidates = rankMetricCandidates(metric, deduped.candidates, options);
  const sortedCandidates = rankedCandidates.sortedCandidates;
  const selectionCandidate = sortedCandidates[0] ?? null;
  const selectionScorecard = selectionCandidate
    ? rankedCandidates.scorecards.get(selectionCandidate.candidateId) ?? null
    : null;
  const runnerUpScorecard = sortedCandidates[1]
    ? rankedCandidates.scorecards.get(sortedCandidates[1].candidateId) ?? null
    : null;
  const conflictingProviders = selectionCandidate
    ? [...new Set(
        sortedCandidates
          .filter((candidate) => candidate.provider !== selectionCandidate.provider)
          .filter((candidate) => !isWithinMetricTolerance(metric, selectionCandidate.value, candidate.value))
          .map((candidate) => candidate.provider),
      )]
    : [];
  const confidenceLevel = inferMetricConfidenceLevel({
    candidateCount: sortedCandidates.length,
    conflictingProviders,
    scoreMargin: selectionScorecard && runnerUpScorecard
      ? selectionScorecard.total - runnerUpScorecard.total
      : null,
    selectionAgreementScore: selectionScorecard?.agreementScore ?? 0,
    selectionCandidate,
  });

  return {
    candidates: sortedCandidates,
    confidence: {
      candidateCount: sortedCandidates.length,
      conflictingProviders,
      exactDuplicateCount: deduped.exactDuplicateCount,
      level: confidenceLevel,
    },
    metric,
    selection: selectionCandidate
      ? {
          occurredAt: selectionCandidate.occurredAt,
          paths: selectionCandidate.paths,
          provider: selectionCandidate.provider,
          recordedAt: selectionCandidate.recordedAt,
          recordIds: selectionCandidate.recordIds,
          resolution: "direct",
          sourceFamily: selectionCandidate.sourceFamily,
          sourceKind: selectionCandidate.sourceKind,
          title: selectionCandidate.title,
          fallbackFromMetric: null,
          fallbackReason: null,
          unit: selectionCandidate.unit,
          value: selectionCandidate.value,
        }
      : emptyMetricSelection(),
  };
}

export function withMetricFallback(
  metric: WearableResolvedMetric,
  fallback: WearableResolvedMetric,
  reason: string,
): WearableResolvedMetric {
  if (metric.selection.value !== null || fallback.selection.value === null) {
    return metric;
  }

  return {
    candidates: [...fallback.candidates],
    confidence: { ...fallback.confidence },
    metric: metric.metric,
    selection: {
      ...fallback.selection,
      fallbackFromMetric: fallback.metric,
      fallbackReason: reason,
      resolution: "fallback",
    },
  };
}

export function resolveSleepWindowSelection(
  candidates: readonly WearableSleepWindowCandidate[],
): {
  confidence: WearableMetricConfidence;
  selection: WearableSleepWindowCandidate | null;
} {
  const rankedWindows = rankSleepWindows(candidates);
  const sorted = rankedWindows.sortedCandidates;
  const selection = sorted[0] ?? null;
  const selectionScorecard = selection
    ? rankedWindows.scorecards.get(selection.candidateId) ?? null
    : null;
  const runnerUpScorecard = sorted[1]
    ? rankedWindows.scorecards.get(sorted[1].candidateId) ?? null
    : null;
  const conflictingProviders = selection
    ? [...new Set(
        sorted
          .filter((candidate) => candidate.provider !== selection.provider)
          .filter((candidate) => !isWithinMetricTolerance("sessionMinutes", candidate.durationMinutes, selection.durationMinutes))
          .map((candidate) => candidate.provider),
      )]
    : [];
  return {
    confidence: {
      candidateCount: sorted.length,
      conflictingProviders,
      exactDuplicateCount: 0,
      level: inferMetricConfidenceLevel({
        candidateCount: sorted.length,
        conflictingProviders,
        scoreMargin: selectionScorecard && runnerUpScorecard
          ? selectionScorecard.total - runnerUpScorecard.total
          : null,
        selectionAgreementScore: selectionScorecard?.agreementScore ?? 0,
        selectionCandidate: selection
          ? {
              candidateId: selection.candidateId,
              date: selection.date,
              externalRef: selection.externalRef,
              metric: "sessionMinutes",
              occurredAt: selection.occurredAt,
              paths: selection.paths,
              provider: selection.provider,
              recordedAt: selection.recordedAt,
              recordIds: selection.recordIds,
              sourceFamily: selection.sourceFamily,
              sourceKind: selection.sourceKind,
              title: selection.title,
              unit: "minutes",
              value: selection.durationMinutes,
            }
          : null,
      }),
    },
    selection,
  };
}

function rankMetricCandidates(
  metric: WearableMetricKey,
  candidates: readonly WearableMetricCandidate[],
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): {
  scorecards: Map<string, WearableMetricScorecard>;
  sortedCandidates: WearableMetricCandidate[];
} {
  const providerScores = buildProviderRankScores(
    metric,
    candidates.map((candidate) => candidate.provider),
    options,
  );
  const recencyScores = buildTimestampRankScores(
    candidates.map((candidate) => candidate.recordedAt ?? candidate.occurredAt),
  );
  const scorecards = new Map<string, WearableMetricScorecard>();
  const healthStoreFallbackScore = buildHealthStoreFallbackScore(candidates);

  for (const candidate of candidates) {
    const providerScore =
      (providerScores.get(candidate.provider) ?? 0) + scoreJunctionSourcePolicy(candidate, candidates)
      + (metric === "steps" ? 0 : healthStoreFallbackScore(candidate));
    const resourceScore = resourceTypeScore(metric, candidate.externalRef?.resourceType);
    const familyScore = sourceFamilyScore(candidate.sourceFamily);
    const recencyScore = recencyScores.get(candidate.recordedAt ?? candidate.occurredAt ?? "") ?? 0;
    const agreementScore = scoreMetricAgreement(metric, candidate, candidates);
    const metricPolicyScore = scoreMetricPolicy(metric, candidate, candidates);

    scorecards.set(candidate.candidateId, {
      agreementScore,
      metricPolicyScore,
      providerScore,
      recencyScore,
      resourceScore,
      sourceFamilyScore: familyScore,
      total: providerScore + resourceScore + familyScore + recencyScore + agreementScore + metricPolicyScore,
    });
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftScore = scorecards.get(left.candidateId);
    const rightScore = scorecards.get(right.candidateId);
    const totalDifference = (rightScore?.total ?? 0) - (leftScore?.total ?? 0);
    if (totalDifference !== 0) {
      return totalDifference;
    }

    const resourceDifference = (rightScore?.resourceScore ?? 0) - (leftScore?.resourceScore ?? 0);
    if (resourceDifference !== 0) {
      return resourceDifference;
    }

    const metricPolicyDifference =
      (rightScore?.metricPolicyScore ?? 0) - (leftScore?.metricPolicyScore ?? 0);
    if (metricPolicyDifference !== 0) {
      return metricPolicyDifference;
    }

    const recencyDifference = (rightScore?.recencyScore ?? 0) - (leftScore?.recencyScore ?? 0);
    if (recencyDifference !== 0) {
      return recencyDifference;
    }

    const timestampDifference = compareIsoDesc(left.recordedAt ?? left.occurredAt, right.recordedAt ?? right.occurredAt);
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return left.candidateId.localeCompare(right.candidateId);
  });

  return {
    scorecards,
    sortedCandidates,
  };
}

function rankSleepWindows(
  candidates: readonly WearableSleepWindowCandidate[],
): {
  scorecards: Map<string, WearableSleepWindowScorecard>;
  sortedCandidates: WearableSleepWindowCandidate[];
} {
  const explicitMainSleep = candidates.filter((candidate) => candidate.sleepType === "main_sleep");
  const nonNapSleep = candidates.filter((candidate) => candidate.sleepType !== "nap" && !candidate.nap);
  const eligibleCandidates = explicitMainSleep.length > 0
    ? explicitMainSleep
    : nonNapSleep.length > 0
      ? nonNapSleep
      : [...candidates];
  const providerScores = buildProviderRankScores(
    "sessionMinutes",
    eligibleCandidates.map((candidate) => candidate.provider),
    { metricFamily: "sleep" },
  );
  const recencyScores = buildTimestampRankScores(
    eligibleCandidates.map((candidate) => candidate.recordedAt ?? candidate.endAt ?? candidate.startAt),
  );
  const durationScores = buildNumberRankScores(eligibleCandidates.map((candidate) => candidate.durationMinutes));
  const maxDurationMinutes = Math.max(0, ...eligibleCandidates.map((candidate) => candidate.durationMinutes));
  const scorecards = new Map<string, WearableSleepWindowScorecard>();
  const healthStoreFallbackScore = buildHealthStoreFallbackScore(eligibleCandidates);

  for (const candidate of eligibleCandidates) {
    const providerScore =
      (providerScores.get(candidate.provider) ?? 0) + scoreJunctionSourcePolicy(candidate, eligibleCandidates)
      + healthStoreFallbackScore(candidate);
    const recencyScore = recencyScores.get(candidate.recordedAt ?? candidate.endAt ?? candidate.startAt ?? "") ?? 0;
    const durationScore = durationScores.get(candidate.durationMinutes) ?? 0;
    const agreementScore = scoreSleepWindowAgreement(candidate, eligibleCandidates);
    const napPenalty = candidate.nap || isShortWindowBesideMainSleep(candidate, maxDurationMinutes) ? -6 : 0;

    scorecards.set(candidate.candidateId, {
      agreementScore,
      durationScore,
      napPenalty,
      providerScore,
      recencyScore,
      total: providerScore + durationScore + recencyScore + agreementScore + napPenalty,
    });
  }

  const sortedCandidates = [...eligibleCandidates].sort((left, right) => {
    const leftScore = scorecards.get(left.candidateId);
    const rightScore = scorecards.get(right.candidateId);
    const totalDifference = (rightScore?.total ?? 0) - (leftScore?.total ?? 0);
    if (totalDifference !== 0) {
      return totalDifference;
    }

    if (left.durationMinutes !== right.durationMinutes) {
      return right.durationMinutes - left.durationMinutes;
    }

    const timestampDifference = compareIsoDesc(
      left.recordedAt ?? left.endAt ?? left.startAt,
      right.recordedAt ?? right.endAt ?? right.startAt,
    );
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return left.candidateId.localeCompare(right.candidateId);
  });

  return {
    scorecards,
    sortedCandidates,
  };
}

function isShortWindowBesideMainSleep(
  candidate: WearableSleepWindowCandidate,
  maxDurationMinutes: number,
): boolean {
  return maxDurationMinutes >= 180 && candidate.durationMinutes < maxDurationMinutes / 2;
}

function buildProviderRankScores(
  metric: WearableMetricKey,
  providers: readonly string[],
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): Map<string, number> {
  const orderedProviders = [...new Set(providers)].sort((left, right) =>
    compareWearableProviders(metric, left, right, options),
  );
  const scores = new Map<string, number>();

  orderedProviders.forEach((provider, index) => {
    scores.set(provider, Math.max(orderedProviders.length - index, 0));
  });

  return scores;
}

/** Health stores can contain a copy of a wearable's own reading. A later sync
 * or agreement with another copy must not displace the device on the same day.
 * Steps keep their separate worn-coverage policy, including partial-day fallback.
 * One ranking scores every candidate against the same list, so each
 * candidate's role is resolved once per list instead of once per pair. */
function buildHealthStoreFallbackScore<
  TCandidate extends WearableMetricCandidate | WearableSleepWindowCandidate,
>(candidates: readonly TCandidate[]): (candidate: TCandidate) => number {
  const roles = new Map<TCandidate, "store" | "device" | null>();
  const roleOf = (item: TCandidate) => {
    let role = roles.get(item);
    if (role === undefined) {
      role = resolveHealthStoreFallbackRole(item);
      roles.set(item, role);
    }
    return role;
  };
  return (candidate) =>
    roleOf(candidate) === "store"
      && candidates.some((other) => other.date === candidate.date && roleOf(other) === "device")
      ? HEALTH_STORE_FALLBACK_PENALTY
      : 0;
}

function resolveHealthStoreFallbackRole(
  item: WearableMetricCandidate | WearableSleepWindowCandidate,
): "store" | "device" | null {
  const provider = resolveWearablePublicSourceProvider(item);
  const sourceType = normalizeWearableOriginSourceSlug(item.dataOrigin?.sourceType);
  if (
    !isAppleWatchWearableSource(item)
    && (HEALTH_STORES.has(provider) || sourceType === "multiple-sources")
  ) {
    return "store";
  }
  return sourceType === "watch" || sourceType === "ring" || hasDirectWearableProviderForSource(provider)
    ? "device"
    : null;
}

function scoreJunctionSourcePolicy(
  candidate: WearableMetricCandidate | WearableSleepWindowCandidate,
  candidates: readonly (WearableMetricCandidate | WearableSleepWindowCandidate)[],
): number {
  if (normalizeLowercaseString(candidate.provider) !== "junction") {
    return 0;
  }

  const sourceProviderSlug = normalizeWearableOriginSourceSlug(candidate.dataOrigin?.sourceProviderSlug);
  if (!sourceProviderSlug) {
    return 0;
  }

  if (!hasDirectWearableProviderForSource(sourceProviderSlug)) {
    return JUNCTION_UNSUPPORTED_SOURCE_PRIORITY_BOOST;
  }

  const sourceProvider = canonicalizeWearableProviderSlug(sourceProviderSlug);
  const directCandidateExists = candidates.some((other) => {
    const provider = normalizeLowercaseString(other.provider);
    if (
      !provider
      || provider === "junction"
      || normalizeWearableOriginSourceSlug(other.dataOrigin?.aggregatorProvider) === "junction"
    ) {
      return false;
    }

    return canonicalizeWearableProviderSlug(provider) === sourceProvider;
  });
  return directCandidateExists ? JUNCTION_DIRECT_DUPLICATE_PENALTY : 0;
}

function buildTimestampRankScores(
  values: readonly (string | null | undefined)[],
): Map<string, number> {
  const uniqueDescending = [...new Set(
    values.filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort((left, right) => right.localeCompare(left));
  const scores = new Map<string, number>();

  uniqueDescending.forEach((value, index) => {
    scores.set(value, Math.max(3 - index, 0));
  });

  return scores;
}

function buildNumberRankScores(
  values: readonly number[],
): Map<number, number> {
  const uniqueDescending = [...new Set(values)].sort((left, right) => right - left);
  const scores = new Map<number, number>();

  uniqueDescending.forEach((value, index) => {
    scores.set(value, Math.max(3 - index, 0));
  });

  return scores;
}

function scoreMetricAgreement(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
  candidates: readonly WearableMetricCandidate[],
): number {
  return Math.min(
    2,
    [...new Set(
      candidates
        .filter((other) => other.candidateId !== candidate.candidateId)
        .filter((other) => other.provider !== candidate.provider)
        .filter((other) => isWithinMetricTolerance(metric, candidate.value, other.value))
        .map((other) => other.provider),
    )].length,
  );
}

function scoreSleepWindowAgreement(
  candidate: WearableSleepWindowCandidate,
  candidates: readonly WearableSleepWindowCandidate[],
): number {
  return Math.min(
    2,
    [...new Set(
      candidates
        .filter((other) => other.candidateId !== candidate.candidateId)
        .filter((other) => other.provider !== candidate.provider)
        .filter((other) => other.sleepType !== "nap" && !other.nap)
        .filter((other) => isWithinMetricTolerance("sessionMinutes", candidate.durationMinutes, other.durationMinutes))
        .map((other) => other.provider),
    )].length,
  );
}

export function compareSleepWindowByDateDesc(
  left: WearableSleepWindowCandidate,
  right: WearableSleepWindowCandidate,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  const timestampDifference = compareIsoDesc(
    left.recordedAt ?? left.endAt ?? left.startAt,
    right.recordedAt ?? right.endAt ?? right.startAt,
  );
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.candidateId.localeCompare(right.candidateId);
}

export function compareMetricCandidateByDateDesc(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return left.candidateId.localeCompare(right.candidateId);
}

export function emptyMetricSelection(): WearableMetricSelection {
  return {
    fallbackFromMetric: null,
    fallbackReason: null,
    occurredAt: null,
    paths: [],
    provider: null,
    recordedAt: null,
    recordIds: [],
    resolution: "none",
    sourceFamily: null,
    sourceKind: null,
    title: null,
    unit: null,
    value: null,
  };
}

function inferMetricConfidenceLevel(input: {
  candidateCount: number;
  conflictingProviders: string[];
  scoreMargin: number | null;
  selectionAgreementScore: number;
  selectionCandidate: WearableMetricCandidate | null;
}): "none" | "low" | "medium" | "high" {
  if (!input.selectionCandidate) {
    return "none";
  }

  if (input.candidateCount === 1) {
    return "high";
  }

  if (input.conflictingProviders.length === 0) {
    return "high";
  }

  if (input.selectionAgreementScore > 0) {
    return "medium";
  }

  return (input.scoreMargin ?? 0) >= 2 ? "medium" : "low";
}

function isWithinMetricTolerance(
  metric: WearableMetricKey,
  left: number,
  right: number,
): boolean {
  return Math.abs(left - right) <= resolveMetricTolerance(metric);
}
