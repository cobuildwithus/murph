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
import { ComparisonDirectory } from "../src/components/comparisons/comparison-directory";
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

const QUICK_STATUS_RANK = { limited: 1, no: 0, yes: 2 } as const;

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
    ...comparison.quickComparison.map((row) => row.capability),
    ...comparison.sources.map((source) => source.label),
    ...comparison.tradeoffs,
    ...(comparison.useTogether ? [comparison.useTogether] : []),
  ];
}

describe("comparison catalog", () => {
  it("keeps every guide browsable while client-only search is disabled in server HTML", () => {
    const markup = renderToStaticMarkup(
      createElement(ComparisonDirectory, {
        comparisons: COMPARISONS,
      }),
    );
    const searchInput = markup.match(/<input[^>]*id="comparison-search"[^>]*>/u)?.[0];

    assert.ok(searchInput, "Comparison directory needs a search input.");
    assert.match(searchInput, /\sdisabled(?:=""|(?=\s|>))/u);
    assert.match(searchInput, /placeholder:text-\[#736a58\]/u);
    assert.equal(
      (markup.match(/href="\/compare\/murph-vs-/gu) ?? []).length,
      COMPARISONS.length,
    );
  });

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
      assert.match(
        comparison.metaDescription,
        /\bpersonal health assistant\b/iu,
        `${comparison.slug} must introduce Murph's product role in search snippets.`,
      );
      assert.doesNotMatch(
        comparison.metaDescription,
        /^Compare Murph\b/iu,
        `${comparison.slug} must not spend its search snippet on a generic comparison opener.`,
      );
      assert.doesNotMatch(
        comparison.headline,
        /^Murph vs\b/iu,
        `${comparison.slug} must not repeat the comparison label in its headline.`,
      );
      assert.equal(comparison.faqs.length, 3);
      assert.ok(comparison.tradeoffs.length >= 2);
      assert.ok(
        comparison.tradeoffs.some((tradeoff) => /\bMurph\b/u.test(tradeoff)),
        `${comparison.slug} must name a concrete Murph limitation among its tradeoffs.`,
      );
      assert.ok(comparison.sources.length >= 2);

      assert.equal(
        comparison.quickComparison.length,
        5,
        `${comparison.slug} needs exactly five quick-comparison rows.`,
      );
      assert.equal(
        new Set(comparison.quickComparison.map((row) => row.capability)).size,
        comparison.quickComparison.length,
        `${comparison.slug} repeats a quick-comparison capability.`,
      );
      assert.ok(
        comparison.quickComparison.filter(
          (row) => row.murph !== row.competitor,
        ).length >= 2,
        `${comparison.slug} needs at least two meaningful quick-comparison differences.`,
      );
      assert.ok(
        comparison.quickComparison.some(
          (row) =>
            QUICK_STATUS_RANK[row.murph]
            > QUICK_STATUS_RANK[row.competitor],
        ),
        `${comparison.slug} must show a grounded Murph advantage.`,
      );
      assert.ok(
        comparison.quickComparison.some(
          (row) =>
            QUICK_STATUS_RANK[row.competitor]
            > QUICK_STATUS_RANK[row.murph],
        ),
        `${comparison.slug} must show a grounded competitor advantage.`,
      );
      for (const row of comparison.quickComparison) {
        assert.match(
          row.capability,
          /^[A-Z][A-Za-z0-9 ]{0,35}$/u,
          `${comparison.slug} has a noisy quick-comparison label.`,
        );
        assert.doesNotMatch(
          row.capability,
          /\bMurph\b/iu,
          `${comparison.slug} names Murph in a capability label.`,
        );
        assert.equal(
          row.capability.toLowerCase().includes(comparison.name.toLowerCase()),
          false,
          `${comparison.slug} names the competitor in a capability label.`,
        );
        assert.ok(
          ["yes", "limited", "no"].includes(row.murph),
          `${comparison.slug} has an invalid Murph quick-comparison status.`,
        );
        assert.ok(
          ["yes", "limited", "no"].includes(row.competitor),
          `${comparison.slug} has an invalid competitor quick-comparison status.`,
        );
        assert.ok(
          row.evidence in comparison.competitorEvidence,
          `${comparison.slug}.${row.capability} needs a valid evidence dimension.`,
        );
      }

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
      assert.match(markup, /<caption[^>]*>Murph and [^<]+ at-a-glance comparison<\/caption>/u);
      assert.match(markup, /<details[^>]*data-detailed-comparison/u);
      assert.match(markup, /✓/u);
      assert.match(markup, /×/u);
      for (const row of comparison.quickComparison) {
        assert.ok(markup.includes(`>${row.capability}<`));
        assert.match(
          markup,
          new RegExp(`data-evidence-dimension="${row.evidence}"`, "u"),
        );
      }
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
          alt: "Murph personal health assistant comparison guides",
          url: "/compare/opengraph-image",
        },
      ],
    });
    expect(comparisonIndexMetadata.twitter).toMatchObject({
      images: [
        {
          alt: "Murph personal health assistant comparison guides",
          url: "/compare/opengraph-image",
        },
      ],
    });
  });

  it("registers the real production table in the synthetic design study", () => {
    const markup = renderToStaticMarkup(createElement(PublicComparisonTableStudy));

    assert.match(markup, /Murph and Recovery wearable at-a-glance comparison/u);
    assert.match(markup, /role="region"/u);
    assert.match(markup, /scope="row"/u);
  });
});
