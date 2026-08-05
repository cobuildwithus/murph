import "server-only";

import type {
  ProductLabelDetail,
  ProductLabelsQueryClient,
  ProductLabelSearchItem,
  ProductLabelSourceItem,
  PublicProductLabelRecord,
  PublicProductLabelSearchItem,
  PublicProductTestEvidence,
} from "./product-labels";
import {
  createProductLabelsQueries,
  createPublicProductLabelsQueries,
  getDefaultProductLabelsPool,
} from "./product-labels";
import { normalizePublicProductLabel } from "./public-products/normalize-label";

const GENERIC_FOOD_DATA_ORIGINS = [
  "usda_foundation",
  "usda_sr_legacy",
  "usda_fndds",
] as const;
const FOOD_MEAL_NUTRITION_ROW_LIMIT = 16;
const FOOD_MEAL_NUTRIENT_NAME_PATTERNS = [
  /^(?:calories?|energy)(?:\b|\s*\()/u,
  /^protein\b/u,
  /^(?:carbohydrate|total carbohydrate|carbs?)\b/u,
  /^(?:total lipid \(fat\)|total fat|fat)\b/u,
  /^(?:fiber|dietary fiber|fiber, total dietary)\b/u,
] as const;

export type FoodSearchItem = ProductLabelSearchItem;
export type FoodNutritionSourceItem = ProductLabelSourceItem;
export type FoodDetail = ProductLabelDetail;
export type FoodNutritionSearchItem = Omit<
  FoodSearchItem,
  "contaminants" | "label"
> & {
  label: {
    nutrition: ReturnType<typeof normalizePublicProductLabel>["nutrition"];
    serving: ReturnType<typeof normalizePublicProductLabel>["serving"];
  };
};

let defaultFoodsQueriesInstance: ReturnType<typeof createFoodsQueries> | null =
  null;
let defaultPublicFoodsQueriesInstance: ReturnType<
  typeof createPublicFoodsQueries
> | null = null;

export function createFoodsQueries(client: ProductLabelsQueryClient): {
  getFoodById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<FoodDetail | null>;
  getFoodByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<FoodDetail | null>;
  searchFoods: (input: {
    genericOnly?: boolean;
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<FoodSearchItem[]>;
  searchFoodNutritionSources: (input: {
    genericOnly?: boolean;
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<FoodNutritionSourceItem[]>;
} {
  const queries = createProductLabelsQueries(client, "foods", {
    genericSearch: {
      dataOrigins: GENERIC_FOOD_DATA_ORIGINS,
    },
  });

  return {
    getFoodById: queries.getById,
    getFoodByUpc: queries.getByUpc,
    searchFoods: queries.search,
    searchFoodNutritionSources: queries.searchWithoutContaminants,
  };
}

export function createPublicFoodsQueries(client: ProductLabelsQueryClient): {
  searchPublicFoods: (input: {
    limit: number;
    q: string;
  }) => Promise<PublicProductLabelSearchItem[]>;
  getPublicFoodRecordById: (input: {
    id: string;
  }) => Promise<PublicProductLabelRecord | null>;
  getPublicFoodEvidence: (input: {
    id: string;
  }) => Promise<PublicProductTestEvidence>;
} {
  const queries = createPublicProductLabelsQueries(client, "foods", {
    excludedDataOrigins: GENERIC_FOOD_DATA_ORIGINS,
  });

  return {
    searchPublicFoods: queries.searchCompact,
    getPublicFoodRecordById: queries.getRecordById,
    getPublicFoodEvidence: queries.getEvidence,
  };
}

export async function searchFoods(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
  genericOnly?: boolean;
}): Promise<FoodSearchItem[]> {
  return await defaultFoodsQueries().searchFoods(input);
}

export async function searchFoodNutritionSources(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
  genericOnly?: boolean;
}): Promise<FoodNutritionSourceItem[]> {
  return await defaultFoodsQueries().searchFoodNutritionSources(input);
}

export async function getFoodById(input: {
  id: string;
  includeOffMarket: boolean;
}): Promise<FoodDetail | null> {
  return await defaultFoodsQueries().getFoodById(input);
}

export async function getFoodByUpc(input: {
  includeOffMarket: boolean;
  upc: string;
}): Promise<FoodDetail | null> {
  return await defaultFoodsQueries().getFoodByUpc(input);
}

export function toFoodNutritionSearchItem(
  item: FoodNutritionSourceItem,
): FoodNutritionSearchItem {
  const normalized = normalizePublicProductLabel({
    kind: "food",
    label: item.label,
    servingGrams: null,
  });
  const mealNutritionRows = normalized.nutrition.rows
    .filter((row) => {
      const name = row.name.trim().toLowerCase();
      return FOOD_MEAL_NUTRIENT_NAME_PATTERNS.some((pattern) =>
        pattern.test(name));
    })
    .slice(0, FOOD_MEAL_NUTRITION_ROW_LIMIT);

  return {
    id: item.id,
    dataOrigin: item.dataOrigin,
    dataOriginId: item.dataOriginId,
    name: item.name,
    brand: item.brand,
    upc: item.upc,
    offMarket: item.offMarket,
    label: {
      nutrition: {
        basis: mealNutritionRows.length > 0
          ? normalized.nutrition.basis
          : "unavailable",
        rows: mealNutritionRows,
      },
      serving: normalized.serving,
    },
  };
}

export async function searchPublicFoods(input: {
  q: string;
  limit: number;
}): Promise<PublicProductLabelSearchItem[]> {
  return await defaultPublicFoodsQueries().searchPublicFoods(input);
}

export async function getPublicFoodRecordById(input: {
  id: string;
}): Promise<PublicProductLabelRecord | null> {
  return await defaultPublicFoodsQueries().getPublicFoodRecordById(input);
}

export async function getPublicFoodEvidence(input: {
  id: string;
}): Promise<PublicProductTestEvidence> {
  return await defaultPublicFoodsQueries().getPublicFoodEvidence(input);
}

function defaultFoodsQueries(): ReturnType<typeof createFoodsQueries> {
  defaultFoodsQueriesInstance ??= createFoodsQueries(
    getDefaultProductLabelsPool(),
  );

  return defaultFoodsQueriesInstance;
}

function defaultPublicFoodsQueries(): ReturnType<typeof createPublicFoodsQueries> {
  defaultPublicFoodsQueriesInstance ??= createPublicFoodsQueries(
    getDefaultProductLabelsPool(),
  );

  return defaultPublicFoodsQueriesInstance;
}
