import type { Metadata } from "next";

import { ComparisonIndex } from "@/src/components/comparisons/comparison-index";
import { ComparisonPageShell } from "@/src/components/comparisons/comparison-shell";
import { COMPARISONS } from "@/src/lib/comparisons/catalog";
import { createComparisonIndexStructuredData } from "@/src/lib/comparisons/structured-data";
import { serializeStructuredData } from "@/src/lib/public-agent-content";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

const comparisonIndexOgImage = createMurphOgImageRef({
  alt: "Murph comparison guides",
  url: "/compare/opengraph-image",
});

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/compare",
  },
  description:
    "Compare Murph with leading health wearables, dashboards, lab services, coaching apps, and AI health assistants using current official sources.",
  openGraph: {
    images: [comparisonIndexOgImage],
    type: "website",
    url: "/compare",
  },
  robots: MURPH_INDEXABLE_PAGE_ROBOTS,
  title: "Murph comparison guides",
  twitter: {
    images: [comparisonIndexOgImage],
  },
});

export default function CompareIndexPage() {
  const structuredData = createComparisonIndexStructuredData();

  return (
    <ComparisonPageShell>
      <script
        dangerouslySetInnerHTML={{
          __html: serializeStructuredData(structuredData),
        }}
        type="application/ld+json"
      />
      <ComparisonIndex comparisons={COMPARISONS} />
    </ComparisonPageShell>
  );
}
