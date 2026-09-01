import type { PublicProductDetail } from "@murphai/contracts";

export const FOOD_METRICS = [
  {
    id: "calories",
    label: "Calories",
    preference: "lower",
    aliases: ["calories", "energy"],
  },
  {
    id: "protein",
    label: "Protein",
    preference: "higher",
    aliases: ["protein"],
  },
  {
    id: "sugars",
    label: "Total sugars",
    preference: "lower",
    aliases: ["total sugars", "sugars, total", "sugars"],
  },
  {
    id: "fat",
    label: "Total fat",
    preference: "lower",
    aliases: ["total fat", "total lipid (fat)", "fat, total"],
  },
] as const;

export type FoodMetric = (typeof FOOD_METRICS)[number];
export type FoodMetricId = FoodMetric["id"];
export type FoodMetricBasis = "per_100_g" | "per_serving";

export interface FoodMetricValue {
  value: number;
  unit: string;
}

export interface FoodMetricComparison {
  metric: FoodMetric;
  values: Map<string, FoodMetricValue>;
  winnerRefs: Set<string>;
  complete: boolean;
}

export interface FoodTopMatch {
  productRefs: Set<string>;
  winsByProductRef: Map<string, number>;
  comparableMetricCount: number;
}

export type EvidenceLevel = "limited" | "partial" | "reported";

export interface FoodEvidenceSummary {
  alertCount: number;
  gapCount: number;
  level: EvidenceLevel;
  testCount: number;
}

export type EvidenceTone = "affirmative" | "warning" | "unknown" | "neutral";

export interface EvidenceMatrixRow {
  analyte: string;
  status: string;
  tone: EvidenceTone;
  coveredSampleCount: number | null;
  totalSampleCount: number | null;
}

export interface EvidenceDimension {
  id: string;
  label: string;
  known: boolean;
  priority: "high" | "standard";
}

const METRIC_BY_ID = new Map<FoodMetricId, FoodMetric>(
  FOOD_METRICS.map((metric) => [metric.id, metric]),
);

export function getFoodMetric(metricId: FoodMetricId): FoodMetric {
  const metric = METRIC_BY_ID.get(metricId);
  if (!metric) {
    throw new Error(`Unknown food metric: ${metricId}`);
  }
  return metric;
}

export function getFoodMetricValue(
  product: PublicProductDetail,
  metricId: FoodMetricId,
  basis: FoodMetricBasis,
): FoodMetricValue | null {
  const metric = getFoodMetric(metricId);
  const row = product.nutrition.rows.find((candidate) => {
    const normalizedName = normalizeMetricName(candidate.name);
    return metric.aliases.some((alias) => alias === normalizedName);
  });
  const amount = row?.amount;

  if (!row || amount?.value == null || !amount.unit) {
    return null;
  }

  const sourceUnit = normalizeUnit(amount.unit);
  const expectedUnit = metricId === "calories" ? "kcal" : "g";
  if (sourceUnit !== expectedUnit) {
    return null;
  }

  if (row.basis === basis) {
    return { value: amount.value, unit: expectedUnit };
  }

  const servingGrams = product.serving?.grams;
  if (!servingGrams || row.basis === "source_unspecified") {
    return null;
  }

  const value = basis === "per_100_g"
    ? amount.value * (100 / servingGrams)
    : amount.value * (servingGrams / 100);

  return { value, unit: expectedUnit };
}

export function compareFoodMetrics(
  products: PublicProductDetail[],
  basis: FoodMetricBasis,
): FoodMetricComparison[] {
  return FOOD_METRICS.map((metric) => {
    const values = new Map<string, FoodMetricValue>();
    for (const product of products) {
      const value = getFoodMetricValue(product, metric.id, basis);
      if (value) {
        values.set(product.productRef, value);
      }
    }

    const numericValues = [...values.values()].map((value) => value.value);
    const winningValue = numericValues.length >= 2
      ? metric.preference === "higher"
        ? Math.max(...numericValues)
        : Math.min(...numericValues)
      : null;
    const winnerRefs = new Set<string>();

    if (winningValue !== null) {
      for (const [productRef, value] of values) {
        if (nearlyEqual(value.value, winningValue)) {
          winnerRefs.add(productRef);
        }
      }
    }

    return {
      metric,
      values,
      winnerRefs,
      complete: products.length >= 2 && values.size === products.length,
    };
  });
}

