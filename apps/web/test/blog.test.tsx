import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src }),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: vi.fn(async () => ({ authenticated: false })),
}));

vi.mock("@/src/lib/github-stars", () => ({
  formatStarCount: (count: number) => String(count),
  getMurphGithubStarCount: vi.fn(async () => null),
}));

import { generateMetadata as generateArticleMetadata } from "../app/blog/[slug]/page";
import { metadata as blogMetadata } from "../app/blog/page";
import { GET as getBlogFeed } from "../app/blog/rss.xml/route";
import blogSitemap from "../app/blog/sitemap";
import {
  BlogArchiveStudy,
  BlogArticleStudy,
} from "../app/design/blog-study";
import { BlogArchive } from "../src/components/blog/blog-archive";
import { BlogArticleView } from "../src/components/blog/blog-article-view";
import {
  BLOG_ARTICLES,
  BLOG_COLLECTION_DESCRIPTION,
  BLOG_HAS_PUBLISHED_CASE_STUDIES,
  buildBlogArticlePath,
  getBlogArticle,
  listRelatedBlogArticles,
  validateBlogArticles,
  type BlogArticle,
} from "../src/lib/blog";

describe("blog registry", () => {
  it("keeps one featured article and stable public paths", () => {
    expect(BLOG_ARTICLES.filter((article) => article.featured)).toHaveLength(1);
    expect(BLOG_ARTICLES.map((article) => article.publishedOn)).toEqual(
      [...BLOG_ARTICLES]
        .map((article) => article.publishedOn)
        .sort((left, right) => right.localeCompare(left)),
    );
    expect(buildBlogArticlePath(BLOG_ARTICLES[0].slug)).toBe(
      "/blog/your-wearable-has-the-numbers-what-happens-next",
    );
    expect(getBlogArticle("not-published")).toBeNull();
  });

  it("rejects duplicate slugs and case studies without a verified result", () => {
    expect(() => validateBlogArticles([BLOG_ARTICLES[0], BLOG_ARTICLES[0]])).toThrow(
      "Duplicate blog slug",
    );

    const incompleteCaseStudy: BlogArticle = {
      body: "A result.",
      description: "A result with incomplete evidence.",
      evidence: {
        consentConfirmed: true,
        limitations: "No controlled baseline.",
        resultSummary: "",
        trustLabels: ["self-reported"],
        verifiedOn: "2026-08-10",
      },
      featured: true,
      keywords: ["result"],
      kind: "case-study",
      publishedOn: "2026-08-10",
      readingMinutes: 3,
      slug: "unverified-result",
      title: "Unverified result",
    };

    expect(() =>
      validateBlogArticles([incompleteCaseStudy]),
    ).toThrow("Missing case-study result");

    expect(() =>
      validateBlogArticles([{
        ...incompleteCaseStudy,
        evidence: {
          ...incompleteCaseStudy.evidence,
          limitations: "",
          resultSummary: "A bounded result.",
        },
      }]),
    ).toThrow("Missing case-study limitations");

    expect(() =>
      validateBlogArticles([{
        ...incompleteCaseStudy,
        evidence: {
          ...incompleteCaseStudy.evidence,
          resultSummary: "A bounded result.",
          trustLabels: [],
        },
      }]),
    ).toThrow("Invalid case-study trust labels");
  });

  it("returns related reading without returning the current article", () => {
    const article = BLOG_ARTICLES[0];
    const related = listRelatedBlogArticles(article);

    expect(related).toHaveLength(2);
    expect(related.map(({ slug }) => slug)).not.toContain(article.slug);
  });
});

describe("blog presentation and discovery", () => {
  it("renders the public archive and article from the shared production components", () => {
    const article = BLOG_ARTICLES[0];
    const archiveMarkup = renderToStaticMarkup(
      <BlogArchive articles={BLOG_ARTICLES} />,
    );
    const articleMarkup = renderToStaticMarkup(
      <BlogArticleView
        article={article}
        relatedArticles={listRelatedBlogArticles(article)}
      />,
    );

    expect(archiveMarkup).toContain("Murph field notes");
    expect(archiveMarkup).toContain(article.title);
    expect(archiveMarkup).toContain('href="/blog/rss.xml"');
    expect(articleMarkup).toContain("A number is not a decision");
    expect(articleMarkup).toContain("About this note");
    expect(articleMarkup).toContain('href="/blog"');
  });

  it("renders the production archive and article against synthetic catalog data", () => {
    const archiveMarkup = renderToStaticMarkup(<BlogArchiveStudy />);
    const articleMarkup = renderToStaticMarkup(<BlogArticleStudy />);

    expect(archiveMarkup).toContain('data-design-study="blog-archive"');
    expect(archiveMarkup).toContain("Read the pattern before choosing the next step");
    expect(articleMarkup).toContain('data-design-study="blog-article"');
    expect(articleMarkup).toContain("Begin with the decision");
    expect(archiveMarkup).toContain('data-design-state="blog-navigation"');
    expect(archiveMarkup).toContain('id="blog-study-footer"');
    expect(articleMarkup).toContain("Verified result");
    expect(articleMarkup).toContain("Evidence basis");
    expect(articleMarkup).toContain("Self-reported");
    expect(articleMarkup).toContain("January 17, 2030");
    expect(articleMarkup).toContain("Synthetic catalog content only");
    expect(articleMarkup).toContain("data-blog-case-study-evidence");
  });

  it("publishes canonical metadata, a complete RSS feed, and a blog sitemap", async () => {
    const article = BLOG_ARTICLES[0];
    const articleMetadata = await generateArticleMetadata({
      params: Promise.resolve({ slug: article.slug }),
    });
    const feedResponse = getBlogFeed();
    const feed = await feedResponse.text();
    const sitemap = blogSitemap();

    expect(blogMetadata.alternates).toEqual(
      expect.objectContaining({
        canonical: "/blog",
        types: { "application/rss+xml": "/blog/rss.xml" },
      }),
    );
    expect(BLOG_HAS_PUBLISHED_CASE_STUDIES).toBe(false);
    expect(blogMetadata.description).toBe(BLOG_COLLECTION_DESCRIPTION);
    expect(blogMetadata.title).toContain("Practical health guides");
    expect(feed).toContain(
      "Case studies appear only when the evidence is ready.",
    );
    expect(feed).not.toContain("and verified case studies about");
    expect(articleMetadata.alternates).toEqual({
      canonical: buildBlogArticlePath(article.slug),
    });
    expect(articleMetadata.openGraph).toEqual(
      expect.objectContaining({ type: "article" }),
    );
    expect(feedResponse.headers.get("Content-Type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    for (const publishedArticle of BLOG_ARTICLES) {
      expect(feed).toContain(publishedArticle.title.replaceAll("&", "&amp;"));
      expect(feed).toContain(buildBlogArticlePath(publishedArticle.slug));
      expect(sitemap.map(({ url }) => url)).toContain(
        `https://www.withmurph.ai${buildBlogArticlePath(publishedArticle.slug)}`,
      );
    }
  });
});
