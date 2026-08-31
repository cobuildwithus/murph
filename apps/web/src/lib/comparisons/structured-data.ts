import {
  comparisonLibraryLastVerified,
  comparisonPath,
  COMPARISONS,
} from "@/src/lib/comparisons/catalog";
import {
  COMPARISON_CATEGORIES,
  type ComparisonEntry,
} from "@/src/lib/comparisons/types";
import { MURPH_PUBLIC_SITE_URL } from "@/src/lib/site-metadata";

function absoluteUrl(path: string): string {
  return new URL(path, MURPH_PUBLIC_SITE_URL).toString();
}

function categoryLabel(comparison: ComparisonEntry): string {
  return COMPARISON_CATEGORIES.find(
    (category) => category.id === comparison.category,
  )?.label ?? "Health products";
}

function murphOrganization() {
  return {
    "@id": `${MURPH_PUBLIC_SITE_URL}/#organization`,
    "@type": "Organization",
    name: "Murph",
    url: MURPH_PUBLIC_SITE_URL,
  };
}

export function createComparisonStructuredData(comparison: ComparisonEntry) {
  const path = comparisonPath(comparison);
  const url = absoluteUrl(path);

  return [
    {
      "@context": "https://schema.org",
      "@id": `${url}#article`,
      "@type": "Article",
      about: [
        {
          "@id": `${MURPH_PUBLIC_SITE_URL}/#software`,
        },
        {
          "@type": "Thing",
          name: comparison.name,
        },
      ],
      articleSection: categoryLabel(comparison),
      author: {
        "@id": `${absoluteUrl("/compare")}#editorial-research`,
        "@type": "Organization",
        name: "Murph editorial research",
        url: absoluteUrl("/compare#methodology"),
      },
      citation: [
        MURPH_PUBLIC_SITE_URL,
        absoluteUrl("/legal/health-ai-safety-disclosure"),
        ...comparison.sources.map((source) => source.url),
      ],
      dateModified: comparison.lastVerified,
      datePublished: "2026-08-30",
      description: comparison.metaDescription,
      headline: `Murph vs ${comparison.name}`,
      image: absoluteUrl(`${path}/opengraph-image`),
      isPartOf: {
        "@id": `${absoluteUrl("/compare")}#collection`,
      },
      mainEntityOfPage: url,
      publisher: murphOrganization(),
      url,
    },
    {
      "@context": "https://schema.org",
      "@id": `${url}#breadcrumbs`,
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          item: MURPH_PUBLIC_SITE_URL,
          name: "Murph",
          position: 1,
        },
        {
          "@type": "ListItem",
          item: absoluteUrl("/compare"),
          name: "Comparisons",
          position: 2,
        },
        {
          "@type": "ListItem",
          item: url,
          name: `Murph vs ${comparison.name}`,
          position: 3,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@id": `${url}#faq`,
      "@type": "FAQPage",
      mainEntity: comparison.faqs.map((faq) => ({
        "@type": "Question",
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
        name: faq.question,
      })),
    },
  ];
}

export function createComparisonIndexStructuredData() {
  const url = absoluteUrl("/compare");

  return {
    "@context": "https://schema.org",
    "@id": `${url}#collection`,
    "@type": "CollectionPage",
    about: {
      "@id": `${MURPH_PUBLIC_SITE_URL}/#software`,
    },
    dateModified: comparisonLibraryLastVerified(),
    datePublished: "2026-08-30",
    description:
      "Source-backed guides comparing Murph, a personal health assistant, with consumer wearables, health dashboards, lab services, coaching apps, and other health assistants.",
    image: absoluteUrl("/compare/opengraph-image"),
    hasPart: COMPARISONS.map((comparison) => ({
      "@id": `${absoluteUrl(comparisonPath(comparison))}#article`,
    })),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: COMPARISONS.map((comparison, index) => ({
        "@type": "ListItem",
        name: `Murph vs ${comparison.name}`,
        position: index + 1,
        url: absoluteUrl(comparisonPath(comparison)),
      })),
      numberOfItems: COMPARISONS.length,
    },
    name: "Murph comparison guides",
    publisher: murphOrganization(),
    url,
  };
}