export function getFoodTopMatch(
  products: PublicProductDetail[],
  comparisons: FoodMetricComparison[],
): FoodTopMatch {
  const winsByProductRef = new Map(
    products.map((product) => [product.productRef, 0]),
  );
  let comparableMetricCount = 0;

  for (const comparison of comparisons) {
    if (!comparison.complete || comparison.winnerRefs.size === 0) {
      continue;
    }
    comparableMetricCount += 1;
    for (const productRef of comparison.winnerRefs) {
      winsByProductRef.set(productRef, (winsByProductRef.get(productRef) ?? 0) + 1);
    }
  }

  const highestWins = Math.max(0, ...winsByProductRef.values());
  const productRefs = new Set<string>();
  if (highestWins > 0) {
    for (const [productRef, wins] of winsByProductRef) {
      if (wins === highestWins) {
        productRefs.add(productRef);
      }
    }
  }

  return { productRefs, winsByProductRef, comparableMetricCount };
}

export function getFoodEvidenceSummary(
  product: PublicProductDetail,
): FoodEvidenceSummary {
  const testCount = product.productTests.total;
  const gapCount = product.unknowns.length;

  return {
    alertCount: product.productTests.alerts.length,
    gapCount,
    level: testCount === 0 ? "limited" : gapCount === 0 ? "reported" : "partial",
    testCount,
  };
}

export function getEvidenceMatrix(
  product: PublicProductDetail,
): EvidenceMatrixRow[] {
  const allSampleKeys = distinctSampleKeys(product.productTests.observations);
  const observationsByAnalyte = new Map<
    string,
    PublicProductDetail["productTests"]["observations"]
  >();

  for (const observation of product.productTests.observations) {
    const current = observationsByAnalyte.get(observation.analyte.name) ?? [];
    current.push(observation);
    observationsByAnalyte.set(observation.analyte.name, current);
  }

  return [...observationsByAnalyte.entries()].map(([analyte, observations]) => {
    const exceeds = observations.some(
      (observation) => observation.screening?.comparison === "exceeds",
    );
    const belowLimit = observations.every(
      (observation) => observation.screening?.comparison === "does_not_exceed",
    );
    const notDetected = observations.every(
      (observation) => observation.result.operator === "not_detected",
    );
    const coveredSampleKeys = distinctSampleKeys(observations);

    if (exceeds) {
      return matrixRow(analyte, "Above limit", "warning", coveredSampleKeys, allSampleKeys);
    }
    if (belowLimit) {
      return matrixRow(analyte, "Below limit", "affirmative", coveredSampleKeys, allSampleKeys);
    }
    if (notDetected) {
      return matrixRow(analyte, "Not detected", "affirmative", coveredSampleKeys, allSampleKeys);
    }
    if (observations.some((observation) => observation.screening === null)) {
      return matrixRow(analyte, "No limit", "unknown", coveredSampleKeys, allSampleKeys);
    }
    return matrixRow(analyte, "Measured", "neutral", coveredSampleKeys, allSampleKeys);
  });
}

export function getEvidenceDimensions(
  product: PublicProductDetail,
): EvidenceDimension[] {
  const unknownCodes = new Set(product.unknowns.map((unknown) => unknown.code));

  return [
    {
      id: "tests",
      label: "Exact product tests",
      known: !unknownCodes.has("NO_LINKED_PRODUCT_TESTS"),
      priority: "high",
    },
    {
      id: "lot",
      label: "Current lot",
      known: product.productTests.total > 0 && !unknownCodes.has("TESTED_LOT_NOT_REPORTED"),
      priority: "high",
    },
    {
      id: "thresholds",
      label: "Screening limits",
      known: product.productTests.total > 0 && !unknownCodes.has("TEST_THRESHOLD_NOT_COMPARABLE"),
      priority: "high",
    },
    {
      id: "nutrition",
      label: "Nutrition",
      known: !unknownCodes.has("NUTRITION_UNAVAILABLE"),
      priority: "standard",
    },
    {
      id: "ingredients",
      label: "Ingredients",
      known:
        !unknownCodes.has("INGREDIENTS_UNAVAILABLE") &&
        !unknownCodes.has("LABEL_CONTENT_OMITTED"),
      priority: "standard",
    },
    {
      id: "serving",
      label: "Serving mass",
      known: !unknownCodes.has("SERVING_MASS_UNAVAILABLE"),
      priority: "standard",
    },
    {
      id: "lab",
      label: "Named lab",
      known: product.productTests.total > 0 && !unknownCodes.has("TEST_LAB_NOT_REPORTED"),
      priority: "standard",
    },
    {
      id: "method",
      label: "Test method",
      known: product.productTests.total > 0 && !unknownCodes.has("TEST_METHOD_NOT_REPORTED"),
      priority: "standard",
    },
    {
      id: "formula",
      label: "Formula revision",
      known: !unknownCodes.has("FORMULA_REVISION_NOT_TRACKED"),
      priority: "standard",
    },
  ];
}

