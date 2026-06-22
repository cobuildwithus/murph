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
  const candidate = buildExperimentMetricCandidates(metricKey);
  return {
    biomarkerKey: candidate.resolvedBiomarkerKey,
    metricKey: candidate.resolvedMetricKey,
  };
}

export function matchesExperimentMetricIdentity(
  metricKey: string,
  point: ExperimentMetricIdentity,
): boolean {
  const candidate = buildExperimentMetricCandidates(metricKey);
  if (candidate.metricKeySet.has(point.metricKey)) {
    return true;
  }

  return point.biomarkerKey !== null &&
    point.biomarkerKey !== undefined &&
    candidate.biomarkerKeySet.has(point.biomarkerKey);
}

function buildExperimentMetricCandidates(metricKey: string) {
  const trimmedMetricKey = metricKey.trim();
  const normalizedMetricKey = normalizeMetricKey(trimmedMetricKey);
  const metricSlug = trimmedMetricKey.split(":").at(-1) ?? trimmedMetricKey;
  const definition = resolveMetricDefinition(trimmedMetricKey);
  const biomarkerDefinition = resolveMetricDefinitionForBiomarker(trimmedMetricKey);
  const slugDefinition = resolveMetricDefinition(metricSlug);
  const resolvedDefinition = definition ?? biomarkerDefinition ?? slugDefinition ?? null;
  const resolvedMetricKey = resolvedDefinition?.key ?? normalizeMetricKey(metricSlug || trimmedMetricKey);
  const resolvedBiomarkerKey = resolvedDefinition?.biomarkerKey ??
    (trimmedMetricKey.startsWith("biomarker:") ? trimmedMetricKey : null);
  const metricKeys = uniqueNonEmptyStrings([
    trimmedMetricKey,
    normalizedMetricKey,
    definition?.key,
    biomarkerDefinition?.key,
    slugDefinition?.key,
    normalizeMetricKey(metricSlug),
  ]);
  const biomarkerKeys = uniqueNonEmptyStrings([
    trimmedMetricKey,
    normalizedMetricKey,
    normalizedMetricKey.startsWith("biomarker:")
      ? normalizedMetricKey
      : `biomarker:${normalizedMetricKey}`,
    definition?.biomarkerKey,
    biomarkerDefinition?.biomarkerKey,
  ]);

  return {
    biomarkerKeys,
    biomarkerKeySet: new Set(biomarkerKeys),
    definition: resolvedDefinition,
    metricKeys,
    metricKeySet: new Set(metricKeys),
    resolvedBiomarkerKey,
    resolvedMetricKey,
  };
}

function uniqueNonEmptyStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ))];
}
