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
  extractHtmlFactsMedia,
  factsTextContaminationReason,
  hydrateCandidatesWithDsldFacts,
  matchShopifyVariantForQueueRow,
  productFactsPromotionBlockedReasonForProduct,
  selectShopifyFactsMedia,
  shopifyJsonUrlForProductUrl,
  shopifyPageUrlForProductUrl,
  variantCandidateTexts,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs";
import {
  buildOcrCandidate,
  buildOpenAiOcrRequest,
  parseOcrJson,
  selectOcrInputRows,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-ocr-preview.mjs";

function ingredientRowName(row: unknown): string {
  assert.ok(row && typeof row === "object");
  assert.ok("name" in row);
  const name = (row as Record<string, unknown>).name;
  if (typeof name !== "string") assert.fail("ingredient row name must be a string");
  return name;
}

function productionIngredientRows(preview: ReturnType<typeof repairPreviewForRow>): Record<string, unknown>[] {
  assert.ok(preview.productionCandidate);
  const rows = preview.productionCandidate.label.ingredientRows;
  assert.ok(Array.isArray(rows));
  return rows;
}

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
          {
            name: "Magnesium",
            amount: "200",
            unit: "mg",
            dailyValue: "48%",
            nestedRows: [{ name: "Glycine", amount: "1", unit: "g" }],
          },
        ],
        servingSizes: ["2 capsules"],
        otherIngredients: "vegetable capsule",
        ingredientText: "Other ingredients raw evidence ".repeat(200),
      },
    });

    assert.equal(searchText.length <= SEARCH_TEXT_MAX_LENGTH, true);
    assert.match(searchText, /Example Magnesium/u);
    assert.match(searchText, /Example Brand/u);
    assert.match(searchText, /Magnesium/u);
    assert.match(searchText, /Glycine/u);
    assert.match(searchText, /vegetable capsule/u);
    assert.doesNotMatch(searchText, /Magnesium 200 mg/u);
    assert.doesNotMatch(searchText, /2 capsules/u);
    assert.doesNotMatch(searchText, /48%/u);
    assert.doesNotMatch(searchText, /marketing body marketing body/u);
    assert.doesNotMatch(searchText, /Supplement Facts Supplement Facts/u);
    assert.doesNotMatch(searchText, /Other ingredients raw evidence/u);
    assert.doesNotMatch(searchText, /rawPageText/u);
  });

  test("search text strips raw other-ingredients labels, embedded amounts, and placeholder variant titles", () => {
    const searchText = buildSearchText({
      source: "example-brand",
      sourceId: "preworkout",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:preworkout",
      name: "Example Pre-Workout",
      brand: "Example Brand",
      upc: "810030518488",
      dataOriginUrl: "https://example.test/products/preworkout",
      label: {
        ingredientRows: [{ name: "Beta-Alanine", amount: "1.6", unit: "g" }],
        otherIngredients: "Other Ingredients: Natural Flavor, Calcium Silicate (25mg), Silicon Dioxide (25mg).",
        variant: { title: "Default Title", sku: "FGPW700130608" },
      },
    });

    assert.match(searchText, /Natural Flavor/u);
    assert.match(searchText, /Calcium Silicate/u);
    assert.match(searchText, /FGPW700130608/u);
    assert.doesNotMatch(searchText, /Other Ingredients:/u);
    assert.doesNotMatch(searchText, /25mg/u);
    assert.doesNotMatch(searchText, /Default Title/u);
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
    assert.doesNotMatch(normalized.searchText, /Magnesium 200 mg/u);
    assert.doesNotMatch(normalized.searchText, /2 capsules/u);
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

    const multiPack = normalizeItem({
      id: "example-brand:health-essentials-multi-pack",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:health-essentials-multi-pack",
      source: "example-brand",
      sourceId: "health-essentials-multi-pack",
      name: "Example Health Essentials Multi-Pack",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Vitamin D3", amount: "25", unit: "mcg" }],
        servingSizes: ["1 multi-pack (4 softgels & 3 capsules)"],
      },
    });

    assert.deepEqual(multiPack.reviewIssues, ["non_standalone_product"]);
    assert.throws(() => assertProductionReady([multiPack]), /non_standalone_product/u);

    const multiBottle = normalizeItem({
      id: "example-brand:b-complex-2-bottles",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:b-complex-2-bottles",
      source: "example-brand",
      sourceId: "b-complex-2-bottles",
      name: "B-Complex, 180 Coated Caplets, 2 Bottles",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Vitamin B12", amount: "50", unit: "mcg" }],
        servingSizes: ["1 caplet"],
      },
    });

    assert.deepEqual(multiBottle.reviewIssues, ["non_standalone_product"]);

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

    const sweetener = normalizeItem({
      id: "example-brand:stevia-table-top-sweetener",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:stevia-table-top-sweetener",
      source: "example-brand",
      sourceId: "stevia-table-top-sweetener",
      name: "Stevia Table Top Sweetener",
      brand: "Example Brand",
      label: {
        ingredientRows: [{ name: "Item Weight", amount: "100", unit: "g" }],
        servingSizes: ["1 g"],
      },
    });

    assert.deepEqual(sweetener.reviewIssues, ["likely_food_or_non_supplement"]);

    const flavoredProtein = normalizeItem({
      id: "example-brand:protein-vanilla",
      dataOrigin: "brand_site",
      dataOriginId: "example-brand:protein-vanilla",
      source: "example-brand",
      sourceId: "protein-vanilla",
      name: "Vegan Protein - Vanilla",
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
    assert.equal(
      shopifyPageUrlForProductUrl("https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules?variant=1"),
      "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
    );
    assert.equal(shopifyJsonUrlForProductUrl("https://example.test/pages/about"), null);
    assert.equal(shopifyPageUrlForProductUrl("https://example.test/pages/about"), null);
  });

  test("matches queue rows to Shopify variants without using product-page body text", () => {
    const row = {
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      name: "5-HTP 100 mg - 120 count",
    };

    assert.deepEqual(variantCandidateTexts(row), ["120 count"]);
    assert.equal(matchShopifyVariantForQueueRow(row, bluebonnetProduct)?.barcode, "743715000537");
  });

  test("uses the only Shopify variant when queue suffix text does not match variant text", () => {
    const product = {
      variants: [
        {
          id: 700110602,
          title: "Default Title",
          public_title: "Default Title",
          option1: "Default Title",
          barcode: "810030513416",
        },
      ],
    };

    assert.equal(
      matchShopifyVariantForQueueRow({
        sourceId: "energy-sticks-breezeberry",
        name: "Energy Sticks - Breezeberry",
      }, product),
      product.variants[0],
    );
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

  test("selects variant-specific SFP facts media without selecting front-panel images", () => {
    const product = {
      variants: [
        { id: 1, title: "Blue Raspberry", option1: "Blue Raspberry", barcode: "874659001790" },
        { id: 2, title: "Limeade", option1: "Limeade", barcode: "874659003442" },
      ],
      media: [
        {
          alt: "Blue Raspberry",
          position: 1,
          media_type: "image",
          src: "https://cdn.example.test/TL_BCAA_30S_BR_1_3.png",
        },
        {
          alt: "Limeade",
          position: 2,
          media_type: "image",
          src: "https://cdn.example.test/Limeade_SFP.png",
        },
        {
          alt: "Blue Raspberry",
          position: 3,
          media_type: "image",
          src: "https://cdn.example.test/BCAA_Blue_Raspberry_SFP_09-12-25.png",
        },
      ],
    };

    assert.deepEqual(selectShopifyFactsMedia(product, product.variants[0]).map((media) => media.url), [
      "https://cdn.example.test/BCAA_Blue_Raspberry_SFP_09-12-25.png",
    ]);
  });

  test("selects variant-specific SFP images embedded in official product HTML", () => {
    const variants = [
      { id: 39503883108445, title: "Sweet Vanilla", option1: "Sweet Vanilla" },
      { id: 43367436320861, title: "Chocolate Peanut Butter", option1: "Chocolate Peanut Butter" },
      { id: 39827283640413, title: "Chocolate Glaze Donut", option1: "Chocolate Glaze Donut" },
    ];
    const html = `
      <div class="main-product-sfp">
        <img src="//brand.example.test/cdn/shop/files/Mass_Gainer-Sweet_Vanilla_SFP.png?crop=center&amp;height=800&amp;width=800" alt="Sweet Vanilla">
      </div>
      <div class="variant_meta_image hidden" data-variant-sfp="43367436320861" variant-title="Chocolate Peanut Butter">
        <img src="//brand.example.test/cdn/shop/files/Mass_Gainer-Chocolate_PB_SFP.png?crop=center&height=800&width=800" alt="Chocolate Peanut Butter">
      </div>
      <div class="variant_meta_image hidden" data-variant-sfp="39827283640413" variant-title="Chocolate Glaze Donut">
        <img src="//brand.example.test/cdn/shop/files/Mass_Gainer_-_Chocolate_Glaze_SFP.png?crop=center&height=800&width=800" alt="Chocolate Glaze Donut">
      </div>
    `;

    assert.deepEqual(extractHtmlFactsMedia(html, variants[2]).map((media) => media.url), [
      "https://brand.example.test/cdn/shop/files/Mass_Gainer_-_Chocolate_Glaze_SFP.png?crop=center&height=800&width=800",
    ]);
  });

  test("adds official HTML facts images to image-only candidates", () => {
    const product = {
      title: "Mass Gainer",
      vendor: "Transparent Labs",
      type: "Protein",
      description: "<p>Nutrition & Supplement Facts</p>",
      variants: [
        { id: 1, title: "Sweet Vanilla", option1: "Sweet Vanilla", barcode: "111" },
        { id: 2, title: "Chocolate Glaze Donut", option1: "Chocolate Glaze Donut", barcode: "222" },
      ],
      media: [],
    };
    const html = `
      <div class="variant_meta_image hidden" data-variant-sfp="2" variant-title="Chocolate Glaze Donut">
        <img src="//brand.example.test/cdn/shop/files/Mass_Gainer_-_Chocolate_Glaze_SFP.png?crop=center&height=800&width=800" alt="Chocolate Glaze Donut">
      </div>
    `;

    const candidate = buildShopifyEvidenceCandidate({
      source: "transparent-labs",
      sourceId: "mass-gainer--chocolate-glaze-donut",
      dataOriginId: "transparent-labs:mass-gainer--chocolate-glaze-donut",
      dataOriginUrl: "https://www.transparentlabs.com/products/proteinseries-mass-gainer",
      name: "Mass Gainer - Chocolate Glaze Donut",
      brand: "Transparent Labs",
    }, product, html, "2026-06-07T00:00:00.000Z");

    assert.deepEqual(candidate?.label.factsImageUrls, [
      "https://brand.example.test/cdn/shop/files/Mass_Gainer_-_Chocolate_Glaze_SFP.png?crop=center&height=800&width=800",
    ]);
    assert.equal(candidate?.refetchPreview.htmlFactsMediaCount, 1);
    assert.deepEqual(candidate?.reviewIssues, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "needs_manual_review",
    ]);
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
    }, bluebonnetProduct, null, "2026-06-07T00:00:00.000Z");

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
    }, product, null, "2026-06-07T00:00:00.000Z");

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
    }, product, null, "2026-06-07T00:00:00.000Z");

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
    }, product, null, "2026-06-07T00:00:00.000Z");

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
    }, bluebonnetProduct, null, "2026-06-07T00:00:00.000Z");

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
    }, bluebonnetProduct, null, "2026-06-07T00:00:00.000Z");

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

  test("parses fenced OCR JSON into a normalized OCR payload", () => {
    assert.deepEqual(parseOcrJson([
      "```json",
      JSON.stringify({
        imageContainsFactsPanel: true,
        confidence: "high",
        factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving Magnesium 200 mg 48%",
        servingSize: "1 Capsule",
        servingsPerContainer: null,
        otherIngredients: "Vegetable cellulose capsule.",
        warnings: ["small print"],
      }),
      "```",
    ].join("\n")), {
      imageContainsFactsPanel: true,
      confidence: "high",
      factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving Magnesium 200 mg 48%",
      servingSize: "1 Capsule",
      servingsPerContainer: null,
      otherIngredients: "Vegetable cellulose capsule.",
      warnings: ["small print"],
    });
  });

  test("builds production-ready OCR candidates only when parsed rows and servings are complete", () => {
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
    }, bluebonnetProduct, null, "2026-06-07T00:00:00.000Z");

    assert.ok(candidate);
    const ocrCandidate = buildOcrCandidate(candidate, {
      imageContainsFactsPanel: true,
      confidence: "high",
      factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving 5-HTP 100 mg *",
      servingSize: "1 Capsule",
      servingsPerContainer: "120",
      otherIngredients: "Vegetable cellulose capsule.",
      warnings: [],
    }, "https://cdn.example.test/743715000537F_supp-side.jpg", "2026-06-07T00:00:00.000Z");

    assert.equal(ocrCandidate.label.needsManualReview, false);
    assert.equal(ocrCandidate.label.evidenceStatus, "structured_facts_from_official_facts_image_ocr");
    assert.deepEqual(ocrCandidate.reviewIssues, []);
    assert.deepEqual(ocrCandidate.label.servingSizes, [
      { text: "1 Capsule", source: "factsText" },
    ]);
    assert.deepEqual(ocrCandidate.label.ingredientRows, [
      {
        name: "5-HTP",
        amount: "100",
        unit: "mg",
        dailyValue: "*",
        source: "factsText",
      },
    ]);
    assert.equal(ocrCandidate.label.otherIngredients, "Vegetable cellulose capsule.");
    assert.equal(ocrCandidate.ocrPreview.promoted, true);
  });

  test("keeps low-confidence OCR candidates blocked from production", () => {
    const candidate = buildShopifyEvidenceCandidate({
      source: "bluebonnet-nutrition",
      sourceId: "5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginId: "bluebonnet-nutrition:5-htp-100-mg-vegetable-capsules--120-count",
      dataOriginUrl: "https://bluebonnetnutrition.com/products/5-htp-100-mg-vegetable-capsules",
      name: "5-HTP 100 mg - 120 count",
      brand: "Bluebonnet Nutrition",
    }, bluebonnetProduct, null, "2026-06-07T00:00:00.000Z");

    assert.ok(candidate);
    const ocrCandidate = buildOcrCandidate(candidate, {
      imageContainsFactsPanel: true,
      confidence: "low",
      factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving 5-HTP 100 mg *",
      servingSize: "1 Capsule",
      servingsPerContainer: "120",
      otherIngredients: null,
      warnings: ["blurry image"],
    }, "https://cdn.example.test/743715000537F_supp-side.jpg", "2026-06-07T00:00:00.000Z");

    assert.equal(ocrCandidate.label.needsManualReview, true);
    assert.equal(ocrCandidate.ocrPreview.promoted, false);
    assert.deepEqual(ocrCandidate.reviewIssues, ["needs_manual_review"]);
  });

  test("selects OCR input rows by source and ignores exact-DSLD hydrated rows", () => {
    const rows = [
      { source: "transparent-labs", label: { factsImageUrls: ["https://cdn.example.test/a.png"] } },
      { source: "transparent-labs", refetchPreview: { dsldUpcHydrated: true }, label: { factsImageUrls: ["https://cdn.example.test/b.png"] } },
      { source: "bluebonnet-nutrition", label: { factsImageUrls: ["https://cdn.example.test/c.png"] } },
      { source: "transparent-labs", label: {} },
    ];

    assert.deepEqual(selectOcrInputRows(rows, { source: "transparent-labs", limit: 10 }), [
      rows[0],
    ]);
  });

  test("builds OpenAI OCR requests with image URL input and strict JSON schema", () => {
    const request = buildOpenAiOcrRequest({
      model: "gpt-5-mini",
      imageUrl: "https://cdn.example.test/facts.png",
      candidate: { name: "Example Magnesium", label: { variant: { title: "60 count" } } },
    });

    assert.equal(request.model, "gpt-5-mini");
    assert.equal(request.input[0].content[1].type, "input_image");
    assert.equal(request.input[0].content[1].image_url, "https://cdn.example.test/facts.png");
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.schema.properties.factsText.type[0], "string");
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
      factsText: "Supplement Facts Serving Size: 3 Oil-Infused Capsules Servings Per Container: 48 Amount Per Serving Niacin 25.5 mg",
    }), [
      { text: "3 Oil-Infused Capsules", source: "factsText" },
    ]);

    assert.deepEqual(extractServingSizes({
      factsText: [
        "Supplement Facts",
        "Serving Size 1 Biodegradable Sachet (2.5 g)",
        "(Makes 8 fl oz)",
        "Servings Per Container 30",
        "Amount Per Serving Proprietary Blend 2.5 g",
      ].join("\n"),
    }), [
      { text: "1 Biodegradable Sachet (2.5 g)", source: "factsText" },
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
    assert.match(preview.proposedSearchTextPreview, /Magnesium/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /Magnesium 200 mg/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /2 Capsules/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /48%/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /page copy page copy/u);
    assert.equal(preview.productionCandidate?.label.bodyText, undefined);
    assert.deepEqual(preview.productionCandidate?.label.servingSizes, [
      { text: "2 Capsules", source: "factsText" },
    ]);
    assert.deepEqual(preview.productionCandidate?.reviewIssues, []);
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

  test("repair preview blocks unit-shifted amounts that contradict the stated daily value", () => {
    // Real defect class: brand page prints "Chromium 200 mg 571%" where 571%
    // of the 35 mcg DV proves the amount is 200 mcg, not 200 mg.
    const preview = repairPreviewForRow({
      id: "example-brand:chromium-unit-shift",
      dataOriginId: "example-brand:chromium-unit-shift",
      dataOriginUrl: "https://example.test/products/chromium",
      name: "Example Chromium Picolinate 200 mcg",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "chromium-unit-shift",
        factsText: "Supplement Facts Serving Size 1 Tablet Amount Per Serving Chromium (as chromium picolinate) 200 mg 571%",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.ok(preview.parserBlockers.includes("daily_value_unit_mismatch"));
  });

  test("repair preview accepts consistent daily values across locale comma formats", () => {
    // 1,385% of the riboflavin 1.3 mg DV is ~18 mg — consistent, must not block.
    const preview = repairPreviewForRow({
      id: "example-brand:riboflavin-consistent",
      dataOriginId: "example-brand:riboflavin-consistent",
      dataOriginUrl: "https://example.test/products/riboflavin",
      name: "Example Riboflavin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "riboflavin-consistent",
        factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving Riboflavin 18 mg 1,385%",
      },
    });

    assert.ok(!preview.parserBlockers.includes("daily_value_unit_mismatch"));
    assert.ok(!preview.parserBlockers.includes("malformed_daily_value"));
  });

  test("repair preview blocks numeric daily values that are not percent strings", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:fraction-daily-value",
      dataOriginId: "example-brand:fraction-daily-value",
      dataOriginUrl: "https://example.test/products/fraction-daily-value",
      name: "Example Zinc",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "fraction-daily-value",
        ingredientRows: [{ name: "Zinc", amount: "20", unit: "mg", dailyValue: "1.82" }],
        servingSizes: ["1 Capsule"],
        factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving Zinc 20 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.ok(preview.parserBlockers.includes("malformed_daily_value"));
  });

  test("repair preview blocks directions-like ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:directions-name",
      dataOriginId: "example-brand:directions-name",
      dataOriginUrl: "https://example.test/products/directions-name",
      name: "Example Creatine",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "directions-name",
        ingredientRows: [
          { name: "Creatine Monohydrate", amount: "5", unit: "g" },
          { name: "Do not exceed", amount: "5", unit: "g" },
        ],
        servingSizes: ["1 Scoop"],
        factsText: "Supplement Facts Serving Size 1 Scoop Amount Per Serving Creatine Monohydrate 5 g",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.ok(preview.parserBlockers.includes("directions_like_ingredient_name"));
  });

  test("repair preview blocks composite slash amounts and mangled spoon servings", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:composite-amount",
      dataOriginId: "example-brand:composite-amount",
      dataOriginUrl: "https://example.test/products/composite-amount",
      name: "Example Inositol Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "composite-amount",
        ingredientRows: [{ name: "Vitamin D (as D3 Cholecalciferol)", amount: "1,000/25", unit: "mcg" }],
        // OCR-mangled "1/4 Teaspoon" that lost its fraction slash
        servingSizes: ["14 Teaspoon (850 mg)"],
        factsText: "Supplement Facts Serving Size 1/4 Teaspoon (850 mg) Amount Per Serving Vitamin D (as D3 Cholecalciferol) 1,000 IU 25 mcg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.ok(preview.parserBlockers.includes("composite_amount_value"));
    assert.ok(preview.parserBlockers.includes("implausible_spoon_serving_size"));
  });

  test("repair preview keeps row source identity when label source stores refetch provenance", () => {
    const preview = repairPreviewForRow({
      id: "alani-nu:pre-workout-cherry-twist",
      dataOriginId: "alani-nu:pre-workout-cherry-twist",
      dataOriginUrl: "https://www.alaninu.com/products/pre-workout",
      name: "Pre-Workout - Cherry Twist",
      brand: "Alani Nu",
      upc: "810030519837",
      offMarket: false,
      searchText: "legacy search text",
      label: {
        source: "official_facts_image_ocr_preview",
        sourceId: "pre-workout-cherry-twist",
        evidenceStatus: "structured_facts_from_official_facts_image_ocr",
        sourceUrl: "https://www.alaninu.com/products/pre-workout",
        ingredientRows: [
          { name: "L-Citrulline", amount: "6", unit: "g" },
          { name: "Beta-Alanine", amount: "1.6", unit: "g" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_image_ocr" }],
        factsText: "Supplement Facts Serving Size 1 scoop L-Citrulline 6 g Beta-Alanine 1.6 g",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.equal(preview.productionCandidate?.source, "alani-nu");
    assert.equal(preview.productionCandidate?.sourceId, "pre-workout-cherry-twist");
    assert.equal(preview.productionCandidate?.dataOriginId, "alani-nu:pre-workout-cherry-twist");
    assert.equal(preview.productionCandidate?.label.source, "official_facts_image_ocr_preview");
    assert.deepEqual(preview.productionCandidate?.reviewIssues, []);
  });

  test("repair preview excludes production review issues from automated candidates", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:starter-kit",
      dataOriginId: "example-brand:starter-kit",
      dataOriginUrl: "https://example.test/products/starter-kit",
      name: "Example Starter Kit",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "starter-kit",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg" }],
        servingSizes: [{ text: "2 capsules", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 capsules Magnesium 200 mg",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, ["non_standalone_product"]);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview blocks parsed ingredient names contaminated by table headers", () => {
    const preview = repairPreviewForRow({
      id: "activlab:activ-t061-ws",
      dataOriginId: "activlab:activ-t061-ws",
      dataOriginUrl: "https://activlab.pl/products/k-mag-b6-shot",
      name: "K-MAG B6 shot",
      brand: "Activlab",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "activlab",
        sourceId: "activ-t061-ws",
        ingredientRows: [
          { name: "% referencyjnej wartości spożycia Magnez" },
          { name: "375 mg" },
        ],
        servingSizes: [{ text: "1 shot o pojemności 80 ml przed treningiem", source: "directions_serving" }],
        factsText: [
          "WARTOŚCI ODŻYWCZE Składnik w porcji % referencyjnej wartości spożycia",
          "Magnez 375 mg 100%",
          "Potas 430 mg 22%",
          "Witamina B6 1,4 mg 100%",
          "Stosować 1 shot o pojemności 80 ml",
        ].join(" "),
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.productionCandidate, null);
    assert.deepEqual(preview.removableFieldCandidates, []);
  });

  test("repair preview blocks retained legacy ingredient names contaminated by table headers", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:legacy-reference-intake",
      dataOriginId: "example-brand:legacy-reference-intake",
      dataOriginUrl: "https://example.test/products/legacy-reference-intake",
      name: "Example Legacy Reference Intake",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "legacy-reference-intake",
        ingredientRows: [
          { name: "Vitamin C", amount: "90", unit: "mg" },
          { name: "%Reference Intake*", amount: "100", unit: "mg" },
        ],
        servingSizes: [{ text: "1 tablet", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 tablet Vitamin C 90 mg",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks retained fallback amount-pattern ingredient rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:retained-fallback-amount-row",
      dataOriginId: "example-brand:retained-fallback-amount-row",
      dataOriginUrl: "https://example.test/products/retained-fallback-amount-row",
      name: "Example Creatine",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "retained-fallback-amount-row",
        ingredientRows: [
          { name: "Creatine Monohydrate", amount: "3", unit: "g", source: "factsText" },
          { name: "100 Amount per serving Creatine Monohydrate 3", amount: "3", unit: "g", source: "factsText_amount_pattern" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Creatine Monohydrate 3 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("fallback_amount_pattern_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks retained percent-prefix nutrient table artifacts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:retained-percent-prefix-artifact",
      dataOriginId: "example-brand:retained-percent-prefix-artifact",
      dataOriginUrl: "https://example.test/products/retained-percent-prefix-artifact",
      name: "Example Glutamine",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "retained-percent-prefix-artifact",
        ingredientRows: [{ name: "%RDA (Women) Energy Value", amount: "3.9", unit: "kcal", source: "factsText_table" }],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Energy Value 3.9 kcal",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview repairs retained embedded age-column artifacts from clean facts text", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:retained-age-column-artifact",
      dataOriginId: "example-brand:retained-age-column-artifact",
      dataOriginUrl: "https://example.test/products/retained-age-column-artifact",
      name: "Example Baby Vitamin D",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "retained-age-column-artifact",
        ingredientRows: [{ name: "12 Months 1 through 3 Years Vitamin D", amount: "10", unit: "mcg", source: "factsText_table" }],
        servingSizes: [{ text: "1 drop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 drop Vitamin D 10 mcg",
      },
    });

    assert.deepEqual(preview.parserBlockers, []);
    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(preview.productionCandidate?.label.ingredientRows, [
      { name: "Vitamin D", amount: "10", unit: "mcg", source: "factsText" },
    ]);
  });

  test("repair preview normalizes retained amounts that already include units", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:retained-amount-unit",
      dataOriginId: "example-brand:retained-amount-unit",
      dataOriginUrl: "https://example.test/products/retained-amount-unit",
      name: "Example Vitamin C",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "retained-amount-unit",
        ingredientRows: [
          { name: "Vitamin C", amount: "476 mg", unit: "mg", source: "structured_label_field" },
          { name: "Protease", amount: "10500 HUT", unit: "HUT", source: "structured_label_field" },
          { name: "Lactobacillus rhamnosus", amount: "17,75 milliard", unit: "d", source: "structured_label_field" },
          { name: "Streptococcus salivarius K12", amount: "1 milliard d’UFC*", unit: "milliard", source: "structured_label_field" },
        ],
        servingSizes: [{ text: "1 tablet", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 tablet Vitamin C 476 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    const ingredientRows = productionIngredientRows(preview);
    assert.equal(ingredientRows[0]?.amount, "476");
    assert.equal(ingredientRows[0]?.unit, "mg");
    assert.equal(ingredientRows[1]?.amount, "10500");
    assert.equal(ingredientRows[1]?.unit, "HUT");
    assert.equal(ingredientRows[2]?.amount, "17.75");
    assert.equal(ingredientRows[2]?.unit, "billion CFU");
    assert.equal(ingredientRows[3]?.amount, "1");
    assert.equal(ingredientRows[3]?.unit, "billion CFU");
  });

  test("repair preview blocks retained rows missing specific mushroom title actives", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:lions-mane-missing-active",
      dataOriginId: "example-brand:lions-mane-missing-active",
      dataOriginUrl: "https://example.test/products/lions-mane-missing-active",
      name: "Lion's Mane Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "lions-mane-missing-active",
        ingredientRows: [{ name: "Certified Organic", amount: "1.5", unit: "g", source: "factsText_table" }],
        servingSizes: [{ text: "1/2 tsp", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1/2 tsp Certified Organic 1.5 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks retained inactive-only nutrition rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:inactive-only-energy",
      dataOriginId: "example-brand:inactive-only-energy",
      dataOriginUrl: "https://example.test/products/inactive-only-energy",
      name: "Daily Energy",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "inactive-only-energy",
        ingredientRows: [{ name: "Sodium", amount: "10", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Sodium 10 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("inactive_only_ingredient_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks retained spotcheck artifact ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:retained-spotcheck-artifacts",
      dataOriginId: "example-brand:retained-spotcheck-artifacts",
      dataOriginUrl: "https://example.test/products/retained-spotcheck-artifacts",
      name: "Example Complex",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "retained-spotcheck-artifacts",
        ingredientRows: [
          { name: "Actifs Dosage pour 2 comprimés/jour AR* Charbon actif végétal", amount: "200", unit: "mg", source: "factsText_table" },
          { name: "PM", amount: "150", unit: "mg", source: "factsText_table" },
          { name: "DVt VitaminA", amount: "650", unit: "mcg", source: "factsText_table" },
          { name: "Rosavins and", amount: "3", unit: "mg", source: "factsText_table" },
          { name: "Carrelne", amount: "150", unit: "mg", source: "factsText_table" },
          { name: "Type-A Polymers]", amount: "175", unit: "mg", source: "factsText_table" },
          { name: "0.65* Protein", amount: "0.21", unit: "g", source: "factsText_table" },
          { name: "✜1", amount: "1", unit: "g", source: "factsText_table" },
          { name: ") Magnesium (from Magnesium Citrate", amount: "500", unit: "mg", source: "factsText_table" },
          { name: ") 4:1 (equiv.", amount: "3.5", unit: "g", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Example 150 mg",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview fixes known bad source brand values", () => {
    for (const row of [
      { source: "doctors-best", inputBrand: "N/A", expectedBrand: "Doctor's Best", name: "Doctor's Best Alpha-Lipoic Acid" },
      { source: "natures-way", inputBrand: "NW", expectedBrand: "Nature's Way", name: "Nature's Way Choline" },
    ]) {
      const preview = repairPreviewForRow({
        id: `${row.source}:alpha-lipoic-acid`,
        dataOriginId: `${row.source}:alpha-lipoic-acid`,
        dataOriginUrl: "https://example.test/products/alpha-lipoic-acid",
        name: row.name,
        brand: row.inputBrand,
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: row.source,
          sourceId: "alpha-lipoic-acid",
          ingredientRows: [{ name: "Alpha-Lipoic Acid", amount: "300", unit: "mg", source: "factsText_table" }],
          servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
          factsText: "Supplement Facts Serving Size 1 capsule Alpha-Lipoic Acid 300 mg",
        },
      });

      assert.equal(preview.automatedBackfillReady, true, row.source);
      assert.equal(preview.brand, row.expectedBrand, row.source);
      assert.equal(preview.productionCandidate?.brand, row.expectedBrand, row.source);
    }
  });

  test("repair preview blocks multi-row inactive-only nutrition panels", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:pomegranate-powder",
      dataOriginId: "example-brand:pomegranate-powder",
      dataOriginUrl: "https://example.test/products/pomegranate-powder",
      name: "Pomegranate Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "pomegranate-powder",
        ingredientRows: [
          { name: "Total Carbs", amount: "5", unit: "g", source: "factsText_table" },
          { name: "Total Sugar", amount: "2", unit: "g", source: "factsText_table" },
          { name: "Includes Added Sugar", amount: "0", unit: "g", source: "factsText_table" },
          { name: "Potassium", amount: "30", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "2 tsp", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 2 tsp Total Carbs 5 g Total Sugar 2 g Potassium 30 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("inactive_only_ingredient_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks remaining manual spotcheck parser fragments", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:manual-spotcheck-fragments",
      dataOriginId: "example-brand:manual-spotcheck-fragments",
      dataOriginUrl: "https://example.test/products/manual-spotcheck-fragments",
      name: "Example Complex",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "manual-spotcheck-fragments",
        ingredientRows: [
          { name: "FREE", amount: "1", unit: "g", source: "factsText_table" },
          { name: "Daily Values L-Glutamine", amount: "1", unit: "g", source: "factsText_table" },
          { name: "Flavours: chocolate", amount: "100", unit: "g", source: "factsText_table" },
          { name: "Dávka – 70 g", amount: "70", unit: "g", source: "factsText_table" },
          { name: "Energetická hodnota", amount: "235", unit: "kcal", source: "factsText_table" },
          { name: "Vitamin B12 Lic. No.: 10020022011847", amount: "1", unit: "mcg", source: "factsText_pipe" },
          { name: "Protein meets pure refreshment. Our", amount: "10", unit: "g", source: "factsText" },
          { name: "4 L-Citrulline 259", amount: "5", unit: "g", source: "factsText_table" },
          { name: "Vitamin B12", amount: "2,000", unit: "calorie", source: "factsText" },
          { name: "Manufactured and distributed by Naked Nutrition", amount: "5", unit: "g", source: "factsText" },
          { name: "PO Box 348634 Coral Gables, FL 33234 Creatine Monohydrate", amount: "5", unit: "g", source: "factsText" },
          { name: "Store in a cool, dry place.", amount: "100", unit: "mcg", source: "factsText_table" },
          { name: "Mix 1 scoop lappin", amount: "200", unit: "mg", source: "factsText" },
          { name: "Acid and Grape Seed Extract", amount: "70", unit: "mg", source: "factsText_table" },
          { name: "Vitamin E (as dl-alpha tocopheryl acetate) Marine Lipid Concentrate", amount: "1000", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Example 100 mg",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks rows missing promised title actives", () => {
    const cases = [
      {
        id: "basic-nutrients",
        name: "Basic Nutrients 2/Day",
        rows: [
          { name: "Vitamin A", amount: "450", unit: "mcg" },
          { name: "Vitamin K", amount: "200", unit: "mcg" },
          { name: "Folate", amount: "400", unit: "mcg" },
        ],
      },
      {
        id: "saw-palmetto",
        name: "Saw Palmetto & Pygeum with Zinc",
        rows: [{ name: "Zinc", amount: "6.7", unit: "mg" }],
      },
      {
        id: "eaa",
        name: "EAA Plus",
        rows: [
          { name: "Sodium", amount: "215", unit: "mg" },
          { name: "L-Histidine", amount: "200", unit: "mg" },
        ],
      },
      {
        id: "power-pak",
        name: "Power Pak Acai Berry",
        rows: [{ name: "Folate", amount: "255", unit: "mcg DFE" }],
      },
      {
        id: "reacta-c",
        name: "Reacta-C with Bioflavonoids",
        rows: [{ name: "Bioflavonoids", amount: "250", unit: "mg" }],
      },
      {
        id: "high-epa",
        name: "AvailOM High EPA Capsules",
        rows: [{ name: "Total Omega-3", amount: "225", unit: "mg" }],
      },
      {
        id: "magnesium-milk-thistle-turmeric",
        name: "Magnesium + Milk Thistle & Turmeric",
        rows: [{ name: "Magnesium", amount: "100", unit: "mg" }],
      },
      {
        id: "apple-cider-vinegar",
        name: "Apple Cider Vinegar + Metabolism Gummies",
        rows: [{ name: "Chromium", amount: "200", unit: "mcg" }],
      },
    ];

    for (const testCase of cases) {
      const preview = repairPreviewForRow({
        id: `example-brand:${testCase.id}`,
        dataOriginId: `example-brand:${testCase.id}`,
        dataOriginUrl: `https://example.test/products/${testCase.id}`,
        name: testCase.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: testCase.id,
          ingredientRows: testCase.rows.map((row) => ({ ...row, source: "factsText_table" })),
          servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
          factsText: `Supplement Facts Serving Size 1 capsule ${testCase.rows[0]?.name} ${testCase.rows[0]?.amount} ${testCase.rows[0]?.unit}`,
        },
      });

      assert.ok(preview.parserBlockers.includes("likely_missing_product_active"), testCase.id);
      assert.equal(preview.automatedBackfillReady, false, testCase.id);
      assert.equal(preview.productionCandidate, null, testCase.id);
    }
  });

  test("repair preview normalizes safe OCR and footnote ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:safe-name-cleanup",
      dataOriginId: "example-brand:safe-name-cleanup",
      dataOriginUrl: "https://example.test/products/safe-name-cleanup",
      name: "Example Cordyceps Fiber",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "safe-name-cleanup",
        ingredientRows: [
          { name: "Cordyceps (Cordyceps militaris) mycelium-/", amount: "1", unit: "g", source: "factsText_table" },
          { name: "Dietary Hiber", amount: "5", unit: "g", source: "factsText_table" },
          { name: "Magnosium (as Dimagnesium Malato)", amount: "40", unit: "mg", source: "factsText_table" },
          { name: "Tron", amount: "1", unit: "mg", source: "factsText_table" },
          { name: "Zino (as zino gluconate)", amount: "5", unit: "mg", source: "factsText_table" },
          { name: "Odorless Garlic **", amount: "1000", unit: "mg", source: "factsText_table" },
          { name: "Bromelain (2,000 G.D.U. per gram)TT", amount: "300", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Cordyceps 1 g Dietary Fiber 5 g",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(productionIngredientRows(preview).map(ingredientRowName), [
      "Cordyceps (Cordyceps militaris) mycelium",
      "Dietary Fiber",
      "Magnesium (as Dimagnesium Malato)",
      "Iron",
      "Zinc (as Zinc gluconate)",
      "Odorless Garlic",
      "Bromelain (2,000 G.D.U. per gram)",
    ]);
  });

  test("repair preview blocks conventional coconut milk powder food rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:coconut-milk-powder",
      dataOriginId: "example-brand:coconut-milk-powder",
      dataOriginUrl: "https://example.test/products/coconut-milk-powder",
      name: "Coconut Milk Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "coconut-milk-powder",
        ingredientRows: [
          { name: "Saturated Fat", amount: "8", unit: "g", source: "factsText_table" },
          { name: "Protein", amount: "1", unit: "g", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 1 scoop Saturated Fat 8 g Protein 1 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_food_or_non_supplement"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks automated candidates that would shrink existing ingredient rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:shrinking-facts",
      dataOriginId: "example-brand:shrinking-facts",
      dataOriginUrl: "https://example.test/products/shrinking-facts",
      name: "Example Magnesium",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "shrinking-facts",
        ingredientRows: [
          { name: "Serving Size" },
          { name: "% der empf. Tageszufuhr pro Kapsel * Magnesium", amount: "240", unit: "mg" },
          { name: "Magnesium", amount: "240", unit: "mg" },
        ],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Magnesium 240 mg 64%",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.ok(preview.parserBlockers.includes("existing_ingredient_rows_would_decrease"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks parser artifact ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:directions-as-ingredient",
      dataOriginId: "example-brand:directions-as-ingredient",
      dataOriginUrl: "https://example.test/products/directions-as-ingredient",
      name: "Example Liquid Herbal",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "directions-as-ingredient",
        ingredientRows: [{ name: "How to Use: Take", amount: "30", unit: "ml" }],
        servingSizes: [{ text: "30 ml", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 30 ml How to Use: Take 30 ml",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks extraction-rate rows as automated ingredients", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:herbal-extraction-rate",
      dataOriginId: "example-brand:herbal-extraction-rate",
      dataOriginUrl: "https://example.test/products/herbal-extraction-rate",
      name: "Example Cotton",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "herbal-extraction-rate",
        ingredientRows: [{ name: "Extraction rate 467 mg fresh herb per", amount: "0.7", unit: "ml" }],
        servingSizes: [{ text: "0.7 ml", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 0.7 ml Extraction rate 467 mg fresh herb per 0.7 ml",
      },
    });

    assert.ok(preview.parserBlockers.some((blocker) => blocker.endsWith("ingredient_name_contamination")));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks percent and footer artifact ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:footer-artifacts",
      dataOriginId: "example-brand:footer-artifacts",
      dataOriginUrl: "https://example.test/products/footer-artifacts",
      name: "Example Melatonin Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "footer-artifacts",
        ingredientRows: [
          { name: "4%*** 8%*** Melatonin", amount: "1", unit: "mg" },
          { name: "Equivalent to", amount: "226", unit: "mg" },
          { name: "RDA is based", amount: "1", unit: "g" },
        ],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Melatonin 1 mg",
      },
    });

    assert.ok(preview.parserBlockers.some((blocker) => blocker.endsWith("ingredient_name_contamination")));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks age, badge, and joined table artifact ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:joined-table-artifacts",
      dataOriginId: "example-brand:joined-table-artifacts",
      dataOriginUrl: "https://example.test/products/joined-table-artifacts",
      name: "Example Immune Capsules",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "joined-table-artifacts",
        ingredientRows: [
          { name: "1 through 3 Years", amount: "3", unit: "g" },
          { name: "# Certified Organic", amount: "1.5", unit: "g" },
          { name: "Holy Basil (Ocimum sanctum) (leaf) (extract) Zinc", amount: "5", unit: "mg" },
          { name: "1 Capsule %* 2 Capsules %*", amount: "250", unit: "mg" },
        ],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Zinc 5 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("existing_ingredient_rows_would_decrease"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks direction and provenance fragments parsed as ingredient names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:provenance-fragments",
      dataOriginId: "example-brand:provenance-fragments",
      dataOriginUrl: "https://example.test/products/provenance-fragments",
      name: "Example Energy Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "provenance-fragments",
        ingredientRows: [
          { name: "Manufactured for: Example Theanine", amount: "100", unit: "mg" },
          { name: "Mix: Shake the bottle & add", amount: "30", unit: "ml" },
          { name: "% Nutrient Reference Value (NRV). Rows: Vitamin D", amount: "40", unit: "mcg" },
          { name: "Servings per bottle: 48", amount: "5", unit: "g" },
          { name: "Milligrams Capsules per Strength Organic Gymnema 25:1 Extract", amount: "300", unit: "mg" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Theanine 100 mg",
      },
    });

    assert.ok(preview.parserBlockers.length > 0);
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks additional sampled parser artifacts", () => {
    for (const row of [
      { id: "product-selector", name: "Example L-Carnitine Liquid", ingredient: "Select Size/Flavor: BLUE RASPBERRY GREEN APPLE L-CARNITINE LIQUID", amount: "3000", unit: "mg" },
      { id: "direction-copy", name: "Example Creatine + Aminos", ingredient: "To maximize results, dink&-", amount: "1", unit: "g" },
      { id: "active-heading", name: "Example Creatine Sport", ingredient: "Składniki aktywne", amount: "5", unit: "g" },
      { id: "merged-intraworkout", name: "Example Intraworkout", ingredient: "Huperzine A Beta-Alanine", amount: "1200", unit: "mg" },
      { id: "badge-prefix", name: "Example Creatine", ingredient: "• NON-GMO* Creatine Monohydrate", amount: "5000", unit: "mg" },
      { id: "badge-ocr-prefix", name: "Example Alfalfa Powder", ingredient: "• NON-CM Vegan Dietary Fiber", amount: "1", unit: "g" },
      { id: "merged-vitamin-iron", name: "Example Iron + Vitamin C", ingredient: "Vitamin C (as L-ascorbic acid) Iron (as ferrous bisglycinate chelate)", amount: "25", unit: "mg" },
      { id: "merged-bcaa-creatine", name: "Example Creatine + BCAAs", ingredient: "Sodium Branched Chain Amino Acids L-Leucine L-Isoleucine L-Valine Creatine Monohydrate", amount: "<1", unit: "g" },
      { id: "short-ocr-token", name: "Example Zeaxanthin", ingredient: "60 ma", amount: "6", unit: "mg" },
      { id: "approx-amount-token", name: "Example Herbal Resistance", ingredient: "Approx. 500 mg", amount: "500", unit: "mg" },
      { id: "merged-amino-pair", name: "Example Amino Complex", ingredient: "L-Leucine L-Lysine", amount: "1.25", unit: "g" },
      { id: "merged-alpha-gpc", name: "Example Alpha-Choline", ingredient: "Glycerylphosphorylcholine Toothed Clubmoss extract BioPerine Complex", amount: "2", unit: "mg" },
      { id: "merged-maca-schizandra", name: "Example VO2 Max", ingredient: "Maca powder Schisandra extract", amount: "250", unit: "mg" },
      { id: "food-preservant", name: "Example Sodium Citrate", ingredient: "• As a food preservant", amount: "0", unit: "g" },
      { id: "usage-question", name: "Get Slim Powder (Mix)", ingredient: "What's the recommended way to use Get Slim Mix?: Mix one sachet of Get Slim Mix with 250 ml", amount: "1", unit: "sachet" },
      { id: "nutrients-heading", name: "Example Pea Protein", ingredient: "Nutrients", amount: "33", unit: "g" },
      { id: "per-amount-name", name: "Example Pea Protein", ingredient: "BCAAs per 33 g", amount: "9.69", unit: "g" },
      { id: "footnote-number-token", name: "Example Children's DHA", ingredient: "1✜", amount: "1", unit: "g" },
      { id: "official-page-note", name: "Example Creatine", ingredient: "Official product page states each stick contains a full", amount: "5", unit: "g" },
      { id: "solgar-related-liquid", name: "Example L-Arginine", ingredient: "Liquid Solgar L-Glutamine", amount: "500", unit: "mg" },
      { id: "solgar-related-capsule", name: "Example L-Arginine", ingredient: "Vegetable Capsules L-Arginine 1000 MG", amount: "1000", unit: "mg" },
      { id: "nutricost-caran-tea", name: "Example Cinnamon", ingredient: "CARAN TEA", amount: "1,200", unit: "mg" },
      { id: "nutricost-egetarian", name: "Example Cinnamon", ingredient: "EGETARIAN Organic Ceylon Cinnamon Powder", amount: "1,200", unit: "mg" },
      { id: "thorne-protein-longa", name: "Example Detox Powder", ingredient: "Protein longa extract (root) / Phospholipi", amount: "20", unit: "g" },
      { id: "collagen-providing", name: "Example Collagen", ingredient: "NT2 Collagen standardized cartilage providing", amount: "10", unit: "mg" },
      { id: "legion-vtaning", name: "Example Women's Multi", ingredient: "VtaninG (as Ascorbic Acid)", amount: "90", unit: "mg" },
      { id: "legion-vitamin-8s", name: "Example Women's Multi", ingredient: "Vitamin 8s (as Calcium D-Partothenate)", amount: "100", unit: "mg" },
      { id: "legion-vitamin-as", name: "Example Women's Multi", ingredient: "Vitamin (as Beta Carotene)", amount: "450", unit: "mcg" },
      { id: "source-enzyme-merge", name: "Example Enzymes", ingredient: "Protease 80,000 USP Amylase 80,000 USP Lipase 6,400 USP Bromelain", amount: "105", unit: "mg" },
      { id: "k2-phospholipids-merge", name: "Example Children's Multi", ingredient: "Vitamin K2 (Coconut) Phospholipids including phosphatidylserine", amount: "50", unit: "mcg" },
      { id: "percent-suffix", name: "Example Ashwagandha", ingredient: "Organic Ashwagandha %", amount: "1200", unit: "mg" },
      { id: "facts-bullet", name: "Example PABA", ingredient: "• Facts", amount: "100", unit: "mg" },
      { id: "ingredients-each", name: "Example Meal Replacement", ingredient: "INGREDIENTS: Each 35 g", amount: "35", unit: "g" },
      { id: "scoop-take", name: "Example Meal Replacement", ingredient: "Scoop: Take 200 ml", amount: "200", unit: "ml" },
      { id: "per-tablet", name: "Example Sleep Support", ingredient: "Per 1 Tablet", amount: "42", unit: "mg" },
      { id: "age-column-low", name: "Example Kids Multi", ingredient: "1-3 Years", amount: "2", unit: "g" },
      { id: "age-column-high", name: "Example Kids Multi", ingredient: "≥ 4 Years", amount: "2", unit: "g" },
      { id: "merged-biotion-carbs", name: "Example Biotin", ingredient: "Total Carbohydrates Protein Biotin Calcium", amount: "1", unit: "g" },
      { id: "enzyme-activity-row", name: "Example Biotin", ingredient: "3.959 HUT 2,297 DU 773 CU 467 L 75 ALU", amount: "60", unit: "mg" },
      { id: "v-number-token", name: "Example Gut Powder", ingredient: "V3", amount: "<1", unit: "g" },
      { id: "lycium-merged", name: "Example Eye Support", ingredient: "Lycium Fruit Extract, Chrysanthemum Flower, Bilberry Fruit Extract. alpha-Lipoic Acid", amount: "30", unit: "mg" },
      { id: "thiamin-riboflavin-merged", name: "Example Iron Multi", ingredient: "Thiamin (vitamin B1) (as thiamine HCI) Riboflavin (vitamin B2)", amount: "25", unit: "mg" },
      { id: "niacin-b6-merged", name: "Example Iron Multi", ingredient: "Niacin (as niacinamide) Vitamin B6 (as pyridoxine HCI)", amount: "50", unit: "mg" },
      { id: "selenium-copper-merged", name: "Example Iron Multi", ingredient: "Selenium (as amino acid chelate) Copper (as amino acid chelate)", amount: "10", unit: "mcg" },
      { id: "keep-out-of-reach", name: "Example L-Arginine", ingredient: "Keep out of reach of children L-Arginine", amount: "500", unit: "mg" },
      { id: "mid-name-keep-out-of-reach", name: "Example Maca Complex", ingredient: "Horny Goat Weed (stem, leaf, root) Keep out of reach Maca Extract", amount: "500", unit: "mg" },
      { id: "rae-token", name: "Example Women's Multi", ingredient: "RAE", amount: "90", unit: "mg" },
      { id: "percent-token", name: "Example Women's Multi", ingredient: "1 100%", amount: "16", unit: "mg" },
      { id: "dfe-token", name: "Example Women's Multi", ingredient: "DFE", amount: "2.4", unit: "mcg" },
      { id: "ocr-equals-token", name: "Example Herbal Drops", ingredient: "= he == = == free > + Organic extract blend", amount: "174", unit: "mg", factsText: "" },
      { id: "just-one-li-prefix", name: "Example Yeast Fermentate", ingredient: "Just one li Dried Yeast Fermentate", amount: "500", unit: "mg" },
      { id: "amino-no-sugar-prefix", name: "Example Whey Protein", ingredient: "NO SUGAR Arginine", amount: "622", unit: "mg" },
      { id: "amino-no-artificial-prefix", name: "Example Whey Protein", ingredient: "NO ARTIFICIAL FLAVORS Tryptophan", amount: "473", unit: "mg" },
      { id: "amino-sweeteners-colors-prefix", name: "Example Whey Protein", ingredient: "SWEETENERS, OR COLORS Tyrosine", amount: "824", unit: "mg" },
      { id: "viracid-root-extract-merge", name: "Example Immune Blend", ingredient: "Root Extract European Elder (Sambucus nigra)", amount: "250", unit: "mg" },
      { id: "viracid-berry-extract-merge", name: "Example Immune Blend", ingredient: "Berry Extract Andrographis (Andrographis paniculata)", amount: "200", unit: "mg" },
      { id: "viracid-leaf-extract-merge", name: "Example Immune Blend", ingredient: "Leaf Extract Echinacea purpurea Extract", amount: "100", unit: "mg" },
      { id: "trace-b12-magnesium-merge", name: "Example Ionic B12", ingredient: "Vitamin B12 (as Methylcobalamin) Magnesium (from CTM)", amount: "1000", unit: "mcg" },
      { id: "protein-section-amino", name: "Example Mass Gainer", ingredient: "PROTEIN Valine", amount: "2950", unit: "mg" },
      { id: "protein-section-leucine", name: "Example Whey Protein", ingredient: "PROTEIN Leucine", amount: "2982", unit: "mg" },
      { id: "complex-section-amino", name: "Example Mass Gainer", ingredient: "COMPLEX Lysine", amount: "4427", unit: "mg" },
      { id: "carbs-section-amino", name: "Example Mass Gainer", ingredient: "CARBS Methionine", amount: "1288", unit: "mg" },
      { id: "carbs-section-histidine", name: "Example Whey Protein", ingredient: "CARBS Histidine", amount: "444", unit: "mg" },
      { id: "no-section-token", name: "Example Whey Protein", ingredient: "NO", amount: "5", unit: "g" },
      { id: "net-qty", name: "Example Herbal Tonic", ingredient: "Net Qty", amount: "450", unit: "ml" },
      { id: "amount-as-name", name: "Example Glucosamine Sulfate", ingredient: "84 mg", amount: "84", unit: "mg" },
      { id: "age-column-or-more", name: "Example Children's Multi", ingredient: "4 or More", amount: "2", unit: "g" },
      { id: "protein-iron-merge", name: "Example Matcha Collagen", ingredient: "Protein Iron", amount: "0.5", unit: "mg" },
      { id: "spanish-nutrient-header", name: "Example Creatine", ingredient: "APORTE DE NUTRIENTES", amount: "100", unit: "g" },
      { id: "generic-fruit-extract", name: "Example Indole-3-Carbinol", ingredient: "Fruit Extract", amount: "5", unit: "mg" },
      { id: "approx-token", name: "Example Herbal Resistance", ingredient: "Approx.", amount: "500", unit: "mg" },
      { id: "sup-token", name: "Example Women's Multi", ingredient: "SUp", amount: "2.4", unit: "mcg" },
      { id: "calcium-iron-merge", name: "Example Pea Protein", ingredient: "Calcium Iron", amount: "15", unit: "mg" },
      { id: "riboflavin-niacin-merge", name: "Example B Complex", ingredient: "Riboflavin Niacin", amount: "20", unit: "mg" },
      { id: "vitamin-e-thiamin-merge", name: "Example Multi-Nutrient", ingredient: "Vitamin E (as d-alpha tocopheryl succinate) Thiamin (vitamin B1)", amount: "67", unit: "mg", factsText: "" },
      { id: "biotin-pantothenic-merge", name: "Example Multi-Nutrient", ingredient: "Biotin Pantothenic Acid (as calcium pantothenate)", amount: "100", unit: "mcg", factsText: "" },
      { id: "choline-calcium-merge", name: "Example Multi-Nutrient", ingredient: "Choline (as bitartrate) Calcium (as amino acid chelate/complex)", amount: "42", unit: "mg", factsText: "" },
      { id: "paba-inositol-merge", name: "Example Multi-Nutrient", ingredient: "PABA (para-aminobenzoic acid) Inositol", amount: "100", unit: "mg", factsText: "" },
      { id: "iron-potassium-merge", name: "Example Trace Minerals", ingredient: "Iron (from CMC) Potassium (from CMC)", amount: "0.25", unit: "mg", factsText: "" },
      { id: "pantothenic-calcium-merge", name: "Example Pantothenic Acid", ingredient: "Pantothenic Acid (from Calcium d-Pantothenate) Calcium (from Calcium d-Pantothenate)", amount: "500", unit: "mg", factsText: "" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: row.amount, unit: row.unit }],
          servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
          factsText: "factsText" in row ? row.factsText : `Supplement Facts Serving Size 1 scoop ${row.ingredient} ${row.amount} ${row.unit}`,
        },
      });

      assert.ok(preview.parserBlockers.length > 0, row.id);
      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.equal(preview.productionCandidate, null, row.id);
    }
  });

  test("repair preview blocks implausible micronutrient amount units", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:b12-unit-ocr",
      dataOriginId: "example-brand:b12-unit-ocr",
      dataOriginUrl: "https://example.test/products/b12-unit-ocr",
      name: "Example Vitamin B-12",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "b12-unit-ocr",
        ingredientRows: [{ name: "Vitamin B12 (as Methylcobalamin)", amount: "5000", unit: "mg" }],
        servingSizes: [{ text: "1 lozenge", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 lozenge Vitamin B12 5000 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks percent units in ingredient rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:percent-unit",
      dataOriginId: "example-brand:percent-unit",
      dataOriginUrl: "https://example.test/products/percent-unit",
      name: "Example Biotin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "percent-unit",
        ingredientRows: [{ name: "Biotin: 1,000ug", amount: "2000", unit: "%" }],
        servingSizes: [{ text: "1 tablet", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 tablet Biotin 2000%",
      },
    });

    assert.ok(preview.parserBlockers.includes("invalid_existing_ingredient_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks implausible micronutrient mass units", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:implausible-mass-units",
      dataOriginId: "example-brand:implausible-mass-units",
      dataOriginUrl: "https://example.test/products/implausible-mass-units",
      name: "Example Greens",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "implausible-mass-units",
        ingredientRows: [
          { name: "Vitamin E", amount: "2.3", unit: "g" },
          { name: "Thiamin", amount: "1", unit: "g" },
          { name: "Iodine", amount: "30000", unit: "mcg" },
          { name: "Sélénium", amount: "110", unit: "mg" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Vitamin E 2.3 g Iodine 30000 mcg Sélénium 110 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks implausibly huge milligram active amounts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:inulin-container-amount",
      dataOriginId: "example-brand:inulin-container-amount",
      dataOriginUrl: "https://example.test/products/inulin-container-amount",
      name: "Example Inulin Powder 200g",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "inulin-container-amount",
        ingredientRows: [{ name: "Inulin (from Chicory Root)", amount: "225000", unit: "mg" }],
        servingSizes: [{ text: "1 teaspoon", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 teaspoon Inulin 225000 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks less-than gram vitamin OCR artifacts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:less-than-gram-vitamin",
      dataOriginId: "example-brand:less-than-gram-vitamin",
      dataOriginUrl: "https://example.test/products/less-than-gram-vitamin",
      name: "Example Vitamin D",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "less-than-gram-vitamin",
        ingredientRows: [{ name: "Vitamin D", amount: "<1", unit: "g" }],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Vitamin D <1 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks implausible high gram elemental calcium", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:electrolyte-calcium-ocr",
      dataOriginId: "example-brand:electrolyte-calcium-ocr",
      dataOriginUrl: "https://example.test/products/electrolyte-calcium-ocr",
      name: "Example Electrolytes Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "electrolyte-calcium-ocr",
        ingredientRows: [
          { name: "Sodium", amount: "330", unit: "mg" },
          { name: "Calcium", amount: "7", unit: "g" },
          { name: "Potassium", amount: "285", unit: "mg" },
        ],
        servingSizes: [{ text: "1 stick", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 stick Sodium 330 mg Calcium 7 g Potassium 285 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks implausible swapped nutrition units", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:collagen-creamer-ocr",
      dataOriginId: "example-brand:collagen-creamer-ocr",
      dataOriginUrl: "https://example.test/products/collagen-creamer-ocr",
      name: "Example Collagen Creamer",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "collagen-creamer-ocr",
        ingredientRows: [
          { name: "Sodium", amount: "5", unit: "g" },
          { name: "Protein", amount: "35", unit: "mg" },
          { name: "Hydrolyzed Collagen", amount: "6", unit: "g" },
        ],
        servingSizes: [{ text: "2 scoops", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 2 scoops Sodium 5 g Protein 35 mg Hydrolyzed Collagen 6 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks malformed and zero active amounts", () => {
    for (const row of [
      { id: "x-amount", name: "Example Pre-Workout", ingredient: "Beta Alanine", amount: "1649 x 32", unit: "g" },
      { id: "slash-amount", name: "Example Heart Formula", ingredient: "Folate", amount: "06/", unit: "mcg" },
      { id: "zero-active", name: "Example Fiber Blend", ingredient: "Proprietary Prebiotic Fiber Blend", amount: "0", unit: "g" },
      { id: "amino-serving-amount", name: "Example Amino Profile", ingredient: "Isoleucine", amount: "22", unit: "g" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: row.amount, unit: row.unit }],
          servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
          factsText: `Supplement Facts Serving Size 1 scoop ${row.ingredient} ${row.amount} ${row.unit}`,
        },
      });

      assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"), row.id);
      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.equal(preview.productionCandidate, null, row.id);
    }
  });

  test("repair preview blocks implausible gram trace minerals", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:chromium-gram-ocr",
      dataOriginId: "example-brand:chromium-gram-ocr",
      dataOriginUrl: "https://example.test/products/chromium-gram-ocr",
      name: "Example Carb Blocker",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "chromium-gram-ocr",
        ingredientRows: [{ name: "Chromium", amount: "1", unit: "g" }],
        servingSizes: [{ text: "2 softgels", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 softgels Chromium 1 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks vitamin D3 retained as milligrams", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:d3-milligram-artifact",
      dataOriginId: "example-brand:d3-milligram-artifact",
      dataOriginUrl: "https://example.test/products/d3-milligram-artifact",
      name: "Example K2 + D3",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "d3-milligram-artifact",
        ingredientRows: [{ name: "Vitamin D3 (as cholecalciferol)", amount: "125 (5,000 IU)", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Vitamin D3 125 mcg (5,000 IU)",
      },
    });

    assert.ok(preview.parserBlockers.includes("implausible_parsed_ingredient_amount"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks conflicting duplicate ingredient rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:conflicting-fish-oil",
      dataOriginId: "example-brand:conflicting-fish-oil",
      dataOriginUrl: "https://example.test/products/conflicting-fish-oil",
      name: "Example Fish Oil",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "conflicting-fish-oil",
        ingredientRows: [
          { name: "EPA (Eicosapentaenoic Acid)", amount: "1.25", unit: "g", source: "factsText_table" },
          { name: "EPA (Eicosapentaenoic Acid)", amount: "450", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 softgel", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 softgel EPA 450 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("conflicting_duplicate_ingredient_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview drops zero-value inactive nutrition rows from parsed facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:protein-zero-vitamin-d",
      dataOriginId: "example-brand:protein-zero-vitamin-d",
      dataOriginUrl: "https://example.test/products/protein-zero-vitamin-d",
      name: "Example Protein Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "protein-zero-vitamin-d",
        factsText: [
          "Nutrition Facts Serving Size 2 scoops",
          "Amount Per Serving Protein 20 g Total Sugar 0 g Includes Added Sugar 0 g Vitamin D 0 mg",
        ].join(" "),
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(preview.productionCandidate?.label.ingredientRows, [
      { name: "Protein", amount: "20", unit: "g", source: "factsText" },
    ]);
  });

  test("repair preview blocks coconut oil food-like rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:liquid-coconut-oil",
      dataOriginId: "example-brand:liquid-coconut-oil",
      dataOriginUrl: "https://example.test/products/liquid-coconut-oil",
      name: "Liquid Coconut Oil",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "liquid-coconut-oil",
        ingredientRows: [{ name: "Saturated Fat", amount: "14", unit: "g", source: "factsText_table" }],
        servingSizes: [{ text: "1 tablespoon", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 1 tablespoon Saturated Fat 14 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_food_or_non_supplement"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks ready-to-drink energy beverage rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:sparkling-energy",
      dataOriginId: "example-brand:sparkling-energy",
      dataOriginUrl: "https://example.test/products/sparkling-energy-drink",
      name: "Example Sparkling Energy Drink - 12 Cans",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "sparkling-energy",
        ingredientRows: [{ name: "Caffeine Content", amount: "200", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "12 fl. oz", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 12 fl. oz Caffeine Content 200 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_food_or_non_supplement"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks loose leaf tea food-like rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:loose-leaf-tea",
      dataOriginId: "example-brand:loose-leaf-tea",
      dataOriginUrl: "https://example.test/products/tulsi-sweet-rose-canister",
      name: "Tulsi Sweet Rose Loose Leaf Tea Canister",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "loose-leaf-tea",
        ingredientRows: [{ name: "Proprietary Organic Blend", amount: "20", unit: "g", source: "factsText_table" }],
        servingSizes: [{ text: "1 tsp (2 g)", source: "official_facts_table" }],
        factsText: "Nutrition Facts Serving Size 1 tsp Proprietary Organic Blend 20 g",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_food_or_non_supplement"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks sampled grocery and beverage-like nutrition rows", () => {
    for (const row of [
      { id: "goji-berries", name: "Goji Berries - 16 oz", ingredient: "Vitamin A", amount: "1282", unit: "mcg" },
      { id: "mycobrew", name: "MycoBrew Mocha - 10 Packets", ingredient: "Protein", amount: "2", unit: "g" },
      { id: "ground-coffee", name: "The High Achiever Ground Coffee", ingredient: "Vitamin B12", amount: "24", unit: "mcg" },
      { id: "matcha-latte", name: "Matcha Latte - 11.1oz", ingredient: "Calcium", amount: "130", unit: "mg" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: row.amount, unit: row.unit, source: "factsText_table" }],
          servingSizes: [{ text: "1 serving", source: "official_facts_table" }],
          factsText: `Nutrition Facts Serving Size 1 serving ${row.ingredient} ${row.amount} ${row.unit}`,
        },
      });

      assert.ok(preview.parserBlockers.includes("likely_food_or_non_supplement"), row.id);
      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.equal(preview.productionCandidate, null, row.id);
    }
  });

  test("repair preview keeps supplement-style latte rows with active collagen", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:matcha-collagen-latte",
      dataOriginId: "example-brand:matcha-collagen-latte",
      dataOriginUrl: "https://example.test/products/matcha-collagen-latte",
      name: "Example Matcha Collagen Latte",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "matcha-collagen-latte",
        ingredientRows: [
          { name: "Hydrolyzed Collagen", amount: "10", unit: "g" },
          { name: "MCT Powder", amount: "1", unit: "g" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Hydrolyzed Collagen 10 g MCT Powder 1 g",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.equal(preview.parserBlockers.includes("likely_food_or_non_supplement"), false);
  });

  test("repair preview blocks underparsed facts panels from non-OCR sources", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:glucose-regulation-ocr-scramble",
      dataOriginId: "example-brand:glucose-regulation-ocr-scramble",
      dataOriginUrl: "https://example.test/products/glucose-regulation-ocr-scramble",
      name: "Example Glucose Regulation Complex",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "glucose-regulation-ocr-scramble",
        ingredientRows: [{ name: "S5 Zinc (as zinc gluconate)", amount: "5", unit: "mg", source: "factsText_pipe" }],
        servingSizes: [{ text: "2 Capsules", source: "official_facts_table" }],
        factsText: [
          "Supplement Facts Serving Size: 2 Capsules Amount Per Serving % DV",
          "Total Carbohydrate <1g 1% Magnesium 200mg 48%",
          "S5 Zinc (as zinc gluconate) 5mg 4% Chromium 400 mcg 143%",
          "Taurine 500 mg Vanadium 100 mcg Alpha-Lipoic Acid 10 mg Banaba Leaf Extract 18 mg",
        ].join(" "),
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_missing_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks long stacked facts panels that parsed only a few rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:basic-prenatal-stacked-panel",
      dataOriginId: "example-brand:basic-prenatal-stacked-panel",
      dataOriginUrl: "https://example.test/products/basic-prenatal-stacked-panel",
      name: "Example Basic Prenatal",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "basic-prenatal-stacked-panel",
        ingredientRows: [
          { name: "Vitamin A", amount: "1500", unit: "mcg RAE", source: "factsText_table" },
          { name: "Vitamin D", amount: "25", unit: "mcg", source: "factsText_table" },
          { name: "Vitamin K", amount: "90", unit: "mcg", source: "factsText_table" },
          { name: "Vitamin B6", amount: "10", unit: "mg", source: "factsText_table" },
          { name: "Folate", amount: "1000", unit: "mcg DFE", source: "factsText_table" },
          { name: "Vitamin B12", amount: "50", unit: "mcg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "3 Capsules", source: "official_facts_table" }],
        factsText: [
          "Supplement Facts Serving Size: Three Capsules Amount Per Serving % DV",
          "Vitamin A 1500 mcg RAE 167% Vitamin C 150 mg 167% Vitamin D 25 mcg 125% Vitamin E 20 mg 133%",
          "Vitamin K 90 mcg 75% Thiamin 5 mg 417% Riboflavin 5 mg 385% Niacin 20 mg 125%",
          "Vitamin B6 10 mg 588% Folate 1000 mcg DFE 250% Vitamin B12 50 mcg 2083%",
          "Biotin 300 mcg 1000% Pantothenic Acid 10 mg 200% Calcium 100 mg 8% Iron 45 mg 250%",
          "Iodine 150 mcg 100% Magnesium 50 mg 12% Zinc 20 mg 182% Selenium 70 mcg 127% Copper 2 mg 222%",
        ].join(" "),
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_missing_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks short page-body fragments masquerading as facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:omega-product-highlights",
      dataOriginId: "example-brand:omega-product-highlights",
      dataOriginUrl: "https://example.test/products/omega-product-highlights",
      name: "Example Omega Fish Oil",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "omega-product-highlights",
        ingredientRows: [
          { name: "EPA", amount: "360", unit: "mg", source: "factsText_table" },
          { name: "DHA", amount: "160", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Product Highlights: Premium Source Product information: Key Ingredients: Fish Oil 800 mg EPA 360 mg DHA 160 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("page_body_contamination"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks accordion and review page text retained as facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:d-mannose-page-body",
      dataOriginId: "example-brand:d-mannose-page-body",
      dataOriginUrl: "https://example.test/products/d-mannose-page-body",
      name: "Example D-Mannose",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "d-mannose-page-body",
        ingredientRows: [{ name: "D-Mannose", amount: "500", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: [
          "Supplement Facts Filter Plus Icon Filter Minus Icon Directions: take 1 capsule daily.",
          "Supplement Facts Serving Size: 1 capsule D-Mannose 500 mg",
          "Reviews Filter Plus Icon Filter Minus Icon <div class=\"yotpo\" data-product-id=\"123\">",
        ].join(" "),
      },
    });

    assert.ok(preview.parserBlockers.includes("page_body_contamination"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks whole legal/manufacturer label text retained as facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:whole-label-text",
      dataOriginId: "example-brand:whole-label-text",
      dataOriginUrl: "https://example.test/products/whole-label-text",
      name: "Example Calcium Magnesium Zinc",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "whole-label-text",
        ingredientRows: [
          { name: "Calcium", amount: "2084", unit: "mg", source: "factsText_table" },
          { name: "Magnesium", amount: "91.5", unit: "mg", source: "factsText_table" },
          { name: "Zinc", amount: "94.2", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "2 tablets", source: "official_facts_table" }],
        factsText: [
          "NOT FOR MEDICINAL USE. Non-standard size under the Legal Metrology Rule.",
          "Manufactured By: Example Wellness. Lic. No.: 123456.",
          "Recommended duration of use: as suggested by your healthcare professional.",
          "Supplement Facts Serving Size 2 tablets Calcium 2084 mg Magnesium 91.5 mg Zinc 94.2 mg",
        ].join(" "),
      },
    });

    assert.ok(preview.parserBlockers.includes("page_body_contamination"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks missing prominent rows in pipe-delimited facts tables", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:pipe-table-mineral",
      dataOriginId: "example-brand:pipe-table-mineral",
      dataOriginUrl: "https://example.test/products/pipe-table-mineral",
      name: "Example Mineral Formula",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "pipe-table-mineral",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop Amount Per Serving | % Daily Value Magnesium | 200 mg | 48% Potassium | 280 mg | 6%",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview treats OCR lodine as a required iodine row", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:trace-minerals-ocr",
      dataOriginId: "example-brand:trace-minerals-ocr",
      dataOriginUrl: "https://example.test/products/trace-minerals-ocr",
      name: "Example Trace Minerals",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "trace-minerals-ocr",
        ingredientRows: [{ name: "Zinc", amount: "30", unit: "mg", source: "factsText_table" }],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Capsule Amount Per Serving lodine (as potassium iodide) 250 mcg 167% Zinc 30 mg 273%",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks missing DHA from omega facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:omega-missing-dha",
      dataOriginId: "example-brand:omega-missing-dha",
      dataOriginUrl: "https://example.test/products/omega-missing-dha",
      name: "Example Omega Fish Krill Oil",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "omega-missing-dha",
        ingredientRows: [
          { name: "Total Omega 3 Fatty Acids", amount: "680", unit: "mg", source: "factsText_table" },
          { name: "EPA (Eicosapentaenoic Acid)", amount: "360", unit: "mg", source: "factsText_table" },
          { name: "Other Omega-3 Fatty Acids", amount: "50", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "2 softgels", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Softgels Fish and Krill Oil Providing 1000 mg Total Omega 3 Fatty Acids 680 mg EPA (Eicosapentaenoic Acid) 360 mg DHA (Docosahexaenoic Acid) 270 mg Other Omega-3 Fatty Acids 50 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks missing visible active rows from dense botanical facts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:phytocore-active-gap",
      dataOriginId: "example-brand:phytocore-active-gap",
      dataOriginUrl: "https://example.test/products/phytocore-active-gap",
      name: "Example PhytoCore",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "phytocore-active-gap",
        ingredientRows: [
          { name: "Choline", amount: "72", unit: "mg", source: "factsText_table" },
          { name: "Dandelion Root Extract", amount: "225", unit: "mg", source: "factsText_table" },
          { name: "Artichoke Leaf Extract", amount: "145", unit: "mg", source: "factsText_table" },
          { name: "L-Methionine USP", amount: "140", unit: "mg", source: "factsText_table" },
          { name: "Milk Thistle Seed Extract", amount: "130", unit: "mg", source: "factsText_table" },
          { name: "Turmeric Root Extract", amount: "100", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "3 capsules", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 3 Capsules Choline 72 mg Dandelion Root Extract 225 mg Artichoke Leaf Extract 145 mg Inositol NF 140 mg L-Methionine USP 140 mg Milk Thistle Seed Extract 130 mg Garlic Bulb 100 mg Turmeric Root Extract 100 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks merged prominent nutrient names with missing rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:merged-potassium-iron",
      dataOriginId: "example-brand:merged-potassium-iron",
      dataOriginUrl: "https://example.test/products/merged-potassium-iron",
      name: "Example Vegan Protein",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "merged-potassium-iron",
        ingredientRows: [
          { name: "Protein", amount: "21", unit: "g", source: "factsText_table" },
          { name: "Iron", amount: "1.3", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Nutrition Facts 56 servings per container SUGGESTED USE Mix 1 scoop with water. Amount Per Serving Protein 21g Potassium Iron 1.3mg 200mg 8% 4%",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks single-serving multi-audience facts tables", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:kids-liquid-multi",
      dataOriginId: "example-brand:kids-liquid-multi",
      dataOriginUrl: "https://example.test/products/kids-liquid-multi",
      name: "Example Children's Multivitamin Liquid",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "kids-liquid-multi",
        ingredientRows: [
          { name: "Vitamin A", amount: "1500", unit: "mcg RAE", source: "factsText_table" },
          { name: "Vitamin D", amount: "12.5", unit: "mcg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 Tablespoon", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Tablespoon % Daily Value Children 1-3 Years Adults and Children ≥4 Years Vitamin A 1500 mcg RAE 500% 167% Vitamin D 12.5 mcg 83% 63%",
      },
    });

    assert.ok(preview.parserBlockers.includes("multi_audience_serving_sizes"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks visible blend rows that were not normalized", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:complex-formula",
      dataOriginId: "example-brand:complex-formula",
      dataOriginUrl: "https://example.test/products/complex-formula",
      name: "Example Complex Formula",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "complex-formula",
        ingredientRows: [{ name: "Vitamin B12", amount: "5", unit: "mcg", source: "factsText_table" }],
        servingSizes: [{ text: "2 capsules", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Capsules Vitamin B12 5 mcg Example Weight Loss Plus Blend 604 mg Robusta coffee extract 200 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks visible blend constituents that are absent from normalized rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:hydration-blend",
      dataOriginId: "example-brand:hydration-blend",
      dataOriginUrl: "https://example.test/products/hydration-blend",
      name: "Example Electrolyte",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "hydration-blend",
        ingredientRows: [
          { name: "Hydration blend", amount: "1.6", unit: "g", source: "factsText_table" },
          { name: "Sodium", amount: "150", unit: "mg", source: "factsText_table" },
          { name: "Potassium", amount: "500", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Scoop Sodium 150 mg Potassium 500 mg Hydration blend: 1.6 g Creatine (as creatine monohydrate), Taurine, PEAK ATP Adenosine 5'-Triphosphate",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_blend_constituents"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks long proprietary blend constituent text without normalized components", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:long-proprietary-blend",
      dataOriginId: "example-brand:long-proprietary-blend",
      dataOriginUrl: "https://example.test/products/long-proprietary-blend",
      name: "Example Immune Blend",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "long-proprietary-blend",
        ingredientRows: [
          { name: "Vitamin C", amount: "150", unit: "mg", source: "factsText_table" },
          { name: "Proprietary Blend", amount: "430", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "2 capsules", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Capsules Vitamin C 150 mg Proprietary Blend: 430 mg Ribonucleic Acid (from yeast) Maitake Mushroom (Grifola frondosa) (aerial part). Chrysanthemum (flower) extract, Loquat leaf extract, Thyme leaf extract, Mullein leaf extract, Oregon Grape root extract",
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_blend_constituents"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks amount-dense panels with too few normalized rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:healthy-aging-powder",
      dataOriginId: "example-brand:healthy-aging-powder",
      dataOriginUrl: "https://example.test/products/healthy-aging-powder",
      name: "Example Healthy Aging Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "healthy-aging-powder",
        ingredientRows: [
          { name: "Taurine", amount: "5000", unit: "mg", source: "factsText_table" },
          { name: "Lithium", amount: "2000", unit: "mcg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "1 scoop", source: "official_facts_table" }],
        factsText: "Serving Size 1 scoop (Approx. 7 g) Amount Per Serving Taurine 5000 mg Wheat germ extract 1500 mg Spermidine 5 mg Lithium 2000 mcg",
      },
    });

    assert.ok(preview.parserBlockers.includes("likely_missing_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks candidates that lose visible vitamin rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:elderberry-vitamin-c-scramble",
      dataOriginId: "example-brand:elderberry-vitamin-c-scramble",
      dataOriginUrl: "https://example.test/products/elderberry-vitamin-c-scramble",
      name: "Example Elderberry Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "elderberry-vitamin-c-scramble",
        ingredientRows: [
          { name: "Zinc", amount: "3.75", unit: "mg", source: "factsText_table" },
          { name: "Sodium", amount: "20", unit: "mg", source: "factsText_table" },
          { name: "Elderberry Extract", amount: "50", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [{ text: "2 Gummies", source: "official_facts_table" }],
        factsText: [
          "Supplement Facts Serving Size: 2 Gummies Amount Per Serving % DV",
          "Vitamin C (as ascorbic acid) Includes Added Sugars 4g 8%",
          "Zinc 3.75mg 45mg 50% Sodium 20mg <1% Elderberry Extract 50mg",
        ].join(" "),
      },
    });

    assert.ok(preview.parserBlockers.includes("missing_prominent_facts_rows"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks multipack supplement rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:p3-health-essentials",
      dataOriginId: "example-brand:p3-health-essentials",
      dataOriginUrl: "https://example.test/products/p3-health-essentials",
      name: "P3 - Health Essentials Sachets (O3, M3, D3)",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "p3-health-essentials",
        ingredientRows: [
          { name: "Vitamin D3", amount: "25", unit: "mcg", source: "factsText_table" },
          { name: "Magnesium", amount: "100", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [
          { text: "4 softgels", source: "factsText" },
          { text: "3 capsules", source: "factsText" },
        ],
        factsText: "Supplement Facts Serving Size 1 multi-pack (4 softgels & 3 capsules) Vitamin D3 25 mcg Magnesium 100 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("non_standalone_product"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks multiple supplement-facts panels in one product row", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:multi-panel-formula",
      dataOriginId: "example-brand:multi-panel-formula",
      dataOriginUrl: "https://example.test/products/multi-panel-formula",
      name: "Example Master Formula",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "multi-panel-formula",
        ingredientRows: [
          { name: "Vitamin D3", amount: "10", unit: "mcg", source: "factsText_table" },
          { name: "Vitamin A", amount: "1350", unit: "mcg RAE", source: "factsText_table" },
          { name: "Vitamin C", amount: "61", unit: "mg", source: "factsText_table" },
        ],
        servingSizes: [
          { text: "1 Veggie Capsule", source: "factsText" },
          { text: "2 Veggie Capsules", source: "factsText" },
          { text: "1 Caplet", source: "factsText" },
        ],
        factsText: [
          "Liquid Vitamin Capsule - Supplement Facts Serving Size 1 Veggie Capsule Vitamin D3 10 mcg",
          "Micronized Nutrient Capsule - Supplement Facts Serving Size 2 Veggie Capsules Vitamin A 1350 mcg RAE",
          "Phyto-Caplet - Supplement Facts Serving Size 1 Caplet Vitamin C 61 mg",
        ].join("\n"),
      },
    });

    assert.ok(preview.parserBlockers.includes("multi_panel_facts"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview normalizes retained serving size objects", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:serving-size-object",
      dataOriginId: "example-brand:serving-size-object",
      dataOriginUrl: "https://example.test/products/serving-size-object",
      name: "Example Biotin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "serving-size-object",
        ingredientRows: [{ name: "Biotin", amount: "5000", unit: "mcg" }],
        servingSizes: [{ servingSize: "1 tablet", servingsPerContainer: 60 }],
        factsText: "Supplement Facts Serving Size 1 tablet Biotin 5000 mcg",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(preview.productionCandidate?.label?.servingSizes, [
      { text: "1 tablet", source: "existing_serving_size" },
    ]);
  });

  test("repair preview dedupes retained existing ingredient rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:duplicate-existing-rows",
      dataOriginId: "example-brand:duplicate-existing-rows",
      dataOriginUrl: "https://example.test/products/duplicate-existing-rows",
      name: "Example Magnesium",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "duplicate-existing-rows",
        ingredientRows: [
          { name: "Magnesium", amount: "100", unit: "mg" },
          { name: "Magnesium", amount: "100", unit: "mg" },
        ],
        servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 capsule Magnesium 100 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(preview.productionCandidate?.label.ingredientRows, [
      { name: "Magnesium", amount: "100", unit: "mg" },
    ]);
  });

  test("repair preview dedupes retained rows that only differ by daily value", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:duplicate-dv-existing-rows",
      dataOriginId: "example-brand:duplicate-dv-existing-rows",
      dataOriginUrl: "https://example.test/products/duplicate-dv-existing-rows",
      name: "Example Magnesium Glycinate",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "duplicate-dv-existing-rows",
        ingredientRows: [
          { name: "Dietary Fiber", amount: "1", unit: "g", dailyValue: "<1%*" },
          { name: "Dietary Fiber", amount: "1", unit: "g", dailyValue: "4%*" },
          { name: "Magnesium", amount: "200", unit: "mg", dailyValue: "48%" },
        ],
        servingSizes: [{ text: "2 tablets", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 tablets Total Carbohydrate 1 g <1% Dietary Fiber 1 g 4% Magnesium 200 mg 48%",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(preview.productionCandidate?.label.ingredientRows, [
      { name: "Dietary Fiber", amount: "1", unit: "g", dailyValue: "4%*" },
      { name: "Magnesium", amount: "200", unit: "mg", dailyValue: "48%" },
    ]);
  });

  test("repair preview blocks products whose promised active is missing from parsed rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:bcaa-watermelon",
      dataOriginId: "example-brand:bcaa-watermelon",
      dataOriginUrl: "https://example.test/products/bcaa-watermelon",
      name: "Example BCAA Powder - Watermelon",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "bcaa-watermelon",
        ingredientRows: [{ name: "Protein", amount: "1", unit: "g" }],
        servingSizes: [{ text: "1 scoop (9 g)", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 scoop (9 g) Protein 1 g",
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.ok(preview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks probiotic and omega products whose active is missing", () => {
    const probioticPreview = repairPreviewForRow({
      id: "example-brand:probiotic-gummies",
      dataOriginId: "example-brand:probiotic-gummies",
      dataOriginUrl: "https://example.test/products/probiotic-gummies",
      name: "Example Probiotic Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "probiotic-gummies",
        ingredientRows: [{ name: "Sugars", amount: "4", unit: "g" }],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Sugars 4 g",
      },
    });

    const omegaPreview = repairPreviewForRow({
      id: "example-brand:omega-gummies",
      dataOriginId: "example-brand:omega-gummies",
      dataOriginUrl: "https://example.test/products/omega-gummies",
      name: "Example Veg Omega-3 Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "omega-gummies",
        ingredientRows: [{ name: "Vitamin C", amount: "90", unit: "mg" }],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Vitamin C 90 mg",
      },
    });

    assert.ok(probioticPreview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(probioticPreview.automatedBackfillReady, false);
    assert.equal(probioticPreview.productionCandidate, null);
    assert.ok(omegaPreview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(omegaPreview.automatedBackfillReady, false);
    assert.equal(omegaPreview.productionCandidate, null);
  });

  test("repair preview blocks vitamin and multivitamin products with missing title actives", () => {
    const vitaminCPreview = repairPreviewForRow({
      id: "example-brand:vitamin-c-gummies",
      dataOriginId: "example-brand:vitamin-c-gummies",
      dataOriginUrl: "https://example.test/products/vitamin-c-gummies",
      name: "Example Vitamin C Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "vitamin-c-gummies",
        ingredientRows: [{ name: "Proprietary Blend", amount: "25", unit: "mg" }],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Proprietary Blend 25 mg",
      },
    });

    const prenatalPreview = repairPreviewForRow({
      id: "example-brand:prenatal-multivitamin",
      dataOriginId: "example-brand:prenatal-multivitamin",
      dataOriginUrl: "https://example.test/products/prenatal-multivitamin",
      name: "Example Prenatal Multivitamin Gummies",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "prenatal-multivitamin",
        ingredientRows: [{ name: "Zinc", amount: "10", unit: "mg" }],
        servingSizes: [{ text: "2 gummies", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 gummies Zinc 10 mg",
      },
    });

    assert.ok(vitaminCPreview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(vitaminCPreview.automatedBackfillReady, false);
    assert.equal(vitaminCPreview.productionCandidate, null);
    assert.ok(prenatalPreview.parserBlockers.includes("likely_missing_product_active"));
    assert.equal(prenatalPreview.automatedBackfillReady, false);
    assert.equal(prenatalPreview.productionCandidate, null);
  });

  test("repair preview blocks age-split multi-audience facts panels", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:kids-multi-age-split",
      dataOriginId: "example-brand:kids-multi-age-split",
      dataOriginUrl: "https://example.test/products/kids-multi-age-split",
      name: "Example Kids Multivitamin",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "kids-multi-age-split",
        ingredientRows: [
          { name: "Vitamin A", amount: "750", unit: "mcg" },
          { name: "Vitamin C", amount: "250", unit: "mg" },
          { name: "Vitamin D", amount: "10", unit: "mcg" },
          { name: "Vitamin E", amount: "6.75", unit: "mg" },
          { name: "Thiamin", amount: "1.05", unit: "mg" },
          { name: "Riboflavin", amount: "1.2", unit: "mg" },
        ],
        servingSizes: [
          { text: "1 Chewable Tablet (2-3 Yrs.)", source: "official_facts_table" },
          { text: "1 Chewable Tablet (4 & Up)", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 Chewable Tablet (2-3 Yrs.) 1 Chewable Tablet (4 & Up) Vitamin A 750 mcg Vitamin C 250 mg",
      },
    });

    assert.ok(preview.parserBlockers.includes("multi_audience_serving_sizes"));
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair preview blocks additional missing title actives", () => {
    for (const row of [
      { id: "garlic-oil", name: "Example Garlic Oil", ingredient: "Parsley Seed Oil" },
      { id: "alpha-lipoic", name: "Example R-Alpha Lipoic Acid", ingredient: "Biotin" },
      { id: "berberine", name: "Example Berberine Breakthrough", ingredient: "Biotin" },
      { id: "iodine", name: "Example Ionic Iodine", ingredient: "ConcenTrace" },
      { id: "elderberry-tea", name: "Example Elderberry Tea", ingredient: "Sodium" },
      { id: "relora", name: "Example Relora", ingredient: "Calcium" },
      { id: "psyllium", name: "Example Psyllium Husk Powder", ingredient: "Iron" },
      { id: "mushroom", name: "Example Mushroom Complex Gummies", ingredient: "Herbal Equivalent" },
      { id: "amino-energy", name: "Example Essential Amin.O. Energy", ingredient: "Green Tea Leaf Extract" },
      { id: "lactoferrin", name: "Example Lactoferrin with Propolis", ingredient: "Concentrated Bee Propolis Extract" },
      { id: "zeaxanthin", name: "Example Ultra Zeaxanthin", ingredient: "Spinach Leaf" },
      { id: "hyaluronic", name: "Example Hyaluronic Acid Complex with Collagen", ingredient: "Collagen Peptides" },
      { id: "curamed", name: "Example CuraMed 750 mg", ingredient: "Proprietary Complex" },
      { id: "calcium-d3", name: "Example Calcium 600 mg with Vitamin D3", ingredient: "Vitamin D3" },
      { id: "hydration-drink", name: "Example Instant Hydration Drink", ingredient: "Vitamin C" },
      { id: "b-complex", name: "Example B-Complex #12", ingredient: "Riboflavin" },
      { id: "black-seed-oil", name: "Example Black Seed Oil with Vitamin D3", ingredient: "Vitamin D3" },
      { id: "sea-moss", name: "Example Beetroot + Sea Moss", ingredient: "Beet Root" },
      { id: "protein", name: "Example Essential Protein", ingredient: "Calcium" },
      { id: "pre-workout", name: "Example Essential Performance Pre-Workout", ingredient: "Magnesium" },
      { id: "cfu-probiotic", name: "Example Men's Probiotics 100 Billion CFU", ingredient: "Probiotic Blend" },
      { id: "complete-e", name: "Example Complete E", ingredient: "Coenzyme Q10" },
      { id: "underparsed-multivitamin", name: "Example Minis Adult 50+ Multivitamins", ingredient: "Vitamin C" },
      { id: "mct-oil", name: "Example MCT Oil", ingredient: "Acid Triglycerides" },
      { id: "phosphatidylserine", name: "Example PS Phosphatidylserine", ingredient: "Phosphatidylethanolamine" },
      { id: "d-mannose", name: "Example Cranberry with D-Mannose", ingredient: "Cranberry Extract" },
      { id: "glucosamine-chondroitin", name: "Example Glucosamine + Chondroitin", ingredient: "Vitamin C" },
      { id: "melatonin-magnesium", name: "Example Melatonin with Magnesium", ingredient: "Melatonin" },
      { id: "protein-creatine", name: "Example Protein + Creatine", ingredient: "Protein" },
      { id: "vitamin-c-elderberry", name: "Example Vitamin C + Elderberry", ingredient: "Vitamin C" },
      { id: "magnesium-ashwagandha", name: "Example Magnesium + Ashwagandha", ingredient: "Magnesium" },
      { id: "probiotic-elderberry", name: "Example Probiotic Elderberry", ingredient: "Lactobacillus rhamnosus" },
      { id: "hydration-creatine", name: "Example Hydration + Creatine", ingredient: "Electrolyte Blend" },
      { id: "reacta-c-elderberry", name: "Example Reacta-C & Elderberry", ingredient: "Calcium Ascorbate" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: "10", unit: "mg" }],
          servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
          factsText: `Supplement Facts Serving Size 1 capsule ${row.ingredient} 10 mg`,
        },
      });

      assert.ok(preview.parserBlockers.includes("likely_missing_product_active"), row.id);
      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.equal(preview.productionCandidate, null, row.id);
    }
  });

  test("repair preview normalizes title-active matching before blocking", () => {
    for (const row of [
      { id: "d-mannose", name: "D-מאנוז", ingredient: "D - Mannose" },
      { id: "magnesium", name: "Magnésium bisglycinate", ingredient: "Magnésium" },
      { id: "ashwagandha", name: "Ashwagandha", ingredient: "Withania somnifera (ashwaganda) extract" },
      { id: "cranberry", name: "Cranberry Extract", ingredient: "Vaccinium macrocarpon extract" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: "10", unit: "mg" }],
          servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
          factsText: `Supplement Facts Serving Size 1 capsule ${row.ingredient} 10 mg`,
        },
      });

      assert.equal(preview.parserBlockers.includes("likely_missing_product_active"), false, row.id);
      assert.equal(preview.automatedBackfillReady, true, row.id);
    }
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

  test("repair preview cleans safe sampled OCR prefixes", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:resveratrol-prefix",
      dataOriginId: "example-brand:resveratrol-prefix",
      dataOriginUrl: "https://example.test/products/resveratrol-prefix",
      name: "Example Resveratrol Capsules",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "resveratrol-prefix",
        ingredientRows: [
          { name: "Serving %** Polygonum cuspidatum Extract", amount: "1000", unit: "mg" },
          { name: "T urmeric Extract", amount: "35", unit: "mg" },
          { name: "ORGANIC Milligrams Organic Black Maca Root", amount: "500", unit: "mg" },
          { name: "Caffeine anhydrous; supplying", amount: "265", unit: "mg" },
          { name: "KRILL OIL++", amount: "500", unit: "mg" },
          { name: "ASTAXANTHIN++++ ++", amount: "25", unit: "mcg" },
        ],
        servingSizes: [{ text: "2 Capsules", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Capsules Serving %** Polygonum cuspidatum Extract 1000 mg T urmeric Extract 35 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(productionIngredientRows(preview).map(ingredientRowName), [
      "Polygonum cuspidatum Extract",
      "Turmeric Extract",
      "Organic Black Maca Root",
      "Caffeine anhydrous",
      "KRILL OIL",
      "ASTAXANTHIN",
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
      id: "example-brand:liquid-caffeine-serving-column",
      dataOriginId: "example-brand:liquid-caffeine-serving-column",
      dataOriginUrl: "https://example.test/products/liquid-caffeine-serving-column",
      name: "Example Liquid Caffeine Supplement",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "liquid-caffeine-serving-column",
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
    for (const row of [
      { id: "chunky-flavour", name: "Chunky Flavour - Fudge Brownie", ingredient: "Erythritol", amount: "2", unit: "g", serving: "3 g" },
      { id: "energy-gel", name: "Energy Gel - Caffeinated - Caramel Coffee", ingredient: "Maltodextrin", amount: "23.40", unit: "g", serving: "1 sachet (39 g)" },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: [{ name: row.ingredient, amount: row.amount, unit: row.unit }],
          servingSizes: [{ text: row.serving, source: "official_nutrition_table" }],
        },
      });

      assert.equal(preview.parserStatus, "structured_ready", row.id);
      assert.deepEqual(preview.parserBlockers, ["likely_food_or_non_supplement"], row.id);
      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.equal(preview.evidenceRecoveryHint, "not_standalone_supplement_review", row.id);
      assert.deepEqual(preview.removableFieldCandidates, [], row.id);
    }
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
    assert.equal(preview.evidenceRecoveryHint, "official_refetch_page_body");
    assert.equal(preview.parsedIngredientRows, 0);
    assert.deepEqual(preview.parserBlockers, [
      "missing_ingredient_rows",
      "missing_serving_sizes",
      "page_body_contamination",
    ]);
  });

  test("repair preview blocks official-image marketing copy from automated backfill", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:beef-liver",
      dataOriginId: "example-brand:beef-liver",
      dataOriginUrl: "https://example.test/products/beef-liver",
      name: "Example Beef Liver",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "beef-liver",
        ingredientRows: [{ name: "Grassfed Liver", amount: "4,500", unit: "mg" }],
        servingSizes: ["6 Capsules"],
        factsText: [
          "Supplement Facts Serving Size: 6 Capsules Servings Per Container 10",
          "Amount Per Serving Grassfed Liver 4,500 mg *Daily Value not established.",
          "Other Ingredients: Gelatin Capsule.",
          "At Example Brand, it's been our promise to deliver the highest quality vitamins and self-care products.",
          "We put all our products to the test in our cutting-edge laboratory.",
          "Our mission is simple - to provide the best nutritional care.",
          "Supports: Stamina and Endurance Male Performance Product.",
          "Potent and Powerful Formula.",
        ].join(" "),
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.productionCandidate, null);
    assert.match(preview.parserBlockers.join("|"), /page_body_contamination/u);
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

  test("repair preview blocks oversized retained page evidence even with parsed rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:legacy-page",
      dataOriginId: "example-brand:legacy-page",
      dataOriginUrl: "https://example.test/products/legacy-page",
      name: "Example Legacy Page",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "legacy-page",
        servingSize: "2 Capsules",
        factsText: "Supplement Facts Amount Per Serving Magnesium 200 mg 48%",
        ingredientText: "Saved page body ".repeat(500),
        bodyText: "Raw page evidence must stay until refetch/OCR replaces it.",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /oversized_retained_evidence/u);
    assert.deepEqual(preview.removableFieldCandidates, []);
    assert.equal(preview.productionCandidate, null);
  });

  test("repair parser extracts multi-DV prenatal facts rows from OCR text", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:prenatal",
      dataOriginId: "example-brand:prenatal",
      dataOriginUrl: "https://example.test/products/prenatal",
      name: "Example Prenatal",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "prenatal",
        evidenceStatus: "structured_facts_from_official_facts_image_ocr",
        factsText: [
          "Supplement Facts",
          "Serving size 1 Tablet",
          "Amount per serving %DV for adults %DV for pregnant women",
          "Vitamin A (100% as beta-carotene and from ferment media) 770 mcg 86% 59%",
          "Vitamin C (as calcium ascorbate and as ascorbic acid from ferment media) 60 mg 67% 50%",
          "Vitamin D3 (as cholecalciferol and from ferment media) 25 mcg [1000 IU] 125% 167%",
          "Folate (as L-5-methylfolate) 680 mcg DFE 170% 113%",
          "Iron (as ferrous bisglycinate chelate) 20 mg 111% 74%",
          "Zinc (as zinc oxide from ferment media) 5.2 mg 47% 40%",
          "Soothing Digestive Blend 65 mg",
        ].join("\n"),
      },
    });

    assert.equal(preview.parserStatus, "structured_ready");
    assert.deepEqual(preview.parserBlockers, []);
    assert.equal(preview.parsedIngredientRows, 7);
    assert.deepEqual(extractIngredientRowsFromText([
      "Supplement Facts",
      "Serving size 1 Tablet",
      "Amount per serving %DV for adults %DV for pregnant women",
      "Vitamin A (100% as beta-carotene and from ferment media) 770 mcg 86% 59%",
      "Vitamin C (as calcium ascorbate and as ascorbic acid from ferment media) 60 mg 67% 50%",
      "Vitamin D3 (as cholecalciferol and from ferment media) 25 mcg [1000 IU] 125% 167%",
      "Folate (as L-5-methylfolate) 680 mcg DFE 170% 113%",
      "Iron (as ferrous bisglycinate chelate) 20 mg 111% 74%",
      "Zinc (as zinc oxide from ferment media) 5.2 mg 47% 40%",
      "Soothing Digestive Blend 65 mg",
    ].join("\n")).map((row) => row.name), [
      "Vitamin A (100% as beta-carotene and from ferment media)",
      "Vitamin C (as calcium ascorbate and as ascorbic acid from ferment media)",
      "Vitamin D3 (as cholecalciferol and from ferment media)",
      "Folate (as L-5-methylfolate)",
      "Iron (as ferrous bisglycinate chelate)",
      "Zinc (as zinc oxide from ferment media)",
      "Soothing Digestive Blend",
    ]);
  });

  test("repair parser keeps stacked folate rows and rejects bracket-only continuation rows", () => {
    const factsText = [
      "Supplement Facts",
      "Serving Size 1 mL",
      "Servings Per Container 60",
      "Amount Per Serving % Daily Value",
      "Vitamin C",
      "[as Ascorbic Acid (from Acerola Cherry Fruit Extract)] 26 mg 22%",
      "Folate",
      "(from Citrus Lemon Peel Extract) 600 mcg DFE 100%",
    ].join("\n");

    assert.deepEqual(extractIngredientRowsFromText(factsText).map((row) => row.name), [
      "Vitamin C [as Ascorbic Acid (from Acerola Cherry Fruit Extract)]",
      "Folate (from Citrus Lemon Peel Extract)",
    ]);
  });

  test("repair parser extracts hydrate minerals instead of mineral-source components", () => {
    const rows = extractIngredientRowsFromText([
      "Supplement Facts",
      "Serving Size: 1 Stick Pack (8.5g)",
      "Servings Per Container: 30",
      "Amount Per Serving %DV",
      "Calcium (from 389mg Calcium Bisglycinate Chelate (TRAACS), 48mg Di-Calcium Phosphate) 84mg 6%",
      "Magnesium (from 250mg Aquamin MG, 214mg Magnesium Bisglycinate) 50mg 12%",
      "Sodium (from 1,630mg Sodium Citrate, 318mg Himalayan Rock Salt) 500mg 22%",
      "Potassium (from 554mg Potassium Citrate, 500mg Organic Coconut Water, 96mg Potassium Chloride) 250mg 6%",
      "Taurine 1000mg †",
      "SenActiv Tienchi Ginseng (Panax notoginseng) Root Extract & Chestnut Rose Fruit Extract 50mg †",
    ].join("\n"));

    assert.deepEqual(rows.map((row) => row.name), [
      "Calcium",
      "Magnesium",
      "Sodium",
      "Potassium",
      "Taurine",
      "SenActiv Tienchi Ginseng (Panax notoginseng) Root Extract & Chestnut Rose Fruit Extract",
    ]);
  });

  test("repair preview fixes legacy source brand and keeps prominent inline nutrients", () => {
    const preview = repairPreviewForRow({
      id: "new-chapter:every-mans-one-daily-40-multivitamin--30-day",
      dataOriginId: "new-chapter:every-mans-one-daily-40-multivitamin--30-day",
      dataOriginUrl: "https://www.newchapter.com/products/every-mans-one-daily-40-multivitamin",
      name: "Every Man's One Daily 40+ Multivitamin - 30 Day",
      brand: "Men's Wellness",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "new-chapter",
        sourceId: "every-mans-one-daily-40-multivitamin--30-day",
        bodyText: "Legacy page body",
        allProductFactsText: ["legacy whole product facts"],
        ingredientText: "Ingredients Supplement Facts Amount per 1 Tablet % Daily Value Vitamin A 900 mcg 100%",
        factsText: [
          "Ingredients Supplement Facts Amount per 1 Tablet % Daily Value",
          "Vitamin A (100% as beta-carotene and from ferment media) 900 mcg 100%",
          "Vitamin C (as ascorbic acid and from ferment media) 90 mg 100%",
          "Vitamin D3 (as cholecalciferol and from ferment media) 25 (1000 mcg IU) 125%",
          "Folate (as 118 mcg folic acid from ferment media) 200 mcg DFE 50%",
          "Vitamin B12 (as cyanocobalamin from ferment media) 10 mcg 417%",
          "Zinc (as zinc oxide from ferment media) 7.4 mg 67%",
        ].join(" "),
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.ok(preview.productionCandidate);
    const ingredientRows = preview.productionCandidate.label.ingredientRows;
    assert.ok(Array.isArray(ingredientRows));
    assert.equal(preview.productionCandidate.brand, "New Chapter");
    assert.deepEqual(preview.removableFieldCandidates, [
      "bodyText",
      "allProductFactsText",
      "ingredientText",
    ]);
    assert.deepEqual(ingredientRows.map(ingredientRowName), [
      "Vitamin A (100% as beta-carotene and from ferment media)",
      "Vitamin C (as ascorbic acid and from ferment media)",
      "Vitamin D3 (as cholecalciferol and from ferment media)",
      "Folate",
      "Vitamin B12 (as cyanocobalamin from ferment media)",
      "Zinc (as zinc oxide from ferment media)",
    ]);
    assert.deepEqual(ingredientRows.find((row) => ingredientRowName(row).startsWith("Vitamin D3")), {
      name: "Vitamin D3 (as cholecalciferol and from ferment media)",
      amount: "25",
      unit: "mcg",
      dailyValue: "125%",
      source: "factsText",
    });
  });

  test("repair serving parser ignores nutrient amounts in liquid multivitamin facts panels", () => {
    const factsText = [
      "Ingredients Supplement Facts Serving size (Adult Dosage Ages 14+) 14+ years 30ml (2 tbsp.)",
      "Serving per container About 30 Amount per serving %DV for 14+ years",
      "Calories 30 Total Carbohydrates 7 g 3%**",
      "Vitamin A (100% as beta-carotene) 900 mcg 100%",
      "Vitamin D3 (as cholecalciferol from lichen) 14 mcg (560 IU) 70%",
    ].join(" ");

    const servingSizes = extractServingSizes({ factsText });

    assert.deepEqual(servingSizes, [
      { text: "30ml (2 tbsp.)", source: "factsText" },
    ]);
    assert.deepEqual(extractIngredientRowsFromText(factsText).find((row) => ingredientRowName(row).startsWith("Vitamin D3")), {
      name: "Vitamin D3 (as cholecalciferol from lichen)",
      amount: "14",
      unit: "mcg",
      dailyValue: "70%",
      source: "factsText",
    });
  });

  test("repair preview blocks multi-bottle duplicate rows before backfill", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:b-complex-2-bottles",
      dataOriginId: "example-brand:b-complex-2-bottles",
      dataOriginUrl: "https://example.test/products/b-complex-2-bottles",
      name: "B-Complex, 180 Coated Caplets, 2 Bottles",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "b-complex-2-bottles",
        factsText: "Supplement Facts Serving Size: 1 Caplet Amount Per Serving Vitamin B12 50 mcg 2083%",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /non_standalone_product/u);
  });

  test("repair preview blocks FAQ page-body evidence even when facts rows parse", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:magnesium-glycinate",
      dataOriginId: "example-brand:magnesium-glycinate",
      dataOriginUrl: "https://example.test/products/magnesium-glycinate",
      name: "Magnesium Glycinate",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "magnesium-glycinate",
        factsText: [
          "Details Supplement Facts Serving Size: 2 tablets Amount per serving % Daily Value Magnesium 300 mg 71%",
          "Directions: Adults take two tablets daily.",
          "All About Magnesium Your Magnesium questions, answered What is magnesium glycinate, and how does it differ from other forms of magnesium?",
        ].join(" "),
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.equal(preview.evidenceRecoveryHint, "official_refetch_page_body");
    assert.match(preview.parserBlockers.join("|"), /page_body_contamination/u);
  });

  test("repair preview blocks sweetener rows that only carry retail metadata", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:stevia-table-top-sweetener",
      dataOriginId: "example-brand:stevia-table-top-sweetener",
      dataOriginUrl: "https://example.test/products/stevia-table-top-sweetener",
      name: "Stevia Table Top Sweetener",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "stevia-table-top-sweetener",
        factsText: "Product / Model Name: Stevia Powder Quantity: Pack of 1 (100g) Best Before: 2 years of Manufacturing Item Weight: 100 g",
        servingSizes: [{ text: "1 g", source: "existing_serving_size" }],
        ingredientRows: [{ name: "Item Weight", amount: "100", unit: "g", source: "existing_ingredient_row" }],
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /likely_food_or_non_supplement/u);
  });

  test("repair preview blocks implausible OCR gram amounts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:collagen-beauty",
      dataOriginId: "example-brand:collagen-beauty",
      dataOriginUrl: "https://example.test/products/collagen-beauty",
      name: "Collagen Beauty Builder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "collagen-beauty",
        factsText: "Supplement Facts Serving Size 3 Caplets Amount Per Serving Protein 3 g BioActive Collagen Peptides 3,000 g Hyaluronic Acid 27 mg Alpha-Lipoic Acid 10 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /implausible_parsed_ingredient_amount/u);
  });

  test("repair preview blocks OCR facts when a visible BCAA row is missing", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:bcaa",
      dataOriginId: "example-brand:bcaa",
      dataOriginUrl: "https://example.test/products/bcaa",
      name: "BCAA 800 mg",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "bcaa",
        factsText: "Supplement Facts Serving Size: 4 Capsules Amount Per Serving L-Leucine 1600 mg L-Isoleucine 800 mg Best Naturals L-Valine 800 mg i socture. Other Ingredients: Capsule.",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_prominent_facts_rows|likely_missing_product_active/u);
  });

  test("repair preview rejects retail net weight rows parsed as ingredients", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:creatine",
      dataOriginId: "example-brand:creatine",
      dataOriginUrl: "https://example.test/products/creatine",
      name: "Creatine",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "creatine",
        factsText: "Supplement Facts Serving Size 1 Scoop (5.7 g) Amount Per Scoop Creatine 5 g Other Ingredients: None. Net Weight: 20.2 oz (1.26 lbs) 573 g",
      },
    });

    assert.equal(preview.automatedBackfillReady, true);
    assert.deepEqual(productionIngredientRows(preview).map(ingredientRowName), [
      "Creatine",
    ]);
  });

  test("repair preview blocks facts when visible turmeric powder is missing", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:turmeric-curcumin",
      dataOriginId: "example-brand:turmeric-curcumin",
      dataOriginUrl: "https://example.test/products/turmeric-curcumin",
      name: "Turmeric Curcumin with BioPerine",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "turmeric-curcumin",
        factsText: "Supplement Facts Serving Size: 2 Capsules Amount Per Serving Turmeric Powder (Curcuma longa) (root) 1400 mg Turmeric Extract 99% Curcumin 100 mg BioPerine Black Pepper Extract 10 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_prominent_facts_rows/u);
  });

  test("repair preview blocks probiotic blends when strain constituents are only raw text", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:probiotic-blend",
      dataOriginId: "example-brand:probiotic-blend",
      dataOriginUrl: "https://example.test/products/probiotic-blend",
      name: "Complete Probiotic",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "probiotic-blend",
        factsText: "Supplement Facts Serving Size 1 capsule Amount Per Serving Probiotic Blend 280 mg (720 million AFU) Akkermansia muciniphila (TA09) 500 million AFU Bifidobacterium adolescentis (TA38) 100 million AFU Bifidobacterium longum (TA24) 100 million AFU",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_blend_constituents/u);
  });

  test("repair preview blocks enzyme blends when only a mineral row is normalized", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:acid-soothe",
      dataOriginId: "example-brand:acid-soothe",
      dataOriginUrl: "https://example.test/products/acid-soothe",
      name: "Acid Soothe",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "acid-soothe",
        factsText: "Supplement Facts Serving Size: 1 Capsule Amount Per Serving Zinc 2 mg 18% Marshmallow Root (Althaea officinalis) Acid Soothe Enzyme Blend Fiber-Digesting Enzymes Cellulase Thera-blend (600 CU) Fat-Digesting Enzymes Lipase Thera-blend (400 FIP)",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_blend_constituents/u);
  });

  test("repair preview rejects sampled generic plural serving-size artifacts", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:magnesium-glycinate",
      dataOriginId: "example-brand:magnesium-glycinate",
      dataOriginUrl: "https://example.test/products/magnesium-glycinate",
      name: "Magnesium Glycinate",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "magnesium-glycinate",
        factsText: "Supplement Facts Serving Size 2 Servings Per Container 90 Amount Per Serving Magnesium 240 mg 57%",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_serving_sizes/u);
  });

  test("repair preview blocks sampled Spanish facts headers parsed as ingredients", () => {
    for (const [id, factsText] of [
      ["cimicifuga", "Supplement Facts Ingredientes: Por 1 comprimido: 20 mg de extracto seco de Cimicifuga racemosa"],
      ["aloe-vera", "Nutrition Facts 6 cucharadas aportan 59,82 ml de jugo de aloe vera"],
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${id}`,
        dataOriginId: `example-brand:${id}`,
        dataOriginUrl: `https://example.test/products/${id}`,
        name: "Example Botanical",
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: id,
          servingSizes: [{ text: "1 comprimido", source: "official_facts_table" }],
          factsText,
        },
      });

      assert.equal(preview.automatedBackfillReady, false, id);
      assert.match(preview.parserBlockers.join("|"), /missing_ingredient_rows|invalid_parsed_ingredient_row|parsed_ingredient_name_contamination/u, id);
    }
  });

  test("repair preview blocks sampled missing visible active rows", () => {
    for (const row of [
      {
        id: "b-complex-missing-b1",
        name: "Methyl B-Complex",
        ingredientRows: [
          { name: "Vitamin B-2 (from Riboflavin-5-Phosphate)", amount: "50", unit: "mg", source: "official_facts_table" },
          { name: "Vitamin B-3 (from Niacinamide)", amount: "50", unit: "mg", source: "official_facts_table" },
          { name: "Vitamin B-12 (from Methylcobalamin)", amount: "50", unit: "mcg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 VegCap Vitamin B-1 (from Thiamine Cocarboxylase) 50 mg Vitamin B-2 50 mg Vitamin B-3 50 mg Vitamin B-12 50 mcg",
      },
      {
        id: "ginkgo-with-bacopa",
        name: "Ginkgo Biloba Extract 120 mg with Bacopa",
        ingredientRows: [{ name: "Ginkgo Biloba Extract", amount: "120", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Quick Release Capsule Ginkgo Biloba Extract 120 mg Bacopa Extract 13.33 mg equivalent to 40 mg of Bacopa Herb",
      },
      {
        id: "pyruvate",
        name: "Pyruvate Power",
        ingredientRows: [{ name: "Calcium (as calcium pyruvate)", amount: "360", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 6 Tablets Calcium (as calcium pyruvate) 360 mg Calcium Pyruvate 3 g",
      },
      {
        id: "caffeine-l-theanine",
        name: "Caffeine + L-Theanine",
        ingredientRows: [{ name: "Green Tea Leaf Extract", amount: "200", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Tablet Green Tea Leaf Extract 200 mg + L-Theanine 200 mg",
      },
      {
        id: "omega-range",
        name: "Breath Plus",
        ingredientRows: [
          { name: "Parsley Seed Oil", amount: "10", unit: "mg", source: "official_facts_table" },
          { name: "ALA (alpha-linolenic acid)", amount: "78 89", unit: "mg", source: "official_facts_table" },
          { name: "SDA (stearidonic acid)", amount: "31 39", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 Softgel Omega-3 (from Ahiflower Oil) 109 - 128 mg ALA (alpha-linolenic acid) 78 - 89 mg SDA (stearidonic acid) 31 - 39 mg",
      },
      {
        id: "inflammatory-health",
        name: "Inflammatory Health",
        ingredientRows: [{ name: "White Willow Bark Extract", amount: "200", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 3 Vegetarian Capsules Palmitoylethanolamide (PEA) 600 mg White Willow Bark Extract 200 mg Devil's Claw Root Extract 100 mg",
      },
      {
        id: "joint-support",
        name: "Joint Support Complex with Collagen",
        ingredientRows: [{ name: "Chicken Sternum Cartilage", amount: "1500", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 3 Capsules Chicken Sternum Cartilage 1500 mg Chondroitin Hyaluronic Acid 300 mg 150 mg",
      },
      {
        id: "oregano-blackseed",
        name: "Oil of Oregano with Blackseed Oil",
        ingredientRows: [{ name: "Blackseed Oil Blend Herbal Equivalent", amount: "8000", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Softgels Oil of Oregano with Blackseed Oil Blend 575 mg Blackseed Oil Organic Oil of Oregano Extract",
      },
      {
        id: "creatine-energy-ocr",
        name: "Creatine + Energy Powder",
        ingredientRows: [{ name: "Creatine Monohydrate", amount: "5000", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Scoop Creatine Monohydrate 5000 mg WARNING: For healthy individuals only. Energy Complex Taurine 150 mg Natural Caffeine 100 mg Theobromine 100 mg Cognitive Complex L-Theanine 300 mg N-Acetyl L-Tyrosine 250 mg Alpha GPC 75 mg Phosphatidylserine 50 mg Huperzine A 200 mcg",
      },
      {
        id: "glp-1-missing-xanthohumulone",
        name: "GLP-1 Complete",
        ingredientRows: [{ name: "Resistant Potato Starch (Solnul®)", amount: "1.3", unit: "g", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 capsules Resistant Potato Starch (Solnul®) 1.3g Lactoplantibacillus plantarum 150mg L. rhamnosus GG 10mg Xanthohumulone (from Hops Extract) 6mg",
      },
      {
        id: "ent-pro-missing-lysozyme",
        name: "Children's ENT-Pro",
        ingredientRows: [{ name: "Fructooligosaccharides", amount: "25", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Lozenge Proprietary blend 2 billion organisms Lactobacillus rhamnosus, Lactobacillus plantarum, Bifidobacterium longum Lysozyme 10 mg Fructooligosaccharides 25 mg",
      },
      {
        id: "liver-detox-missing-triphala",
        name: "Natural Liver Detox",
        ingredientRows: [
          { name: "Organic Dandelion (Root) Extract", amount: "300", unit: "mg", source: "official_facts_table" },
          { name: "Organic Milk Thistle (Seed) Extract", amount: "250", unit: "mg", source: "official_facts_table" },
          { name: "Organic Artichoke Extract", amount: "150", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 2 Capsules Organic Triphala (Fruit) Extract 300mg: Organic Amla, Organic Belleric Myrobalan, Organic Chebulic Myrobalan. Organic Dandelion (Root) Extract 300mg Organic Milk Thistle (Seed) Extract 250mg Organic Artichoke Extract 150mg",
      },
      {
        id: "magnesium-rich-plants-missing",
        name: "Magnesium Glycinate Chelate",
        ingredientRows: [{ name: "Magnesium", amount: "200", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Capsule Magnesium 200 mg Magnesium-Rich Plants Blend* Organic Spinach Leaf Organic Chard Leaf Organic Okra Fruit Organic Quinoa Grain Organic Black Bean Organic Pumpkin Fruit Organic Sunflower Seed Organic Flaxseed 30 mg",
      },
      {
        id: "cinnamon-missing-title-active",
        name: "Ceylon Cinnamon with Biotin and Chromium",
        ingredientRows: [
          { name: "Biotin", amount: "1000", unit: "mcg", source: "official_facts_table" },
          { name: "Chromium", amount: "800", unit: "mcg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 2 Vegan Capsules Biotin 1000 mcg Chromium 800 mcg Ceylon Cinnamon Extract 250 mg (Cinnamomum verum) (bark)",
      },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: row.name,
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: row.ingredientRows,
          servingSizes: [{ text: "1 tablet", source: "official_facts_table" }],
          factsText: row.factsText,
        },
      });

      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.match(preview.parserBlockers.join("|"), /missing_prominent_facts_rows|missing_blend_constituents|likely_missing_product_active|likely_missing_facts_rows|implausible_parsed_ingredient_amount/u, row.id);
    }
  });

  test("repair preview blocks sampled amount-before proprietary blend constituents", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:respiration-blend",
      dataOriginId: "example-brand:respiration-blend",
      dataOriginUrl: "https://example.test/products/respiration-blend",
      name: "Respiration Blend SP-3",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "respiration-blend",
        ingredientRows: [{ name: "Proprietary Blend", amount: "875", unit: "mg", source: "official_facts_table" }],
        servingSizes: [{ text: "2 VegCaps", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 VegCaps Amount Per Serving 875 mg % Daily Value Proprietary Blend Pleurisy (root), Slippery Elm (bark), Wild Cherry (bark), Plantain (leaf), Chickweed (aerial), Horehound (aerial), Licorice (root), Mullein (leaf) *Daily Value not established.",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_blend_constituents|missing_prominent_facts_rows/u);
  });

  test("repair preview blocks sampled stacked OCR ingredient corruptions", () => {
    for (const row of [
      {
        id: "guarana-ocr-typo",
        ingredientRows: [{ name: "Guarana Extarct 4:1 (Paullinia Cupana) (Seed)", amount: "300", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Tablet Guarana Extarct 4:1 300 mg",
      },
      {
        id: "mass-gainer-ocr-artifacts",
        ingredientRows: [
          { name: "CONTENTS Leucine*^", amount: "5630", unit: "mg", source: "official_facts_table" },
          { name: "NSF", amount: "11.6", unit: "g", source: "official_facts_table" },
          { name: "Histidine* CARBS", amount: "1021", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Nutrition Facts Serving size 7 scoops Chocolate Mass Gainer Amino Acid Profile CONTENTS Leucine 5630 mg NSF 11.6g Histidine CARBS 1021 mg Protein 50g",
      },
      {
        id: "protein-vitamin-ocr",
        ingredientRows: [
          { name: "Vitamin B", amount: "0.5", unit: "mg", source: "official_facts_table" },
          { name: "Vitamin Biz", amount: "2.43", unit: "mcg", source: "official_facts_table" },
        ],
        factsText: "Nutrition Facts Serving size 1 Scoop Vitamin B: 0.5mg Folate 165mcg DFE Vitamin Biz 2.43mcg",
      },
      {
        id: "neem-ocr-junk",
        ingredientRows: [{ name: "SX » Hy OEE\" ~ 5 Organic neem (Azadirachta indica) flower", amount: "20", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Capsules Organic neem leaf 600mg Organic neem soft twigs 30mg SX » Hy OEE ~ 5 Organic neem flower 20mg",
      },
      {
        id: "tiap-serving-artifact",
        ingredientRows: [
          { name: "Tiap", amount: "5", unit: "mL", source: "official_facts_table" },
          { name: "Ivy Leaf Extract", amount: "52.5", unit: "mg", source: "official_facts_table" },
          { name: "Thyme Seed Extract", amount: "60", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Komposisi: Tiap 5 mL mengandung: Ivy Leaf Extract 52,5 mg Thyme Seed Extract 60 mg",
      },
      {
        id: "echinacea-duplicate",
        ingredientRows: [
          { name: "Echinacea (Echinacea angustifolia) (root)", amount: "230", unit: "mg", source: "official_facts_table" },
          { name: "Echinacea (Echinacea angustifolia) (root) Echinacea (Echinacea purpurea) (root)", amount: "230", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 VegCap Echinacea (Echinacea angustifolia) (root) Echinacea (Echinacea purpurea) (root) 230 mg 230 mg",
      },
      {
        id: "b-complex-unit-shift",
        ingredientRows: [
          { name: "Vitamin C (as Ascorbic Acid)", amount: "<1", unit: "g", source: "official_facts_table" },
          { name: "Folate", amount: "10", unit: "mg", source: "official_facts_table" },
          { name: "Vitamin B-12 (as Cyanocobalamin)", amount: "680", unit: "mcg DFE", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 Chewable Tablet Amount Per Serving Calories Total Carbohydrate Dietary Fiber Vitamin C Thiamine Riboflavin Niacin Vitamin B-6 Folate Vitamin B-12 Biotin Pantothenic Acid Choline 10 3 g <1 g 250 mg 7.5 mg 8.5 mg 50 mg 680 mcg DFE 30 mcg 300 mcg",
      },
      {
        id: "glp-1-merged-strains",
        ingredientRows: [
          { name: "L. plantarum 276 &", amount: "150", unit: "mg", source: "official_facts_table" },
          { name: "L. rhamnosus GG (Heat-inactivated) Lactoplantibacillus plantarum", amount: "10", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 2 capsules L. plantarum 276 & Amount Per Serving 150mg L. rhamnosus GG Lactoplantibacillus plantarum 10mg Xanthohumulone 6mg",
      },
      {
        id: "rhodiola-strength-prefix",
        ingredientRows: [{ name: "Strength Organic Rhodiola", amount: "300", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Vegan Capsule Strength Organic Rhodiola 300 mg 10:1 Extract",
      },
      {
        id: "trace-mineral-merged",
        ingredientRows: [
          { name: "Magnesium (from CTM) Chloride (from CTM)", amount: "25", unit: "mg", source: "official_facts_table" },
          { name: "ConcenTrace® Trace Minerals (CTM) Boron (from Boron Complex, CTM)", amount: "350", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1.25 mL Magnesium (from CTM) Chloride (from CTM) 25mg 65mg ConcenTrace Trace Minerals (CTM) Boron (from Boron Complex, CTM) 350mg 6mg",
      },
      {
        id: "ginger-supercritical-merge",
        ingredientRows: [
          { name: "Organic ginger powder (rhizome and aerial part)", amount: "557", unit: "mg", source: "official_facts_table" },
          { name: "Organic ginger extract (rhizome) Organic ginger supercritical CO2 extract (rhizome)", amount: "233", unit: "mg", source: "official_facts_table" },
        ],
        factsText: "Supplement Facts Serving Size 1 Caplet Organic ginger powder 557 mg Organic ginger extract Organic ginger supercritical CO2 extract 233 mg 30 mg",
      },
      {
        id: "bacillus-ocr-typo",
        ingredientRows: [{ name: "Baciulls coagulans (2 Billion CFU)", amount: "14", unit: "mg", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 6 Capsules Baciulls coagulans (2 Billion CFU) 14mg",
      },
    ]) {
      const preview = repairPreviewForRow({
        id: `example-brand:${row.id}`,
        dataOriginId: `example-brand:${row.id}`,
        dataOriginUrl: `https://example.test/products/${row.id}`,
        name: "Example OCR Label",
        brand: "Example Brand",
        upc: null,
        offMarket: false,
        searchText: "",
        label: {
          source: "example-brand",
          sourceId: row.id,
          ingredientRows: row.ingredientRows,
          servingSizes: [{ text: "1 capsule", source: "official_facts_table" }],
          factsText: row.factsText,
        },
      });

      assert.equal(preview.automatedBackfillReady, false, row.id);
      assert.match(preview.parserBlockers.join("|"), /ingredient_name_contamination|parsed_ingredient_name_contamination|implausible_parsed_ingredient_amount|invalid_existing_ingredient_rows/u, row.id);
    }
  });

  test("repair preview blocks sampled parser-origin leading comma rows", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:bcaa-leading-comma",
      dataOriginId: "example-brand:bcaa-leading-comma",
      dataOriginUrl: "https://example.test/products/bcaa-leading-comma",
      name: "BCAA Powder",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "bcaa-leading-comma",
        factsText: "Ingredients You Can Trust: Supplement Facts, Serving Size 1 Scoop (6.7g), Amount Per Serving, %DV, L-Leucine 2.5 g, *, L-Isoleucine 1.25 g, *, L-Valine 1.25 g, *, *Daily Value not established",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /parsed_ingredient_name_contamination/u);
  });

  test("repair preview blocks sampled CJK continuation amount tables", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:cjk-continuation",
      dataOriginId: "example-brand:cjk-continuation",
      dataOriginUrl: "https://example.test/products/cjk-continuation",
      name: "Example CJK Supplement",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "cjk-continuation",
        ingredientRows: [{ name: "鋅", amount: "10", unit: "mg", source: "official_facts_table" }],
        servingSizes: [{ text: "2 粒", source: "official_facts_table" }],
        factsText: "營養標示\n每一份量 2 粒\n成分\n每份\n鋅\n10毫克\n其他成分含量\n每一份量 2粒\n牛蒡萃取物\n(含牛蒡多酚)\n500毫克\n甘藍萃取物\n(含維生素U)\n380毫克",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /likely_missing_facts_rows/u);
  });

  test("repair preview blocks sampled comma-merged active names", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:sod-2000-plus",
      dataOriginId: "example-brand:sod-2000-plus",
      dataOriginUrl: "https://example.test/products/sod-2000-plus",
      name: "SOD 2000 Plus",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "sod-2000-plus",
        ingredientRows: [{ name: "Rosemary Leaf, Green Tea Leaf Extract, Calcium D-Glucarate, Ellagic", amount: "400", unit: "mg", source: "official_facts_table" }],
        servingSizes: [{ text: "1 VegCap", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 VegCap S.O.D. Complex 400 mg Superoxide Dismutase Catalase Support Base Rosemary Leaf, Green Tea Leaf Extract, Calcium D-Glucarate, Ellagic Acid, Grape Seed Extract 70 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /ingredient_name_contamination|parsed_ingredient_name_contamination|missing_prominent_facts_rows/u);
  });

  test("repair preview blocks parenthesized probiotic blend amounts when strains are missing", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:complete-afterbiotics",
      dataOriginId: "example-brand:complete-afterbiotics",
      dataOriginUrl: "https://example.test/products/complete-afterbiotics",
      name: "Complete Afterbiotics",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "complete-afterbiotics",
        ingredientRows: [{ name: "Complete Afterbiotics", amount: "255", unit: "mg", source: "official_facts_table" }],
        servingSizes: [{ text: "1 Capsule", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 1 Capsule Complete Afterbiotics 255 mg Probiotic and SBO Blend (18 Billion CFU) Saccharomyces boulardii Pediococcus acidilactici Lactobacillus rhamnosus Bacillus subtilis",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /missing_blend_constituents|missing_prominent_facts_rows/u);
  });

  test("repair preview blocks sampled OCR junk ingredient prefixes", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:lycopene-ocr",
      dataOriginId: "example-brand:lycopene-ocr",
      dataOriginUrl: "https://example.test/products/lycopene-ocr",
      name: "Lycopene",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "lycopene-ocr",
        ingredientRows: [
          { name: "Naus Lycopene (from tomatoes)", amount: "30", unit: "mg", source: "official_facts_table" },
          { name: "Dict", amount: "0.5", unit: "g", source: "official_facts_table" },
        ],
        servingSizes: [{ text: "2 Softgels", source: "official_facts_table" }],
        factsText: "Supplement Facts Serving Size 2 Softgels Dict Calories 5 Naus Lycopene (from tomatoes) 30 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /ingredient_name_contamination|parsed_ingredient_name_contamination|invalid_existing_ingredient_rows/u);
  });

  test("repair preview blocks herb-promising multivitamins when herb rows are absent", () => {
    const preview = repairPreviewForRow({
      id: "example-brand:multi-urter",
      dataOriginId: "example-brand:multi-urter",
      dataOriginUrl: "https://example.test/products/multi-urter",
      name: "Livol Multivitamin m. urter",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      searchText: "",
      label: {
        source: "example-brand",
        sourceId: "multi-urter",
        ingredientRows: [
          { name: "Vitamin A", amount: "800", unit: "mcg", source: "official_facts_table" },
          { name: "Vitamin D", amount: "20", unit: "mcg", source: "official_facts_table" },
          { name: "Calcium", amount: "400", unit: "mg", source: "official_facts_table" },
        ],
        servingSizes: [{ text: "2 tablette", source: "official_facts_table" }],
        factsText: "Næringsindhold pr. dagsdosis Vitamin A 800 mcg Vitamin D 20 mcg Calcium 400 mg Urter Ca. mængde Paprikafrugtekstrakt Fra 396 mg Rosmarinbladpulver 20 mg",
      },
    });

    assert.equal(preview.automatedBackfillReady, false);
    assert.match(preview.parserBlockers.join("|"), /likely_missing_product_active|missing_prominent_facts_rows/u);
  });
});
