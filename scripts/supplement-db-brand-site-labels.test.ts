import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  SEARCH_TEXT_MAX_LENGTH,
  assertProductionReady,
  buildSearchText,
  normalizeItem,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs";
import {
  buildEvidenceRecoveryByBrand,
  buildEvidenceRecoveryQueue,
  extractIngredientRowsFromText,
  extractServingSizes,
  repairPreviewForRow,
  summarize,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs";
import {
  buildDsldStructuredFactsByUpcSql,
  buildShopifyEvidenceCandidate,
  factsTextContaminationReason,
  hydrateCandidatesWithDsldFacts,
  matchShopifyVariantForQueueRow,
  productFactsPromotionBlockedReasonForProduct,
  selectShopifyFactsMedia,
  shopifyJsonUrlForProductUrl,
  variantCandidateTexts,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs";

describe("supplement brand-site DB helper", () => {
  test("builds compact search text from normalized product facts instead of page body JSON", () => {
    const searchText = buildSearchText({
      source: "example-brand",
      sourceId: "magnesium",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:magnesium",
      name: "Example Magnesium",
      brand: "Example Brand",
      upc: "012345678905",
      dataOriginUrl: "https://example.test/products/magnesium",
      label: {
        productType: "Capsules",
        bodyText: "marketing body ".repeat(500),
        factsText: "Supplement Facts ".repeat(500),
        rawPageText: "faq copy ".repeat(500),
        ingredientRows: [
          { name: "Magnesium", amount: "200", unit: "mg" },
          { name: "Glycine", amount: "1", unit: "g" },
        ],
        servingSizes: ["2 capsules"],
        ingredientText: "Other ingredients: vegetable capsule.",
      },
    });

    assert.equal(searchText.length <= SEARCH_TEXT_MAX_LENGTH, true);
    assert.match(searchText, /Example Magnesium/u);
    assert.match(searchText, /Magnesium 200 mg/u);
    assert.match(searchText, /2 capsules/u);
    assert.doesNotMatch(searchText, /marketing body marketing body/u);
    assert.doesNotMatch(searchText, /Supplement Facts Supplement Facts/u);
    assert.doesNotMatch(searchText, /rawPageText/u);
  });

  test("normalization ignores caller-provided broad searchText", () => {
    const normalized = normalizeItem({
      id: "example-brand:magnesium",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:magnesium",
      source: "example-brand",
      sourceId: "magnesium",
      name: "Example Magnesium",
      brand: "Example Brand",
      searchText: "bad copied page text ".repeat(500),
      label: {
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: ["2 capsules"],
      },
    });

    assert.match(normalized.searchText, /Example Magnesium/u);
    assert.doesNotMatch(normalized.searchText, /bad copied page text/u);
    assert.deepEqual(normalized.reviewIssues, []);
  });

  test("production readiness requires normalized rows and rejects non-product/page-body rows", () => {
    const valid = normalizeItem({
      id: "example-brand:magnesium",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:magnesium",
      source: "example-brand",
      sourceId: "magnesium",
      name: "Example Magnesium",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: ["2 capsules"],
      },
    });
    assert.doesNotThrow(() => assertProductionReady([valid]));

    const blocked = normalizeItem({
      id: "example-brand:starter-kit",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:starter-kit",
      source: "example-brand",
      sourceId: "starter-kit",
      name: "Example Starter Kit",
      brand: "Example Brand",
      label: {
        bodyText: "full page copy ".repeat(200),
        ingredientRows: [],
        servingSizes: [],
      },
    });

    assert.deepEqual(blocked.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "non_standalone_product",
      "page_body_text_too_large",
    ]);
    assert.throws(() => assertProductionReady([blocked]), /Production upsert blocked/u);

    const food = normalizeItem({
      id: "example-brand:chunky-flavour",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:chunky-flavour",
      source: "example-brand",
      sourceId: "chunky-flavour",
      name: "Chunky Flavour - Fudge Brownie",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Erythritol", amount: "2", unit: "g" }],
        servingSizes: ["3 g"],
      },
    });

    assert.deepEqual(food.reviewIssues, ["likely_food_or_non_supplement"]);
    assert.throws(() => assertProductionReady([food]), /likely_food_or_non_supplement/u);

    const flavoredProtein = normalizeItem({
      id: "example-brand:protein-oatmeal-cookie",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:protein-oatmeal-cookie",
      source: "example-brand",
      sourceId: "protein-oatmeal-cookie",
      name: "Vegan Protein - Oatmeal Cookie",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Protein blend", amount: "20", unit: "g" }],
        servingSizes: ["1 scoop"],
      },
    });

    assert.deepEqual(flavoredProtein.reviewIssues, []);

    const supplementPowder = normalizeItem({
      id: "example-brand:collagen-flavour-powder",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:collagen-flavour-powder",
      source: "example-brand",
      sourceId: "collagen-flavour-powder",
      name: "UC-II Collagen Orange Flavour Powder",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Collagen", amount: "40", unit: "mg" }],
        servingSizes: ["1 sachet"],
      },
    });

    assert.deepEqual(supplementPowder.reviewIssues, []);
  });
});

