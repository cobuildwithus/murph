import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlogArticleView } from "@/src/components/blog/blog-article-view";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import {
  BLOG_ARTICLES,
  buildBlogArticlePath,
  getBlogArticle,
  listRelatedBlogArticles,
} from "@/src/lib/blog";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../../sticky-nav";

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_ARTICLES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const article = getBlogArticle((await params).slug);
  if (!article) {
    notFound();
  }

  return createMurphPageMetadata({
    title: `${article.title} · Murph`,
    description: article.description,
    alternates: {
      canonical: buildBlogArticlePath(article.slug),
    },
    openGraph: {
      type: "article",
      publishedTime: `${article.publishedOn}T00:00:00.000Z`,
    },
  });
}

export default async function BlogArticlePage({ params }: BlogArticlePageProps) {
  const article = getBlogArticle((await params).slug);
  if (!article) {
    notFound();
  }
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    author: {
      "@type": "Organization",
      name: "Murph",
      url: "https://www.withmurph.ai",
    },
    datePublished: article.publishedOn,
    description: article.description,
    headline: article.title,
    image: "https://www.withmurph.ai/hero.jpg",
    mainEntityOfPage:
      `https://www.withmurph.ai${buildBlogArticlePath(article.slug)}`,
    publisher: {
      "@type": "Organization",
      name: "Murph",
      url: "https://www.withmurph.ai",
    },
  }).replaceAll("<", "\\u003c");

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: structuredData }}
        type="application/ld+json"
      />
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
      />
      <BlogArticleView
        article={article}
        relatedArticles={listRelatedBlogArticles(article)}
      />
      <SiteFooter />
    </>
  );
}
