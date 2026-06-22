import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
} from "./metrics/index.ts";

export interface ExperimentMetricIdentity {
  biomarkerKey?: string | null;
  metricKey: string;
}

export interface ResolvedExperimentMetricIdentity {
  biomarkerKey: string | null;
  metricKey: string;
}

export function resolveExperimentMetricIdentity(metricKey: string): ResolvedExperimentMetricIdentity {
  const trimmedMetricKey = metricKey.trim();
  const metricSlug = trimmedMetricKey.split(":").at(-1) ?? trimmedMetricKey;
  const definition = trimmedMetricKey.startsWith("biomarker:")
    ? resolveMetricDefinitionForBiomarker(trimmedMetricKey) ?? resolveMetricDefinition(metricSlug)
    : resolveMetricDefinition(trimmedMetricKey);

  return {
    biomarkerKey: definition?.biomarkerKey ?? (trimmedMetricKey.startsWith("biomarker:") ? trimmedMetricKey : null),
    metricKey: definition?.key ?? normalizeMetricKey(
      trimmedMetricKey.startsWith("biomarker:") ? metricSlug : trimmedMetricKey,
    ),
  };
}

export function matchesExperimentMetricIdentity(
  metricKey: string,
  point: ExperimentMetricIdentity,
): boolean {
  return point.metricKey === resolveExperimentMetricIdentity(metricKey).metricKey;
}
