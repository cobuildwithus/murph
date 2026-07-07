import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import {
  FEATURE_CATALOG_FEED_SCHEMA,
  FEATURE_CATALOG_ITEMS,
} from "@/src/lib/feature-catalog";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET(): Promise<Response> {
  const origin = (
    resolveHostedPublicBaseUrl(process.env) ?? MURPH_PRODUCT_ORIGIN
  ).replace(/\/+$/u, "");

  return Response.json(
    {
      schema: FEATURE_CATALOG_FEED_SCHEMA,
      items: FEATURE_CATALOG_ITEMS,
      links: {
        fullChangelog: `${origin}/changelog`,
      },
    },
    {
      headers: {
        "Cache-Control": CACHE_CONTROL,
      },
    },
  );
}
