import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  generateMetadata,
  generateStaticParams,
} from "../app/compare/[competitor]/page";
import { metadata as comparisonIndexMetadata } from "../app/compare/page";
import { PublicComparisonTableStudy } from "../app/design/public-comparison-table-study";
import { ComparisonArticle } from "../src/components/comparisons/comparison-page";
import {
  comparisonPath,
  COMPARISONS,
  getComparisonByRouteSegment,
  listComparisonRoutes,
  listRelatedComparisons,
} from "../src/lib/comparisons/catalog";
import {
  MURPH_COMPARISON_EVIDENCE,
  MURPH_COMPARISON_PROFILE,
} from "../src/lib/comparisons/murph-profile";
import { createComparisonStructuredData } from "../src/lib/comparisons/structured-data";
import { COMPARISON_CATEGORIES } from "../src/lib/comparisons/types";
import {
  MURPH_INDEXABLE_PAGE_ROBOTS,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "../src/lib/site-metadata";

const HUMAN_COPY_FIELDS = [
  "bestFor",
  "bottomLine",
  "chooseCompetitor",
  "chooseMurph",
  "headline",
  "metaDescription",
  "name",
  "overview",
] as const;

function comparisonBySlug(slug: string) {
  const comparison = COMPARISONS.find((entry) => entry.slug === slug);
  assert.ok(comparison, `Missing comparison fixture for ${slug}.`);
  return comparison;
}

function humanCopy(comparison: (typeof COMPARISONS)[number]): string[] {
  return [
    ...HUMAN_COPY_FIELDS.map((field) => comparison[field]),
    ...(comparison.aliases ?? []),
    ...Object.values(comparison.competitor),
    ...comparison.faqs.flatMap((faq) => [faq.question, faq.answer]),
    ...comparison.sources.map((source) => source.label),
    ...comparison.tradeoffs,
    ...(comparison.useTogether ? [comparison.useTogether] : []),
  ];
}

describe("comparison catalog", () => {
  it("publishes a substantial, unique, source-backed catalog", () => {
    expect(COMPARISONS.length).toBeGreaterThanOrEqual(60);

    assert.deepEqual(
      Object.keys(MURPH_COMPARISON_EVIDENCE).sort(),
      Object.keys(MURPH_COMPARISON_PROFILE).sort(),
      "Murph must map evidence for every comparison dimension.",
    );
    for (const [key, ordinals] of Object.entries(MURPH_COMPARISON_EVIDENCE)) {
      for (const ordinal of ordinals) {
        assert.equal(
          Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 2,
          true,
          `Murph.${key} has out-of-range source ${ordinal}.`,
        );
      }
    }

    const slugs = new Set<string>();
    const names = new Set<string>();
    const descriptions = new Set<string>();
    const categories = new Set<string>();

    for (const comparison of COMPARISONS) {
      assert.match(comparison.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      assert.equal(slugs.has(comparison.slug), false, `Duplicate slug: ${comparison.slug}`);
      assert.equal(names.has(comparison.name.toLowerCase()), false, `Duplicate name: ${comparison.name}`);
      assert.equal(
        descriptions.has(comparison.metaDescription.toLowerCase()),
        false,
        `Duplicate description: ${comparison.slug}`,
      );
      slugs.add(comparison.slug);
      names.add(comparison.name.toLowerCase());
      descriptions.add(comparison.metaDescription.toLowerCase());
      categories.add(comparison.category);

      assert.match(comparison.lastVerified, /^\d{4}-\d{2}-\d{2}$/u);
      assert.ok(comparison.metaDescription.length >= 100);
      assert.ok(comparison.metaDescription.length <= 190);
      assert.equal(comparison.faqs.length, 3);
      assert.ok(comparison.tradeoffs.length >= 2);
      assert.ok(comparison.sources.length >= 2);

      const competitorProfileKeys = Object.keys(
        comparison.competitor,
      ) as Array<keyof typeof comparison.competitor>;
      assert.deepEqual(
        Object.keys(comparison.competitorEvidence).sort(),
        [...competitorProfileKeys].sort(),
        `${comparison.slug} must map evidence for every comparison dimension.`,
      );
      for (const key of competitorProfileKeys) {
        const ordinals = comparison.competitorEvidence[key];
        assert.ok(
          ordinals.length > 0,
          `${comparison.slug}.${key} needs a source reference.`,
        );
        assert.equal(
          new Set(ordinals).size,
          ordinals.length,
          `${comparison.slug}.${key} repeats a source reference.`,
        );
        for (const ordinal of ordinals) {
          assert.equal(
            Number.isInteger(ordinal)
              && ordinal >= 1
              && ordinal <= comparison.sources.length,
            true,
            `${comparison.slug}.${key} has out-of-range source ${ordinal}.`,
          );
        }
      }

      const copy = humanCopy(comparison);
      assert.ok(copy.join(" ").length >= 1_000, `${comparison.slug} needs more substantive copy.`);
      for (const value of copy) {
        assert.equal(value, value.trim(), `${comparison.slug} has untrimmed copy.`);
        assert.doesNotMatch(value, /—|--/u, `${comparison.slug} uses a prohibited dash.`);
      }

      const sourceUrls = new Set<string>();
      for (const source of comparison.sources) {
        const url = new URL(source.url);
        assert.equal(url.protocol, "https:");
        assert.equal(sourceUrls.has(source.url), false, `${comparison.slug} repeats a source.`);
        sourceUrls.add(source.url);
      }

      if (comparison.relationship === "complement") {
        assert.ok(comparison.useTogether, `${comparison.slug} should explain how the products work together.`);
      }
    }

    expect(categories).toEqual(
      new Set(COMPARISON_CATEGORIES.map((category) => category.id)),
    );
  });

  it("exposes one canonical static route per comparison and no reversed duplicates", () => {
    const routes = listComparisonRoutes();
    expect(routes).toHaveLength(COMPARISONS.length + 1);
    expect(routes[0]).toBe("/compare");
    expect(new Set(routes).size).toBe(routes.length);
    expect(generateStaticParams()).toEqual(
      COMPARISONS.map((comparison) => ({
        competitor: `murph-vs-${comparison.slug}`,
      })),
    );

    for (const comparison of COMPARISONS) {
      const path = comparisonPath(comparison);
      expect(path).toBe(`/compare/murph-vs-${comparison.slug}`);
      expect(getComparisonByRouteSegment(`murph-vs-${comparison.slug}`)).toBe(comparison);
      expect(routes).not.toContain(`/compare/${comparison.slug}-vs-murph`);
    }
  });

  it.each(["whoop", "bodybuddy", "commonhealth"])(
    "renders the %s guide as substantive semantic HTML",
    (slug) => {
      const comparison = comparisonBySlug(slug);
      const markup = renderToStaticMarkup(
        createElement(ComparisonArticle, {
          comparison,
          related: listRelatedComparisons(comparison),
        }),
      );
      const readableText = markup
        .replaceAll(/<[^>]+>/gu, " ")
        .replaceAll(/\s+/gu, " ")
        .trim();
      const headingMarkup = markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/u)?.[1];

      assert.ok(headingMarkup, "Comparison guide needs an h1.");
      assert.equal(
        headingMarkup.replaceAll(/<[^>]+>/gu, "").trim(),
        `Murph vs ${comparison.name}`,
      );
      assert.match(markup, /<caption[^>]*>Murph and [^<]+ feature comparison<\/caption>/u);
      assert.match(markup, /scope="col"/u);
      assert.match(markup, /scope="row"/u);
      assert.match(markup, /Official sources/u);
      assert.match(markup, /official-source desk research/iu);
      assert.equal((markup.match(/<h3\b/gu) ?? []).length, 3);
      assert.ok(readableText.length > 2_000);

      for (const ordinals of Object.values(MURPH_COMPARISON_EVIDENCE)) {
        for (const ordinal of ordinals) {
          const sourceNumber = String(ordinal).padStart(2, "0");
          assert.match(
            markup,
            new RegExp(
              `href="#comparison-${comparison.slug}-source-${sourceNumber}"`,
              "u",
            ),
          );
          assert.match(
            markup,
            new RegExp(
              `id="comparison-${comparison.slug}-source-${sourceNumber}"`,
              "u",
            ),
          );
        }
      }

      for (const ordinals of Object.values(comparison.competitorEvidence)) {
        for (const ordinal of ordinals) {
          const sourceNumber = String(ordinal + 2).padStart(2, "0");
          assert.match(
            markup,
            new RegExp(
              `href="#comparison-${comparison.slug}-source-${sourceNumber}"`,
              "u",
            ),
          );
          assert.match(
            markup,
            new RegExp(
              `id="comparison-${comparison.slug}-source-${sourceNumber}"`,
              "u",
            ),
          );
        }
      }
    },
  );

  it("publishes visible Article, breadcrumb, and FAQ structured data without review markup", () => {
    const comparison = comparisonBySlug("whoop");
    const structuredData = createComparisonStructuredData(comparison);
    const serialized = JSON.stringify(structuredData);
    const article = structuredData[0] as {
      citation: readonly string[];
      headline: string;
    };
    const faq = structuredData[2] as {
      mainEntity: ReadonlyArray<{
        acceptedAnswer: { text: string };
        name: string;
      }>;
    };

    assert.equal(article.headline, `Murph vs ${comparison.name}`);
    assert.deepEqual(
      article.citation.slice(-comparison.sources.length),
      comparison.sources.map((source) => source.url),
    );
    assert.ok(article.citation.length > comparison.sources.length);
    assert.deepEqual(
      faq.mainEntity.map((entry) => ({
        answer: entry.acceptedAnswer.text,
        question: entry.name,
      })),
      comparison.faqs,
    );
    assert.doesNotMatch(serialized, /AggregateRating|Product|Review/u);
  });

  it("gives known guides unique indexable metadata and unknown guides noindex metadata", async () => {
    const comparison = comparisonBySlug("bodybuddy");
    const metadata = await generateMetadata({
      params: Promise.resolve({ competitor: "murph-vs-bodybuddy" }),
    });
    const missingMetadata = await generateMetadata({
      params: Promise.resolve({ competitor: "murph-vs-not-a-product" }),
    });

    expect(metadata.title).toBe(`Murph vs ${comparison.name}`);
    expect(metadata.description).toBe(comparison.metaDescription);
    expect(metadata.alternates?.canonical).toBe(comparisonPath(comparison));
    expect(metadata.robots).toEqual(MURPH_INDEXABLE_PAGE_ROBOTS);
    expect(metadata.openGraph).toMatchObject({
      images: [
        {
          alt: `Murph vs ${comparison.name}`,
          url: `${comparisonPath(comparison)}/opengraph-image`,
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      images: [
        {
          alt: `Murph vs ${comparison.name}`,
          url: `${comparisonPath(comparison)}/opengraph-image`,
        },
      ],
    });
    expect(
      metadata.openGraph && "type" in metadata.openGraph
        ? metadata.openGraph.type
        : undefined,
    ).toBe("article");
    expect(missingMetadata.robots).toEqual(MURPH_NOINDEX_PAGE_ROBOTS);
  });

  it("points the comparison index metadata at its dedicated share card", () => {
    expect(comparisonIndexMetadata.openGraph).toMatchObject({
      images: [
        {
          alt: "Murph comparison guides",
          url: "/compare/opengraph-image",
        },
      ],
    });
    expect(comparisonIndexMetadata.twitter).toMatchObject({
      images: [
        {
          alt: "Murph comparison guides",
          url: "/compare/opengraph-image",
        },
      ],
    });
  });

  it("registers the real production table in the synthetic design study", () => {
    const markup = renderToStaticMarkup(createElement(PublicComparisonTableStudy));

    assert.match(markup, /Murph and Recovery wearable feature comparison/u);
    assert.match(markup, /role="region"/u);
    assert.match(markup, /scope="row"/u);
  });
});
