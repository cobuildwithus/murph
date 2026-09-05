import type {
  PublicProductDetail,
  PublicProductSearchHit,
} from "@murphai/contracts";

export const FOOD_METRICS = [
  {
    id: "calories",
    label: "Calories",
    preference: "lower",
    aliases: ["calories", "energy"],
    unit: "kcal",
  },
  {
    id: "protein",
    label: "Protein",
    preference: "higher",
    aliases: ["protein"],
    unit: "g",
  },
  {
    id: "sugars",
    label: "Total sugars",
    preference: "lower",
    aliases: ["total sugars", "sugars, total", "sugars"],
    unit: "g",
  },
  {
    id: "fat",
    label: "Total fat",
    preference: "lower",
    aliases: ["total fat", "total lipid (fat)", "fat, total"],
    unit: "g",
  },
  {
    id: "saturated_fat",
    label: "Saturated fat",
    preference: "lower",
    aliases: ["saturated fat", "fatty acids, total saturated"],
    unit: "g",
  },
  {
    id: "sodium",
    label: "Sodium",
    preference: "lower",
    aliases: ["sodium", "sodium, na"],
    unit: "mg",
  },
] as const;

export const FOOD_COMPARISON_LIMIT = 10;

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

export interface FoodEvidenceSegment {
  id: "nutrition" | "serving" | "ingredients" | "tests" | "limits";
  label: string;
  covered: boolean;
}

export interface FoodEvidenceCoverage {
  segments: FoodEvidenceSegment[];
  coveredCount: number;
}

export type FoodEvidenceTone = "alert" | "supported" | "unknown" | "neutral";

export interface FoodEvidenceStatus {
  id: "tests" | "above" | "within" | "no_limit";
  tone: FoodEvidenceTone;
  title: string;
  detail: string;
}

