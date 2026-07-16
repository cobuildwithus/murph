import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { PublicProductDetail } from "@murphai/contracts";

vi.mock("next/link", () => ({
  default(input: {
    children?: ReactNode;
    className?: string;
    href: string;
    prefetch?: boolean;
  }) {
    return createElement("a", {
      className: input.className,
      "data-prefetch": String(input.prefetch),
      href: input.href,
    }, input.children);
  },
}));

import { MurphSafeProductDetail } from "@/src/components/murph-safe/product-detail";
import MurphSafeSearchPage, {
  metadata as searchMetadata,
} from "../app/search/page";

describe("Murph Safe public pages", () => {
  test("renders the approved search identity and indexable generic metadata", () => {
    const markup = renderToStaticMarkup(createElement(MurphSafeSearchPage));

    expect(searchMetadata.title).toBe(
      "Murph Safe | Food, supplement, and product test data",
    );
    expect(searchMetadata.robots).toEqual({ follow: true, index: true });
    expect(markup).toContain("Is it Murph Safe?");
    expect(markup).toContain(
      "What’s in it, what’s been tested, and what we still don’t know.",
    );
    expect(markup).toContain("LABEL CONTENTS");
    expect(markup).toContain("PRODUCT TESTS");
    expect(markup).toContain("KNOWN GAPS");
    expect(markup).toContain("/api/public/v1/openapi.json");
    expect(markup).not.toContain("name=\"q\"");
  });

  test("renders detail evidence in the approved order with honest caveats", () => {
    const markup = renderToStaticMarkup(
      createElement(MurphSafeProductDetail, { product: makeProductDetail() }),
    );

    const productTestsIndex = markup.indexOf("Product tests");
    const ingredientsIndex = markup.indexOf("Supplement facts");
    const nutritionIndex = markup.indexOf("Nutrition facts");
    const unknownsIndex = markup.indexOf("What we do not know");
    const provenanceIndex = markup.indexOf("Sources and record details");
    const correctionIndex = markup.indexOf("Think this record is wrong or out of date?");

    expect(productTestsIndex).toBeGreaterThan(-1);
    expect(productTestsIndex).toBeLessThan(ingredientsIndex);
    expect(ingredientsIndex).toBeLessThan(nutritionIndex);
    expect(nutritionIndex).toBeLessThan(unknownsIndex);
    expect(unknownsIndex).toBeLessThan(provenanceIndex);
    expect(provenanceIndex).toBeLessThan(correctionIndex);
    expect(markup).toContain(
      "This comparison is a screening reference, not a product safety determination.",
    );
    expect(markup).toContain("Showing 1 of 2 observations");
    expect(markup).toContain("Exact product match, manually reviewed");
    expect(markup).toContain("1 scoop (5 g)");
    expect(markup).toContain("500 mg");
    expect(markup).toContain("OTHER INGREDIENTS");
    expect(markup).toContain("Vegetable capsule.");
    expect(markup).toContain("Basis: per unit of product mass");
    expect(markup).toContain("1 mcg. Basis: per unit of product mass");
    expect(markup).toContain("Assumes 70 kg body weight and 1 serving per day");
    expect(markup).not.toContain("product_mass");
    expect(markup).not.toContain("adult_one_serving_per_day_v1");
    expect(markup).not.toContain("Normalized result:");
    expect(markup).toContain("mailto:support@withmurph.ai");
    expect(markup).not.toContain("first product");
  });

  test("describes missing product tests as an evidence gap", () => {
    const product = makeProductDetail();
    product.productTests = {
      alerts: [],
      observations: [],
      returned: 0,
      status: "no_known_product_tests",
      total: 0,
      truncated: false,
    };
    const markup = renderToStaticMarkup(
      createElement(MurphSafeProductDetail, { product }),
    );

    expect(markup).toContain(
      "Murph has no product-level test tied to this exact record. This is an evidence gap, not a safety finding.",
    );
    expect(markup).not.toMatch(/>Safe</);
    expect(markup).not.toContain("Passed");
  });

  test("does not infer a screening comparison from an alert", () => {
    const product = makeProductDetail();
    const observation = product.productTests.observations[0];
    if (!observation) {
      throw new Error("Synthetic product test observation is missing.");
    }
    observation.screening = null;

    const markup = renderToStaticMarkup(
      createElement(MurphSafeProductDetail, { product }),
    );

    expect(product.productTests.alerts.length).toBeGreaterThan(0);
    expect(markup).not.toContain("Above this screening threshold");
    expect(markup).not.toContain(
      "This comparison is a screening reference, not a product safety determination.",
    );
  });

  test("renders qualitative operators and small measurements without losing meaning", () => {
    const product = makeProductDetail();
    const observation = product.productTests.observations[0];
    if (!observation) {
      throw new Error("Synthetic product test observation is missing.");
    }
    observation.normalizedResult = null;
    observation.result = {
      basis: "oral_total_dietary_exposure",
      operator: "not_detected",
      unit: "ppm",
      value: null,
    };
    observation.screening = null;

    const qualitativeMarkup = renderToStaticMarkup(
      createElement(MurphSafeProductDetail, { product }),
    );
    expect(qualitativeMarkup).toContain("Not detected (reported in ppm)");
    expect(qualitativeMarkup).toContain("Basis: total daily oral exposure");
    expect(qualitativeMarkup).not.toContain("Not detected ppm");

    observation.result = {
      basis: "product_mass",
      operator: "eq",
      unit: "ppm",
      value: 0.00001,
    };
    const preciseMarkup = renderToStaticMarkup(
      createElement(MurphSafeProductDetail, { product }),
    );
    expect(preciseMarkup).toContain("0.00001 ppm");
  });
});

