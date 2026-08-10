import type { Metadata } from "next";

import { BlogArchive } from "@/src/components/blog/blog-archive";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { BLOG_ARTICLES } from "@/src/lib/blog";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const BLOG_DESCRIPTION =
  "Practical health guides, field notes from building Murph, and verified case studies about making better decisions with the whole picture.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph Field Notes · Guides and case studies",
  description: BLOG_DESCRIPTION,
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
