import { describe, expect, test } from "vitest";

import {
  getPopularFoodBrands,
  getPopularFoodCategorySearchQuery,
  orderFoodsByPopularity,
} from "@/src/lib/food-popularity";

describe("food popularity categories", () => {
  test.each([
    ["milk", "whole milk"],
    ["chips", "potato chips"],
    ["cheese", "cheddar cheese"],
    ["bread", "sandwich bread"],
    ["cereal", "breakfast cereal"],
    ["water", "bottled water"],
    ["chocolate", "milk chocolate"],
    ["nut butter", "peanut butter"],
    ["coffee", "bottled coffee"],
    ["cooking oil", "olive oil"],
  ])("maps %s to the intended broad category", (query, category) => {
    expect(getPopularFoodBrands(query)).toEqual(getPopularFoodBrands(category));
  });

  test("does not guess a category from a partial word match", () => {
    expect(getPopularFoodBrands("berry yogurt snack")).toEqual([]);
    expect(getPopularFoodBrands("jack cheese board")).toEqual([]);
  });

  test("uses category terms to keep direct brand matches relevant", () => {
    expect(getPopularFoodCategorySearchQuery("soda")).toBe("soda OR cola");
    expect(getPopularFoodCategorySearchQuery("chips")).toBe("chips OR crisps");
    expect(getPopularFoodCategorySearchQuery("protein shakes")).toBe(
      '"protein shake" OR "nutrition shake"',
    );
    expect(getPopularFoodCategorySearchQuery("unknown category")).toBeNull();
  });

  test("orders known category brands before evidence and noisy variants", () => {
    const rows = [
      popularityRow("Unknown", "Plain potato chips", 40),
      popularityRow("LAY'S", "LAY'S 24 count variety pack", 30),
      popularityRow("Pringles", "Original potato crisps", 4),
      popularityRow("LAY'S", "Classic potato chips", 2),
      popularityRow("Miss Vickie's", "Sea salt potato chips", 0),
    ];

    expect(
      orderFoodsByPopularity(rows, "chips").map((row) => row.name),
    ).toEqual([
      "Classic potato chips",
      "LAY'S 24 count variety pack",
      "Sea salt potato chips",
      "Original potato crisps",
      "Plain potato chips",
    ]);
  });

  test("prefers a standard soda over flavored and miniature variants", () => {
    const rows = [
      popularityRow("COCA-COLA", "CHERRY SODA", 0),
      popularityRow("COCA-COLA", "SODA SOFT DRINK", 0),
      popularityRow("7UP", "MINI LEMON LIME SODA", 0),
      popularityRow("7UP", "DIET LEMON LIME SODA", 0),
      popularityRow("7UP", "7UP, CAFFEINE FREE SODA", 0),
    ];

    expect(orderFoodsByPopularity(rows, "soda").map((row) => row.name)).toEqual(
      [
        "SODA SOFT DRINK",
        "CHERRY SODA",
        "7UP, CAFFEINE FREE SODA",
        "DIET LEMON LIME SODA",
        "MINI LEMON LIME SODA",
      ],
    );
  });
});

function popularityRow(brand: string, name: string, observationCount: number) {
  return { brand, name, testing: { observationCount } };
}
