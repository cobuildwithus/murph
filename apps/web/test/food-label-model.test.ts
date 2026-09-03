import { describe, expect, test } from "vitest";

import type {
  PublicProductDetail,
  PublicProductSearchHit,
} from "@murphai/contracts";

import {
  FOOD_COMPARISON_LIMIT,
  FOOD_CATEGORY_FALLBACK_ASSET,
  buildFoodComparisonUrl,
  cleanFoodSearchHits,
  compareFoodMetrics,
  dedupeFoodSearchHits,
  getFoodCategoryAsset,
  getFoodComparisonCategoryQuery,
  getFoodEvidenceCoverage,
  getFoodEvidenceStatuses,
  getFoodEvidenceSummary,
  getFoodMetricConclusion,
  getFoodMetricValue,
  getFoodPackageSize,
  getFoodProductIdentity,
  getFoodTopMatch,
  hasOnlyZeroFoodNutrition,
  hasUsefulFoodComparisonData,
  orderFoodSearchHitsForDiversity,
  parseFoodComparisonUrl,
  selectDiverseFoodSearchHits,
} from "@/src/components/food-label-lab/food-label-model";

describe("food label comparison model", () => {
  test("caps one visible comparison at ten products", () => {
    expect(FOOD_COMPARISON_LIMIT).toBe(10);
  });

  test("selects different brands before a second product from one brand", () => {
    const hits = [
      makeSearchHit("food_a", "Shake A", "100000000001", "Premier Protein"),
      makeSearchHit("food_b", "Shake B", "100000000002", "Premier Protein"),
      makeSearchHit("food_c", "Shake C", "100000000003", "Fairlife"),
      makeSearchHit("food_d", "Shake D", "100000000004", "Orgain"),
      makeSearchHit("food_e", "Shake E", "100000000005", "OWYN"),
      makeSearchHit("food_f", "Shake F", "100000000006", "Fairlife"),
    ];

    expect(
      selectDiverseFoodSearchHits(hits, 4).map((hit) => hit.productRef),
    ).toEqual(["food_a", "food_c", "food_d", "food_e"]);
    expect(
      orderFoodSearchHitsForDiversity(hits).map((hit) => hit.productRef),
    ).toEqual(["food_a", "food_c", "food_d", "food_e", "food_b", "food_f"]);
  });

  test("stores only valid product references and the comparison basis in a share URL", () => {
    const nextUrl = buildFoodComparisonUrl(
      "/food?campaign=fall&debug=1#comparison",
      ["food_alpha", "invalid", "food_beta", "food_alpha"],
      "per_serving",
    );

    expect(nextUrl).toBe(
      "/food?campaign=fall&debug=1&compare=food_alpha%2Cfood_beta&basis=per_serving#comparison",
    );
    expect(
      parseFoodComparisonUrl(
        "?compare=food_alpha%2Cinvalid%2Cfood_beta%2Cfood_alpha&basis=per_serving",
      ),
    ).toEqual({
      basis: "per_serving",
      productRefs: ["food_alpha", "food_beta"],
    });
    expect(buildFoodComparisonUrl(nextUrl, [], "per_100_g")).toBe(
      "/food?campaign=fall&debug=1#comparison",
    );
  });

  test("normalizes the six visible metrics and converts between serving bases", () => {
    const product = makeFood("food_one", {
      calories: 100,
      protein: 8,
      sugars: 4,
      fat: 2,
      saturatedFat: 1,
      sodium: 80,
      servingGrams: 150,
    });

    expect(getFoodMetricValue(product, "calories", "per_100_g")).toEqual({
      unit: "kcal",
      value: 100,
    });
    expect(getFoodMetricValue(product, "protein", "per_serving")).toEqual({
      unit: "g",
      value: 12,
    });
    expect(getFoodMetricValue(product, "saturated_fat", "per_100_g")).toEqual({
      unit: "g",
      value: 1,
    });
    expect(getFoodMetricValue(product, "sodium", "per_serving")).toEqual({
      unit: "mg",
      value: 120,
    });
  });

  test("rounds calculated calories to the precision shown in the table", () => {
    const product = makeFood("food_calories", {
      calories: 133.45,
      servingGrams: 150,
    });

    expect(getFoodMetricValue(product, "calories", "per_serving")).toEqual({
      unit: "kcal",
      value: 200,
    });
  });

  test("does not treat an all-zero source panel as useful comparison data", () => {
    const product = makeFood("food_all_zero", {
      calories: 0,
      protein: 0,
      sugars: 0,
      fat: 0,
      saturatedFat: 0,
      sodium: 0,
    });
    product.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };

    expect(hasOnlyZeroFoodNutrition(product)).toBe(true);
    expect(hasUsefulFoodComparisonData(product)).toBe(false);
    expect(getFoodMetricValue(product, "calories", "per_100_g")).toBeNull();
    expect(getFoodEvidenceCoverage(product).segments[0]?.covered).toBe(false);
  });

  test("rejects physically impossible per-100-gram nutrition", () => {
    const product = makeFood("food_bad_scale", {
      calories: 1455,
      protein: 272.7,
      sugars: 9.1,
      fat: 27.3,
    });
    product.productTests.total = 4;

    expect(getFoodMetricValue(product, "calories", "per_100_g")).toBeNull();
    expect(getFoodMetricValue(product, "protein", "per_100_g")).toBeNull();
    expect(hasUsefulFoodComparisonData(product)).toBe(false);
  });

  test("keeps the top match metric-specific and separate from evidence", () => {
    const first = makeFood("food_first", {
      calories: 53,
      protein: 9.3,
      sugars: 2.7,
      fat: 0,
    });
    const second = makeFood("food_second", {
      calories: 106,
      protein: 10,
      sugars: 3.5,
      fat: 5.9,
    });
    const comparisons = compareFoodMetrics([first, second], "per_100_g");
    const topMatch = getFoodTopMatch([first, second], comparisons);

    expect(
      comparisons.find((row) => row.metric.id === "protein")?.winnerRefs,
    ).toEqual(new Set([second.productRef]));
    expect(topMatch.productRefs).toEqual(new Set([first.productRef]));
    expect(topMatch.winsByProductRef.get(first.productRef)).toBe(3);
    expect(topMatch.comparableMetricCount).toBe(6);
  });

  test("does not count a metric toward top match when one product lacks it", () => {
    const first = makeFood("food_first", { protein: 10 });
    const second = makeFood("food_second", { protein: 8 });
    second.nutrition.rows = second.nutrition.rows.filter(
      (row) => row.name !== "Total Fat",
    );

    const comparisons = compareFoodMetrics([first, second], "per_100_g");
    const topMatch = getFoodTopMatch([first, second], comparisons);

    const fat = comparisons.find((row) => row.metric.id === "fat");
    expect(fat?.complete).toBe(false);
    expect(fat?.winnerRefs).toEqual(new Set());
    if (!fat) {
      throw new Error("Fat comparison did not render.");
    }
    expect(getFoodMetricConclusion(fat, first.productRef, 2)).toBe(
      "Values for 1 of 2 products",
    );
    expect(topMatch.comparableMetricCount).toBe(5);
  });

  test("does not mark every product as a winner when all values tie", () => {
    const first = makeFood("food_first", { sugars: 0 });
    const second = makeFood("food_second", { sugars: 0 });

    const sugars = compareFoodMetrics([first, second], "per_100_g").find(
      (row) => row.metric.id === "sugars",
    );

    expect(sugars?.complete).toBe(true);
    expect(sugars?.winnerRefs).toEqual(new Set());
    if (!sugars) {
      throw new Error("Sugar comparison did not render.");
    }
    expect(getFoodMetricConclusion(sugars, second.productRef, 2)).toBe(
      "Compared across 2 products",
    );
  });

  test("uses the visible one-decimal value for converted winners", () => {
    const first = makeFood("food_first", { servingGrams: 150, sugars: 5 });
    const second = makeFood("food_second", { servingGrams: 121, sugars: 4 });
    setMetricBasis(first, "Total Sugars", "per_serving");
    setMetricBasis(second, "Total Sugars", "per_serving");

    const comparisons = compareFoodMetrics([first, second], "per_100_g");
    const sugars = comparisons.find((row) => row.metric.id === "sugars");
    if (!sugars) {
      throw new Error("Sugar comparison did not render.");
    }

    expect([...sugars.values.values()]).toEqual([
      { unit: "g", value: 3.3 },
      { unit: "g", value: 3.3 },
    ]);
    expect(sugars.winnerRefs).toEqual(new Set());
    expect(
      getFoodTopMatch([first, second], comparisons).winsByProductRef,
    ).toEqual(
      new Map([
        [first.productRef, 0],
        [second.productRef, 0],
      ]),
    );

    const secondSugars = second.nutrition.rows.find(
      (row) => row.name === "Total Sugars",
    );
    if (!secondSugars?.amount) {
      throw new Error("Second sugar value did not render.");
    }
    secondSugars.amount.value = 4.2;
    const visibleDifference = compareFoodMetrics(
      [first, second],
      "per_100_g",
    ).find((row) => row.metric.id === "sugars");
    expect(visibleDifference?.values.get(second.productRef)?.value).toBe(3.5);
    expect(visibleDifference?.winnerRefs).toEqual(new Set([first.productRef]));
  });

  test("uses exact alerts and known gaps without producing a safety score", () => {
    const limited = makeFood("food_limited");
    limited.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };
    limited.unknowns.push(unknown("NO_LINKED_PRODUCT_TESTS"));

    const summary = getFoodEvidenceSummary(limited);
    expect(summary.level).toBe("limited");
    expect(summary.alertCount).toBe(0);
    expect(summary.observationCount).toBe(0);
    expect(summary.returnedObservationCount).toBe(0);
    expect(limited.unknowns.map((entry) => entry.code)).toContain(
      "NO_LINKED_PRODUCT_TESTS",
    );
  });

  test("keeps evidence statuses separate for above, within, and no comparable limit", () => {
    const product = makeFood("food_bounded");
    product.productTests.total = 21;
    product.productTests.returned = 20;
    product.productTests.truncated = true;
    product.productTests.observations = [
      observation("bpa", "BPA", "exceeds", "sample-0"),
      observation("lead", "Lead", "does_not_exceed", "sample-1"),
      ...Array.from({ length: 18 }, (_, index) =>
        observation(`dehp-${index}`, "DEHP", null, `sample-${index + 2}`),
      ),
    ];

    expect(getFoodEvidenceSummary(product)).toEqual(
      expect.objectContaining({
        observationCount: 21,
        returnedObservationCount: 20,
        observationsTruncated: true,
      }),
    );
    expect(getFoodEvidenceStatuses(product)).toEqual([
      expect.objectContaining({
        id: "tests",
        tone: "neutral",
        detail: "20 of 21 results shown",
      }),
      expect.objectContaining({
        id: "above",
        tone: "alert",
        title: "1 above a screening limit",
      }),
      expect.objectContaining({
        id: "within",
        tone: "supported",
        title: "1 within a comparable limit",
      }),
      expect.objectContaining({
        id: "no_limit",
        tone: "unknown",
        title: "18 measured, no comparable limit",
      }),
    ]);

    const untested = makeFood("food_untested");
    untested.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };
    expect(getFoodEvidenceStatuses(untested)).toEqual([
      expect.objectContaining({
        id: "tests",
        tone: "unknown",
        title: "Not tested",
      }),
    ]);
  });

  test("meters record coverage, never safety", () => {
    const product = makeFood("food_coverage");
    product.productTests.observations = [
      observation("bpa", "BPA", null, "sample-0"),
    ];
    if (product.serving) {
      product.serving.grams = null;
    }

    const coverage = getFoodEvidenceCoverage(product);
    expect(
      coverage.segments.map((segment) => [segment.id, segment.covered]),
    ).toEqual([
      ["nutrition", true],
      ["serving", false],
      ["ingredients", true],
      ["tests", true],
      ["limits", false],
    ]);
    expect(coverage.coveredCount).toBe(3);
  });

  test("treats the five-alert response cap as a lower bound", () => {
    const product = makeFood("food_alerts");
    product.productTests.alerts = Array.from({ length: 5 }, (_, index) =>
      alert(index),
    );

    expect(getFoodEvidenceSummary(product)).toEqual(
      expect.objectContaining({ alertCount: 5, alertsLowerBound: true }),
    );
  });

  test("matches the product name before ingredients and falls back to generic packaged food", () => {
    const bar = makeFood("food_bar");
    bar.name = "DARK CHOCOLATE NUTS & SEA SALT BAR";
    bar.brand = "KIND";
    bar.ingredients.statement = "ALMONDS, PEANUTS, MILK, CREAM, CHOCOLATE.";
    expect(getFoodCategoryAsset(bar)).toBe(
      "/design-assets/food-label-lab/bars.svg",
    );

    const brandedBar = makeFood("food_branded_bar");
    brandedBar.name = "BREAKFAST BARS";
    brandedBar.brand = "EXAMPLE PROTEIN";
    expect(getFoodComparisonCategoryQuery(brandedBar)).toBe("protein bars");

    const shake = makeFood("food_shake");
    shake.name = "CHOCOLATE HIGH PROTEIN MILK SHAKE, CHOCOLATE";
    expect(getFoodCategoryAsset(shake)).toBe(
      "/design-assets/food-label-lab/protein-shake.svg",
    );

    const flavoredShake = makeFood("food_flavored_shake");
    flavoredShake.name = "HIGH PROTEIN 30 G SHAKES, NUT BUTTER FLAVOR";
    expect(getFoodCategoryAsset(flavoredShake)).toBe(
      "/design-assets/food-label-lab/protein-shake.svg",
    );
    expect(getFoodComparisonCategoryQuery(flavoredShake)).toBe(
      "protein shakes",
    );

    const yogurt = makeFood("food_yogurt");
    yogurt.name = "PLAIN ORGANIC GREEK WHOLE MILK YOGURT, PLAIN";
    expect(getFoodCategoryAsset(yogurt)).toBe(
      "/design-assets/food-label-lab/yogurt.svg",
    );

    const bites = makeFood("food_bites");
    bites.name = "RXBAR Dark Chocolate Peanut Butter Bites";
    bites.brand = "RXBAR";
    expect(getFoodCategoryAsset(bites)).toBe(
      "/design-assets/food-label-lab/bars.svg",
    );

    const pops = makeFood("food_pops");
    pops.name = "OAT MILK POPS, OAT MILK";
    pops.brand = "JONNY POPS";
    expect(getFoodCategoryAsset(pops)).toBe(
      "/design-assets/food-label-lab/frozen-desserts.svg",
    );

    const brandOnly = makeFood("food_brand_only");
    brandOnly.name = "WASABI PEAS";
    brandOnly.brand = "Mountain Man Nut & Fruit Co.";
    brandOnly.ingredients.statement = null;
    expect(getFoodCategoryAsset(brandOnly)).toBe(FOOD_CATEGORY_FALLBACK_ASSET);

    const cola = makeFood("food_cola");
    cola.name = "Coca-Cola 2 litre Non-Refillable Plastic Bottle";
    cola.brand = "Coca-Cola";
    cola.ingredients.statement = "CARBONATED WATER, HIGH FRUCTOSE CORN SYRUP.";
    expect(getFoodCategoryAsset(cola)).toBe(
      "/design-assets/food-label-lab/sweet-drinks.svg",
    );
    expect(getFoodComparisonCategoryQuery(cola)).toBe("soda");
    expect(getFoodComparisonCategoryQuery(yogurt)).toBe("greek yogurt");
    expect(getFoodComparisonCategoryQuery(bar)).toBe("bars");

    const byIngredients = makeFood("food_ingredients");
    byIngredients.name = "ORIGINAL";
    byIngredients.brand = "Example";
    byIngredients.ingredients.statement = "CULTURED PASTEURIZED MILK.";
    expect(getFoodCategoryAsset(byIngredients)).toBe(
      "/design-assets/food-label-lab/yogurt.svg",
    );

    const unknownFood = makeFood("food_unknown");
    unknownFood.name = "ORIGINAL";
    unknownFood.brand = "Example";
    unknownFood.ingredients.statement = null;
    expect(getFoodCategoryAsset(unknownFood)).toBe(
      FOOD_CATEGORY_FALLBACK_ASSET,
    );
    expect(getFoodComparisonCategoryQuery(unknownFood)).toBeNull();
    expect(FOOD_CATEGORY_FALLBACK_ASSET).toBe(
      "/design-assets/food-label-lab/packaged-food.svg",
    );
  });

  test("cleans shouting names, repeated flavors, and package sizes without inventing data", () => {
    expect(
      getFoodProductIdentity({
        name: "STRAWBERRY PROTEIN BAR, STRAWBERRY",
        brand: "RXBAR",
        serving: { description: "1 bar", amount: 52, unit: "GRM", grams: 52 },
      }),
    ).toEqual({
      brand: "RXBAR",
      title: "Strawberry Protein Bar",
      size: "52 g",
    });

    expect(
      getFoodProductIdentity({
        name: "Organic Plain Nonfat Greek Yogurt, 32 oz",
        brand: "Straus",
      }),
    ).toEqual({
      brand: "Straus",
      title: "Organic Plain Nonfat Greek Yogurt",
      size: "32 oz",
    });

    expect(
      getFoodProductIdentity({
        name: "RXBAR Protein Bars, Blueberry Cashew Butter",
        brand: "RXBAR",
      }).title,
    ).toBe("Blueberry Cashew Butter Protein Bars");
    expect(
      getFoodProductIdentity({
        name: "COMPLETE PROTEIN 42 G ELITE HIGH PROTEIN MILK SHAKE, VANILLA, VANILLA",
        brand: "CORE POWER",
      }).title,
    ).toBe("Vanilla Complete Protein 42 G Elite High Protein Milk Shake");

    expect(
      getFoodProductIdentity({ name: "GREEK YOGURT", brand: "CORE POWER" })
        .brand,
    ).toBe("Core Power");
    expect(
      getFoodProductIdentity({
        name: "FIZZ7, SODA",
        brand: "Example Drinks, Inc.",
      }),
    ).toEqual({ brand: "FIZZ7", title: "Soda", size: null });
    expect(
      getFoodProductIdentity({
        name: "WHEY PROTEIN BAR",
        brand: "Example Foods Co./powerbar-Distribution",
      }),
    ).toEqual({ brand: "Powerbar", title: "Whey Protein Bar", size: null });
    expect(
      getFoodProductIdentity({
        name: "HIGH PROTEIN SHAKE",
        brand: "EXAMPLE",
        serving: { description: "1 fl", amount: 330, unit: null, grams: null },
      }),
    ).toEqual({ brand: "Example", title: "High Protein Shake", size: null });
    expect(
      getFoodProductIdentity({ name: "Coca-Cola Can", brand: "Coca-Cola" }),
    ).toEqual({ brand: "Coca-Cola", title: "", size: null });
    expect(
      getFoodProductIdentity({ name: "Snickers", brand: "Snickers" }),
    ).toEqual({ brand: "Snickers", title: "", size: null });
    expect(
      getFoodPackageSize("BLUEBERRY 12 G. PROTEIN BAR, BLUEBERRY"),
    ).toBeNull();
    expect(
      getFoodPackageSize("Coca-Cola 24-16.9 fluid ounce (US) Bottle"),
    ).toBe("24 × 16.9 fl oz");
    expect(
      getFoodProductIdentity({
        name: "RXBAR PROTEIN BAR, 1.83 OZ, 10 COUNT",
        brand: "RXBAR",
      }),
    ).toEqual({ brand: "RXBAR", title: "Protein Bar", size: "10 × 1.83 oz" });
    expect(
      getFoodPackageSize("COMPLETE PROTEIN 42 G ELITE HIGH PROTEIN MILK SHAKE"),
    ).toBeNull();
  });

  test("collapses duplicate non-null UPC rows and keeps distinct packages", () => {
    const hits = [
      { productRef: "food_a", upc: "00049000050103" },
      { productRef: "food_b", upc: "49000050103" },
      { productRef: "food_c", upc: "00049000012590" },
      { productRef: "food_d", upc: null },
      { productRef: "food_e", upc: null },
    ];

    expect(dedupeFoodSearchHits(hits).map((hit) => hit.productRef)).toEqual([
      "food_a",
      "food_c",
      "food_d",
      "food_e",
    ]);
  });

  test("hides multipacks from broad searches and keeps them for explicit package queries", () => {
    const hits = [
      makeSearchHit("food_pack", "PEPSI Cola, 16.9 Fl Oz, 24 Count", "001"),
      makeSearchHit("food_single", "PEPSI Soda, 12 Fl Oz", "002"),
      makeSearchHit("food_unsized", "PEPSI Wild Cherry Cola", "003"),
    ];

    expect(
      cleanFoodSearchHits(hits, "pepsi").map((hit) => hit.productRef),
    ).toEqual(["food_single", "food_unsized"]);
    expect(
      cleanFoodSearchHits(hits, "24 count").map((hit) => hit.productRef),
    ).toContain("food_pack");
    expect(cleanFoodSearchHits(hits, "001")).toEqual(hits);
  });

  test("puts the canonical product first for an exact brand query", () => {
    const hits = [
      makeSearchHit(
        "food_ice_cream",
        "Chopped Snickers Bars, Caramel, Chocolate Chips, Nougat Whipped Icing, Vanilla Ice Cream",
        "001",
        "Snickers",
      ),
      makeSearchHit("food_minis", "Snickers Minis", "002", "Snickers"),
      makeSearchHit("food_original", "Snickers", "003", "Snickers"),
      makeSearchHit(
        "food_almond",
        "Snickers Almond Bar",
        "004",
        "Snickers",
        20,
      ),
    ];

    expect(
      cleanFoodSearchHits(hits, "snickers").map((hit) => hit.productRef),
    ).toEqual(["food_original", "food_minis", "food_almond", "food_ice_cream"]);
    expect(
      cleanFoodSearchHits(hits, "snickers", "evidence").map(
        (hit) => hit.productRef,
      ),
    ).toEqual(["food_original", "food_almond", "food_minis", "food_ice_cream"]);
  });

  test("removes baking products from a soda comparison", () => {
    const hits = [
      makeSearchHit("food_baking", "100% Pure Baking Soda", "001"),
      makeSearchHit("food_cola", "Cola, 12 Fl Oz", "002", "Coca-Cola"),
    ];

    expect(
      cleanFoodSearchHits(hits, "soda", "popular").map((hit) => hit.productRef),
    ).toEqual(["food_cola"]);
  });
});

