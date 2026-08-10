import type { Metadata } from "next";

import { BlogArchive } from "@/src/components/blog/blog-archive";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import {
  BLOG_ARTICLES,
  BLOG_COLLECTION_DESCRIPTION,
  BLOG_HAS_PUBLISHED_CASE_STUDIES,
} from "@/src/lib/blog";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  title: BLOG_HAS_PUBLISHED_CASE_STUDIES
    ? "Murph Field Notes · Guides and case studies"
    : "Murph Field Notes · Practical health guides",
  description: BLOG_COLLECTION_DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: {
      "application/rss+xml": "/blog/rss.xml",
    },
  },
  openGraph: {
    type: "website",
  },
});

export default async function BlogPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
      />
      <BlogArchive articles={BLOG_ARTICLES} />
      <SiteFooter />
    </>
  );
}
