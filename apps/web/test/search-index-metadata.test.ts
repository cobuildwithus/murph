import { describe, expect, it } from "vitest";

import { metadata as experimentsMetadata } from "../app/(dashboard)/experiments/page";
import { metadata as dashboardMetadata } from "../app/(dashboard)/layout";
import { metadata as designMetadata } from "../app/design/page";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { metadata as pitchMetadata } from "../app/pitch/page";
import { listHealthCommonsBiomarkerRoutes } from "../src/lib/health-commons/biomarker-projections";
import { listHealthCommonsExperimentRouteParams } from "../src/lib/health-commons/experiment-browse";
import { listHealthCommonsMeasurementMethodRoutes } from "../src/lib/health-commons/measurement-method-detail";
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
    ].sort();

    expect(sitemap()).toEqual(expectedRoutes.map((route) => ({
      url: publicUrl(route),
    })));

    for (const { experimentId } of listHealthCommonsExperimentRouteParams()) {
      const route = `/experiments/${encodeURIComponent(experimentId)}`;
      expect(expectedRoutes).not.toContain(`${route}/results`);
    }
  });

  it("defaults private routes to noindex and opts the public experiment index back in", () => {
    expect(dashboardMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(designMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(pitchMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
    expect(experimentsMetadata.alternates?.canonical).toBe("/experiments");
    expect(experimentsMetadata.robots).toEqual(MURPH_INDEXABLE_PAGE_ROBOTS);
  });
});
