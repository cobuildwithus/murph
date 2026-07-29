import type {
  ExperimentAnalysisPlan,
  ExperimentMetricOutcomeCapture,
  ExperimentMeasurementKind,
  ExperimentOutcomeStatistic,
} from "@murphai/contracts";

import { resolveExperimentMetricIdentity } from "./experiment-metrics.ts";

export interface ResolvedExperimentMetricOutcome {
  kind: "metric";
  key: string;
  label: string;
  metricKey: string;
  statistic: ExperimentOutcomeStatistic;
  capture: ExperimentMetricOutcomeCapture;
}

export interface ResolvedExperimentStructuredReviewOutcome {
  kind: "structured_review";
  key: string;
  label: string;
}

export type ResolvedExperimentPrimaryOutcome =
  | ResolvedExperimentMetricOutcome
  | ResolvedExperimentStructuredReviewOutcome;

export interface ExperimentOutcomeEvidenceRoleSummary {
  kinds: ExperimentMeasurementKind[];
  observedCount: number;
  plannedCount: number;
  recordIds: string[];
}

export interface ExperimentOutcomeEvidencePlanSummary {
  baseline: ExperimentOutcomeEvidenceRoleSummary;
  completePlan: boolean;
  followup: ExperimentOutcomeEvidenceRoleSummary;
  reviewReady: boolean;
}

export interface ExperimentOutcomeEvidenceOptions {
  availableRecordIds?: ReadonlySet<string>;
  observedThrough?: string;
}

export function resolveExperimentMetricOutcome(
  key: string,
  options: {
    capture?: ExperimentMetricOutcomeCapture | null;
    label?: string | null;
    statistic?: ExperimentOutcomeStatistic | null;
  } = {},
): ResolvedExperimentMetricOutcome {
  const normalizedKey = key.trim().toLowerCase();
  const capture = options.capture ?? { kind: "measurement" };
  const sourceKey = capture.kind === "derived_metric"
    ? capture.sourceMetricKey
    : normalizedKey;
  return {
    kind: "metric",
    key: normalizedKey,
    label: options.label?.trim() || humanizeExperimentOutcomeKey(normalizedKey),
    metricKey: resolveExperimentMetricIdentity(sourceKey).metricKey,
    statistic: options.statistic ?? "mean",
    capture,
  };
}

export function resolveExperimentPrimaryOutcome(
  analysisPlan: ExperimentAnalysisPlan | undefined,
): ResolvedExperimentPrimaryOutcome | null {
  const configured = analysisPlan?.primaryOutcome;
  const legacyKey = analysisPlan?.primaryBiomarkerKey?.trim().toLowerCase();
  const key = configured?.key.trim().toLowerCase() ?? legacyKey;
  if (!key || !analysisPlan) {
    return null;
  }

  if (configured?.kind === "structured_review") {
    return {
      kind: "structured_review",
      key,
      label: configured.label?.trim() || humanizeExperimentOutcomeKey(key),
    };
  }

  return resolveExperimentMetricOutcome(key, {
    capture: configured?.kind === "metric" ? configured.capture : undefined,
    label: configured?.label,
    statistic: configured?.kind === "metric" ? configured.statistic : undefined,
  });
}

export function summarizeExperimentOutcomeEvidencePlan(
  analysisPlan: ExperimentAnalysisPlan | undefined,
  outcomeKey: string,
  options: ExperimentOutcomeEvidenceOptions = {},
): ExperimentOutcomeEvidencePlanSummary {
  const baseline = summarizeRole(analysisPlan, outcomeKey, "baseline", options);
  const followup = summarizeRole(analysisPlan, outcomeKey, "followup", options);
  return {
    baseline,
    completePlan:
      baseline.observedCount + baseline.plannedCount > 0 &&
      followup.observedCount + followup.plannedCount > 0,
    followup,
    reviewReady: baseline.observedCount > 0 && followup.observedCount > 0,
  };
}

export function humanizeExperimentOutcomeKey(value: string): string {
  const slug = value.trim().split(":").at(-1) ?? value.trim();
  return slug
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeRole(
  analysisPlan: ExperimentAnalysisPlan | undefined,
  outcomeKey: string,
  role: "baseline" | "followup",
  options: ExperimentOutcomeEvidenceOptions,
): ExperimentOutcomeEvidenceRoleSummary {
  const normalizedKey = outcomeKey.trim().toLowerCase();
  const matchingAnchors = (analysisPlan?.measurementAnchors ?? []).filter(
    (anchor) =>
      anchor.role === role &&
      anchor.biomarkerKeys.some((key) => key.trim().toLowerCase() === normalizedKey),
  );
  const observedAnchors = matchingAnchors.filter(
    (anchor) =>
      (options.observedThrough === undefined ||
        anchor.observedOn === undefined ||
        anchor.observedOn <= options.observedThrough) &&
      (options.availableRecordIds === undefined ||
        options.availableRecordIds.has(anchor.recordId)),
  );
  const planned = (analysisPlan?.plannedMeasurements ?? []).filter(
    (measurement) =>
      measurement.role === role &&
      measurement.biomarkerKeys.some((key) => key.trim().toLowerCase() === normalizedKey),
  );

  return {
    kinds: [...new Set(observedAnchors.map((entry) => entry.kind))].sort(),
    observedCount: observedAnchors.length,
    plannedCount: planned.length,
    recordIds: observedAnchors.map((anchor) => anchor.recordId),
  };
}
