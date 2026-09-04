import type { MetadataRoute } from "next";

import { listComparisonSitemapEntries } from "@/src/lib/comparisons/catalog";
import { listHealthCommonsBiomarkerRoutes } from "@/src/lib/health-commons/biomarker-projections";
import { listHealthCommonsExperimentRouteParams } from "@/src/lib/health-commons/experiment-browse";
import { listHealthCommonsGoalRouteParams } from "@/src/lib/health-commons/goal-projections";
import { listHealthCommonsMeasurementMethodRoutes } from "@/src/lib/health-commons/measurement-method-detail";
import { GOAL_CATEGORIES } from "@/src/lib/goals/goal-categories";
import { MURPH_PUBLIC_SITE_URL } from "@/src/lib/site-metadata";

const STATIC_PUBLIC_ROUTES = [
  "/",
  "/about",
  "/changelog",
  "/clubs",
  "/contact",
  "/consumer-health-data-privacy-policy",
  "/experiments",
  "/goals",
  "/goals/methodology",
  "/food",
  "/knowledge",
  "/legal",
  "/legal/health-ai-safety-disclosure",
  "/legal/privacy",
  "/legal/terms",
  "/refer",
  "/search",
  "/security",
  "/subprocessors",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const experimentRoutes = listHealthCommonsExperimentRouteParams().flatMap(
    ({ experimentId }) => {
      const route = `/experiments/${encodeURIComponent(experimentId)}`;
      return [route, `${route}/research`];
    },
  );
  const biomarkerRoutes = listHealthCommonsBiomarkerRoutes().flatMap((biomarkerId) => {
    const route = `/biomarkers/${encodeURIComponent(biomarkerId)}`;
    return [route, `${route}/research`];
  });
  const measurementMethodRoutes = listHealthCommonsMeasurementMethodRoutes().map(
    (measurementMethodId) =>
      `/measurement-methods/${encodeURIComponent(measurementMethodId)}`,
  );
  const goalRoutes = [
    ...GOAL_CATEGORIES.map((category) => `/goals/${category.slug}`),
    ...listHealthCommonsGoalRouteParams().map(
      ({ goalId }) => `/goals/${encodeURIComponent(goalId)}`,
    ),
  ];
  const comparisonEntries = listComparisonSitemapEntries();
  const comparisonLastModifiedByRoute = new Map(
    comparisonEntries.map(({ lastModified, route }) => [route, lastModified]),
  );

  return [
    ...STATIC_PUBLIC_ROUTES,
    ...comparisonLastModifiedByRoute.keys(),
    ...experimentRoutes,
    ...biomarkerRoutes,
    ...measurementMethodRoutes,
    ...goalRoutes,
  ]
    .sort()
    .map((route) => ({
      ...(comparisonLastModifiedByRoute.has(route)
        ? { lastModified: comparisonLastModifiedByRoute.get(route) }
        : {}),
      url: new URL(route, MURPH_PUBLIC_SITE_URL).toString(),
    }));
}