describe("supplement brand-site refetch preview", () => {
  const bluebonnetProduct = {
    title: "5-HTP 100 mg",
    vendor: "Bluebonnet Nutrition",
    type: "Amino Acids",
    description: "<p>Supports relaxation.</p>",
    variants: [
      {
        id: 1,
        title: "60 count",
        public_title: "60 count",
        option1: "60 count",
        sku: "51",
        barcode: "743715000513",
        available: true,
        name: "5-HTP 100 mg - 60 count",
        options: ["60 count"],
      },
      {
        id: 2,
        title: "120 count",
        public_title: "120 count",
        option1: "120 count",
        sku: "53",
        barcode: "743715000537",
        available: true,
        name: "5-HTP 100 mg - 120 count",
        options: ["120 count"],
      },
    ],
    media: [
      {
        alt: "Front panel. #size_60 count",
        position: 1,
        media_type: "image",
        src: "https://cdn.example.test/743715000513F_afront_side.jpg",
      },
      {
        alt: "Supplement facts panel. #size_60 count",
        position: 2,
        media_type: "image",
        src: "https://cdn.example.test/743715000513F_supp_side.jpg",
        width: 1500,
        height: 1575,
      },
      {
        alt: "Supplement facts panel. #size_120 count",
        position: 5,
        media_type: "image",
        src: "https://cdn.example.test/743715000537F_supp-side.jpg",
        width: 1500,
        height: 1575,
      },
    ],
  };

  test("maps Shopify product URLs to official product JSON endpoints", () => {
    assert.equal(
      shopifyJsonUrlForProductUrl("https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules?variant=1"),
      "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules.js",
    );
    assert.equal(shopifyJsonUrlForProductUrl("https://example.test/pages/about"), null);
  });

  test("matches queue rows to Shopify variants without using product-page body text", () => {
    const row = {
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      name: "5-HTP 100 mg - 120 count",
    };

    assert.deepEqual(variantCandidateTexts(row), ["120 count"]);
    assert.equal(matchShopifyVariantForQueueRow(row, bluebonnetProduct)?.barcode, "743715000537");
  });

  test("selects facts media for the matched variant only", () => {
    const variant = bluebonnetProduct.variants[1];
    assert.deepEqual(selectShopifyFactsMedia(bluebonnetProduct, variant), [
      {
        url: "https://cdn.example.test/743715000537F_supp-side.jpg",
        alt: "Supplement facts panel. #size_120 count",
        position: 5,
        width: 1500,
        height: 1575,
        score: 16,
      },
    ]);
  });

  test("does not select another variant's facts image or a matching front panel", () => {
    const product = {
      ...bluebonnetProduct,
      media: [
        {
          alt: "Front panel. #size_120 count",
          position: 1,
          media_type: "image",
          src: "https://cdn.example.test/743715000537F_afront-side.jpg",
        },
        {
          alt: "Supplement facts panel. #size_60 count",
          position: 2,
          media_type: "image",
          src: "https://cdn.example.test/743715000513F_supp_side.jpg",
        },
      ],
    };

    assert.deepEqual(selectShopifyFactsMedia(product, bluebonnetProduct.variants[1]), []);
  });

  test("emits image-only candidates as manual-review rows blocked from production", () => {
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      id: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
      action: "refetch_official_label_or_ocr",
      parserBlockers: ["missing_ingredient_rows", "missing_serving_sizes"],
    }, bluebonnetProduct, "2026-06-07T00:00:00.000Z");

    assert.equal(candidate?.upc, "743715000537");
    assert.deepEqual(candidate?.label.factsImageUrls, [
      "https://cdn.example.test/743715000537F_supp-side.jpg",
    ]);
    assert.equal(candidate?.label.needsManualReview, true);
    assert.deepEqual(candidate?.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "needs_manual_review",
    ]);
    assert.doesNotMatch(JSON.stringify(candidate?.label), /Supports relaxation/u);
  });

  test("promotes clean official facts text only when structured rows and servings parse", () => {
    const product = {
      ...bluebonnetProduct,
      description: [
        "<h2>Supplement Facts</h2>",
        "<p>Serving Size 1 Capsule</p>",
        "<p>Amount Per Serving 5-HTP (from Griffonia simplicifolia seed extract) 100 mg *</p>",
      ].join(""),
      variants: [bluebonnetProduct.variants[0]],
      media: [],
    };

    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg",
      brand: "Bluebonnet Nutrition",
    }, product, "2026-06-07T00:00:00.000Z");

    assert.deepEqual(candidate?.label.servingSizes, [
      { text: "1 Capsule", source: "factsText" },
    ]);
    assert.deepEqual(candidate?.label.ingredientRows, [
      {
        name: "5-HTP (from Griffonia simplicifolia seed extract)",
        amount: "100",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
    ]);
    assert.equal(candidate?.label.needsManualReview, false);
    assert.deepEqual(candidate?.reviewIssues, []);
  });

  test("keeps shared product-description facts blocked for multi-variant products", () => {
    const product = {
      ...bluebonnetProduct,
      description: [
        "<h2>Supplement Facts</h2>",
        "<p>Serving Size 1 Capsule</p>",
        "<p>Amount Per Serving 5-HTP 100 mg *</p>",
      ].join(""),
      media: [],
    };

    assert.equal(
      productFactsPromotionBlockedReasonForProduct(product, "Supplement Facts Serving Size 1 Capsule Amount Per Serving 5-HTP 100 mg *"),
      "shared_product_facts_for_multiple_variants",
    );

    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
    }, product, "2026-06-07T00:00:00.000Z");

    assert.equal(candidate?.label.needsManualReview, true);
    assert.equal(candidate?.refetchPreview.productFactsPromotionBlockedReason, "shared_product_facts_for_multiple_variants");
    assert.equal(candidate?.label.ingredientRows, undefined);
    assert.equal(candidate?.label.servingSizes, undefined);
    assert.deepEqual(candidate?.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "needs_manual_review",
    ]);
  });

  test("keeps page-body-contaminated facts text out of candidate labels", () => {
    const contaminated = "Supplement Facts Serving Size 1 Capsule Amount Per Serving 5-HTP 100 mg * Add to cart Reviews Shipping";
    assert.equal(factsTextContaminationReason(contaminated), "facts_text_page_body_marker");

    const product = {
      ...bluebonnetProduct,
      description: `<p>${contaminated}</p>`,
      variants: [bluebonnetProduct.variants[0]],
      media: [],
    };
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg",
      brand: "Bluebonnet Nutrition",
    }, product, "2026-06-07T00:00:00.000Z");

    assert.equal(candidate?.label.needsManualReview, true);
    assert.equal(candidate?.refetchPreview.productFactsPromotionBlockedReason, "facts_text_page_body_marker");
    assert.equal(candidate?.label.factsText, undefined);
    assert.equal(candidate?.label.ingredientRows, undefined);
    assert.deepEqual(candidate?.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "needs_manual_review",
    ]);
  });

  test("hydrates blocked candidates from exact UPC-matched DSLD structured facts", () => {
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
    }, bluebonnetProduct, "2026-06-07T00:00:00.000Z");

    assert.ok(candidate);
    const [hydrated] = hydrateCandidatesWithDsldFacts([candidate], {
      "743715000537": {
        id: "176487",
        canonicalKey: "dsld:176487",
        upc: "743715000537",
        label: {
          ingredientRows: [
            { name: "5-Hydroxytryptophan", quantity: [{ quantity: 100, unit: "mg" }] },
          ],
          servingSizes: [
            { minQuantity: 1, maxQuantity: 1, unit: "Capsule(s)" },
          ],
          netContents: [
            { quantity: 120, unit: "Vegetable Capsule(s)" },
          ],
          otheringredients: "Vegetable cellulose capsule.",
        },
      },
    });

    assert.equal(hydrated.label.needsManualReview, false);
    assert.equal(hydrated.label.evidenceStatus, "structured_facts_from_exact_dsld_upc_match");
    assert.deepEqual(hydrated.reviewIssues, []);
    assert.deepEqual(hydrated.label.ingredientRows, [
      { name: "5-Hydroxytryptophan", quantity: [{ quantity: 100, unit: "mg" }] },
    ]);
    assert.deepEqual(hydrated.label.servingSizes, [
      { minQuantity: 1, maxQuantity: 1, unit: "Capsule(s)" },
    ]);
    assert.deepEqual(hydrated.label.structuredFactsSource, {
      dataOrigin: "dsld",
      id: "176487",
      canonicalKey: "dsld:176487",
      upc: "743715000537",
      matchedBy: "exact_upc",
    });
    assert.equal(hydrated.label.otherIngredients, "Vegetable cellulose capsule.");
    assert.equal(hydrated.refetchPreview.dsldUpcHydrated, true);
  });

  test("does not hydrate candidates without complete DSLD structured facts", () => {
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
    }, bluebonnetProduct, "2026-06-07T00:00:00.000Z");

    assert.ok(candidate);
    const [notHydrated] = hydrateCandidatesWithDsldFacts([candidate], {
      "743715000537": {
        id: "176487",
        canonicalKey: "dsld:176487",
        upc: "743715000537",
        label: {
          ingredientRows: [{ name: "5-Hydroxytryptophan" }],
          servingSizes: [],
        },
      },
    });

    assert.equal(notHydrated.label.needsManualReview, true);
    assert.equal(notHydrated.refetchPreview.dsldUpcHydrated, undefined);
    assert.deepEqual(notHydrated.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "needs_manual_review",
    ]);
  });

  test("builds DSLD hydration SQL for exact UPC rows only", () => {
    const sql = buildDsldStructuredFactsByUpcSql(["743715000537", "743715000537", "743715000513"]);
    assert.match(sql, /s\.data_origin = 'dsld'/u);
    assert.match(sql, /s\.upc = i\.upc/u);
    assert.match(sql, /jsonb_array_length\(s\.label->'ingredientRows'\) > 0/u);
    assert.equal((sql.match(/743715000537/gu) ?? []).length, 1);
  });
});

