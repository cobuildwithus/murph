import type { MetadataRoute } from "next";

import { BLOG_ARTICLES, buildBlogArticlePath } from "@/src/lib/blog";

const SITE_ORIGIN = "https://www.withmurph.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "weekly",
      lastModified: BLOG_ARTICLES[0]?.publishedOn,
      priority: 0.8,
      url: `${SITE_ORIGIN}/blog`,
    },
    ...BLOG_ARTICLES.map((article) => ({
      changeFrequency: "monthly" as const,
      lastModified: article.publishedOn,
      priority: article.featured ? 0.7 : 0.6,
      url: `${SITE_ORIGIN}${buildBlogArticlePath(article.slug)}`,
    })),
  ];
}
