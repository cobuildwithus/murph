import { describe, expect, it } from "vitest";

import { metadata as experimentsMetadata } from "../app/(dashboard)/experiments/page";
import { metadata as dashboardMetadata } from "../app/(dashboard)/layout";
import { metadata as designMetadata } from "../app/design/page";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { metadata as pitchMetadata } from "../app/pitch/page";
import {
  listComparisonRoutes,
  listComparisonSitemapEntries,
} from "../src/lib/comparisons/catalog";
import { listHealthCommonsBiomarkerRoutes } from "../src/lib/health-commons/biomarker-projections";
import { listHealthCommonsExperimentRouteParams } from "../src/lib/health-commons/experiment-browse";
import { listHealthCommonsMeasurementMethodRoutes } from "../src/lib/health-commons/measurement-method-detail";
import {
  listHealthCommonsGoalEntries,
  listHealthCommonsGoalRouteAliases,
  listHealthCommonsGoalRouteParams,
  resolveHealthCommonsGoalPage,
} from "../src/lib/health-commons/goal-projections";
import { GOAL_CATEGORIES } from "../src/lib/goals/goal-categories";
import {
  MURPH_INDEXABLE_PAGE_ROBOTS,
  MURPH_NOINDEX_PAGE_ROBOTS,
  MURPH_PUBLIC_SITE_URL,
} from "../src/lib/site-metadata";

const EXPECTED_PUBLIC_SITE_URL = "https://www.withmurph.ai";
const EXPECTED_STATIC_PUBLIC_ROUTES = [
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

function publicUrl(route: string): string {
  return new URL(route, EXPECTED_PUBLIC_SITE_URL).toString();
}

describe("public search indexing metadata", () => {
  it("publishes a robots policy that keeps page-level noindex metadata crawlable", () => {
    expect(MURPH_PUBLIC_SITE_URL).toBe(EXPECTED_PUBLIC_SITE_URL);
    expect(robots()).toEqual({
      host: EXPECTED_PUBLIC_SITE_URL,
      rules: {
        allow: "/",
        disallow: "/api/",
        userAgent: "*",
      },
      sitemap: `${EXPECTED_PUBLIC_SITE_URL}/sitemap.xml`,
    });
  });

  it("publishes the exact approved public route inventory", () => {
    const expectedRoutes = [
      ...EXPECTED_STATIC_PUBLIC_ROUTES,
      ...listComparisonRoutes(),
      ...listHealthCommonsExperimentRouteParams().flatMap(({ experimentId }) => {
        const route = `/experiments/${encodeURIComponent(experimentId)}`;
        return [route, `${route}/research`];
      }),
      ...listHealthCommonsBiomarkerRoutes().flatMap((biomarkerId) => {
        const route = `/biomarkers/${encodeURIComponent(biomarkerId)}`;
        return [route, `${route}/research`];
      }),
      ...listHealthCommonsMeasurementMethodRoutes().map((measurementMethodId) =>
        `/measurement-methods/${encodeURIComponent(measurementMethodId)}`
      ),
      ...GOAL_CATEGORIES.map((category) => `/goals/${category.slug}`),
      ...listHealthCommonsGoalRouteParams().map(({ goalId }) =>
        `/goals/${encodeURIComponent(goalId)}`
      ),
    ].sort();

    const comparisonLastModifiedByRoute = new Map(
      listComparisonSitemapEntries().map(({ lastModified, route }) => [
        route,
        lastModified,
      ]),
    );

    expect(sitemap()).toEqual(expectedRoutes.map((route) => ({
      ...(comparisonLastModifiedByRoute.has(route)
        ? { lastModified: comparisonLastModifiedByRoute.get(route) }
        : {}),
      url: publicUrl(route),
    })));

    for (const { experimentId } of listHealthCommonsExperimentRouteParams()) {
      const route = `/experiments/${encodeURIComponent(experimentId)}`;
      expect(expectedRoutes).not.toContain(`${route}/results`);
    }
  });

  it("publishes a broad, uniquely routed goal library in every category", () => {
    const goals = listHealthCommonsGoalEntries();
    const routeIds = goals.map((goal) => goal.routeId);
    const reservedRouteIds = new Set([
      "methodology",
      ...GOAL_CATEGORIES.map((category) => category.slug),
    ]);
    const categories = new Set(goals.map((goal) => goal.category));

    expect(goals.length).toBeGreaterThanOrEqual(200);
    expect(new Set(routeIds).size).toBe(routeIds.length);
    for (const routeId of [...routeIds, ...listHealthCommonsGoalRouteAliases()]) {
      expect(
        reservedRouteIds.has(routeId),
        `generated goal route must not shadow a reserved route: ${routeId}`,
      ).toBe(false);
    }
    expect(categories).toEqual(new Set(GOAL_CATEGORIES.map((category) => category.slug)));
    for (const category of GOAL_CATEGORIES) {
      const categoryRouteIds = new Set(
        goals
          .filter((goal) => goal.category === category.slug)
          .map((goal) => goal.routeId),
      );
      for (const featuredRouteId of category.featuredRouteIds) {
        expect(
          categoryRouteIds.has(featuredRouteId),
          `${category.slug} featured goal should resolve: ${featuredRouteId}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the retired aerobic-base route mapped to the canonical cardio guide and out of the sitemap", () => {
    const legacyRouteId = "build-aerobic-base";
    const canonicalRouteId = "improve-cardio-endurance";

    expect(listHealthCommonsGoalRouteAliases()).toContain(legacyRouteId);
    expect(resolveHealthCommonsGoalPage(legacyRouteId)).toMatchObject({
      goal: {
        key: "goal_template:improve-cardio-endurance",
        routeId: canonicalRouteId,
      },
      route: {
        canonicalRouteId,
        isAlias: true,
      },
    });

    const sitemapUrls = sitemap().map((entry) => entry.url);
    expect(sitemapUrls).toContain(publicUrl(`/goals/${canonicalRouteId}`));
    expect(sitemapUrls).not.toContain(publicUrl(`/goals/${legacyRouteId}`));
  });

  it("defaults private routes to noindex and opts the public experiment index back in", () => {
    expect(dashboardMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(designMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(pitchMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(experimentsMetadata.alternates?.canonical).toBe("/experiments");
    expect(experimentsMetadata.robots).toEqual(MURPH_INDEXABLE_PAGE_ROBOTS);
  });
});
