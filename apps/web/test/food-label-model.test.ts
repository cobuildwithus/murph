import { describe, expect, test } from "vitest";

import type { PublicProductDetail } from "@murphai/contracts";

import {
  FOOD_CATEGORY_FALLBACK_ASSET,
  compareFoodMetrics,
  dedupeFoodSearchHits,
  getFoodCategoryAsset,
  getFoodEvidenceCoverage,
  getFoodEvidenceStatuses,
  getFoodEvidenceSummary,
  getFoodLeadSummary,
  getFoodMetricConclusion,
  getFoodMetricValue,
  getFoodPackageSize,
  getFoodProductIdentity,
  getFoodTopMatch,
} from "@/src/components/food-label-lab/food-label-model";

describe("food label comparison model", () => {
  test("normalizes the four visible metrics and converts between serving bases", () => {
    const product = makeFood("food_one", {
      calories: 100,
      protein: 8,
      sugars: 4,
      fat: 2,
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

    expect(comparisons.find((row) => row.metric.id === "protein")?.winnerRefs)
      .toEqual(new Set([second.productRef]));
    expect(topMatch.productRefs).toEqual(new Set([first.productRef]));
    expect(topMatch.winsByProductRef.get(first.productRef)).toBe(3);
    expect(topMatch.comparableMetricCount).toBe(4);
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
    expect(topMatch.comparableMetricCount).toBe(3);
  });

  test("keeps equal complete values as tied winners", () => {
    const first = makeFood("food_first", { sugars: 0 });
    const second = makeFood("food_second", { sugars: 0 });

    const sugars = compareFoodMetrics([first, second], "per_100_g").find(
      (row) => row.metric.id === "sugars",
    );

    expect(sugars?.complete).toBe(true);
    expect(sugars?.winnerRefs).toEqual(new Set([first.productRef, second.productRef]));
    if (!sugars) {
      throw new Error("Sugar comparison did not render.");
    }
    expect(getFoodMetricConclusion(sugars, second.productRef, 2)).toBe(
      "Tied for lowest",
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
    expect(sugars.winnerRefs).toEqual(
      new Set([first.productRef, second.productRef]),
    );
    expect(getFoodTopMatch([first, second], comparisons).winsByProductRef)
      .toEqual(new Map([[first.productRef, 4], [second.productRef, 4]]));

    const secondSugars = second.nutrition.rows.find(
      (row) => row.name === "Total Sugars",
    );
    if (!secondSugars?.amount) {
      throw new Error("Second sugar value did not render.");
    }
    secondSugars.amount.value = 4.2;
    const visibleDifference = compareFoodMetrics([first, second], "per_100_g")
      .find((row) => row.metric.id === "sugars");
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

  test("keeps the lead summary on visible rows only", () => {
    const first = makeFood("food_first", { calories: 50, protein: 9, sugars: 2, fat: 0 });
    first.brand = "Chobani";
    first.name = "Plain Nonfat Greek Yogurt";
    const second = makeFood("food_second", { calories: 100, protein: 10, sugars: 3, fat: 5 });
    const comparisons = compareFoodMetrics([first, second], "per_100_g");
    const topMatch = getFoodTopMatch([first, second], comparisons);

    expect(getFoodLeadSummary([first, second], topMatch)).toBe(
      "Chobani Plain Nonfat Greek Yogurt leads 3 of 4 comparable rows.",
    );
    expect(getFoodLeadSummary([first], getFoodTopMatch([first], []))).toBeNull();

    const twin = makeFood("food_twin", { calories: 50, protein: 9, sugars: 2, fat: 0 });
    twin.brand = "Chobani";
    twin.name = "Plain Nonfat Greek Yogurt";
    const tiedComparisons = compareFoodMetrics([first, twin], "per_100_g");
    expect(getFoodLeadSummary([first, twin], getFoodTopMatch([first, twin], tiedComparisons))).toBe(
      "All 2 products lead 4 of 4 comparable rows.",
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
      expect.objectContaining({ id: "tests", tone: "neutral", detail: "20 of 21 results shown" }),
      expect.objectContaining({ id: "above", tone: "alert", title: "1 above a screening limit" }),
      expect.objectContaining({ id: "within", tone: "supported", title: "1 within a comparable limit" }),
      expect.objectContaining({ id: "no_limit", tone: "unknown", title: "18 measured, no comparable limit" }),
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
      expect.objectContaining({ id: "tests", tone: "unknown", title: "Not tested" }),
    ]);
  });

  test("meters record coverage, never safety", () => {
    const product = makeFood("food_coverage");
    product.productTests.observations = [observation("bpa", "BPA", null, "sample-0")];
    if (product.serving) {
      product.serving.grams = null;
    }

    const coverage = getFoodEvidenceCoverage(product);
    expect(coverage.segments.map((segment) => [segment.id, segment.covered])).toEqual([
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
    expect(getFoodCategoryAsset(bar)).toBe("/design-assets/food-label-lab/bars.svg");

    const shake = makeFood("food_shake");
    shake.name = "CHOCOLATE HIGH PROTEIN MILK SHAKE, CHOCOLATE";
    expect(getFoodCategoryAsset(shake)).toBe("/design-assets/food-label-lab/protein-shake.svg");

    const yogurt = makeFood("food_yogurt");
    yogurt.name = "PLAIN ORGANIC GREEK WHOLE MILK YOGURT, PLAIN";
    expect(getFoodCategoryAsset(yogurt)).toBe("/design-assets/food-label-lab/yogurt.svg");

    const bites = makeFood("food_bites");
    bites.name = "RXBAR Dark Chocolate Peanut Butter Bites";
    bites.brand = "RXBAR";
    expect(getFoodCategoryAsset(bites)).toBe("/design-assets/food-label-lab/bars.svg");

    const pops = makeFood("food_pops");
    pops.name = "OAT MILK POPS, OAT MILK";
    pops.brand = "JONNY POPS";
    expect(getFoodCategoryAsset(pops)).toBe("/design-assets/food-label-lab/frozen-desserts.svg");

    const brandOnly = makeFood("food_brand_only");
    brandOnly.name = "WASABI PEAS";
    brandOnly.brand = "Mountain Man Nut & Fruit Co.";
    brandOnly.ingredients.statement = null;
    expect(getFoodCategoryAsset(brandOnly)).toBe(FOOD_CATEGORY_FALLBACK_ASSET);

    const cola = makeFood("food_cola");
    cola.name = "Coca-Cola 2 litre Non-Refillable Plastic Bottle";
    cola.brand = "Coca-Cola";
    cola.ingredients.statement = "CARBONATED WATER, HIGH FRUCTOSE CORN SYRUP.";
    expect(getFoodCategoryAsset(cola)).toBe("/design-assets/food-label-lab/sweet-drinks.svg");

    const byIngredients = makeFood("food_ingredients");
    byIngredients.name = "ORIGINAL";
    byIngredients.brand = "Example";
    byIngredients.ingredients.statement = "CULTURED PASTEURIZED MILK.";
    expect(getFoodCategoryAsset(byIngredients)).toBe("/design-assets/food-label-lab/yogurt.svg");

    const unknownFood = makeFood("food_unknown");
    unknownFood.name = "ORIGINAL";
    unknownFood.brand = "Example";
    unknownFood.ingredients.statement = null;
    expect(getFoodCategoryAsset(unknownFood)).toBe(FOOD_CATEGORY_FALLBACK_ASSET);
    expect(FOOD_CATEGORY_FALLBACK_ASSET).toBe("/design-assets/food-label-lab/packaged-food.svg");
  });

  test("cleans shouting names, repeated flavors, and package sizes without inventing data", () => {
    expect(getFoodProductIdentity({
      name: "STRAWBERRY PROTEIN BAR, STRAWBERRY",
      brand: "RXBAR",
      serving: { description: "1 bar", amount: 52, unit: "GRM", grams: 52 },
    })).toEqual({ brand: "RXBAR", title: "Strawberry Protein Bar", size: "52 g serving" });

    expect(getFoodProductIdentity({
      name: "Organic Plain Nonfat Greek Yogurt, 32 oz",
      brand: "Straus",
    })).toEqual({ brand: "Straus", title: "Organic Plain Nonfat Greek Yogurt, 32 oz", size: "32 oz" });

    expect(getFoodProductIdentity({
      name: "RXBAR Protein Bars, Blueberry Cashew Butter",
      brand: "RXBAR",
    }).title).toBe("Blueberry Cashew Butter Protein Bars");
    expect(getFoodProductIdentity({
      name: "COMPLETE PROTEIN 42 G ELITE HIGH PROTEIN MILK SHAKE, VANILLA, VANILLA",
      brand: "CORE POWER",
    }).title).toBe("Vanilla Complete Protein 42 G Elite High Protein Milk Shake");

    expect(getFoodProductIdentity({ name: "GREEK YOGURT", brand: "CORE POWER" }).brand).toBe("Core Power");
    expect(getFoodPackageSize("BLUEBERRY 12 G. PROTEIN BAR, BLUEBERRY")).toBeNull();
    expect(getFoodPackageSize("Coca-Cola 24-16.9 fluid ounce (US) Bottle")).toBe("24 × 16.9 fl oz");
    expect(getFoodProductIdentity({
      name: "RXBAR PROTEIN BAR, 1.83 OZ, 10 COUNT",
      brand: "RXBAR",
    })).toEqual({ brand: "RXBAR", title: "Protein Bar, 1.83 Oz, 10 Count", size: "10 × 1.83 oz" });
    expect(getFoodPackageSize("COMPLETE PROTEIN 42 G ELITE HIGH PROTEIN MILK SHAKE")).toBeNull();
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
});

function makeFood(
  productRef: string,
  values: {
    calories?: number;
    protein?: number;
    sugars?: number;
    fat?: number;
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
      ],
    },
    productTests: {
      status: "known_product_tests",
      total: 1,
      returned: 1,
      truncated: false,
      observations: [observation("lead", "Lead", "does_not_exceed", "sample-a")],
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
  const item = observation(`lead-${index}`, "Lead", "exceeds", `sample-${index}`);
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
