import { describe, expect, it } from "vitest";

import { metadata as dashboardMetadata } from "../app/(dashboard)/layout";
import { metadata as designMetadata } from "../app/design/page";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import {
  listComparisonRoutes,
  listComparisonSitemapEntries,
} from "../src/lib/comparisons/catalog";
import { listHealthCommonsMeasurementMethodRoutes } from "../src/lib/health-commons/measurement-method-detail";
import {
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
  "/food",
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
      ...listHealthCommonsMeasurementMethodRoutes().map((measurementMethodId) =>
        `/measurement-methods/${encodeURIComponent(measurementMethodId)}`
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
  });

  it("defaults private routes to noindex", () => {
    expect(dashboardMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(designMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
  });
});
