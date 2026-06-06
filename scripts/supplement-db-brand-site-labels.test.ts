import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  SEARCH_TEXT_MAX_LENGTH,
  assertProductionReady,
  buildSearchText,
  normalizeItem,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs";
import {
  extractIngredientRowsFromText,
  extractServingSizes,
  repairPreviewForRow,
} from "../.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs";

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
    assert.equal(preview.parsedIngredientRows, 1);
    assert.equal(preview.parsedServingSizes, 1);
    assert.equal(preview.searchTextWouldChange, true);
    assert.deepEqual(preview.removableFieldCandidates, ["bodyText"]);
    assert.match(preview.proposedSearchTextPreview, /Magnesium 200 mg/u);
    assert.doesNotMatch(preview.proposedSearchTextPreview, /page copy page copy/u);
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

    assert.equal(preview.parserStatus, "partial_parse");
    assert.equal(preview.parsedIngredientRows > 0, true);
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
