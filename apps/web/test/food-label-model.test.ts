import { describe, expect, test } from "vitest";

import type { PublicProductDetail } from "@murphai/contracts";

import {
  compareFoodMetrics,
  getFoodAlertLabel,
  getFoodCategoryAsset,
  getFoodEvidenceSummary,
  getFoodMetricConclusion,
  getFoodMetricValue,
  getFoodObservationScope,
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

  test("preserves bounded observation scope in evidence summaries", () => {
    const product = makeFood("food_bounded");
    product.productTests.total = 21;
    product.productTests.returned = 20;
    product.productTests.truncated = true;
    product.productTests.observations = Array.from({ length: 20 }, (_, index) =>
      observation(`lead-${index}`, "Lead", "does_not_exceed", `sample-${index}`),
    );

    const summary = getFoodEvidenceSummary(product);
    expect(summary).toEqual(
      expect.objectContaining({
        alertCount: 0,
        observationCount: 21,
        returnedObservationCount: 20,
        observationsTruncated: true,
      }),
    );
    expect(getFoodAlertLabel(summary, true)).toBe(
      "No alerts among shown observations",
    );
    expect(getFoodObservationScope(summary)).toBe("Showing 20 of 21 observations");
  });

  test("treats the five-alert response cap as a lower bound", () => {
    const product = makeFood("food_alerts");
    product.productTests.alerts = Array.from({ length: 5 }, (_, index) =>
      alert(index),
    );

    const summary = getFoodEvidenceSummary(product);
    expect(summary).toEqual(
      expect.objectContaining({ alertCount: 5, alertsLowerBound: true }),
    );
    expect(getFoodAlertLabel(summary, true)).toBe(
      "At least 5 alerts among shown observations",
    );
  });

  test("selects a broad category illustration without using remote images", () => {
    const yogurt = makeFood("food_yogurt");
    yogurt.name = "Plain Greek Yogurt";

    expect(getFoodCategoryAsset(yogurt)).toBe(
      "/design-assets/food-label-lab/yogurt.svg",
    );
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