export function formatFoodMetricValue(value: FoodMetricValue): string {
  const rounded = Math.abs(value.value - Math.round(value.value)) < 0.05
    ? String(Math.round(value.value))
    : value.value.toFixed(1);
  return `${rounded} ${value.unit}`;
}

export function getFoodCategoryAsset(product: PublicProductDetail): string {
  const haystack = [
    product.name,
    product.brand ?? "",
    product.ingredients.statement ?? "",
  ].join(" ").toLowerCase();

  const categories: Array<[string, RegExp]> = [
    ["yogurt", /yogurt|yoghurt|skyr/u],
    ["cheese", /cheese|cheddar|mozzarella|parmesan/u],
    ["plant-milk", /oat milk|almond milk|soy milk|coconut milk/u],
    ["dairy-milk", /\bmilk\b|cream|half-and-half/u],
    ["eggs", /\begg|omelet/u],
    ["poultry", /chicken|turkey|duck/u],
    ["seafood", /salmon|tuna|fish|shrimp|cod|sardine/u],
    ["meat", /beef|pork|steak|bacon|ham|sausage/u],
    ["plant-protein", /tofu|tempeh|seitan|plant protein/u],
    ["legumes", /bean|lentil|chickpea|pea soup/u],
    ["fruit", /fruit|apple|banana|berry|orange|mango/u],
    ["vegetables", /vegetable|broccoli|spinach|carrot|kale/u],
    ["bread", /bread|bagel|tortilla/u],
    ["pasta-noodles", /pasta|noodle|spaghetti|macaroni/u],
    ["cereal-oats", /cereal|oat|granola/u],
    ["grains", /rice|quinoa|grain/u],
    ["nuts-seeds", /almond|peanut|cashew|walnut|seed/u],
    ["oils-fats", /olive oil|avocado oil|butter|ghee/u],
    ["sauces-condiments", /sauce|ketchup|mustard|mayo|dressing/u],
    ["soups-stews", /soup|stew|chili/u],
    ["pizza-flatbread", /pizza|flatbread/u],
    ["prepared-meals", /meal|bowl|entrée|entree|dinner/u],
    ["crackers-rice-cakes", /cracker|rice cake/u],
    ["bars", /protein bar|snack bar|energy bar/u],
    ["bakery", /cake|muffin|pastry|donut/u],
    ["cookies-sweets", /cookie|candy|chocolate|sweet/u],
    ["frozen-desserts", /ice cream|gelato|sorbet/u],
    ["sweet-drinks", /soda|cola|juice|energy drink/u],
    ["coffee-tea", /coffee|tea|matcha/u],
    ["water", /water|seltzer/u],
    ["alcohol", /beer|wine|vodka|whiskey|alcohol/u],
    ["baby-food", /baby food|infant/u],
  ];

  const category = categories.find(([, pattern]) => pattern.test(haystack))?.[0]
    ?? "snacks";
  return `/design-assets/food-label-lab/${category}.svg`;
}

function matrixRow(
  analyte: string,
  status: string,
  tone: EvidenceTone,
  coveredSampleKeys: Set<string>,
  allSampleKeys: Set<string>,
): EvidenceMatrixRow {
  return {
    analyte,
    status,
    tone,
    coveredSampleCount: allSampleKeys.size > 0 ? coveredSampleKeys.size : null,
    totalSampleCount: allSampleKeys.size > 0 ? allSampleKeys.size : null,
  };
}

function distinctSampleKeys(
  observations: PublicProductDetail["productTests"]["observations"],
): Set<string> {
  const keys = new Set<string>();
  for (const observation of observations) {
    const sample = observation.sample;
    const key = sample?.sourceSampleId
      ?? sample?.lotCode
      ?? [
        observation.source.key,
        observation.source.reportDate,
        observation.testedProduct.sourceProductId,
        sample?.testedOn,
      ].filter(Boolean).join(":");
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function normalizeMetricName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeUnit(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cal" || normalized === "kcalories") {
    return "kcal";
  }
  if (normalized === "gram" || normalized === "grams") {
    return "g";
  }
  return normalized;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.0001, Math.abs(right) * 0.000001);
}
