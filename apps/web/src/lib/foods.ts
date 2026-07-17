import "server-only";

import type {
  ProductLabelDetail,
  ProductLabelsQueryClient,
  ProductLabelSearchItem,
  PublicProductLabelRecord,
  PublicProductLabelSearchItem,
  PublicProductTestEvidence,
} from "./product-labels";
import {
  createProductLabelsQueries,
  createPublicProductLabelsQueries,
  getDefaultProductLabelsPool,
} from "./product-labels";

const GENERIC_FOOD_DATA_ORIGINS = [
  "usda_foundation",
  "usda_sr_legacy",
  "usda_fndds",
] as const;

export type FoodSearchItem = ProductLabelSearchItem;
export type FoodDetail = ProductLabelDetail;

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
