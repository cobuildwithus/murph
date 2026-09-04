import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComparisonArticle } from "@/src/components/comparisons/comparison-page";
import { ComparisonPageShell } from "@/src/components/comparisons/comparison-shell";
import {
  comparisonPath,
  getComparisonByRouteSegment,
  listComparisonRouteParams,
  listRelatedComparisons,
} from "@/src/lib/comparisons/catalog";
import { createComparisonStructuredData } from "@/src/lib/comparisons/structured-data";
import { serializeStructuredData } from "@/src/lib/public-agent-content";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ competitor: string }> {
  return listComparisonRouteParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const comparison = getComparisonByRouteSegment((await params).competitor);

  if (!comparison) {
    return createMurphPageMetadata({
      description: "This Murph comparison guide could not be found.",
      robots: MURPH_NOINDEX_PAGE_ROBOTS,
      title: "Comparison not found",
    });
  }

  const path = comparisonPath(comparison);
  const title = `Murph vs ${comparison.name}`;
  const ogImage = createMurphOgImageRef({
    alt: title,
    url: `${path}/opengraph-image`,
  });

  return createMurphPageMetadata({
    alternates: {
      canonical: path,
    },
    description: comparison.metaDescription,
    openGraph: {
      images: [ogImage],
      modifiedTime: comparison.lastVerified,
      publishedTime: "2026-08-30",
      type: "article",
      url: path,
    },
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
    title,
    twitter: {
      images: [ogImage],
    },
  });
}

export default async function ComparisonDetailPage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const comparison = getComparisonByRouteSegment((await params).competitor);

  if (!comparison) {
    notFound();
  }

  const structuredData = createComparisonStructuredData(comparison);

  return (
    <ComparisonPageShell>
      {structuredData.map((entry) => (
        <script
          dangerouslySetInnerHTML={{
            __html: serializeStructuredData(entry),
          }}
          key={entry["@id"]}
          type="application/ld+json"
        />
      ))}
      <main>
        <ComparisonArticle
          comparison={comparison}
          related={listRelatedComparisons(comparison)}
        />
      </main>
    </ComparisonPageShell>
  );
}