function makeProductDetail(): PublicProductDetail {
  return {
    brand: "Example Labs",
    ingredients: {
      active: [
        {
          amount: { display: "500", unit: "mg", value: 500 },
          children: [],
          dailyValuePercent: null,
          name: "Creatine monohydrate",
          notes: null,
        },
      ],
      other: [],
      otherStatement: "Vegetable capsule.",
      statement: "Creatine monohydrate.",
      structure: "structured",
    },
    kind: "supplement",
    marketStatus: "active",
    name: "Example Creatine",
    nutrition: {
      basis: "per_serving",
      rows: [
        {
          amount: { display: "500", unit: "mg", value: 500 },
          basis: "per_serving",
          dailyValuePercent: null,
          name: "Creatine",
        },
      ],
    },
    productRef: "supplement_c3VwcGxlbWVudC0x",
    productTests: {
      alerts: [
        {
          analyte: { key: "lead", name: "Lead" },
          concernLevel: "medium",
          result: { basis: "per serving", operator: "eq", unit: "mcg", value: 1.2 },
          source: {
            key: "plasticlist",
            name: "PlasticList",
            reportDate: "2026-01-02",
            reportTitle: "Synthetic product report",
            url: "https://example.test/report",
          },
          testedProduct: {
            brand: "Example Labs",
            matchMethod: "manual_confirmed",
            name: "Example Creatine",
            sourceProductId: "synthetic-1",
            upc: "123456789012",
          },
          threshold: {
            authority: "Synthetic authority",
            basis: "per serving",
            name: "Synthetic screening threshold",
            unit: "mcg",
            url: "https://example.test/threshold",
            value: 1,
          },
        },
      ],
      observations: [
        {
          analyte: { key: "lead", name: "Lead" },
          id: "synthetic-observation-1",
          labName: "Example Laboratory",
          normalizedResult: { basis: "product_mass", unit: "mcg", value: 1.2 },
          result: { basis: "product_mass", operator: "eq", unit: "mcg", value: 1.2 },
          screening: {
            comparison: "exceeds",
            threshold: {
              authority: "Synthetic authority",
              basis: "product_mass",
              name: "Synthetic screening threshold",
              unit: "mcg",
              url: "https://example.test/threshold",
              value: 1,
            },
            screeningPolicy: {
              assumedBodyWeightKg: 70,
              assumedServingsPerDay: 1,
              exposure: {
                basis: "oral_total_dietary_exposure",
                unit: "mcg/day",
                value: 1.2,
              },
              id: "adult_one_serving_per_day_v1",
              ratio: 1.2,
              servingGrams: 5,
            },
          },
          source: {
            key: "plasticlist",
            name: "PlasticList",
            reportDate: "2026-01-02",
            reportTitle: "Synthetic product report",
            url: "https://example.test/report",
          },
          testedProduct: {
            brand: "Example Labs",
            matchMethod: "manual_confirmed",
            name: "Example Creatine",
            sourceProductId: "synthetic-1",
            upc: "123456789012",
          },
          testMethod: "Synthetic assay",
        },
      ],
      returned: 1,
      status: "known_product_tests",
      total: 2,
      truncated: true,
    },
    serving: {
      amount: 1,
      description: "1 scoop",
      grams: 5,
      unit: "scoop",
    },
    source: {
      importedAt: "2026-01-03T00:00:00.000Z",
      key: "brand_site",
      lastSeenAt: "2026-01-03T00:00:00.000Z",
      name: "Official brand label",
      recordId: "synthetic-product-1",
      releaseDate: "2026-01-01",
      url: "https://example.test/product",
    },
    unknowns: [
      {
        code: "FORMULA_REVISION_NOT_TRACKED",
        description: "Murph does not track an immutable formula revision for this label.",
        title: "Formula revision not tracked",
      },
    ],
    upc: "123456789012",
  };
}
