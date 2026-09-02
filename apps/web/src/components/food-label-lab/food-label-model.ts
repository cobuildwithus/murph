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
  alertsLowerBound: boolean;
  gapCount: number;
  level: EvidenceLevel;
  observationCount: number;
  returnedObservationCount: number;
  observationsTruncated: boolean;
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
    return foodMetricValue(amount.value, expectedUnit);
  }

  const servingGrams = product.serving?.grams;
  if (!servingGrams || row.basis === "source_unspecified") {
    return null;
  }

  const value = basis === "per_100_g"
    ? amount.value * (100 / servingGrams)
    : amount.value * (servingGrams / 100);

  return foodMetricValue(value, expectedUnit);
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

    const complete = products.length >= 2 && values.size === products.length;
    const numericValues = [...values.values()].map((value) => value.value);
    const winningValue = complete
      ? metric.preference === "higher"
        ? Math.max(...numericValues)
        : Math.min(...numericValues)
      : null;
    const winnerRefs = new Set<string>();

    if (winningValue !== null) {
      for (const [productRef, value] of values) {
        if (value.value === winningValue) {
          winnerRefs.add(productRef);
        }
      }
    }

    return {
      metric,
      values,
      winnerRefs,
      complete,
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
  const observationCount = product.productTests.total;
  const gapCount = product.unknowns.length;
  const alertCount = product.productTests.alerts.length;

  return {
    alertCount,
    alertsLowerBound: alertCount === 5,
    gapCount,
    level: observationCount === 0 ? "limited" : gapCount === 0 ? "reported" : "partial",
    observationCount,
    returnedObservationCount: product.productTests.returned,
    observationsTruncated: product.productTests.truncated,
  };
}

export function getFoodMetricConclusion(
  comparison: FoodMetricComparison,
  activeProductRef: string,
  productCount: number,
): string {
  if (!comparison.complete) {
    return `Values for ${comparison.values.size} of ${productCount} products`;
  }
  if (comparison.winnerRefs.has(activeProductRef)) {
    const direction = comparison.metric.preference === "higher" ? "highest" : "lowest";
    return comparison.winnerRefs.size > 1
      ? `Tied for ${direction}`
      : direction === "highest" ? "Highest" : "Lowest";
  }
  return `Compared across ${productCount} products`;
}

export function getFoodAlertLabel(
  summary: FoodEvidenceSummary,
  detail: boolean,
): string {
  if (summary.observationCount === 0) {
    return detail ? "No exact observations" : "No observations";
  }
  if (summary.alertCount === 0) {
    if (summary.observationsTruncated) {
      return detail ? "No alerts among shown observations" : "No alerts shown";
    }
    return detail ? "0 alerts in exact observations" : "0 alerts";
  }
  const count = summary.alertsLowerBound
    ? `At least ${summary.alertCount}`
    : String(summary.alertCount);
  const noun = summary.alertCount === 1 ? "alert" : "alerts";
  return detail ? `${count} ${noun} among shown observations` : `${count} ${noun}`;
}

export function getFoodObservationScope(summary: FoodEvidenceSummary): string {
  if (summary.observationsTruncated) {
    return `Showing ${summary.returnedObservationCount} of ${summary.observationCount} observations`;
  }
  return `${summary.observationCount} ${summary.observationCount === 1 ? "observation" : "observations"}`;
}

export function formatFoodMetricValue(value: FoodMetricValue): string {
  const display = Number.isInteger(value.value)
    ? String(value.value)
    : value.value.toFixed(1);
  return `${display} ${value.unit}`;
}

function foodMetricValue(value: number, unit: string): FoodMetricValue {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return { value: Object.is(rounded, -0) ? 0 : rounded, unit };
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
