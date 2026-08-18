import type { MetadataRoute } from "next";

import { MURPH_PUBLIC_SITE_URL } from "@/src/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    host: MURPH_PUBLIC_SITE_URL,
    rules: {
      allow: "/",
      disallow: "/api/",
      userAgent: "*",
    },
    sitemap: `${MURPH_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
