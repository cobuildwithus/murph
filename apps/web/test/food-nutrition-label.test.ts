import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { isRecord } from "../src/lib/primitives";
import { normalizeFoodNutritionLabel } from "../src/lib/food-nutrition-label";

describe("normalizeFoodNutritionLabel", () => {
  it("preserves structured nutrition facts and source order", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        ingredientRows: [
          {
            amount: "500",
            dailyValue: "25%",
            name: "Primary ingredient",
            nestedRows: [
              {
                amount: "125.5",
                name: "Nested ingredient",
                unit: "mg",
              },
            ],
            notes: "Source note",
            unit: "mg",
          },
        ],
        nutritionRows: [
          {
            amount: 10,
            dailyValue: "5%",
            name: "Nutrient",
            unit: "mg",
          },
        ],
        otheringredients: {
          ingredients: [{ name: "Capsule" }],
        },
        servingSizes: [
          {
            amount: 2,
            description: "Two capsules",
            grams: 1.5,
            unit: "capsules",
          },
        ],
      },
      servingGrams: null,
    });

    expect(result.serving).toEqual({
      amount: 2,
      description: "Two capsules",
      grams: 1.5,
      unit: "capsules",
    });
    expect(result.nutrition).toEqual({
      basis: "per_serving",
      rows: [
        {
          name: "Nutrient",
          amount: { value: 10, unit: "mg", display: "10" },
          dailyValuePercent: 5,
          basis: "per_serving",
        },
      ],
    });
  });

  it("preserves branded food nutrition and serving context", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        householdServing: "One package",
        ingredients: "Ingredient one, ingredient two (subingredient A, subingredient B)",
        nutrientsPer100g: [
          {
            name: "Protein",
            unit: "g",
            value: 12.4,
          },
        ],
        servingSize: "45",
        servingSizeUnit: "g",
      },
      servingGrams: 45,
    });

    expect(result.serving).toEqual({
      description: "One package",
      amount: 45,
      unit: "g",
      grams: 45,
    });
    expect(result.nutrition.basis).toBe("per_100_g");
    expect(result.nutrition.rows[0]?.amount).toEqual({
      display: "12.4",
      unit: "g",
      value: 12.4,
    });
  });

  it("reads USDA portion grams for generic food serving context", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        nutrientsPer100g: [
          { name: "Protein", unit: "g", value: 10 },
        ],
        portions: [
          {
            amount: 1,
            description: "slice",
            gramWeight: 28,
          },
        ],
      },
      servingGrams: null,
    });

    expect(result.serving).toEqual({
      amount: 1,
      description: "slice",
      grams: 28,
      unit: null,
    });
  });

  it("normalizes curated food rows without inferring missing values", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        calories: 190,
        ingredientRows: [
          {
            ingredients: [
              { name: "Declared child" },
              "not flattened",
              { name: "" },
            ],
            name: "Declared group",
          },
          { name: "Second ingredient" },
        ],
        nutrientsPerServing: [
          { amount: 4, name: "Protein", unit: "g" },
        ],
        servingSizes: [{ description: "One bar", grams: "40" }],
      },
      servingGrams: null,
    });

    expect(result.nutrition.rows[0]).toEqual({
      name: "Calories",
      amount: { display: "190", unit: "kcal", value: 190 },
      dailyValuePercent: null,
      basis: "per_serving",
    });
    expect(result.serving?.grams).toBe(40);
  });

  it("does not duplicate an existing case-insensitive Calories row", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        calories: 190,
        nutrientsPerServing: [
          { amount: 180, name: "calories", unit: "kcal" },
        ],
      },
      servingGrams: 40,
    });

    expect(result.nutrition.rows.filter((row) =>
      row.name.toLowerCase() === "calories")).toEqual([
      {
        name: "calories",
        amount: { display: "180", unit: "kcal", value: 180 },
        dailyValuePercent: null,
        basis: "per_serving",
      },
    ]);
  });

  it("preserves committed curated food nutrition", async () => {
    const parsed: unknown = JSON.parse(await readFile(
      new URL("../sql/foods/plasticlist-brand-site-foods.json", import.meta.url),
      "utf8",
    ));
    if (!Array.isArray(parsed)) {
      throw new TypeError("Expected curated food fixture rows.");
    }
    const record = parsed.find((candidate) =>
      isRecord(candidate)
      && candidate.name === "Butter Chicken with Basmati Rice");
    if (!isRecord(record) || !isRecord(record.label)) {
      throw new TypeError("Expected the Butter Chicken curated label fixture.");
    }

    const result = normalizeFoodNutritionLabel({
      label: record.label,
      servingGrams: 354,
    });

    expect(result.nutrition.rows[0]).toEqual({
      name: "Calories",
      amount: { display: "400", unit: "kcal", value: 400 },
      dailyValuePercent: null,
      basis: "per_serving",
    });
  });

  it("accepts current brand-label serving shapes", () => {
    const stringServing = normalizeFoodNutritionLabel({
      label: {
        otherIngredients: "Vegetable capsule",
        servingSizes: ["2 capsules"],
      },
      servingGrams: null,
    });
    const sourcedServing = normalizeFoodNutritionLabel({
      label: {
        servingSizes: [{ source: "brand label", text: "One scoop" }],
      },
      servingGrams: null,
    });

    expect(stringServing.serving?.description).toBe("2 capsules");
    expect(sourcedServing.serving?.description).toBe("One scoop");
  });

  it("returns honest gaps for malformed or unavailable source data", () => {
    const result = normalizeFoodNutritionLabel({
      label: {
        ingredientRows: [null, {}, { name: "" }],
        nutritionRows: "not-an-array",
        servingSizes: [{ amount: -1, grams: "unknown" }],
      },
      servingGrams: null,
    });

    expect(result.nutrition).toEqual({ basis: "unavailable", rows: [] });
    expect(result.serving).toBeNull();
  });


  it("bounds nutrition rows before returning them", () => {
    const ingredientRows = Array.from({ length: 260 }, (_, index) => ({
      name: `Ingredient ${index}`,
      nestedRows: Array.from({ length: 60 }, (__, childIndex) => ({
        name: `Child ${childIndex}`,
      })),
    }));
    const nutritionRows = Array.from({ length: 300 }, (_, index) => ({
      name: `Nutrient ${index}`,
    }));

    const result = normalizeFoodNutritionLabel({
      label: { ingredientRows, nutritionRows },
      servingGrams: 1,
    });

    expect(result.nutrition.rows).toHaveLength(256);
  });
});
