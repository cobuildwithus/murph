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

function publicUrl(route: string): string {
  return new URL(route, MURPH_PUBLIC_SITE_URL).toString();
}

describe("public search indexing metadata", () => {
  it("publishes a robots policy that keeps page-level noindex metadata crawlable", () => {
    expect(robots()).toEqual({
      host: MURPH_PUBLIC_SITE_URL,
      rules: {
        allow: "/",
        disallow: "/api/",
        userAgent: "*",
      },
      sitemap: `${MURPH_PUBLIC_SITE_URL}/sitemap.xml`,
    });
  });

  it("publishes every indexable Health Commons route once", () => {
    const entries = sitemap();
    const urls = entries.map(({ url }) => url);
    const uniqueUrls = new Set(urls);

    expect(uniqueUrls.size).toBe(urls.length);
    expect(urls).toEqual([...urls].sort());
    for (const publicRoute of ["/", "/experiments", "/knowledge", "/search"]) {
      expect(uniqueUrls).toContain(publicUrl(publicRoute));
    }

    for (const { experimentId } of listHealthCommonsExperimentRouteParams()) {
      const route = `/experiments/${encodeURIComponent(experimentId)}`;
      expect(uniqueUrls).toContain(publicUrl(route));
      expect(uniqueUrls).toContain(publicUrl(`${route}/research`));
      expect(uniqueUrls).not.toContain(publicUrl(`${route}/results`));
    }

    for (const biomarkerId of listHealthCommonsBiomarkerRoutes()) {
      const route = `/biomarkers/${encodeURIComponent(biomarkerId)}`;
      expect(uniqueUrls).toContain(publicUrl(route));
      expect(uniqueUrls).toContain(publicUrl(`${route}/research`));
    }

    for (const measurementMethodId of listHealthCommonsMeasurementMethodRoutes()) {
      expect(uniqueUrls).toContain(publicUrl(
        `/measurement-methods/${encodeURIComponent(measurementMethodId)}`,
      ));
    }

    for (const privateOrInternalRoute of [
      "/biomarkers",
      "/design",
      "/environment",
      "/home",
      "/pitch",
      "/settings",
    ]) {
      expect(uniqueUrls).not.toContain(publicUrl(privateOrInternalRoute));
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
