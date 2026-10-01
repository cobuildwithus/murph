import { describe, expect, test } from "vitest";

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import {
  getFoodIngredientItems,
  getFoodMurphNote,
} from "@/src/components/food-label-lab/food-product-review";

describe("food product review", () => {
  test("gives a protein shake with sweeteners grade C and three reasons", () => {
    const product = cloneDesignProduct();
    product.name = "Chocolate protein milk shake";
    product.ingredients.statement =
      "Filtered lowfat milk, acesulfame potassium, carrageenan, monk fruit juice concentrate, cellulose gel, stevia leaf extract, sucralose";
    setNutrition(product, "Protein", 10.14);
    product.nutrition.rows.push({
      name: "Sugars, added",
      amount: { value: 0, unit: "g", display: "0" },
      dailyValuePercent: null,
      basis: "per_100_g",
    });
    product.productTests.total = 57;
    product.productTests.returned = product.productTests.observations.length;
    product.productTests.truncated = true;
    product.productTests.observations = product.productTests.observations.map(
      (observation) => ({ ...observation, screening: null }),
    );
    product.productTests.alerts = [];

    expect(getFoodMurphNote(product)).toMatchObject({
      grade: "C",
      reasons: [
        { id: "sugar-substitutes", tone: "caution" },
        {
          id: "protein",
          tone: "positive",
          text: "Protein stands out at 10.1 g per 100g.",
        },
        { id: "no-added-sugar", tone: "positive" },
      ],
      tone: "mixed",
    });
  });

  test("lets an exceeded lab limit override an otherwise plain label", () => {
    const product = cloneDesignProduct(2);

    const note = getFoodMurphNote(product);
    expect(note).toMatchObject({
      grade: "E",
      tone: "caution",
    });
    expect(note.reasons.map((reason) => reason.id)).toEqual([
      "lab-above-limit",
      "protein",
    ]);
  });

  test("does not invent a verdict for a sparse record", () => {
    const product = cloneDesignProduct();
    product.ingredients.statement = null;
    product.nutrition.rows = [];
    product.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };

    expect(getFoodMurphNote(product)).toMatchObject({
      grade: null,
      reasons: [{ id: "sparse-record", tone: "neutral" }],
      tone: "unknown",
    });
  });

  test("uses standard high-nutrient cutoffs without hiding the measured value", () => {
    const product = cloneDesignProduct();
    setNutrition(product, "Total Fat", 18);
    setNutrition(product, "Sodium, Na", 650);

    const note = getFoodMurphNote(product);
    expect(note).toMatchObject({
      grade: "D",
      tone: "caution",
    });
    expect(note.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "high-nutrients",
          text: expect.stringContaining("per 100g."),
        }),
        expect.objectContaining({
          id: "protein",
          text: expect.stringContaining("per 100g."),
        }),
      ]),
    );
  });

  test("uses A for a clear strength and B for a complete neutral label", () => {
    const strongProduct = cloneDesignProduct();
    expect(getFoodMurphNote(strongProduct).grade).toBe("A");

    const neutralProduct = cloneDesignProduct();
    setNutrition(neutralProduct, "Protein", 6);
    expect(getFoodMurphNote(neutralProduct).grade).toBe("B");
  });

  test("keeps grouped ingredients attached to their parent", () => {
    const product = cloneDesignProduct();
    product.ingredients.statement =
      "PROTEIN BLEND (MILK PROTEIN ISOLATE, WHEY PROTEIN ISOLATE), SUCRALOSE";

    expect(getFoodIngredientItems(product)).toMatchObject([
      {
        name: "Protein Blend",
        children: [
          { name: "Milk Protein Isolate" },
          { name: "Whey Protein Isolate" },
        ],
      },
      { name: "Sucralose", children: [] },
    ]);
  });
});

function cloneDesignProduct(index = 0) {
  const source = FOOD_LABEL_DESIGN_PRODUCTS[index];
  if (!source) {
    throw new Error("Food Label Lab design product is missing.");
  }
  return structuredClone(source);
}

function setNutrition(
  product: ReturnType<typeof cloneDesignProduct>,
  name: string,
  value: number,
) {
  const nutrition = product.nutrition.rows.find((row) => row.name === name);
  if (!nutrition?.amount) {
    throw new Error(`Nutrition row ${name} is missing.`);
  }
  nutrition.amount.value = value;
  nutrition.amount.display = String(value);
}
