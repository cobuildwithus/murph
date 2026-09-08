import { AI_HEALTH_ASSISTANT_COMPARISONS } from "./data/ai-health-assistants";
import { FITNESS_COMPARISONS } from "./data/fitness";
import { HEALTH_ASSISTANT_COMPARISONS } from "./data/health-assistants";
import { HEALTH_COACHING_APP_COMPARISONS } from "./data/health-coaching-apps";
import { HEALTH_DATA_COMPARISONS } from "./data/health-data";
import { HEALTH_DEVICE_COMPARISONS } from "./data/health-devices";
import { LABS_LONGEVITY_COMPARISONS } from "./data/labs-longevity";
import { LONGEVITY_APP_COMPARISONS } from "./data/longevity-apps";
import { MESSAGING_AGENT_COMPARISONS } from "./data/messaging-agents";
import { MESSAGING_HEALTH_COMPARISONS } from "./data/messaging-health";
import { NUTRITION_COMPARISONS } from "./data/nutrition";
import { SLEEP_MENTAL_COMPARISONS } from "./data/sleep-mental";
import { WEARABLE_COMPARISONS } from "./data/wearables";
import type { ComparisonEntry } from "./types";

export const COMPARISON_ROUTE_PREFIX = "murph-vs-";
export const COMPARISON_REVIEWED_ON = "2026-09-04";

export const COMPARISONS: readonly ComparisonEntry[] = [
  ...WEARABLE_COMPARISONS,
  ...HEALTH_DATA_COMPARISONS,
  ...LABS_LONGEVITY_COMPARISONS,
  ...FITNESS_COMPARISONS,
  ...NUTRITION_COMPARISONS,
  ...SLEEP_MENTAL_COMPARISONS,
  ...HEALTH_ASSISTANT_COMPARISONS,
  ...MESSAGING_HEALTH_COMPARISONS,
  ...HEALTH_DEVICE_COMPARISONS,
  ...LONGEVITY_APP_COMPARISONS,
  ...AI_HEALTH_ASSISTANT_COMPARISONS,
  ...HEALTH_COACHING_APP_COMPARISONS,
  ...MESSAGING_AGENT_COMPARISONS,
];

const COMPARISONS_BY_SLUG = new Map(
  COMPARISONS.map((comparison) => [comparison.slug, comparison] as const),
);

export function comparisonPath(comparison: ComparisonEntry): string {
  return `/compare/${COMPARISON_ROUTE_PREFIX}${comparison.slug}`;
}

export function getComparisonByRouteSegment(
  routeSegment: string,
): ComparisonEntry | null {
  if (!routeSegment.startsWith(COMPARISON_ROUTE_PREFIX)) {
    return null;
  }

  return COMPARISONS_BY_SLUG.get(
    routeSegment.slice(COMPARISON_ROUTE_PREFIX.length),
  ) ?? null;
}

export function listComparisonRouteParams(): Array<{ competitor: string }> {
  return COMPARISONS.map((comparison) => ({
    competitor: `${COMPARISON_ROUTE_PREFIX}${comparison.slug}`,
  }));
}

export function listComparisonRoutes(): string[] {
  return ["/compare", ...COMPARISONS.map(comparisonPath)];
}

export function comparisonLibraryLastVerified(): ComparisonEntry["lastVerified"] {
  return COMPARISONS.reduce(
    (latest, comparison) =>
      comparison.lastVerified > latest ? comparison.lastVerified : latest,
    COMPARISONS[0]?.lastVerified ?? COMPARISON_REVIEWED_ON,
  );
}

export function listComparisonSitemapEntries(): Array<{
  lastModified: ComparisonEntry["lastVerified"];
  route: string;
}> {
  return [
    {
      lastModified: comparisonLibraryLastVerified(),
      route: "/compare",
    },
    ...COMPARISONS.map((comparison) => ({
      lastModified: comparison.lastVerified,
      route: comparisonPath(comparison),
    })),
  ];
}

export function listRelatedComparisons(
  comparison: ComparisonEntry,
  limit = 4,
): ComparisonEntry[] {
  const peers = COMPARISONS.filter(
    (candidate) => candidate.category === comparison.category,
  );
  const currentIndex = peers.findIndex(
    (candidate) => candidate.slug === comparison.slug,
  );
  const orderedPeers = [
    ...peers.slice(currentIndex + 1),
    ...peers.slice(0, currentIndex),
  ];

  return orderedPeers.slice(0, limit);
}
