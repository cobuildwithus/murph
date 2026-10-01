import "server-only";

import { FOOD_POPULAR_BRANDS } from "./food-popularity-data";

const POPULARITY_CATEGORY_ALIASES = {
  bread: "sandwich bread",
  cereal: "breakfast cereal",
  cheese: "cheddar cheese",
  chips: "potato chips",
  chocolate: "milk chocolate",
  coffee: "bottled coffee",
  "cooking oil": "olive oil",
  "greek yogurts": "greek yogurt",
  milk: "whole milk",
  "nut butter": "peanut butter",
  "protein bar": "protein bars",
  "protein shake": "protein shakes",
  sodas: "soda",
  cola: "soda",
  colas: "soda",
  pop: "soda",
  water: "bottled water",
} as const satisfies Record<string, keyof typeof FOOD_POPULAR_BRANDS>;

const POPULARITY_RELATED_QUERIES = {
  "greek yogurt": [
    ["costco yogurt", 4],
    ["plain greek yogurt", 4],
    ["vanilla greek yogurt", 4],
  ],
  "protein bars": [
    ["costco protein bars", 4],
    ["low sugar protein bars", 4],
    ["plant based protein bars", 4],
  ],
  "protein shakes": [["meal replacement shakes", 4]],
  soda: [
    ["costco soda", 2],
    ["diet soda", 3],
    ["zero sugar soda", 4],
  ],
} as const satisfies Partial<
  Record<
    keyof typeof FOOD_POPULAR_BRANDS,
    readonly (readonly [keyof typeof FOOD_POPULAR_BRANDS, number])[]
  >
>;

const PRIMARY_BRAND_COUNT = 6;
const MAX_POPULAR_BRAND_COUNT = 20;
const GENERIC_SODA_TITLES = new Set([
  "cola",
  "soda",
  "soda soft drink",
  "soft drink",
]);

const POPULARITY_CATEGORY_SEARCH_QUERIES = {
  "bottled coffee": "coffee",
  "bottled water": "water",
  "breakfast cereal": "cereal",
  "cheddar cheese": "cheese",
  "milk chocolate": "chocolate",
  "olive oil": "oil",
  "peanut butter": '"peanut butter" OR "almond butter" OR "cashew butter"',
  "potato chips": "chips OR crisps",
  "protein shakes": '"protein shake" OR "nutrition shake"',
  "sandwich bread": "bread",
  soda: "soda OR cola",
  "whole milk": "milk",
} as const satisfies Partial<Record<keyof typeof FOOD_POPULAR_BRANDS, string>>;

function normalizePopularityQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function resolvePopularityCategory(
  query: string,
): keyof typeof FOOD_POPULAR_BRANDS | null {
  const normalized = normalizePopularityQuery(query);
  if (!normalized) {
    return null;
  }

  const canonical =
    POPULARITY_CATEGORY_ALIASES[
      normalized as keyof typeof POPULARITY_CATEGORY_ALIASES
    ] ?? normalized;
  const exact =
    FOOD_POPULAR_BRANDS[canonical as keyof typeof FOOD_POPULAR_BRANDS];
  if (exact) {
    return canonical as keyof typeof FOOD_POPULAR_BRANDS;
  }

  return null;
}

export function getPopularFoodBrands(
  query: string,
): readonly { key: string; name: string }[] {
  const category = resolvePopularityCategory(query);
  if (!category) {
    return [];
  }

  const base = FOOD_POPULAR_BRANDS[category];
  const related = (
    POPULARITY_RELATED_QUERIES[
      category as keyof typeof POPULARITY_RELATED_QUERIES
    ] ?? []
  ).map(([relatedQuery, limit]) =>
    FOOD_POPULAR_BRANDS[relatedQuery].slice(0, limit),
  );
  const ordered = base
    .slice(0, PRIMARY_BRAND_COUNT)
    .map((brand) => ({ ...brand }));
  const seen = new Set(ordered.map((brand) => brand.key));
  const maxRelatedLength = Math.max(
    0,
    ...related.map((brands) => brands.length),
  );

  for (let index = 0; index < maxRelatedLength; index += 1) {
    for (const brands of related) {
      const brand = brands[index];
      if (brand && !seen.has(brand.key)) {
        seen.add(brand.key);
        ordered.push({ ...brand });
      }
    }
  }
  for (const brand of base.slice(PRIMARY_BRAND_COUNT)) {
    if (!seen.has(brand.key)) {
      seen.add(brand.key);
      ordered.push({ ...brand });
    }
  }

  return ordered.slice(0, MAX_POPULAR_BRAND_COUNT);
}

export function getPopularFoodBrandKeys(query: string): readonly string[] {
  return getPopularFoodBrands(query).map((brand) => brand.key);
}

export function getPopularFoodDirectBrandNames(
  query: string,
): readonly string[] {
  if (!resolvePopularityCategory(query)) {
    return [];
  }
  return getPopularFoodBrands(query)
    .slice(0, 9)
    .map((brand) => brand.name);
}

export function getPopularFoodCategorySearchQuery(
  query: string,
): string | null {
  const category = resolvePopularityCategory(query);
  if (!category) {
    return null;
  }
  return (
    POPULARITY_CATEGORY_SEARCH_QUERIES[
      category as keyof typeof POPULARITY_CATEGORY_SEARCH_QUERIES
    ] ?? category
  );
}

export function orderFoodsByPopularity<
  T extends {
    brand: string | null;
    name: string;
    testing: { observationCount: number };
  },
>(rows: T[], query: string): T[] {
  const popularBrands = getPopularFoodBrands(query);
  if (popularBrands.length === 0) {
    return rows;
  }

  return rows
    .map((row, index) => {
      const normalizedBrand = normalizePopularityQuery(row.brand ?? "").replace(
        /\s/gu,
        "",
      );
      const normalizedName = normalizePopularityQuery(row.name).replace(
        /\s/gu,
        "",
      );
      const rank = popularBrands.findIndex(
        (brand) =>
          normalizedBrand === brand.key ||
          normalizedBrand.includes(brand.key) ||
          normalizedName.startsWith(brand.key),
      );
      const normalizedTitle = normalizePopularityQuery(row.name);
      const isSodaCategory = resolvePopularityCategory(query) === "soda";
      return {
        index,
        isDietVariant: /\b(?:diet|zero|sugar free|caffeine free)\b/iu.test(
          row.name,
        ),
        isMultipack:
          /\b\d+\s*(?:count|ct|pack|pk)\b|\b(?:mini|fun size)\b/iu.test(
            row.name,
          ),
        isSpecificSoda:
          isSodaCategory && !GENERIC_SODA_TITLES.has(normalizedTitle),
        repeatsBrand:
          Boolean(normalizedBrand) &&
          normalizedName.startsWith(normalizedBrand),
        rank: rank < 0 ? Number.MAX_SAFE_INTEGER : rank,
        row,
      };
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(left.isMultipack) - Number(right.isMultipack) ||
        Number(left.isSpecificSoda) - Number(right.isSpecificSoda) ||
        Number(left.isDietVariant) - Number(right.isDietVariant) ||
        Number(right.repeatsBrand) - Number(left.repeatsBrand) ||
        right.row.testing.observationCount -
          left.row.testing.observationCount ||
        left.row.name.length - right.row.name.length ||
        left.index - right.index,
    )
    .map((entry) => entry.row);
}
