import {
  resolveReviewedBiomarkerFallbackRanges,
} from "@murphai/health-commons/biomarker-fallback-ranges";
import {
  resolveHealthCommonsBiomarkerEntityKey,
} from "@murphai/health-commons/biomarker-entity-mappings";
import type { HealthCommonsWebBiomarkerFallbackRange } from "@murphai/health-commons/runtime";
import { resolveLabResultMetricDefinition } from "@murphai/health-metrics";

import { getGeneratedBiomarkerIndex } from "@/src/lib/health-commons/generated-biomarker-artifacts";

export function resolveLabBiomarkerContext(metricKey: string): {
  displayName: string;
  fallbackRanges: HealthCommonsWebBiomarkerFallbackRange[];
  summary: string | null;
} {
  const normalizedMetricKey = metricKey.trim().toLowerCase();
  const definition = resolveLabResultMetricDefinition(normalizedMetricKey);
  const entityKeys = new Set([
    definition?.biomarkerKey,
    ...(definition?.biomarkerAliases ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveHealthCommonsBiomarkerEntityKey(value)));
  const entry = getGeneratedBiomarkerIndex().biomarkers.find((candidate) =>
    entityKeys.has(candidate.key)
      || candidate.routeId === normalizedMetricKey
      || candidate.aliases.includes(normalizedMetricKey)
  );
  if (entry) {
    entityKeys.add(entry.key);
  }

  const reviewedFallbackRanges = [...entityKeys].flatMap((entityKey) =>
    resolveReviewedBiomarkerFallbackRanges(entityKey)
  );

  return {
    displayName: definition?.displayName
      ?? entry?.shortName
      ?? entry?.title
      ?? normalizedMetricKey.replaceAll("-", " "),
    fallbackRanges: [
      ...(entry?.fallbackRanges ?? []),
      ...reviewedFallbackRanges,
    ],
    summary: entry?.summary ?? null,
  };
}