function makeFood(
  productRef: string,
  values: {
    calories?: number;
    protein?: number;
    sugars?: number;
    fat?: number;
    saturatedFat?: number;
    sodium?: number;
    servingGrams?: number;
  } = {},
): PublicProductDetail {
  return {
    productRef,
    kind: "food",
    name: "Example Food",
    brand: "Example",
    upc: "123456789012",
    marketStatus: "active",
    serving: {
      description: "1 cup",
      amount: 1,
      unit: "cup",
      grams: values.servingGrams ?? 100,
    },
    ingredients: {
      structure: "statement_only",
      statement: "Milk.",
      otherStatement: null,
      active: [],
      other: [],
    },
    nutrition: {
      basis: "per_100_g",
      rows: [
        row("Calories", values.calories ?? 90, "kcal"),
        row("Protein", values.protein ?? 9, "g"),
        row("Total Sugars", values.sugars ?? 3, "g"),
        row("Total Fat", values.fat ?? 4, "g"),
        row("Fatty acids, total saturated", values.saturatedFat ?? 1, "g"),
        row("Sodium, Na", values.sodium ?? 50, "mg"),
      ],
    },
    productTests: {
      status: "known_product_tests",
      total: 1,
      returned: 1,
      truncated: false,
      observations: [
        observation("lead", "Lead", "does_not_exceed", "sample-a"),
      ],
      alerts: [],
    },
    source: {
      key: "brand_site",
      name: "Official brand label",
      recordId: productRef,
      url: "https://example.com/label",
      releaseDate: null,
      lastSeenAt: null,
      importedAt: null,
    },
    unknowns: [unknown("FORMULA_REVISION_NOT_TRACKED")],
  };
}

