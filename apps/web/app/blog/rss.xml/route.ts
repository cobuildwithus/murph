import {
  BLOG_ARTICLES,
  BLOG_COLLECTION_DESCRIPTION,
  buildBlogArticlePath,
} from "@/src/lib/blog";

const SITE_ORIGIN = "https://www.withmurph.ai";

export const dynamic = "force-static";

export function GET() {
  const items = BLOG_ARTICLES.map((article) => {
    const url = `${SITE_ORIGIN}${buildBlogArticlePath(article.slug)}`;

    return [
      "<item>",
      `<title>${escapeXml(article.title)}</title>`,
      `<link>${url}</link>`,
      `<guid isPermaLink="true">${url}</guid>`,
      `<description>${escapeXml(article.description)}</description>`,
      `<pubDate>${new Date(`${article.publishedOn}T00:00:00.000Z`).toUTCString()}</pubDate>`,
      "</item>",
    ].join("");
  }).join("");

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    "<title>Murph Field Notes</title>",
    `<link>${SITE_ORIGIN}/blog</link>`,
    `<description>${escapeXml(BLOG_COLLECTION_DESCRIPTION)}</description>`,
    items,
    "</channel></rss>",
  ].join("");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600",
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
