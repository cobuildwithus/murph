import { describe, expect, it } from "vitest";

import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import { GET as getFeatureCatalogFeed } from "../app/api/feature-catalog/route";
import {
  FEATURE_CATALOG_FEED_SCHEMA,
  FEATURE_CATALOG_ITEMS,
} from "../src/lib/feature-catalog";
import { resolveHostedPublicBaseUrl } from "../src/lib/hosted-web/public-url";

describe("feature catalog routes", () => {
  it("returns the evergreen catalog with canonical links", async () => {
    const response = await getFeatureCatalogFeed();
    const body = await response.json();
    const expectedOrigin = (
      resolveHostedPublicBaseUrl(process.env) ?? MURPH_PRODUCT_ORIGIN
    ).replace(/\/+$/u, "");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    expect(body).toEqual({
      schema: FEATURE_CATALOG_FEED_SCHEMA,
      items: JSON.parse(JSON.stringify(FEATURE_CATALOG_ITEMS)),
      links: {
        fullChangelog: `${expectedOrigin}/changelog`,
      },
    });
  });
});
