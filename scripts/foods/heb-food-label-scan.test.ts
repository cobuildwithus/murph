import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  extractHebProductUrls,
  isHebFoodCategoryPath,
  normalizeHebProductUrl,
  parseHebProductMarkdown,
  scanHebFoods,
} from "./heb-food-label-scan.ts";

const WHOLE_MILK_MARKDOWN = `Title: H-E-B Whole Milk - Shop Milk at H-E-B

# H\u2011E\u2011B Whole Milk

1 gal

1.   [H-E-B](https://www.heb.com/)
2.   [Shop](https://www.heb.com/browse/shop)
3.   [Dairy & eggs](https://www.heb.com/category/shop/dairy-eggs/2864/490016)
4.   [Milk](https://www.heb.com/category/shop/milk/490016/490053)
5.   H-E-B Whole Milk

## Highlights

Go local SNAP EBT eligible Select Ingredients

## Description

Enriched with vitamins E & D, H-E-B whole milk comes in handy.

*   ## Nutrition facts and ingredients

### Nutrition Facts

16 servings per container

Serving Size 1.00 cup
    *   Amount Per Serving
    *   Calories 150 Calories from Fat 70
    *   % Daily Value*
    *   Total Fat
        *   8g
        *   12%

    *   Sodium
        *   100mg
        *   4%

    *   Vitamin A

        *   10%

* The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet.

#### Ingredients

Milk, Vitamin D3, Vitamin E.

#### Allergens and safety warnings

Contains: MILK. Keep refrigerated.

*   ## More information
`;

const MULTI_PANEL_MARKDOWN = `Title: Meal Simple by H-E-B El Jefe Burrito - Shop Meals at H-E-B

# Meal Simple by H-E-B El Jefe Burrito - Smoked Pork

10 oz

1.   [H-E-B](https://www.heb.com/)
2.   [Shop](https://www.heb.com/browse/shop)
3.   [Deli & prepared food](https://www.heb.com/category/shop/deli-prepared-food/2864/490017)
4.   [Ready meals & snacks](https://www.heb.com/category/shop/ready-meals-snacks/490017/490061)

## Description

Ready to heat burrito.

*   ## Nutrition facts and ingredients

### Nutrition Facts

142g
2 servings per container

Serving Size 1/2 burrito (142g)
    *   Amount Per Serving Calories 280
    *   % Daily Value*
    *   Total Fat
        *   8g
        *   11%

### Nutrition Facts

284g
2 servings per container

Serving Size

1/2 burrito (142g)

    *   Amount Per Serving Calories 570
    *   % Daily Value*
    *   Total Fat
        *   17g
        *   22%

#### Ingredients

Flour Tortilla, Smoked Pork, Rice, Cheese.

*   ## More information
`;

const PET_FOOD_MARKDOWN = `Title: H-E-B Texas Pets Dog Food - Shop Pets at H-E-B

# H-E-B Texas Pets Dog Food

16 lb

1.   [H-E-B](https://www.heb.com/)
2.   [Shop](https://www.heb.com/browse/shop)
3.   [Pets](https://www.heb.com/category/shop/pets/2863/490025)
4.   [Dogs](https://www.heb.com/category/shop/pets/dogs/490025/490131)
5.   H-E-B Texas Pets Dog Food

## Description

Food for dogs, not a human food label.

*   ## Nutrition facts and ingredients

### Nutrition Facts

Serving Size 1 cup
    *   Amount Per Serving Calories 300

#### Ingredients

Chicken Meal, Corn, Rice.

*   ## More information
`;