describe("supplement brand-site repair preview", () => {
  test("extracts serving size and ingredient rows from pipe-delimited facts text", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 Softgel Servings Per Container 30",
      "Amount Per Serving | % Daily Value",
      "Astaxanthin From Haematococcus pluvialis Extract (whole) | 12 mg | **",
      "Other Ingredients: Softgel (gelatin, glycerin, water), flax oil.",
    ].join(" ");

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "1 Softgel", source: "factsText" },
    ]);
    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Astaxanthin From Haematococcus pluvialis Extract (whole)",
        amount: "12",
        unit: "mg",
        dailyValue: "**",
        source: "factsText",
      },
    ]);
  });

  test("extracts ingredient rows from simple facts text amount patterns", () => {
    const factsText = [
      "Supplement Facts Serving Size 3 Capsules Servings Per Container 30",
      "Amount Per Serving",
      "Vitamin C 250 mg 278%",
      "Vitamin D3 (cholecalciferol) 25 mcg 125%",
      "Other Ingredients: Capsule.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin C",
        amount: "250",
        unit: "mg",
        dailyValue: "278%",
        source: "factsText",
      },
      {
        name: "Vitamin D3 (cholecalciferol)",
        amount: "25",
        unit: "mcg",
        dailyValue: "125%",
        source: "factsText",
      },
    ]);
  });

  test("extracts serving sizes from amount-per facts headers", () => {
    const factsText = [
      "Ingredients Supplement Facts Amount per 1 Capsule % Daily Value",
      "Proprietary Probiotic Blend 300 mg",
      "Supplement Facts Amount Per Tablet % Daily Value Magnesium 50 mg",
    ].join(" ");

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "1 Capsule", source: "factsText" },
      { text: "1 Tablet", source: "factsText" },
    ]);
  });

  test("extracts serving sizes from OCR typo and generic servings marker", () => {
    const factsText = [
      "Supplement Facts Servings Size 23 g Servings: 20 Amount Per Serving Protein 20 g",
      "Supplement Facts Serving Size: 0.7 ml Servings: about 42 Amount Per Serving Anise seed extract 634 mg",
    ].join(" ");

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "23 g", source: "factsText" },
      { text: "0.7 ml", source: "factsText" },
    ]);
  });

  test("cleans noisy serving-size text", () => {
    assert.deepEqual(extractServingSizes({
      factsText: [
        "Supplement Facts SUGGESTED USE Serving Size: 1 Scoop (4g) daily to a 16 oz water bottle",
        "Servings Per Container: 120 Amount Per Serving Vitamin C 90mg 100%",
      ].join(" "),
    }), [
      { text: "1 Scoop (4g)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Supplement facts: Serving size 4 capsules. Magnesium (elemental) 144 mg (34% DV) from 2,000 mg Magtein® Magnesium L-Threonate.",
    }), [
      { text: "4 capsules", source: "factsText" },
    ]);
  });

  test("extracts modified serving sizes and preserves periods inside parentheses", () => {
    assert.deepEqual(extractServingSizes({
      factsText: [
        "Supplement Facts",
        "Serving Size 1 Vegetarian Capsule",
        "Amount Per Serving Enzyme Blend 94 mg",
      ].join("\n"),
    }), [
      { text: "1 Vegetarian Capsule", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: [
        "Supplement Facts",
        "Serving Size 5g (approx. 1 scoop)",
        "Amount Per Serving Protein 20g",
      ].join("\n"),
    }), [
      { text: "5g (approx. 1 scoop)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Supplement Facts Serving Size: 2 Soft Gels Servings Per Container: 30 Amount Per Serving DHA 500 mg",
    }), [
      { text: "2 Soft Gels", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Supplement Facts Serving Size 1 Rounded Scoop (approx. 8.5 grams) Servings Per Container 30 Amount Per Serving Protein 8 g",
    }), [
      { text: "1 Rounded Scoop (approx. 8.5 grams)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 capsule per day, preferably with a meal",
    }), [
      { text: "1 capsule", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "7,5 g (1 serving)",
    }), [
      { text: "7,5 g (1 serving)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 Tablet/tablets per day, preferably with a meal",
    }), [
      { text: "1 Tablet", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "4 kapsułki",
    }), [
      { text: "4 kapsułki", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "10 g (1 serving)",
    }), [
      { text: "10 g (1 serving)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 Gummy(ies) per day, preferably with a meal",
    }), [
      { text: "1 Gummy(ies)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 comprimido Dosis por envase: 60",
    }), [
      { text: "1 comprimido", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 miarkę proszku (10 g) rozpuścić w 250 ml wody",
    }), [
      { text: "1 miarkę proszku (10 g)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "2 kapsle",
    }), [
      { text: "2 kapsle", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "1 Kapsel",
    }), [
      { text: "1 Kapsel", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "2 cacitos (13 g",
    }), [
      { text: "2 cacitos (13 g)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingSize: "journalière (1 gélule",
    }), [
      { text: "1 gélule", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "1 tabletkę rozpuścić w 250 ml wody",
    }), [
      { text: "1 tabletkę", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Supplement Facts Serving Size: 2 Vegan Capsules Servings Per Container: 30 Amount Per Serving Apple Cider Vinegar 1,200 mg *",
    }), [
      { text: "2 Vegan Capsules", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Nutrition Facts about 8 servings per container Serving size 4 fl. oz. (118 mL) Amount per serving Calories 0 Total Fat 0g",
    }), [
      { text: "4 fl. oz. (118 mL)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "STOSOWANIE\nPorcję (31,5 g - 1 miarka) rozpuścić w bidonie z 500 ml wody.",
    }), [
      { text: "31,5 g", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "STOSOWANIE\n30 g (1½ płaskiej miarki) rozpuścić w 200 ml wody.",
    }), [
      { text: "30 g (1½ płaskiej miarki)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "2 comprimés par jour, à avaler avec un verre d'eau",
    }), [
      { text: "2 comprimés", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "5 ml par prise, 3 fois par jour",
    }), [
      { text: "5 ml", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "6 gouttes en une prise",
    }), [
      { text: "6 gouttes", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "Tomar 1 lata (500 ml) al día",
    }), [
      { text: "1 lata (500 ml)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingDirectionsText: "Täglich 1 Tablette am Morgen",
    }), [
      { text: "1 Tablette", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingDirectionsText: "Täglich 1 Kapsel mit reichlich Flüssigkeit (z. B. Wasser) einnehmen.",
    }), [
      { text: "1 Kapsel", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingDirectionsText: "Verzehrsempfehlung: Täglich 1 Augen Vital Kapsel am besten nach einer Mahlzeit mit reichlich Flüssigkeit schlucken.\nInhalt: 20,3 g 30 Kapseln",
    }), [
      { text: "1 Kapsel", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingDirectionsText: "Verzehrsempfehlung für Jugendliche und Erwachsene: Täglich 1 Tablette Magnesium 400 mit reichlich Flüssigkeit schlucken.\nInhalt: 39,5 g 30 Tabletten",
    }), [
      { text: "1 Tablette", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      servingRecommendationText: "60 ml (1 vial) una vez al día",
    }), [
      { text: "60 ml (1 vial)", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Recommended Usage Level (for Adults): Take 2 tablets daily with a meal or as directed.",
    }), [
      { text: "2 tablets", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Suggested Use: Take 1 capsule daily with water. Supplement Facts: Magnesium 100 mg.",
    }), [
      { text: "1 capsule", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: "Serving/directions: כמוסה אחת ליום לפני האוכל\nPackage: 60 כמוסות\nשם הרכיב | כמות\nMagnesium | 200 mg",
    }), [
      { text: "1 כמוסה", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({ servingSize: "100 g" }), []);
    assert.deepEqual(extractServingSizes({ servingSize: "250 ml" }), []);
  });

  test("splits same-line ingredient rows before lowercase Greek-prefix names", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 Tablet Amount Per Serving %DV",
      "Acetyl L-Carnitine (as HCl) 500 mg alpha-Lipoic Acid 150 mg †Daily Value not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Acetyl L-Carnitine (as HCl)",
        amount: "500",
        unit: "mg",
        source: "factsText",
      },
      {
        name: "alpha-Lipoic Acid",
        amount: "150",
        unit: "mg",
        dailyValue: "†",
        source: "factsText",
      },
    ]);
  });

  test("extracts stacked lowercase Greek-prefix ingredient names", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 Tablet",
      "Amount Per Serving",
      "%DV",
      "Acetyl L-Carnitine (as HCl)",
      "500 mg",
      "alpha-Lipoic Acid",
      "150 mg",
      "†Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Acetyl L-Carnitine (as HCl)",
        amount: "500",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "alpha-Lipoic Acid",
        amount: "150",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("rejects caption-derived fake ingredient rows", () => {
    assert.deepEqual(
      extractIngredientRowsFromText("Codeage Liposomal L-Carnitine Supplement Facts Capsule 500mg"),
      [],
    );
    assert.deepEqual(
      extractIngredientRowsFromText("Double Wood NAD supplement facts label showing 250mg per capsule"),
      [],
    );
    assert.deepEqual(
      extractIngredientRowsFromText("Supplement Facts for Chewable Cal-Snack Calcium Magnesium 1000 MG 60 Count"),
      [],
    );
  });

  test("strips OCR daily-serving-value header text before ingredient rows", () => {
    const factsText = [
      "Supplement Facts Serving Size: 1 Capsule Servings Per Container: 120",
      "Amount Per %Daily Serving Value* Alpha Lipoic Acid 200 mg * Daily Value not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Alpha Lipoic Acid",
        amount: "200",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
    ]);
  });

  test("strips repeated amount and daily-value headers before facts rows", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 Capsule",
      "Amount Per Serving % Daily Value Alpha-Lipoic Acid 150 mg † † Daily Value not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Alpha-Lipoic Acid",
        amount: "150",
        unit: "mg",
        dailyValue: "†",
        source: "factsText",
      },
    ]);
  });

  test("parses large percent daily values before footnote markers", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 Veggie Capsule",
      "Amount Per Serving % Daily Value Biotin 5,000 mcg 16667% † Daily Value not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Biotin",
        amount: "5,000",
        unit: "mcg",
        dailyValue: "16667%",
        source: "factsText",
      },
    ]);
  });

  test("parses comma-separated facts rows", () => {
    const factsText = [
      "Supplement Facts: Serving Size 5 Vegetable Capsules, Servings Per Container 30,",
      "Amount Per Serving %DV, PeptiStrong Fava Bean Hydrolysate Peptide Complex 2400 mg*,",
      "Panax ginseng Extract (stem and leaf) 100 mg*,",
      "Rhodiola (Rhodiola rosea) Extract (root) 100 mg*,",
      "*Daily Value (DV) not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "PeptiStrong Fava Bean Hydrolysate Peptide Complex",
        amount: "2400",
        unit: "mg",
        source: "factsText",
      },
      {
        name: "Panax ginseng Extract (stem and leaf)",
        amount: "100",
        unit: "mg",
        source: "factsText",
      },
      {
        name: "Rhodiola (Rhodiola rosea) Extract (root)",
        amount: "100",
        unit: "mg",
        source: "factsText",
      },
    ]);
  });

  test("parses rows with multiple amount parentheticals and terminal punctuation", () => {
    const factsText = [
      "Supplement Facts Serving Size: 3 Capsules Servings Per Container: 30 Amount Per Serving / % Daily Value",
      "Vitamin D 25 mcg (1000 IU) (As Cholecalciferol) 125%",
      "Calcium 750 mg (As AlgaeCal® Mesophyllum superpositum) 58%",
      "Magnesium 65 mg (As AlgaeCal® Mesophyllum superpositum) 15%.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin D",
        amount: "25",
        unit: "mcg",
        dailyValue: "125%",
        source: "factsText",
      },
      {
        name: "Calcium",
        amount: "750",
        unit: "mg",
        dailyValue: "58%",
        source: "factsText",
      },
      {
        name: "Magnesium",
        amount: "65",
        unit: "mg",
        dailyValue: "15%",
        source: "factsText",
      },
    ]);
  });

  test("parses dagger-delimited blend rows before component percentages", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 scoop (5 g) Servings Per Container 80",
      "Amount Per Serving % Daily Value Branched Chain Amino Acids(BCAA)2:1:1 5g †",
      "Instantized L-Leucine 50% Instantized L-Valine 25% Instantized L-Isoleucine 25%",
      "† Daily Value not established.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Branched Chain Amino Acids(BCAA)2:1:1",
        amount: "5",
        unit: "g",
        dailyValue: "†",
        source: "factsText",
      },
    ]);
  });

  test("parses each-serving-provides OCR ingredient blocks", () => {
    const factsText = [
      "Servings per container: 30 Nutritional Information (Approx. Values)",
      "EACH SERVING PROVIDES: Berberine HCL 98% 500mg Milk Thistle Extract 200 mg Cinnamon Powder 100 mg",
      "Recommended Usage Level (for Adults): Take 2 capsules daily after any one meal.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Berberine HCL 98%",
        amount: "500",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "Milk Thistle Extract",
        amount: "200",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "Cinnamon Powder",
        amount: "100",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses smart-quoted OCR label rows without broad fallback rows", () => {
    const factsText = [
      "Supplement Facts label for Elite Sleep. Text reads: “ELITE SLEEP,” “Supplement Facts,”",
      "“Serving Size: 2 Capsules,” “Servings Per Container: 30.”",
      "“Amount Per Serving % Daily Value.” “Vitamin B6 (As Pyridoxine HCl) 4mg 235%.”",
      "“Melatonin 3mg *.” “Tart Cherry Fruit Powder (CherryPURE®) 200mg *.”",
      "“L-Theanine 200mg *.” “Valerian Root Extract 300mg .”",
      "“Daily value not established.”",
    ].join(" ");

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "2 Capsules", source: "factsText" },
    ]);
    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin B6 (As Pyridoxine HCl)",
        amount: "4",
        unit: "mg",
        dailyValue: "235%",
        source: "factsText",
      },
      {
        name: "Melatonin",
        amount: "3",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
      {
        name: "Tart Cherry Fruit Powder (CherryPURE®)",
        amount: "200",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
      {
        name: "L-Theanine",
        amount: "200",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
      {
        name: "Valerian Root Extract",
        amount: "300",
        unit: "mg",
        source: "factsText",
      },
    ]);
  });

  test("parses multi-line pipe-delimited facts cells", () => {
    const factsText = [
      "Supplement Facts",
      "Serving size: 1 Capsule",
      "Ingredient |",
      "Amount per Serving |",
      "% Daily Value* |",
      "Vitamin D (as D3 cholecalciferol) |",
      "125 mcg (5,000 IU) |",
      "625% |",
      "Vitamin K2 (from MK-7, menaquinone-7) |",
      "50 mcg |",
      "42% |",
      "*Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin D (as D3 cholecalciferol)",
        amount: "125",
        unit: "mcg",
        dailyValue: "625%",
        source: "factsText_pipe",
      },
      {
        name: "Vitamin K2 (from MK-7, menaquinone-7)",
        amount: "50",
        unit: "mcg",
        dailyValue: "42%",
        source: "factsText_pipe",
      },
    ]);
  });

  test("parses compact pipe facts rows with daily values in the next cell", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size: 2 Softgels",
      "Amount Per Serving | % DV",
      "Total Fat 2g | 3%*",
      "Saturated Fat 2g | 10%*",
      "C8 MCT oil 2000mg (Brain Octane® oil) | **",
      "** Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Saturated Fat",
        amount: "2",
        unit: "g",
        dailyValue: "10%*",
        source: "factsText_pipe",
      },
      {
        name: "C8 MCT oil",
        amount: "2000",
        unit: "mg",
        dailyValue: "**",
        source: "factsText_pipe",
      },
    ]);
  });

  test("parses JSON-stringified stacked facts text", () => {
    const factsText = JSON.stringify([
      [
        "Supplement Facts",
        "Serving Size: 1 Quick Release Softgel",
        "Servings Per Container: 100",
        "Amount Per Serving",
        "%Daily Value",
        "Aloe Vera Extract (Aloe barbadensis)",
        "25 mg",
        "*",
        "(a 200:1 extract, equivalent to 5,000 mg of fresh Aloe Vera inner leaf gel)",
        "*Daily Value not established.",
      ].join("\n"),
    ]);

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "1 Quick Release Softgel", source: "factsText" },
    ]);
    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Aloe Vera Extract (Aloe barbadensis)",
        amount: "25",
        unit: "mg",
        dailyValue: "*",
        source: "factsText_table",
      },
    ]);
  });

  test("clears label headers before stacked OCR amount rows", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 2 Tablets",
      "Serving Per Container 15",
      "Amount Per Serving",
      "7-OXO-DHEA Acetate",
      "100 mgt",
      "†Daily Value not established.",
      "Other ingredients: microcrystalline cellulose.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "7-OXO-DHEA Acetate",
        amount: "100",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses amount-before-name OCR table rows", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size: 1 capsule",
      "Amount Per Serving",
      "100mg*",
      "7-Keto DHEA",
      "(as 7-keto dehydroepiandrosterone acetate)",
      "* Daily Value not established",
      "Other Ingredients: Vegetarian Capsule.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "7-Keto DHEA (as 7-keto dehydroepiandrosterone acetate)",
        amount: "100",
        unit: "mg",
        dailyValue: "*",
        source: "factsText_table",
      },
    ]);
  });

  test("parses amount block before ingredient names", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 VegCap",
      "Amount Per",
      "Serving",
      "150 mg",
      "60 mg",
      "% Daily",
      "Value",
      "167%",
      "Vitamin C (as Ascorbic Acid)",
      "Hyaluronic Acid (Microbial Fermentation)",
      "*Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin C (as Ascorbic Acid)",
        amount: "150",
        unit: "mg",
        dailyValue: "167%",
        source: "factsText_table",
      },
      {
        name: "Hyaluronic Acid (Microbial Fermentation)",
        amount: "60",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses ingredient name blocks followed by amount blocks", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 VegCap",
      "Amount Per Serving",
      "Griffonia (Griffonia simplicifolia) (bean extract) (Guaranteed 100 mg [98%] L-5-Hydroxytryptophan)",
      "St. John's Wort (Hypericum perforatum) (aerial)",
      "102 mg",
      "210 mg",
      "*Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Griffonia (Griffonia simplicifolia) (bean extract)",
        amount: "102",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "St. John's Wort (Hypericum perforatum) (aerial)",
        amount: "210",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses inline ingredient names followed by terminal amount blocks", () => {
    const factsText = [
      "Supplement Facts Serving Size 1 VegCap Amount Per Serving",
      "Griffonia (Griffonia simplicifolia) (bean extract) (Guaranteed 100 mg [98%] L-5-Hydroxytryptophan)",
      "St. John's Wort (Hypericum perforatum) (aerial) 102 mg 210 mg",
      "*Daily Value not established. Other Ingredients: Vegetable Cellulose Capsule.",
    ].join(" ");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Griffonia (Griffonia simplicifolia) (bean extract)",
        amount: "102",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "St. John's Wort (Hypericum perforatum) (aerial)",
        amount: "210",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("normalizes OCR footnote letters after liquid units", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1/2 Teaspoon",
      "Amount Per Serving",
      "Organic Cilantro Leaf Extract",
      "1.5 mLT",
      "Organic Chlorella",
      "250 mgt",
      "†Daily value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Organic Cilantro Leaf Extract",
        amount: "1.5",
        unit: "mL",
        source: "factsText_table",
      },
      {
        name: "Organic Chlorella",
        amount: "250",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses Chinese nutrition facts rows and serving size", () => {
    const factsText = [
      "營養標示",
      "每一份量 1 粒 / 本包裝含 60 份",
      "成分",
      "每份",
      "每日參考值%",
      "維生素C",
      "10毫克",
      "10%",
      "鋅",
      "5.1毫克",
      "34%",
      "其他成分含量",
      "每一份量 1粒",
      "專利葡萄籽萃取物(含多酚)",
      "100毫克",
      "法國紅葡萄萃取物(含白藜蘆醇)",
      "50毫克",
      "反式白藜蘆醇",
      "40毫克",
    ].join("\n");

    assert.deepEqual(extractServingSizes({ factsText }), [
      { text: "1 粒", source: "factsText" },
      { text: "1粒", source: "factsText" },
    ]);
    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "維生素C",
        amount: "10",
        unit: "mg",
        dailyValue: "10%",
        source: "factsText_table",
      },
      {
        name: "鋅",
        amount: "5.1",
        unit: "mg",
        dailyValue: "34%",
        source: "factsText_table",
      },
      {
        name: "專利葡萄籽萃取物(含多酚)",
        amount: "100",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "法國紅葡萄萃取物(含白藜蘆醇)",
        amount: "50",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "反式白藜蘆醇",
        amount: "40",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses mixed amount/name blocks when the counts align", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 VegCap",
      "Amount Per Serving",
      "350 mg",
      "% Daily Value",
      "Broccoli (Brassica oleracea italica) (seed extract) (Guaranteed to contain 35 mg [10%] Sulforaphane Glucosinolates)",
      "Myrosinase Enzyme (Brassica oleracea italica) (Thioglucosidase)",
      "Organic Freeze-Dried Broccoli Sprouts (Brassica oleracea italica)",
      "13 mg",
      "50 mg",
      "*Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Broccoli (Brassica oleracea italica) (seed extract)",
        amount: "350",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "Myrosinase Enzyme (Brassica oleracea italica) (Thioglucosidase)",
        amount: "13",
        unit: "mg",
        source: "factsText_table",
      },
      {
        name: "Organic Freeze-Dried Broccoli Sprouts (Brassica oleracea italica)",
        amount: "50",
        unit: "mg",
        source: "factsText_table",
      },
    ]);
  });

  test("parses supplement facts lines without an amount-per-serving header", () => {
    const factsText = [
      "Supplement Facts",
      "Protein Powder: Cake Batter (20 Serving Bag)",
      "Serving Size: 1 Scoop (25g)",
      "Servings Per Container: 20",
      "Calories: 90",
      "Cholesterol 10mg (3% DV)",
      "Total Carbohydrate 2g (1% DV)",
      "Total Sugars 1g († DV)",
      "Protein 20g (40% DV)",
      "Calcium 50mg (4% DV)",
      "Iron 0.2mg (1% DV)",
      "Sodium 30mg (1% DV)",
      "Potassium 60mg (1% DV)",
      "Digestive Enzyme Blend 100mg († DV); Lipase 10 FIP, Cellulase 50 CU",
      "Other Ingredients: Grass-Fed Whey Protein Isolate.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Protein",
        amount: "20",
        unit: "g",
        dailyValue: "40%",
        source: "factsText",
      },
      {
        name: "Calcium",
        amount: "50",
        unit: "mg",
        dailyValue: "4%",
        source: "factsText",
      },
      {
        name: "Iron",
        amount: "0.2",
        unit: "mg",
        dailyValue: "1%",
        source: "factsText",
      },
      {
        name: "Sodium",
        amount: "30",
        unit: "mg",
        dailyValue: "1%",
        source: "factsText",
      },
      {
        name: "Potassium",
        amount: "60",
        unit: "mg",
        dailyValue: "1%",
        source: "factsText",
      },
      {
        name: "Digestive Enzyme Blend",
        amount: "100",
        unit: "mg",
        dailyValue: "†",
        source: "factsText",
      },
    ]);
  });

  test("parses transposed facts tables with names before amount rows", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 Chewable",
      "Calories",
      "Total Carbohydrate",
      "Vitamin C (Ascorbic Acid)",
      "Whole Food Base (Rutin Concentrate, Bioflavonoid Concentrate",
      "[from Citrus], Hesperidin Concentrate, Citrus Pectin)",
      "Amount Per % Daily",
      "Serving",
      "Value",
      "5",
      "1 g",
      "500 mg",
      "50 mg",
      "<1%†",
      "556%",
      "*",
      "†Percent Daily Value based on a 2,000 calorie diet.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Vitamin C (Ascorbic Acid)",
        amount: "500",
        unit: "mg",
        dailyValue: "556%",
        source: "factsText_table",
      },
      {
        name: "Whole Food Base (Rutin Concentrate, Bioflavonoid Concentrate [from Citrus], Hesperidin Concentrate, Citrus Pectin)",
        amount: "50",
        unit: "mg",
        dailyValue: "*",
        source: "factsText_table",
      },
    ]);
  });

  test("extracts stacked amount rows with parenthetical equivalent amounts", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size: 2 Quick Release Capsules",
      "Amount Per Serving",
      "%Daily Value",
      "Apple Cider Vinegar",
      "1,200 mg (1.2 g)",
      "*",
      "*Daily Value not established.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Apple Cider Vinegar",
        amount: "1,200",
        unit: "mg",
        dailyValue: "*",
        source: "factsText_table",
      },
    ]);
  });

  test("extracts stacked amount rows with numeric daily values", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 Tablet",
      "Amount Per Serving",
      "%DV",
      "Biotin",
      "5,000 mcg 16,667%",
      "Other ingredients: microcrystalline cellulose.",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText), [
      {
        name: "Biotin",
        amount: "5,000",
        unit: "mcg",
        dailyValue: "16,667%",
        source: "factsText_table",
      },
    ]);
  });

  test("repair preview preserves raw label fields while proposing additive rows and compact search text", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:magnesium",
      dataOriginId: "example-brand:magnesium",
      dataOriginUrl: "https://example.test/products/magnesium",
      name: "Example Magnesium",
      brand: "Example Brand",
      upc: "012345678905",
      offMarket: false,
      searchText: "old raw page search ".repeat(400),
      label: {
        source: "example-brand",
        sourceId: "magnesium",
        bodyText: "page copy ".repeat(200),
        factsText: "Supplement Facts Serving Size 2 Capsules Servings Per Container 30 Amount Per Serving Magnesium 200 mg 48% Other Ingredients: Capsule.",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.equal(preview.evidenceRecoveryHint, "structured_ready");
    assert.equal(preview.parsedIngredientRows, 1);
    assert.equal(preview.parsedServingSizes, 1);
    assert.equal(preview.searchTextWouldChange, true);
    assert.deepEqual(preview.removableFieldCandidates, ["bodyText"]);
    assert.match(preview.proposedSearchTextPreview, /Magnesium 200 mg/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /page copy page copy/u);
  });

  test("repair preview does not remove raw evidence from partial rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:caption-only",
      dataOriginId: "example-brand:caption-only",
      dataOriginUrl: "https://example.test/products/caption-only",
      name: "Example Caption Only",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "caption-only",
        factsText: "Supplement Facts Serving Size 1 Capsule",
        bodyText: "Official page body retained for manual review.",
        rawPageText: "Raw page text retained for refetch review.",
        allProductFactsText: ["Supplement Facts"],
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.deepEqual(preview.parserBlockers, ["missing_ingredient_rows"]);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview rejects malformed existing normalized rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:malformed-existing",
      dataOriginId: "example-brand:malformed-existing",
      dataOriginUrl: "https://example.test/products/malformed-existing",
      name: "Example Existing",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "malformed-existing",
        ingredientRows: [{}],
        servingSizes: ["1 Capsule"],
        bodyText: "Raw evidence must not be removed when existing rows are invalid.",
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.deepEqual(preview.parserBlockers, [
      "invalid_existing_ingredient_rows",
      "missing_ingredient_rows",
    ]);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview reparses invalid existing normalized rows from clean facts text", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:reparse-existing",
      dataOriginId: "example-brand:reparse-existing",
      dataOriginUrl: "https://example.test/products/reparse-existing",
      name: "Example Reparse Existing",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "reparse-existing",
        ingredientRows: [{ name: "Serving Size 1 Capsule Magnesium", amount: "200", unit: "mg" }],
        servingSizes: ["1 Capsule"],
        factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving Magnesium 200 mg 48%",
        bodyText: "Raw page evidence can be removed only after clean replacement rows are parsed.",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.equal(preview.parsedIngredientRows, 1);
    assert.deepEqual(preview.removableFieldCandidates, ["bodyText"]);
  });

  test("ingredient parser rejects nutritional-value header rows", () => {
    const rows = extractIngredientRowsFromText([
      "Nutritional Value / Active Ingredients: | 3 g (1 serving) Creatine malate | 2400 mg",
      "Taurine | 10000 mg",
    ].join(" | "));

    assert.deepEqual(rows.map((row) => row.name), [
      "Creatine malate",
      "Taurine",
    ]);
  });

  test("ingredient parser handles colon-delimited facts after per-tablet prefixes", () => {
    assert.deepEqual(extractIngredientRowsFromText([
      "Nutritional Information Per Tablet:",
      "Aloe Vera Leaf Gel Extract (200:1 extract, equivalent to 10,000mg Aloe Vera Leaf Gel): 50mg",
    ].join(" ")), [
      {
        name: "Aloe Vera Leaf Gel Extract (200:1 extract)",
        amount: "50",
        unit: "mg",
        source: "factsText",
      },
    ]);

    assert.deepEqual(extractIngredientRowsFromText([
      "Nutritional Information Each tablet contains:",
      "Lactobacillus acidophilus: 1.00cfu",
      "Bifidobacterium animalis subsp. Lactis.: 1.00cfu",
    ].join(" ")), [
      {
        name: "Lactobacillus acidophilus",
        amount: "1.00",
        unit: "CFU",
        source: "factsText",
      },
      {
        name: "Bifidobacterium animalis subsp. Lactis.",
        amount: "1.00",
        unit: "CFU",
        source: "factsText",
      },
    ]);
  });

  test("repair preview rejects facts-panel text stored as an existing serving size", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:malformed-serving-size",
      dataOriginId: "example-brand:malformed-serving-size",
      dataOriginUrl: "https://example.test/products/malformed-serving-size",
      name: "Example Existing Serving Size",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "malformed-serving-size",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg", dailyValue: "48%" }],
        servingSizes: ["Supplement Facts Serving Size 2 Capsules Amount Per Serving Magnesium 200 mg 48%"],
        bodyText: "Raw evidence must not be removed when existing serving size text is invalid.",
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.deepEqual(preview.parserBlockers, [
      "invalid_existing_serving_sizes",
      "missing_serving_sizes",
    ]);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview rejects facts-panel text stored as singular serving size", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:malformed-singular-serving-size",
      dataOriginId: "example-brand:malformed-singular-serving-size",
      dataOriginUrl: "https://example.test/products/malformed-singular-serving-size",
      name: "Example Singular Serving Size",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "malformed-singular-serving-size",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg", dailyValue: "48%" }],
        servingSize: "Supplement Facts Serving Size 2 Capsules Amount Per Serving Magnesium 200 mg 48%",
        bodyText: "Raw evidence must not be removed when singular serving size text is invalid.",
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.deepEqual(preview.parserBlockers, ["missing_serving_sizes"]);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview accepts existing serving-size object shapes", () => {
    const servingSizes = [
      { amount: 1, unit: "tablet", servingSize: "Per tablet" },
      { servingSize: "Pour 2 comprimés", source: "official_facts_table" },
      { servingSize: "Dávka – 35 g", source: "official_nutrition_table" },
      { servingSize: "7,5 g (1 serving)", source: "one_serving_parenthetical" },
      { servingSize: "10 g (1 serving)", source: "one_serving_parenthetical" },
      { text: "4 capsule / tablet (1 serving)", source: "one_serving_parenthetical" },
      { text: "1 effervescent tablet per day, preferably with a meal", source: "directions_serving" },
      { text: "1 Tablet/tablets per day, preferably with a meal", source: "directions_serving" },
      { text: "4 kapsułki", source: "official_facts_table" },
      { text: "4 tablety", source: "official_nutrition_table" },
      { text: "1 láhev (750 ml)", source: "official_nutrition_table" },
      { text: "1 Gummy(ies) per day, preferably with a meal", source: "directions_serving" },
      { text: "2 kapsle", source: "official_nutrition_table" },
      { text: "1 Kapsel", source: "table_header_unit" },
      { text: "2 cacitos (13 g", source: "dose_text" },
      { text: "journalière (1 gélule", source: "dose_text" },
      { text: "Adults; 1 tablet: 1 daily", source: "health_canada_dose" },
      { text: "כמוסה אחת ליום לפני האוכל או בהתאם להוראות הרופא המטפל", source: "official_directions" },
      { text: "1-3 כמוסות ביום אחרי האוכל", source: "official_directions" },
    ];
    for (const [index, servingSize] of servingSizes.entries()) {
      const preview = repairPreviewForRow({
        id: `example-brand:existing-serving-size-${index}`,
        dataOriginId: `example-brand:existing-serving-size-${index}`,
        dataOriginUrl: "https://example.test/products/existing-serving-size",
        name: "Example Existing Serving Size",
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: "existing-serving-size",
          ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
          servingSizes: [servingSize],
        },
      });

      assert.equal(preview.parserStatus, "structured_ready");
      assert.deepEqual(preview.parserBlockers, []);
    }
  });

  test("repair preview replaces mixed existing serving sizes with valid serving subset", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:mixed-serving-sizes",
      dataOriginId: "example-brand:mixed-serving-sizes",
      dataOriginUrl: "https://example.test/products/mixed-serving-sizes",
      name: "Example Mixed Serving Sizes",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "mixed-serving-sizes",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: [
          { text: "Dávka – 35 g", source: "official_nutrition_table" },
          { text: "Poměr ředění: 35 g/250 ml vody", source: "official_nutrition_table" },
        ],
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.deepEqual(preview.parsedServingSizesPreview, [
      { text: "35 g", source: "official_nutrition_table" },
    ]);

    const packetPreview = repairPreviewForRow({
      id: "example-brand:mixed-packet-serving-sizes",
      dataOriginId: "example-brand:mixed-packet-serving-sizes",
      dataOriginUrl: "https://example.test/products/mixed-packet-serving-sizes",
      name: "Example Packet Gel",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "mixed-packet-serving-sizes",
        ingredientRows: [{ name: "Caffeine", amount: "50", unit: "mg" }],
        servingSizes: [
          { text: "100 g", source: "official_nutrition_table" },
          { text: "200 g - 4 sáčky", source: "official_nutrition_table" },
          { text: "50 g - 1 sáček", source: "official_nutrition_table" },
        ],
      },
    });

    assert.equal(packetPreview.parserStatus, "structured_ready");
    assert.deepEqual(packetPreview.parserBlockers, []);
    assert.deepEqual(packetPreview.parsedServingSizesPreview, [
      { text: "1 sáček (50 g)", source: "official_nutrition_table" },
    ]);
  });

  test("repair preview accepts official serving-column volumes while rejecting table bases", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:drink-serving-column",
      dataOriginId: "example-brand:drink-serving-column",
      dataOriginUrl: "https://example.test/products/drink-serving-column",
      name: "Example Energy Drink",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "drink-serving-column",
        ingredientRows: [{ name: "Caffeine", amount: "100", unit: "mg" }],
        servingSizes: [
          { text: "100 ml", source: "table_amount_basis" },
          { text: "330 ml", source: "official_nutrition_table" },
        ],
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.deepEqual(preview.parsedServingSizesPreview, [
      { text: "330 ml", source: "official_nutrition_table" },
    ]);
  });

  test("repair preview blocks obvious food and flavoring rows from automated backfill", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:chunky-flavour",
      dataOriginId: "example-brand:chunky-flavour",
      dataOriginUrl: "https://example.test/products/chunky-flavour",
      name: "Chunky Flavour - Fudge Brownie",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "chunky-flavour",
        ingredientRows: [{ name: "Erythritol", amount: "2", unit: "g" }],
        servingSizes: [{ text: "3 g", source: "official_nutrition_table" }],
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, ["likely_food_or_non_supplement"]);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.evidenceRecoveryHint, "not_standalone_supplement_review");
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview summary separates parser readiness from automated backfill readiness", () => {
    const safe = repairPreviewForRow({
      id: "example-brand:magnesium",
      dataOriginId: "example-brand:magnesium",
      dataOriginUrl: "https://example.test/products/magnesium",
      name: "Example Magnesium",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "magnesium",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: [{ text: "1 capsule", source: "official_label" }],
      },
    });
    const blocked = repairPreviewForRow({
      id: "example-brand:chunky-flavour",
      dataOriginId: "example-brand:chunky-flavour",
      dataOriginUrl: "https://example.test/products/chunky-flavour",
      name: "Chunky Flavour - Fudge Brownie",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "chunky-flavour",
        ingredientRows: [{ name: "Erythritol", amount: "2", unit: "g" }],
        servingSizes: [{ text: "3 g", source: "official_nutrition_table" }],
      },
    });

    assert.equal(safe.automatedBackfillReady, true);
    assert.equal(blocked.automatedBackfillReady, false);
    assert.deepEqual(summarize([safe, blocked]), {
      rowsReviewed: 2,
      searchTextWouldChange: 2,
      oldOversizedSearchTextRows: 0,
      proposedOversizedSearchTextRows: 0,
      addIngredientRows: 0,
      addServingSizes: 0,
      structuredReady: 2,
      automatedBackfillReady: 1,
      structuredReadyWithBlockers: 1,
      partialParse: 0,
      needsBetterParser: 0,
      removableFieldCandidateRows: 0,
      byBrand: {
        "example-brand": {
          rows: 2,
          structuredReady: 2,
          automatedBackfillReady: 1,
          needsBetterParser: 0,
        },
      },
    });
  });

  test("repair preview builds a prioritized evidence recovery queue without raw label bodies", () => {
    const refetch = repairPreviewForRow({
      id: "large-brand:caption-only",
      dataOriginId: "large-brand:caption-only",
      dataOriginUrl: "https://example.test/products/caption-only",
      name: "Caption Only",
      brand: "Large Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "large-brand",
        sourceId: "caption-only",
        factsText: "Supplement Facts",
        bodyText: "raw body text must not appear in queue",
      },
    });
    const servingReview = repairPreviewForRow({
      id: "small-brand:serving-review",
      dataOriginId: "small-brand:serving-review",
      dataOriginUrl: "https://example.test/products/serving-review",
      name: "Serving Review",
      brand: "Small Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "small-brand",
        sourceId: "serving-review",
        factsText: "Supplement Facts Amount Per Serving Magnesium 200 mg 48%",
      },
    });
    const safe = repairPreviewForRow({
      id: "large-brand:ready",
      dataOriginId: "large-brand:ready",
      dataOriginUrl: "https://example.test/products/ready",
      name: "Ready",
      brand: "Large Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "large-brand",
        sourceId: "ready",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: [{ text: "1 capsule", source: "official_label" }],
      },
    });

    const queue = buildEvidenceRecoveryQueue([servingReview, safe, refetch]);

    assert.equal(queue.length, 2);
    assert.deepEqual(queue.map((row) => row.action), [
      "refetch_official_label_or_ocr",
      "review_serving_size_parser",
    ]);
    assert.equal(queue[0].source, "large-brand");
    assert.equal(queue[0].brandUnreadyRows, 1);
    assert.equal(queue[0].missingIngredientRows, true);
    assert.equal(queue[0].missingServingSizes, true);
    assert.equal(Object.hasOwn(queue[0], "bodyText"), false);
    assert.equal(JSON.stringify(queue).includes("raw body text must not appear"), false);

    assert.deepEqual(buildEvidenceRecoveryByBrand(queue), [
      {
        source: "large-brand",
        rows: 1,
        sourceUrls: 1,
        actions: { refetch_official_label_or_ocr: 1 },
        hints: { official_refetch_or_ocr: 1 },
        blockers: {
          missing_ingredient_rows: 1,
          missing_serving_sizes: 1,
        },
        sampleRows: [
          {
            id: "large-brand:caption-only",
            dataOriginId: "large-brand:caption-only",
            name: "Caption Only",
            action: "refetch_official_label_or_ocr",
            parserStatus: "needs_better_parser",
            parserBlockers: [
              "missing_ingredient_rows",
              "missing_serving_sizes",
            ],
            dataOriginUrl: "https://example.test/products/caption-only",
          },
        ],
      },
      {
        source: "small-brand",
        rows: 1,
        sourceUrls: 1,
        actions: { review_serving_size_parser: 1 },
        hints: { parser_serving_size_review: 1 },
        blockers: {
          missing_serving_sizes: 1,
        },
        sampleRows: [
          {
            id: "small-brand:serving-review",
            dataOriginId: "small-brand:serving-review",
            name: "Serving Review",
            action: "review_serving_size_parser",
            parserStatus: "partial_parse",
            parserBlockers: [
              "missing_serving_sizes",
            ],
            dataOriginUrl: "https://example.test/products/serving-review",
          },
        ],
      },
    ]);
  });

  test("repair preview rejects net-content counts stored as existing serving sizes", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:net-content-serving-size",
      dataOriginId: "example-brand:net-content-serving-size",
      dataOriginUrl: "https://example.test/products/net-content-serving-size",
      name: "Example Stick Packs",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "net-content-serving-size",
        ingredientRows: [{ name: "Vitamin C", amount: "500", unit: "mg" }],
        servingSizes: ["30 Stick Packs"],
        bodyText: "Raw evidence must not be removed when net contents are stored as serving size.",
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.deepEqual(preview.parserBlockers, [
      "invalid_existing_serving_sizes",
      "missing_serving_sizes",
    ]);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview rejects mass and liquid net contents stored as existing serving sizes", () => {
    for (const servingSize of ["100 g", "100g", "100mL", "12 fl oz", "12fl oz"]) {
      const preview = repairPreviewForRow({
        id: `example-brand:net-content-${servingSize}`,
        dataOriginId: `example-brand:net-content-${servingSize}`,
        dataOriginUrl: "https://example.test/products/net-content-serving-size",
        name: "Example Net Content",
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: "net-content-serving-size",
          ingredientRows: [{ name: "Protein", amount: "20", unit: "g" }],
          servingSizes: [servingSize],
          bodyText: "Raw evidence must not be removed when net contents are stored as serving size.",
        },
      });

      assert.equal(preview.parserStatus, "partial_parse");
      assert.deepEqual(preview.parserBlockers, [
        "invalid_existing_serving_sizes",
        "missing_serving_sizes",
      ]);
      assert.deepEqual(preview.removableFieldCandidates, []);
    }
  });

  test("repair preview keeps large mass serving sizes with explicit serving context", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:large-serving-size",
      dataOriginId: "example-brand:large-serving-size",
      dataOriginUrl: "https://example.test/products/large-serving-size",
      name: "Example Mass Gainer",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "large-serving-size",
        ingredientRows: [{ name: "Protein", amount: "50", unit: "g" }],
        servingSizes: ["340 g (About 2 Scoops)"],
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
  });

  test("repair preview infers one-unit serving size from exact per-form product title", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:iron",
      dataOriginId: "example-brand:iron",
      dataOriginUrl: "https://example.test/products/iron",
      name: "45mg Iron Per Tablet",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "iron",
        factsText: "Supplement Facts Amount Per Serving Iron 45 mg 250%",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.equal(preview.parsedServingSizes, 1);
    assert.equal(preview.parsedIngredientRows, 1);
  });

  test("repair preview extracts structured label facts with compact amounts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:collagen",
      dataOriginId: "example-brand:collagen",
      dataOriginUrl: "https://example.test/products/collagen",
      name: "Example Collagen",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "collagen",
        servingSize: "2 Capsules",
        facts: [
          { nutrient: "Protein", amount: "9g" },
          { nutrient: "Vitamin C", parentheses: "from Lipid Metabolite Ascorbate", amount: "90mg", dailyValuePercentage: "100%" },
        ],
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.equal(preview.parsedServingSizes, 1);
    assert.equal(preview.parsedIngredientRows, 2);
  });

  test("repair preview extracts structured factsRows before text fallback", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:b-complex",
      dataOriginId: "example-brand:b-complex",
      dataOriginUrl: "https://example.test/products/b-complex",
      name: "Example B Complex",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "b-complex",
        servingSize: "1 Coated Caplet",
        factsRows: [
          { name: "Thiamin (Vitamin B-1)", amount: "50 mg", dailyValue: "4,167%" },
          { name: "Folate (400 mcg Folic Acid)", amount: "666 mcg DFE", dailyValue: "167%" },
        ],
        factsText: [
          "Supplement Facts Serving size: 1 Coated Caplet Amount Per Serving | % Daily Value",
          "Thiamin (Vitamin B-1) 50 mg | 4,167%",
          "Folate (400 mcg Folic Acid) 666 mcg DFE | 167%",
        ].join("\n"),
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.deepEqual(preview.parsedIngredientRowSources, ["structured_label_field"]);
    assert.equal(preview.parsedIngredientRows, 2);
  });

  test("repair preview infers generic serving from structured Target per-serving facts", () => {
    const preview = repairPreviewForRow({
      id: "example-target:b12",
      dataOriginId: "example-target:b12",
      dataOriginUrl: "https://example.test/products/b12",
      name: "Example B12 Tablets - 60ct",
      brand: "Example Target",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-target",
        sourceId: "b12",
        factsText: "Amount Per Serving\nVitamin B12 2500 mcg 104167% DV",
        rawTargetNutritionFacts: {
          value_prepared_list: [
            {
              description: "Amount Per Serving",
              nutrients: [
                {
                  name: "Vitamin B12",
                  quantity: 2500,
                  percentage: 104167,
                  unit_of_measurement: "mcg",
                },
              ],
            },
          ],
        },
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.equal(preview.parsedServingSizes, 1);
    assert.equal(preview.parsedIngredientRows, 1);
  });

  test("repair preview does not treat enzyme activity text as stacked amount risk", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:quercetin",
      dataOriginId: "example-brand:quercetin",
      dataOriginUrl: "https://example.test/products/quercetin",
      name: "Example Quercetin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "quercetin",
        factsText: [
          "Supplement Facts",
          "Serving Size 3 Tablets",
          "Amount Per Serving",
          "Vitamin C (as ascorbic acid)",
          "700 mg",
          "778%",
          "Quercetin",
          "1 g",
          "Bromelain (2,000 G.D.U. per gram)tT",
          "300 mg",
          "†Daily Value not established.",
        ].join("\n"),
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.equal(preview.parsedIngredientRows, 3);
  });

  test("repair preview allows parenthetical name continuations before amount rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:apple-pectin",
      dataOriginId: "example-brand:apple-pectin",
      dataOriginUrl: "https://example.test/products/apple-pectin",
      name: "Example Apple Pectin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "apple-pectin",
        factsText: [
          "Supplement Facts",
          "Serving Size: 3 Capsules",
          "Amount Per Serving",
          "% DV",
          "Dietary Fiber",
          "1g",
          "4%",
          "Apple Pectin Powder",
          "(Malus domestica) (pomace)",
          "2,100mg",
          "** Daily Value not established.",
        ].join("\n"),
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.equal(preview.parsedIngredientRows, 2);
  });

  test("repair preview allows lowercase wrapped name continuations before amount rows", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 Stick Pack",
      "Amount Per Serving",
      "Gotu Kola (Centella asiatica) leaf and",
      "stem extract (10% triterpenes)",
      "120 mg",
      "Hyaluronic acid",
      "120 mg",
      "*Daily Value not established.",
    ].join("\n");
    const preview = repairPreviewForRow({
      id: "example-brand:gotu-kola",
      dataOriginId: "example-brand:gotu-kola",
      dataOriginUrl: "https://example.test/products/gotu-kola",
      name: "Example Gotu Kola",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "gotu-kola",
        factsText,
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.deepEqual(extractIngredientRowsFromText(factsText).map((row) => row.name), [
      "Gotu Kola (Centella asiatica) leaf and stem extract (10% triterpenes)",
      "Hyaluronic acid",
    ]);
    assert.equal(preview.parsedIngredientRows, 2);
  });

  test("repair preview accepts lowercase omega component facts rows without header carryover", () => {
    const factsText = [
      "Supplement",
      "Facts",
      "Serving Size 2 Softgels",
      "Amount Per Serving",
      "%DV",
      "Calories",
      "10",
      "Total Fat",
      "1 g",
      "2%*",
      "Krill Oil Blend",
      "1 g",
      "Yielding:",
      "Phospholipids, omega-3 rich",
      "420 mg",
      "omega-3 fatty acids, total",
      "300 mg",
      "Eicosapentaenoic acid (EPA)",
      "150 mg",
      "Docosahexaenoic acid (DHA)",
      "90 mg",
      "Astaxanthin",
      "1.5 mg",
      "+",
      "*Percent Daily Values are based on a 2,000 calorie diet.",
    ].join("\n");
    const preview = repairPreviewForRow({
      id: "example-brand:krill-oil",
      dataOriginId: "example-brand:krill-oil",
      dataOriginUrl: "https://example.test/products/krill-oil",
      name: "Example Krill Oil",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "krill-oil",
        factsText,
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.deepEqual(extractIngredientRowsFromText(factsText).map((row) => row.name), [
      "Krill Oil Blend",
      "Phospholipids, omega-3 rich",
      "omega-3 fatty acids, total",
      "Eicosapentaenoic acid (EPA)",
      "Docosahexaenoic acid (DHA)",
      "Astaxanthin",
    ]);
    assert.equal(preview.parsedIngredientRows, 6);
  });

  test("repair preview downgrades page-body facts text even when amount patterns are found", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:creatine-gummies",
      dataOriginId: "example-brand:creatine-gummies",
      dataOriginUrl: "https://example.test/products/creatine-gummies",
      name: "Example Creatine Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "creatine-gummies",
        factsText: [
          "Tub Flavor: Tropical Fruit Punch Quantity: Decrease quantity Increase quantity Buy Now Notify Me When Available",
          "Description Suggested Use Supplement Facts FAQ Previous Next Description Why Example Creatine Gummies Are Convenient.",
          "Taking 4 gummies daily provides a maintenance dose of 5 g. Four gummies deliver the same 5 g dose.",
          " ".repeat(1300),
        ].join(" "),
      },
    });

    assert.equal(preview.parserStatus, "needs_better_parser");
    assert.equal(preview.evidenceRecoveryHint, "official_refetch_or_ocr");
    assert.equal(preview.parsedIngredientRows, 0);
    assert.deepEqual(preview.parserBlockers, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
    ]);
  });

  test("repair preview downgrades table-layout facts text with separated names and amounts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:mass-gainer",
      dataOriginId: "example-brand:mass-gainer",
      dataOriginUrl: "https://example.test/products/mass-gainer",
      name: "Example Mass Gainer",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "mass-gainer",
        factsText: [
          "Supplement Facts Serving Size 340 g (About 2 Scoops)",
          "Amount Per Serving Calories Total Fat Saturated Fat Cholesterol Total Carbohydrate Protein Vitamin C Magnesium Zinc Creatine Monohydrate",
          "1250 5 g 3 g 200 mg 252 g 50 g 30 mg 140 mg 3 mg 5 g",
          "% Daily Value 6% 15% 67%",
        ].join(" "),
      },
    });

    assert.equal(preview.parserStatus, "partial_parse");
    assert.equal(preview.parsedServingSizes, 1);
  });
});