export interface FoodProductIdentity {
  brand: string | null;
  title: string;
  size: string | null;
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

function readFoodMetricValue(
  product: PublicProductDetail,
  metricId: FoodMetricId,
  basis: FoodMetricBasis,
): FoodMetricValue | null {
  if (hasOnlyZeroFoodNutrition(product)) {
    return null;
  }

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
  const expectedUnit = metric.unit;
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

  const value =
    basis === "per_100_g"
      ? amount.value * (100 / servingGrams)
      : amount.value * (servingGrams / 100);

  return foodMetricValue(value, expectedUnit);
}

const FOOD_METRIC_PER_100_G_MAX: Record<FoodMetricId, number> = {
  calories: 1_000,
  protein: 100,
  sugars: 100,
  fat: 100,
  saturated_fat: 100,
  sodium: 100_000,
};

function isPlausibleFoodMetricValue(
  metricId: FoodMetricId,
  value: FoodMetricValue,
  basis: FoodMetricBasis,
): boolean {
  return (
    basis !== "per_100_g" || value.value <= FOOD_METRIC_PER_100_G_MAX[metricId]
  );
}

export function getFoodMetricValue(
  product: PublicProductDetail,
  metricId: FoodMetricId,
  basis: FoodMetricBasis,
): FoodMetricValue | null {
  const value = readFoodMetricValue(product, metricId, basis);
  return value && isPlausibleFoodMetricValue(metricId, value, basis)
    ? value
    : null;
}

export function hasOnlyZeroFoodNutrition(
  product: PublicProductDetail,
): boolean {
  const values = product.nutrition.rows.flatMap((row) =>
    row.amount?.value == null ? [] : [row.amount.value],
  );
  return values.length > 0 && values.every((value) => value === 0);
}

export function hasUsefulFoodComparisonData(
  product: PublicProductDetail,
): boolean {
  const hasImplausibleMetric = FOOD_METRICS.some((metric) => {
    const value = readFoodMetricValue(product, metric.id, "per_100_g");
    return (
      value !== null &&
      !isPlausibleFoodMetricValue(metric.id, value, "per_100_g")
    );
  });
  if (hasImplausibleMetric) {
    return false;
  }
  if (hasOnlyZeroFoodNutrition(product)) {
    return false;
  }
  return (["calories", "protein", "sugars", "fat"] as const).every(
    (metricId) =>
      getFoodMetricValue(product, metricId, "per_100_g") !== null,
  );
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
      if (winnerRefs.size === products.length) {
        winnerRefs.clear();
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
    if (!comparison.complete) {
      continue;
    }
    comparableMetricCount += 1;
    for (const productRef of comparison.winnerRefs) {
      winsByProductRef.set(
        productRef,
        (winsByProductRef.get(productRef) ?? 0) + 1,
      );
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
    level:
      observationCount === 0
        ? "limited"
        : gapCount === 0
        ? "reported"
        : "partial",
    observationCount,
    returnedObservationCount: product.productTests.returned,
    observationsTruncated: product.productTests.truncated,
  };
}

export function getFoodEvidenceCoverage(
  product: PublicProductDetail,
): FoodEvidenceCoverage {
  const codes = new Set(product.unknowns.map((unknown) => unknown.code));
  const segments: FoodEvidenceSegment[] = [
    {
      id: "nutrition",
      label: "Nutrition label",
      covered:
        product.nutrition.rows.length > 0 &&
        !hasOnlyZeroFoodNutrition(product) &&
        !codes.has("NUTRITION_UNAVAILABLE"),
    },
    {
      id: "serving",
      label: "Serving mass",
      covered: Boolean(product.serving?.grams),
    },
    {
      id: "ingredients",
      label: "Ingredients",
      covered:
        Boolean(product.ingredients.statement) ||
        product.ingredients.active.length > 0 ||
        product.ingredients.other.length > 0,
    },
    {
      id: "tests",
      label: "Linked product tests",
      covered: product.productTests.total > 0,
    },
    {
      id: "limits",
      label: "Comparable screening limit",
      covered: product.productTests.observations.some(
        (observation) => observation.screening !== null,
      ),
    },
  ];
  return {
    segments,
    coveredCount: segments.filter((segment) => segment.covered).length,
  };
}

export function getFoodEvidenceStatuses(
  product: PublicProductDetail,
): FoodEvidenceStatus[] {
  const tests = product.productTests;
  if (tests.total === 0) {
    return [
      {
        id: "tests",
        tone: "unknown",
        title: "Not tested",
        detail: "No product-level test is linked to this exact record.",
      },
    ];
  }

  const scope = tests.truncated
    ? `${tests.returned} of ${tests.total} results shown`
    : `${tests.total} ${tests.total === 1 ? "result" : "results"} shown`;
  const above = tests.observations.filter(
    (observation) => observation.screening?.comparison === "exceeds",
  ).length;
  const within = tests.observations.filter(
    (observation) => observation.screening?.comparison === "does_not_exceed",
  ).length;
  const noLimit = tests.observations.filter(
    (observation) => observation.screening === null,
  ).length;

  const statuses: FoodEvidenceStatus[] = [
    {
      id: "tests",
      tone: "neutral",
      title: "Tested",
      detail: scope,
    },
  ];
  if (above > 0) {
    statuses.push({
      id: "above",
      tone: "alert",
      title: `${above} above a screening limit`,
      detail: "A shown result exceeded an available screening limit.",
    });
  }
  if (within > 0) {
    statuses.push({
      id: "within",
      tone: "supported",
      title: `${within} within a comparable limit`,
      detail: "Shown results that did not exceed their screening limit.",
    });
  }
  if (noLimit > 0) {
    statuses.push({
      id: "no_limit",
      tone: "unknown",
      title: `${noLimit} measured, no comparable limit`,
      detail: "Murph has no compatible screening limit for these results.",
    });
  }
  return statuses;
}

export function getFoodMetricConclusion(
  comparison: FoodMetricComparison,
  activeProductRef: string,
  productCount: number,
): string {
  if (!comparison.complete) {
    return productCount < 2
      ? "Add a product to compare"
      : `Values for ${comparison.values.size} of ${productCount} products`;
  }
  if (comparison.winnerRefs.has(activeProductRef)) {
    const direction =
      comparison.metric.preference === "higher" ? "highest" : "lowest";
    return comparison.winnerRefs.size > 1
      ? `Tied for ${direction}`
      : direction === "highest"
      ? "Highest"
      : "Lowest";
  }
  return `Compared across ${productCount} products`;
}

export function formatFoodMetricValue(value: FoodMetricValue): string {
  const display = Number.isInteger(value.value)
    ? String(value.value)
    : value.value.toFixed(1);
  return `${display} ${value.unit}`;
}

function foodMetricValue(value: number, unit: string): FoodMetricValue {
  const precision = unit === "kcal" ? 1 : 10;
  const rounded = Math.round((value + Number.EPSILON) * precision) / precision;
  return { value: Object.is(rounded, -0) ? 0 : rounded, unit };
}

const PACKAGE_SIZE_PATTERN =
  /\b(\d+(?:[.,]\d+)?(?:\s?[x×-]\s?\d+(?:[.,]\d+)?)?)\s?(fluid ounces?|fl\.? ?oz|ounces?|oz|lbs?|pounds?|kg|ml|mlt|litres?|liters?|l|grams?|g)\b\.?(?!\s?protein)/iu;

const PACKAGE_COUNT_PATTERN = /\b(\d+)\s?(?:count|ct|pack|pk)\b/iu;

const SIZE_UNIT_LABELS: Record<string, string> = {
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  "fl oz": "fl oz",
  "fl. oz": "fl oz",
  "fl.oz": "fl oz",
  floz: "fl oz",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  kg: "kg",
  ml: "mL",
  mlt: "mL",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  l: "L",
  gram: "g",
  grams: "g",
  g: "g",
};

export function getFoodPackageSize(name: string): string | null {
  const match = PACKAGE_SIZE_PATTERN.exec(name);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  const unit = SIZE_UNIT_LABELS[match[2].toLowerCase().replace(/\s+/gu, " ")];
  if (!unit) {
    return null;
  }
  const amount = match[1].replace(",", ".").replace(/\s?[x×-]\s?/u, " × ");
  if (unit === "g" && Number.parseFloat(amount) < 100) {
    return null;
  }
  const count = amount.includes("×")
    ? null
    : PACKAGE_COUNT_PATTERN.exec(name)?.[1];
  return count ? `${count} × ${amount} ${unit}` : `${amount} ${unit}`;
}

function getFoodDisplayBrand(
  name: string,
  rawBrand: string | null,
): string | null {
  const reportedBrand = rawBrand?.trim();
  if (!reportedBrand) {
    return null;
  }

  const leadingMark = name.split(",")[0]?.trim() ?? "";
  const corporateBrand =
    /(?:\/|\b(?:inc|company|corporation|corp|llc|ltd)\b)/iu.test(reportedBrand);
  if (!corporateBrand) {
    return recaseShouting(reportedBrand, true);
  }

  const alphanumericMark = /^(?=.*[a-z])(?=.*\d)[a-z\d&'+.-]{2,30}$/iu.test(
    leadingMark,
  );
  if (alphanumericMark) {
    return recaseShouting(leadingMark, true);
  }

  const embeddedConsumerMark = reportedBrand
    .split("/")
    .slice(1)
    .map((segment) => segment.split("-")[0]?.trim() ?? "")
    .find((segment) => /^[a-z][a-z\d&'+.]{1,29}$/u.test(segment));
  if (!embeddedConsumerMark) {
    return recaseShouting(reportedBrand, true);
  }

  const displayBrand =
    embeddedConsumerMark.charAt(0).toUpperCase() +
    embeddedConsumerMark.slice(1);
  return recaseShouting(displayBrand, true);
}

function getFoodServingSize(
  serving: PublicProductDetail["serving"] | undefined,
): string | null {
  if (!serving) {
    return null;
  }
  if (serving.grams) {
    return `${formatServingAmount(serving.grams)} g`;
  }
  if (serving.amount && serving.unit) {
    const unit = SIZE_UNIT_LABELS[serving.unit.toLowerCase()] ?? serving.unit;
    return `${formatServingAmount(serving.amount)} ${unit}`;
  }

  const description = serving.description?.trim();
  if (!description || /^\d+(?:[.,]\d+)?\s*(?:fl)?$/iu.test(description)) {
    return null;
  }
  return description;
}

function combineFoodSizes(
  packageSize: string | null,
  servingSize: string | null,
): string | null {
  if (packageSize && servingSize) {
    return `${packageSize} · ${servingSize}`;
  }
  return packageSize ?? servingSize;
}

export function getFoodProductIdentity(
  product: Pick<PublicProductDetail, "name" | "brand"> & {
    serving?: PublicProductDetail["serving"];
    servingGrams?: number | null;
  },
): FoodProductIdentity {
  const brand = getFoodDisplayBrand(product.name, product.brand);
  const packageSize = getFoodPackageSize(product.name);
  let title = product.name.trim();
  if (brand && title.toLowerCase().startsWith(brand.toLowerCase())) {
    title = title.slice(brand.length).replace(/^[\s,:®™-]+/u, "");
  }
  title = leadWithVariant(dropRepeatedTrailingSegment(title));
  title = packageSize ? stripPackageDetails(title) || title : title;
  title = recaseShouting(title);
  if (brand && /^(?:bottle|can|container|package|pack)$/iu.test(title.trim())) {
    title = "";
  }

  const servingSize =
    getFoodServingSize(product.serving) ??
    (product.servingGrams
      ? `${formatServingAmount(product.servingGrams)} g`
      : null);

  return {
    brand,
    title: title || (brand ? "" : product.name.trim()),
    size: combineFoodSizes(packageSize, servingSize),
  };
}

function stripPackageDetails(name: string): string {
  return name
    .replace(PACKAGE_SIZE_PATTERN, "")
    .replace(PACKAGE_COUNT_PATTERN, "")
    .replace(/[\s,/:–-]+$/gu, "")
    .replace(/^\s*[,/:–-]+\s*/gu, "")
    .replace(/\s*[,/:–-]+\s*[,/:–-]+\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();
}

function dropRepeatedTrailingSegment(name: string): string {
  const segments = name
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  while (segments.length > 1) {
    const last = segments[segments.length - 1]?.toLowerCase() ?? "";
    const head = segments.slice(0, -1).join(", ").toLowerCase();
    if (last && head.includes(last)) {
      segments.pop();
      continue;
    }
    break;
  }
  return segments.join(", ");
}

function leadWithVariant(name: string): string {
  const segments = name
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const variant =
    segments.length >= 2 ? segments[segments.length - 1] : undefined;
  if (
    !variant ||
    variant.split(/\s+/u).length > 3 ||
    getFoodPackageSize(variant) ||
    PACKAGE_COUNT_PATTERN.test(variant)
  ) {
    return name;
  }
  return `${variant} ${segments.slice(0, -1).join(", ")}`;
}

function recaseShouting(value: string, preserveShortBrand = false): string {
  const letters = value.replace(/[^A-Za-z]/gu, "");
  if (letters.length === 0 || /[a-z]/u.test(letters)) {
    return value;
  }
  const words = value.split(/\s+/u);
  if (preserveShortBrand && words.length === 1 && letters.length <= 5) {
    return value;
  }
  return words
    .map((word) =>
      word.length <= 1 ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

function formatServingAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function dedupeFoodSearchHits<
  T extends Pick<PublicProductSearchHit, "productRef" | "upc">,
>(hits: T[]): T[] {
  const seenUpcs = new Set<string>();
  const seenRefs = new Set<string>();
  return hits.filter((hit) => {
    if (seenRefs.has(hit.productRef)) {
      return false;
    }
    seenRefs.add(hit.productRef);
    if (!hit.upc) {
      return true;
    }
    const upc = hit.upc.replace(/^0+/u, "");
    if (seenUpcs.has(upc)) {
      return false;
    }
    seenUpcs.add(upc);
    return true;
  });
}

export function selectDiverseFoodSearchHits<
  T extends Pick<PublicProductSearchHit, "brand" | "productRef">,
>(hits: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  const selected: T[] = [];
  const selectedRefs = new Set<string>();
  const selectedBrands = new Set<string>();

  for (const hit of hits) {
    const brandKey = normalizeFoodSearchRankingText(hit.brand);
    if (brandKey && selectedBrands.has(brandKey)) {
      continue;
    }
    selected.push(hit);
    selectedRefs.add(hit.productRef);
    if (brandKey) {
      selectedBrands.add(brandKey);
    }
    if (selected.length === limit) {
      return selected;
    }
  }

  for (const hit of hits) {
    if (selectedRefs.has(hit.productRef)) {
      continue;
    }
    selected.push(hit);
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}

export function orderFoodSearchHitsForDiversity<
  T extends Pick<PublicProductSearchHit, "brand" | "productRef">,
>(hits: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const hit of hits) {
    const brandKey =
      normalizeFoodSearchRankingText(hit.brand) || `product:${hit.productRef}`;
    const bucket = buckets.get(brandKey);
    if (bucket) {
      bucket.push(hit);
    } else {
      buckets.set(brandKey, [hit]);
    }
  }

  const ordered: T[] = [];
  const brandBuckets = [...buckets.values()];
  const longestBucket = Math.max(
    0,
    ...brandBuckets.map((bucket) => bucket.length),
  );
  for (let index = 0; index < longestBucket; index += 1) {
    for (const bucket of brandBuckets) {
      const hit = bucket[index];
      if (hit) {
        ordered.push(hit);
      }
    }
  }
  return ordered;
}

export interface FoodComparisonUrlState {
  basis: FoodMetricBasis;
  productRefs: string[];
}

export function parseFoodComparisonUrl(search: string): FoodComparisonUrlState {
  const params = new URLSearchParams(search);
  const productRefs = dedupeStrings(
    (params.get("compare") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(isShareableFoodProductRef),
  ).slice(0, FOOD_COMPARISON_LIMIT);

  return {
    basis: params.get("basis") === "per_serving" ? "per_serving" : "per_100_g",
    productRefs,
  };
}

export function buildFoodComparisonUrl(
  currentUrl: string,
  productRefs: string[],
  basis: FoodMetricBasis,
): string {
  const url = new URL(currentUrl, "https://www.withmurph.ai");
  const safeRefs = dedupeStrings(
    productRefs.filter(isShareableFoodProductRef),
  ).slice(0, FOOD_COMPARISON_LIMIT);

  if (safeRefs.length === 0) {
    url.searchParams.delete("compare");
    url.searchParams.delete("basis");
  } else {
    url.searchParams.set("compare", safeRefs.join(","));
    if (basis === "per_serving") {
      url.searchParams.set("basis", basis);
    } else {
      url.searchParams.delete("basis");
    }
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function isShareableFoodProductRef(value: string): boolean {
  return /^food_[A-Za-z0-9_-]{3,500}$/u.test(value);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

const MULTIPACK_NAME_PATTERN =
  /\b\d+\s*(?:count|ct|pack|pk)\b|\b\d+\s*[-x×]\s*\d+(?:[.,]\d+)?\s*(?:fl\.?\s*oz|ounces?|oz|ml|l)\b/iu;
const MULTIPACK_QUERY_PATTERN = /\b(?:count|ct|pack|pk)\b|\b\d+\s*[-x×]\s*\d/iu;

export function cleanFoodSearchHits(
  hits: PublicProductSearchHit[],
  query: string,
  foodSearchOrder: "relevance" | "evidence" | "popular" = "relevance",
): PublicProductSearchHit[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  if (/^\d+$/u.test(normalizedQuery)) {
    return hits;
  }
  const rankingQuery = normalizeFoodSearchRankingText(query);
  const meaningMatchedHits = hits.filter(
    (hit) =>
      !(
        (rankingQuery === "soda" || rankingQuery === "cola") &&
        /\bbaking soda\b/iu.test(hit.name)
      ),
  );
  const categoryCandidates =
    meaningMatchedHits.length > 0 ? meaningMatchedHits : hits;

  const singleProducts = categoryCandidates.filter(
    (hit) => !MULTIPACK_NAME_PATTERN.test(hit.name),
  );
  const candidates =
    !MULTIPACK_QUERY_PATTERN.test(normalizedQuery) && singleProducts.length > 0
      ? singleProducts
      : categoryCandidates;
  const brandQuery = candidates.some(
    (hit) => normalizeFoodSearchRankingText(hit.brand) === rankingQuery,
  );

  return candidates
    .map((hit, index) => {
      const identity = getFoodProductIdentity(hit);
      const normalizedName = normalizeFoodSearchRankingText(hit.name);
      const normalizedTitle = normalizeFoodSearchRankingText(identity.title);
      return {
        exactProductMatch:
          brandQuery &&
          (normalizedName === rankingQuery || normalizedTitle === rankingQuery),
        hasLinkedTests: hit.productTests.total > 0,
        hasSize: identity.size !== null,
        hit,
        index,
        titleLength: normalizedTitle.length,
      };
    })
    .sort((left, right) => {
      if (left.exactProductMatch !== right.exactProductMatch) {
        return Number(right.exactProductMatch) - Number(left.exactProductMatch);
      }
      if (
        foodSearchOrder === "evidence" &&
        left.hasLinkedTests !== right.hasLinkedTests
      ) {
        return Number(right.hasLinkedTests) - Number(left.hasLinkedTests);
      }
      if (brandQuery && left.titleLength !== right.titleLength) {
        return left.titleLength - right.titleLength;
      }
      if (foodSearchOrder === "relevance" && left.hasSize !== right.hasSize) {
        return Number(right.hasSize) - Number(left.hasSize);
      }
      return left.index - right.index;
    })
    .map(({ hit }) => hit);
}

function normalizeFoodSearchRankingText(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const PROTEIN_SHAKE_CATEGORY_PATTERN =
  /\b(?:high\s+)?protein(?:\s+\d+(?:\.\d+)?\s*g)?\s+(?:milk\s+)?shakes?\b|\bprotein drinks?\b|nutrition shake|meal replacement/u;

const NAMED_CATEGORIES: Array<[string, RegExp]> = [
  [
    "frozen-desserts",
    /ice cream|gelato|sorbet|frozen yogurt|frozen dessert|popsicle|\bpops\b/u,
  ],
  ["protein-shake", PROTEIN_SHAKE_CATEGORY_PATTERN],
  [
    "plant-milk",
    /oat milk|almond milk|soy milk|coconut milk|cashew milk|rice milk|oat ?beverage|almond ?beverage/u,
  ],
  [
    "bars",
    /\b(?:protein|snack|energy|granola|nut|cereal|breakfast|fruit)\s?bars?\b|\bbars?\b|\bbites\b/u,
  ],
  ["yogurt", /yogurt|yoghurt|skyr|kefir/u],
  ["cheese", /cheese|cheddar|mozzarella|parmesan|brie|feta/u],
  [
    "nut-butter-spreads",
    /peanut butter|almond butter|nut butter|hazelnut spread|\bjam\b|jelly|preserves|marmalade/u,
  ],
  ["chips", /\bchips?\b|crisps|tortilla chip|pretzel|popcorn|cheese puffs/u],
  ["crackers-rice-cakes", /cracker|rice cake/u],
  ["cereal-oats", /cereal|oatmeal|\boats\b|granola|muesli/u],
  [
    "dairy-milk",
    /\bmilk\b(?! chocolate)|\bcream\b|half-and-half|half & half|creamer/u,
  ],
  [
    "cookies-sweets",
    /cookie|candy|chocolate|gummy|gummies|licorice|caramel|marshmallow|sweet/u,
  ],
  ["bakery", /\bcake\b|muffin|pastry|donut|doughnut|croissant|brownie|pie\b/u],
  ["bread", /bread|bagel|tortilla|bun\b|roll\b|pita|naan|english muffin/u],
  ["pasta-noodles", /pasta|noodle|spaghetti|macaroni|ramen|lasagna/u],
  ["pizza-flatbread", /pizza|flatbread/u],
  ["soups-stews", /soup|stew|chili|broth|bone broth/u],
  [
    "sauces-condiments",
    /sauce|ketchup|mustard|mayo|dressing|salsa|hummus|dip\b|relish|vinaigrette/u,
  ],
  ["sweeteners", /honey|maple syrup|agave|sweetener|\bsyrup\b|sugar\b/u],
  [
    "prepared-meals",
    /\bmeal\b|\bbowl\b|entrée|entree|dinner|burrito|frozen meal|mac and cheese/u,
  ],
  ["eggs", /\beggs?\b|omelet/u],
  ["poultry", /chicken|turkey|duck/u],
  [
    "seafood",
    /salmon|tuna|\bfish\b|shrimp|\bcod\b|sardine|anchov|crab|lobster/u,
  ],
  ["meat", /beef|pork|steak|bacon|\bham\b|sausage|jerky|salami|hot dog/u],
  [
    "plant-protein",
    /tofu|tempeh|seitan|plant protein|plant-based|veggie burger/u,
  ],
  ["legumes", /\bbeans?\b|lentil|chickpea|edamame/u],
  [
    "nuts-seeds",
    /almond|peanut|cashew|walnut|pistachio|pecan|\bseeds?\b|trail mix/u,
  ],
  ["oils-fats", /olive oil|avocado oil|coconut oil|butter|ghee|margarine/u],
  [
    "fruit",
    /fruit|apple|banana|berry|berries|orange|mango|grape|raisin|dried fruit/u,
  ],
  ["vegetables", /vegetable|broccoli|spinach|carrot|kale|salad|greens/u],
  ["grains", /\brice\b|quinoa|grain|couscous|barley/u],
  ["coffee-tea", /coffee|\btea\b|matcha|latte|espresso|cold brew/u],
  [
    "sweet-drinks",
    /soda|cola|juice|energy drink|sports drink|lemonade|kombucha|soft drink/u,
  ],
  ["water", /water|seltzer|sparkling/u],
  ["alcohol", /beer|wine|vodka|whiskey|whisky|alcohol|hard seltzer|cider/u],
  ["baby-food", /baby food|infant|toddler/u],
  ["supplements", /protein powder|supplement|electrolyte/u],
];

const INGREDIENT_CATEGORIES: Array<[string, RegExp]> = [
  ["yogurt", /cultured/u],
  ["cheese", /cheese/u],
  ["dairy-milk", /\bmilk\b|cream/u],
  ["nuts-seeds", /almond|peanut|cashew|walnut/u],
  ["cereal-oats", /\boats?\b/u],
  ["grains", /\brice\b|wheat|flour/u],
  ["sweet-drinks", /carbonated water|corn syrup/u],
];

export const FOOD_CATEGORY_FALLBACK_ASSET =
  "/design-assets/food-label-lab/packaged-food.svg";

const CATEGORY_SEARCH_QUERY_OVERRIDES: Record<string, string> = {
  "cereal-oats": "cereal",
  "cookies-sweets": "cookies",
  "crackers-rice-cakes": "crackers",
  "nut-butter-spreads": "nut butter",
  "oils-fats": "cooking oil",
  "sweet-drinks": "soda",
};

export function getFoodCategoryAsset(
  product: Pick<PublicProductDetail, "name" | "brand"> & {
    ingredients?: PublicProductDetail["ingredients"];
  },
): string {
  const name = product.name.toLowerCase();
  const namedCategory = NAMED_CATEGORIES.find(([, pattern]) =>
    pattern.test(name),
  )?.[0];
  if (namedCategory) {
    return `/design-assets/food-label-lab/${namedCategory}.svg`;
  }

  const statement = product.ingredients?.statement?.toLowerCase() ?? "";
  const ingredientCategory = INGREDIENT_CATEGORIES.find(([, pattern]) =>
    pattern.test(statement),
  )?.[0];
  if (ingredientCategory) {
    return `/design-assets/food-label-lab/${ingredientCategory}.svg`;
  }
  return FOOD_CATEGORY_FALLBACK_ASSET;
}

export function getFoodComparisonCategoryQuery(
  product: Pick<PublicProductDetail, "name" | "brand"> & {
    ingredients?: PublicProductDetail["ingredients"];
  },
): string | null {
  const name = [product.brand, product.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\bprotein\b[^,]{0,50}\bbars?\b/u.test(name)) {
    return "protein bars";
  }
  if (
    /\bprotein\b[^,]{0,50}\bshakes?\b/u.test(name) ||
    PROTEIN_SHAKE_CATEGORY_PATTERN.test(name)
  ) {
    return "protein shakes";
  }
  if (/\bgreek\b[^,]{0,40}\byogurt\b/u.test(name)) {
    return "greek yogurt";
  }

  const asset = getFoodCategoryAsset(product);
  if (asset === FOOD_CATEGORY_FALLBACK_ASSET) {
    return null;
  }
  const category = asset.slice(asset.lastIndexOf("/") + 1, -4);
  return (
    CATEGORY_SEARCH_QUERY_OVERRIDES[category] ?? category.replaceAll("-", " ")
  );
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
