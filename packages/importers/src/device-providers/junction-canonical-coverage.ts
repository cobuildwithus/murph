import { normalizeJunctionSourceProviderSlug } from "./junction-origin.ts";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
} from "./junction-resources.ts";
import { slugify } from "./shared-normalization.ts";

export interface JunctionCanonicalCoverageEvidence {
  readonly resource: string;
  readonly sourceProviderSlug: string;
}

export interface JunctionCanonicalCoverageEvent {
  readonly dataOrigin?: { readonly sourceProviderSlug?: string };
  readonly externalRef?: { readonly resourceType: string };
}

const CANONICAL_RESOURCES: readonly string[] = [
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES.filter((resource) => resource !== "profile"),
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
];

export function deriveJunctionCanonicalCoverageEvidence(
  events: readonly JunctionCanonicalCoverageEvent[],
): readonly JunctionCanonicalCoverageEvidence[] {
  const evidence = new Map<string, JunctionCanonicalCoverageEvidence>();
  for (const event of events) {
    const sourceProviderSlug = normalizeJunctionSourceProviderSlug(
      event.dataOrigin?.sourceProviderSlug,
    );
    if (!sourceProviderSlug) {
      continue;
    }
    const resource = CANONICAL_RESOURCES.find((candidate) =>
      event.externalRef?.resourceType
        === `junction-${slugify(sourceProviderSlug, "source")}-${slugify(candidate, "resource")}`
    );
    if (resource) {
      evidence.set(`${sourceProviderSlug}\u0000${resource}`, { resource, sourceProviderSlug });
    }
  }
  return [...evidence.values()].sort((left, right) =>
    left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    || left.resource.localeCompare(right.resource)
  );
}