function makeSearchHit(
  productRef: string,
  name: string,
  upc: string,
  brand = "PEPSI",
  linkedTests = 0,
): PublicProductSearchHit {
  return {
    productRef,
    kind: "food",
    name,
    brand,
    upc,
    source: { key: "usda", name: "USDA FoodData Central" },
    productTests:
      linkedTests > 0
        ? { status: "known_product_tests", total: linkedTests }
        : { status: "no_known_product_tests", total: 0 },
  };
}

function row(name: string, value: number, unit: string) {
  return {
    name,
    amount: { value, unit, display: String(value) },
    dailyValuePercent: null,
    basis: "per_100_g" as const,
  };
}

function setMetricBasis(
  product: PublicProductDetail,
  metricName: string,
  basis: "per_100_g" | "per_serving",
) {
  const metric = product.nutrition.rows.find((row) => row.name === metricName);
  if (!metric) {
    throw new Error(`Metric ${metricName} is missing from the product.`);
  }
  metric.basis = basis;
}

function unknown(
  code: PublicProductDetail["unknowns"][number]["code"],
): PublicProductDetail["unknowns"][number] {
  return { code, title: code, description: "Synthetic gap." };
}

function observation(
  key: string,
  name: string,
  comparison: "does_not_exceed" | "exceeds" | null,
  sampleId: string,
  operator: "lt" | "not_detected" | "detected" = "lt",
): PublicProductDetail["productTests"]["observations"][number] {
  return {
    id: `${key}-${sampleId}`,
    analyte: { key, name },
    result: {
      operator,
      value: operator === "not_detected" ? null : 0.5,
      unit: "ppb",
      basis: "tested sample",
    },
    normalizedResult: null,
    source: {
      key: "lab",
      name: "Lab",
      url: null,
      reportTitle: null,
      reportDate: "2026-08-12",
    },
    testedProduct: {
      name: "Example Food",
      brand: "Example",
      upc: "123456789012",
      sourceProductId: "example",
      matchMethod: "exact_upc",
    },
    sample: {
      evidenceType: "laboratory_measurement",
      samplingContext: "retail_purchase",
      sourceSampleId: sampleId,
      sampleCount: 1,
      reportedUpc: "123456789012",
      lotCode: sampleId,
      bestBy: null,
      packageSize: null,
      collectedOn: null,
      testedOn: null,
      labName: "Lab",
      testMethod: "Method",
    },
    labName: "Lab",
    testMethod: "Method",
    screening: comparison
      ? {
          comparison,
          threshold: {
            value: 5,
            unit: "ppb",
            basis: "tested sample",
            authority: "Example",
            name: "Example limit",
            url: null,
          },
        }
      : null,
  };
}

function alert(
  index: number,
): PublicProductDetail["productTests"]["alerts"][number] {
  const item = observation(
    `lead-${index}`,
    "Lead",
    "exceeds",
    `sample-${index}`,
  );
  if (!item.screening) {
    throw new Error("Synthetic alert requires a screening threshold.");
  }
  return {
    analyte: item.analyte,
    concernLevel: "high",
    result: item.result,
    threshold: item.screening.threshold,
    source: item.source,
    testedProduct: item.testedProduct,
    sample: item.sample,
  };
}