describe("H-E-B food label scan workflow", () => {
  test("normalizes and extracts H-E-B product URLs", () => {
    assert.equal(
      normalizeHebProductUrl("https://www.heb.com/product-detail/h-e-b-whole-milk-1-gal/314130?foo=bar"),
      "https://www.heb.com/product-detail/h-e-b-whole-milk-1-gal/314130",
    );
    assert.deepEqual(extractHebProductUrls("[Milk](https://www.heb.com/product-detail/h-e-b-whole-milk-1-gal/314130?x=1)"), [
      "https://www.heb.com/product-detail/h-e-b-whole-milk-1-gal/314130",
    ]);
  });

  test("parses a product page into foods-table candidate shape", () => {
    const candidate = parseHebProductMarkdown(
      WHOLE_MILK_MARKDOWN,
      "https://www.heb.com/product-detail/h-e-b-whole-milk/314130",
      new Date("2026-06-16T12:00:00.000Z"),
    );

    assert.equal(candidate.id, "heb:314130");
    assert.equal(candidate.dataOrigin, "brand_site");
    assert.equal(candidate.name, "H-E-B Whole Milk");
    assert.equal(candidate.brand, "H-E-B");
    assert.equal(candidate.label.size, "1 gal");
    assert.deepEqual(candidate.label.categoryPath, ["Dairy & eggs", "Milk", "H-E-B Whole Milk"]);
    assert.equal(candidate.label.ingredients, "Milk, Vitamin D3, Vitamin E.");
    assert.equal(candidate.label.nutritionFacts.panels.length, 1);
    assert.equal(candidate.label.nutritionFacts.panels[0]?.servingSize, "1.00 cup");
    assert.equal(candidate.label.nutritionFacts.panels[0]?.calories, "150");
    assert.deepEqual(candidate.label.nutritionFacts.panels[0]?.nutrients.slice(0, 2), [
      { name: "Total Fat", amount: "8g", dailyValue: "12%" },
      { name: "Sodium", amount: "100mg", dailyValue: "4%" },
    ]);
    assert.deepEqual(candidate.reviewIssues, ["missing_upc"]);
  });

  test("preserves multiple Nutrition Facts panels", () => {
    const candidate = parseHebProductMarkdown(
      MULTI_PANEL_MARKDOWN,
      "https://www.heb.com/product-detail/meal-simple-by-h-e-b-el-jefe-burrito-smoked-pork/16112519",
      new Date("2026-06-16T12:00:00.000Z"),
    );

    assert.equal(candidate.label.nutritionFacts.panels.length, 2);
    assert.equal(candidate.label.nutritionFacts.panels[0]?.calories, "280");
    assert.equal(candidate.label.nutritionFacts.panels[1]?.calories, "570");
    assert.equal(candidate.label.nutritionFacts.panels[1]?.servingSize, "1/2 burrito (142g)");
  });

  test("classifies only H-E-B human-food department categories as food", () => {
    assert.equal(isHebFoodCategoryPath(["Dairy & eggs", "Milk"]), true);
    assert.equal(isHebFoodCategoryPath(["Baby & kids", "Food & formula"]), true);
    assert.equal(isHebFoodCategoryPath(["Baby & kids", "Toys"]), false);
    assert.equal(isHebFoodCategoryPath(["Pets", "Dogs"]), false);
    assert.equal(isHebFoodCategoryPath(["Health & beauty", "Vitamins & supplements"]), false);
  });

  test("discovers URLs and writes summary without network when injected fetcher is used", async () => {
    const searchMarkdown = `
      [Milk](https://www.heb.com/product-detail/h-e-b-whole-milk/314130)
      [Burrito](https://www.heb.com/product-detail/meal-simple-by-h-e-b-el-jefe-burrito-smoked-pork/16112519)
    `;
    const pages = new Map([
      ["https://www.heb.com/search?q=milk", searchMarkdown],
      ["https://www.heb.com/product-detail/h-e-b-whole-milk/314130", WHOLE_MILK_MARKDOWN],
      [
        "https://www.heb.com/product-detail/meal-simple-by-h-e-b-el-jefe-burrito-smoked-pork/16112519",
        MULTI_PANEL_MARKDOWN,
      ],
    ]);

    const result = await scanHebFoods({
      limit: 2,
      searchTerms: ["milk"],
      now: new Date("2026-06-16T12:00:00.000Z"),
      fetchMarkdown: async (url) => {
        const page = pages.get(url);
        if (!page) throw new Error(`missing fixture for ${url}`);
        return page;
      },
    });

    assert.equal(result.summary.discoveredProductUrls, 2);
    assert.equal(result.summary.scannedProducts, 2);
    assert.equal(result.summary.productionReadyCandidates, 2);
    assert.equal(result.summary.multiPanelNutritionFacts, 1);
    assert.equal(result.summary.withUpc, 0);
    assert.equal(result.summary.issueCounts.missing_upc, 2);
  });

  test("drops parsed products from non-food departments", async () => {
    const result = await scanHebFoods({
      limit: 2,
      retryRounds: 0,
      productUrls: [
        "https://www.heb.com/product-detail/h-e-b-whole-milk/314130",
        "https://www.heb.com/product-detail/h-e-b-texas-pets-dog-food/123456",
      ],
      now: new Date("2026-06-16T12:00:00.000Z"),
      fetchMarkdown: async (url) => (url.includes("dog-food") ? PET_FOOD_MARKDOWN : WHOLE_MILK_MARKDOWN),
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.dataOriginId, "heb:314130");
    assert.equal(result.summary.attemptedProducts, 2);
    assert.equal(result.summary.nonFoodProducts, 1);
    assert.equal(result.summary.scannedProducts, 1);
  });

  test("recovers transient product fetch failures in retry rounds", async () => {
    const attemptsByUrl = new Map<string, number>();
    const result = await scanHebFoods({
      limit: 2,
      retryRounds: 1,
      retryDelayMs: 0,
      productUrls: [
        "https://www.heb.com/product-detail/h-e-b-whole-milk/314130",
        "https://www.heb.com/product-detail/meal-simple-by-h-e-b-el-jefe-burrito-smoked-pork/16112519",
      ],
      now: new Date("2026-06-16T12:00:00.000Z"),
      fetchMarkdown: async (url) => {
        const attempts = (attemptsByUrl.get(url) ?? 0) + 1;
        attemptsByUrl.set(url, attempts);
        if (url.includes("16112519") && attempts === 1) throw new Error("transient fixture failure");
        return url.includes("16112519") ? MULTI_PANEL_MARKDOWN : WHOLE_MILK_MARKDOWN;
      },
    });

    assert.equal(result.candidates.length, 2);
    assert.equal(result.failures.length, 0);
    assert.equal(result.summary.fetchFailedProducts, 0);
    assert.equal(attemptsByUrl.get("https://www.heb.com/product-detail/meal-simple-by-h-e-b-el-jefe-burrito-smoked-pork/16112519"), 2);
  });

  test("counts product fetch failures without aborting the scan", async () => {
    const result = await scanHebFoods({
      limit: 2,
      retryRounds: 0,
      productUrls: [
        "https://www.heb.com/product-detail/h-e-b-whole-milk/314130",
        "https://www.heb.com/product-detail/h-e-b-missing-product/999999",
      ],
      now: new Date("2026-06-16T12:00:00.000Z"),
      fetchMarkdown: async (url) => {
        if (url.includes("999999")) throw new Error("fixture fetch failed");
        return WHOLE_MILK_MARKDOWN;
      },
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.summary.attemptedProducts, 2);
    assert.equal(result.summary.fetchFailedProducts, 1);
    assert.equal(result.failures[0]?.productUrl, "https://www.heb.com/product-detail/h-e-b-missing-product/999999");
  });
});
