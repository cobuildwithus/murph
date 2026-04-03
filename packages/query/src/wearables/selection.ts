import { dedupeExactMetricCandidates } from "./dedupe.ts";
import {
  compareWearableProviders,
  formatMetricLabel,
  formatProviderName,
  resolveMetricTolerance,
  resourceTypeScore,
  sourceFamilyScore,
} from "./provider-policy.ts";
import { compareIsoDesc } from "./shared.ts";
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
  const agreeingProviders = selectionCandidate
    ? [...new Set(
        sortedCandidates
          .filter((candidate) => isWithinMetricTolerance(metric, selectionCandidate.value, candidate.value))
          .map((candidate) => candidate.provider),
      )]
    : [];
  const reasons: string[] = [];

  if (deduped.exactDuplicateCount > 0) {
    reasons.push(
      `Suppressed ${deduped.exactDuplicateCount} exact duplicate candidate${deduped.exactDuplicateCount === 1 ? "" : "s"}.`,
    );
  }

  if (selectionCandidate && selectionScorecard) {
    reasons.push(
      buildMetricSelectionReason(
        metric,
        selectionCandidate,
        selectionScorecard,
        sortedCandidates[1] ?? null,
        runnerUpScorecard,
      ),
    );
  }

  if (agreeingProviders.length > 1) {
    reasons.push(`Providers agreed within tolerance: ${agreeingProviders.map(formatProviderName).join(", ")}.`);
  }

  if (conflictingProviders.length > 0) {
    reasons.push(`Conflicting values remained from ${conflictingProviders.map(formatProviderName).join(", ")}.`);
  }

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
      reasons,
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

export function withSleepFallback(
  metric: WearableResolvedMetric,
  fallback: WearableResolvedMetric,
  reason: string,
): WearableResolvedMetric {
  if (metric.selection.value !== null || fallback.selection.value === null) {
    return metric;
  }

  return {
    candidates: [...fallback.candidates],
    confidence: {
      ...fallback.confidence,
      reasons: [reason, ...fallback.confidence.reasons],
    },
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
  const reasons: string[] = [];

  if (selection && selectionScorecard) {
    reasons.push(
      buildSleepWindowSelectionReason(
        selection,
        selectionScorecard,
        sorted[1] ?? null,
        runnerUpScorecard,
      ),
    );
  }

  if (conflictingProviders.length > 0) {
    reasons.push(`Sleep windows differed across ${conflictingProviders.map(formatProviderName).join(", ")}.`);
  }

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
              externalRef: null,
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
      reasons,
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

  for (const candidate of candidates) {
    const providerScore = providerScores.get(candidate.provider) ?? 0;
    const resourceScore = resourceTypeScore(metric, candidate.externalRef?.resourceType);
    const familyScore = sourceFamilyScore(candidate.sourceFamily);
    const recencyScore = recencyScores.get(candidate.recordedAt ?? candidate.occurredAt ?? "") ?? 0;
    const agreementScore = scoreMetricAgreement(metric, candidate, candidates);

    scorecards.set(candidate.candidateId, {
      agreementScore,
      providerScore,
      recencyScore,
      resourceScore,
      sourceFamilyScore: familyScore,
      total: providerScore + resourceScore + familyScore + recencyScore + agreementScore,
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
  const providerScores = buildProviderRankScores(
    "sessionMinutes",
    candidates.map((candidate) => candidate.provider),
    { metricFamily: "sleep" },
  );
  const recencyScores = buildTimestampRankScores(
    candidates.map((candidate) => candidate.recordedAt ?? candidate.endAt ?? candidate.startAt),
  );
  const durationScores = buildNumberRankScores(candidates.map((candidate) => candidate.durationMinutes));
  const scorecards = new Map<string, WearableSleepWindowScorecard>();

  for (const candidate of candidates) {
    const providerScore = providerScores.get(candidate.provider) ?? 0;
    const recencyScore = recencyScores.get(candidate.recordedAt ?? candidate.endAt ?? candidate.startAt ?? "") ?? 0;
    const durationScore = durationScores.get(candidate.durationMinutes) ?? 0;
    const agreementScore = scoreSleepWindowAgreement(candidate, candidates);
    const napPenalty = candidate.nap ? -6 : 0;

    scorecards.set(candidate.candidateId, {
      agreementScore,
      durationScore,
      napPenalty,
      providerScore,
      recencyScore,
      total: providerScore + durationScore + recencyScore + agreementScore + napPenalty,
    });
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
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
        .filter((other) => !other.nap)
        .filter((other) => isWithinMetricTolerance("sessionMinutes", candidate.durationMinutes, other.durationMinutes))
        .map((other) => other.provider),
    )].length,
  );
}

function buildMetricSelectionReason(
  metric: WearableMetricKey,
  candidate: WearableMetricCandidate,
  scorecard: WearableMetricScorecard,
  runnerUp: WearableMetricCandidate | null,
  runnerUpScorecard: WearableMetricScorecard | null,
): string {
  const parts = [
    `provider +${scorecard.providerScore}`,
    `specificity +${scorecard.resourceScore}`,
    `source family +${scorecard.sourceFamilyScore}`,
    `recency +${scorecard.recencyScore}`,
    `agreement +${scorecard.agreementScore}`,
  ];

  if (!runnerUp || !runnerUpScorecard) {
    return `Selected ${describeMetricEvidence(candidate)} for ${formatMetricLabel(metric)} because it scored highest (${parts.join(", ")}; total ${scorecard.total}).`;
  }

  return `Selected ${describeMetricEvidence(candidate)} for ${formatMetricLabel(metric)} because it scored highest (${parts.join(", ")}; total ${scorecard.total}) ahead of ${describeMetricEvidence(runnerUp)} (total ${runnerUpScorecard.total}).`;
}

function buildSleepWindowSelectionReason(
  candidate: WearableSleepWindowCandidate,
  scorecard: WearableSleepWindowScorecard,
  runnerUp: WearableSleepWindowCandidate | null,
  runnerUpScorecard: WearableSleepWindowScorecard | null,
): string {
  const parts = [
    `provider +${scorecard.providerScore}`,
    `duration +${scorecard.durationScore}`,
    `recency +${scorecard.recencyScore}`,
    `agreement +${scorecard.agreementScore}`,
    scorecard.napPenalty === 0 ? "nap penalty +0" : `nap penalty ${scorecard.napPenalty}`,
  ];

  if (!runnerUp || !runnerUpScorecard) {
    return `Selected ${describeSleepWindowEvidence(candidate)} because it scored highest (${parts.join(", ")}; total ${scorecard.total}).`;
  }

  return `Selected ${describeSleepWindowEvidence(candidate)} because it scored highest (${parts.join(", ")}; total ${scorecard.total}) ahead of ${describeSleepWindowEvidence(runnerUp)} (total ${runnerUpScorecard.total}).`;
}

function describeMetricEvidence(candidate: WearableMetricCandidate): string {
  const timestamp = candidate.recordedAt ?? candidate.occurredAt ?? "unknown time";
  return `${formatProviderName(candidate.provider)} ${candidate.sourceKind} recorded ${timestamp}`;
}

function describeSleepWindowEvidence(candidate: WearableSleepWindowCandidate): string {
  const timestamp = candidate.recordedAt ?? candidate.endAt ?? candidate.startAt ?? "unknown time";
  return `${formatProviderName(candidate.provider)} ${candidate.nap ? "nap" : "sleep"} window recorded ${timestamp}`;
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
