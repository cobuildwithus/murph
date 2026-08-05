import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { isRecord } from "../src/lib/primitives";
import { normalizePublicProductLabel } from "../src/lib/public-products/normalize-label";

describe("normalizePublicProductLabel", () => {
  it("preserves structured supplement facts, nested rows, and source order", () => {
    const result = normalizePublicProductLabel({
      kind: "supplement",
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

    expect(result.ingredients).toEqual({
      structure: "structured",
      statement: null,
      otherStatement: null,
      active: [
        {
          name: "Primary ingredient",
          amount: { value: 500, unit: "mg", display: "500" },
          dailyValuePercent: 25,
          notes: "Source note",
          children: [
            {
              name: "Nested ingredient",
              amount: { value: 125.5, unit: "mg", display: "125.5" },
              dailyValuePercent: null,
              notes: null,
            },
          ],
        },
      ],
      other: [
        {
          name: "Capsule",
          amount: null,
          dailyValuePercent: null,
          notes: null,
          children: [],
        },
      ],
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
    expect(result.unknownCodes).toEqual(["FORMULA_REVISION_NOT_TRACKED"]);
  });

  it("keeps a branded food ingredient declaration as a statement", () => {
    const result = normalizePublicProductLabel({
      kind: "food",
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

    expect(result.ingredients).toEqual({
      structure: "statement_only",
      statement: "Ingredient one, ingredient two (subingredient A, subingredient B)",
      otherStatement: null,
      active: [],
      other: [],
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
    expect(result.unknownCodes).toEqual([
      "FORMULA_REVISION_NOT_TRACKED",
      "INGREDIENTS_STATEMENT_ONLY",
    ]);
  });

  it("reads USDA portion grams for generic food serving context", () => {
    const result = normalizePublicProductLabel({
      kind: "food",
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
    const result = normalizePublicProductLabel({
      kind: "food",
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

    expect(result.ingredients.active.map((row) => row.name)).toEqual([
      "Declared group",
      "Second ingredient",
    ]);
    expect(result.ingredients.active[0]?.children.map((row) => row.name)).toEqual([
      "Declared child",
    ]);
    expect(result.nutrition.rows[0]).toEqual({
      name: "Calories",
      amount: { display: "190", unit: "kcal", value: 190 },
      dailyValuePercent: null,
      basis: "per_serving",
    });
    expect(result.serving?.grams).toBe(40);
  });

  it("does not duplicate an existing case-insensitive Calories row", () => {
    const result = normalizePublicProductLabel({
      kind: "food",
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

  it("preserves the committed Butter Chicken label hierarchy", async () => {
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

    const result = normalizePublicProductLabel({
      kind: "food",
      label: record.label,
      servingGrams: 354,
    });

    expect(result.ingredients.active.map((row) => row.name)).toEqual([
      "Chicken and sauce",
      "Cooked basmati rice",
    ]);
    expect(result.ingredients.active[0]?.children.map((row) => row.name)).toContain(
      "Cooked chicken",
    );
    expect(result.ingredients.active[1]?.children.map((row) => row.name)).toContain(
      "Rice",
    );
    expect(result.nutrition.rows[0]).toEqual({
      name: "Calories",
      amount: { display: "400", unit: "kcal", value: 400 },
      dailyValuePercent: null,
      basis: "per_serving",
    });
  });

  it("accepts current brand-label serving and other-ingredient shapes", () => {
    const stringServing = normalizePublicProductLabel({
      kind: "supplement",
      label: {
        otherIngredients: "Vegetable capsule",
        servingSizes: ["2 capsules"],
      },
      servingGrams: null,
    });
    const sourcedServing = normalizePublicProductLabel({
      kind: "supplement",
      label: {
        servingSizes: [{ source: "brand label", text: "One scoop" }],
      },
      servingGrams: null,
    });

    expect(stringServing.ingredients.other).toEqual([]);
    expect(stringServing.ingredients.otherStatement).toBe("Vegetable capsule");
    expect(stringServing.serving?.description).toBe("2 capsules");
    expect(sourcedServing.serving?.description).toBe("One scoop");
  });

  it("returns honest gaps for malformed or unavailable source data", () => {
    const result = normalizePublicProductLabel({
      kind: "supplement",
      label: {
        ingredientRows: [null, {}, { name: "" }],
        nutritionRows: "not-an-array",
        servingSizes: [{ amount: -1, grams: "unknown" }],
      },
      servingGrams: null,
    });

    expect(result.ingredients).toEqual({
      structure: "unavailable",
      statement: null,
      otherStatement: null,
      active: [],
      other: [],
    });
    expect(result.nutrition).toEqual({ basis: "unavailable", rows: [] });
    expect(result.serving).toBeNull();
    expect(result.unknownCodes).toEqual([
      "FORMULA_REVISION_NOT_TRACKED",
      "INGREDIENTS_UNAVAILABLE",
      "NUTRITION_UNAVAILABLE",
      "SERVING_MASS_UNAVAILABLE",
    ]);
  });

  it("preserves an ambiguous amount as display text without inventing a number", () => {
    const result = normalizePublicProductLabel({
      kind: "supplement",
      label: {
        ingredientRows: [
          { amount: "<1", name: "Trace ingredient", unit: "mg" },
        ],
      },
      servingGrams: 1,
    });

    expect(result.ingredients.active[0]?.amount).toEqual({
      value: null,
      unit: "mg",
      display: "<1",
    });
  });

  it("bounds every public collection before returning it", () => {
    const ingredientRows = Array.from({ length: 260 }, (_, index) => ({
      name: `Ingredient ${index}`,
      nestedRows: Array.from({ length: 60 }, (__, childIndex) => ({
        name: `Child ${childIndex}`,
      })),
    }));
    const nutritionRows = Array.from({ length: 300 }, (_, index) => ({
      name: `Nutrient ${index}`,
    }));

    const result = normalizePublicProductLabel({
      kind: "supplement",
      label: { ingredientRows, nutritionRows },
      servingGrams: 1,
    });

    expect(result.ingredients.active).toHaveLength(200);
    expect(result.ingredients.active[0]?.children).toHaveLength(50);
    expect(result.nutrition.rows).toHaveLength(256);
  });
});
