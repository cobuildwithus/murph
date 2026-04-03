import { formatMetricLabel, formatProviderName } from "./provider-policy.ts";
import { uniqueStrings } from "./shared.ts";
import type {
  WearableConfidenceLevel,
  WearableResolvedMetric,
  WearableSummaryConfidence,
} from "./types.ts";

export function summarizeMetricsConfidence(
  metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]>,
  options: {
    extraNotes?: readonly string[];
    missingSummaryNote: string;
  },
): WearableSummaryConfidence {
  const selectedProviders = uniqueStrings(
    metrics
      .map(([, metric]) => metric.selection.provider)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const selectedMetrics = metrics.filter(([, metric]) => metric.selection.value !== null);
  const conflictingMetrics = metrics
    .filter(([, metric]) => metric.confidence.conflictingProviders.length > 0)
    .map(([metric]) => metric);
  const lowConfidenceMetrics = metrics
    .filter(([, metric]) => metric.confidence.level === "low")
    .map(([metric]) => metric);
  const notes: string[] = [];

  if (selectedMetrics.length === 0) {
    notes.push(options.missingSummaryNote);
  } else if (selectedProviders.length > 0) {
    notes.push(`Selected evidence came from ${selectedProviders.map(formatProviderName).join(", ")}.`);
  }

  if (conflictingMetrics.length > 0) {
    notes.push(`Some metrics still conflict across providers: ${conflictingMetrics.map(formatMetricLabel).join(", ")}.`);
  }

  notes.push(...(options.extraNotes ?? []));

  const level: WearableConfidenceLevel = selectedMetrics.length === 0
    ? "none"
    : lowConfidenceMetrics.length > 0
      ? "low"
      : conflictingMetrics.length > 0
        ? "medium"
        : selectedMetrics.every(([, metric]) => metric.confidence.level === "high")
          ? "high"
          : "medium";

  return {
    conflictingMetrics,
    level,
    lowConfidenceMetrics,
    notes,
    selectedProviders,
  };
}

export function buildSummaryHighlight(
  category: string,
  date: string,
  confidence: WearableSummaryConfidence,
): string {
  if (confidence.level === "none") {
    return `No ${category} summary was available for ${date}.`;
  }

  const providers = confidence.selectedProviders.length > 0
    ? confidence.selectedProviders.map(formatProviderName).join(", ")
    : "no provider";

  return `${formatMetricLabel(category)} on ${date} is ${confidence.level}-confidence and currently resolves to ${providers}.`;
}

export function collectSummaryProviders(
  summaries: readonly ({ summaryConfidence: WearableSummaryConfidence } | null)[],
): string[] {
  return uniqueStrings(
    summaries.flatMap((summary) => summary?.summaryConfidence.selectedProviders ?? []),
  );
}

export function inferDaySummaryConfidence(
  summaries: readonly ({ summaryConfidence: WearableSummaryConfidence } | null)[],
): WearableConfidenceLevel {
  const available = summaries.filter(
    (summary): summary is { summaryConfidence: WearableSummaryConfidence } => summary !== null,
  );

  if (available.length === 0) {
    return "none";
  }

  if (available.some((summary) => summary.summaryConfidence.level === "low")) {
    return "low";
  }

  if (available.every((summary) => summary.summaryConfidence.level === "high")) {
    return "high";
  }

  return "medium";
}
