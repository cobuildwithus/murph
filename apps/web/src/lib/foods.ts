import "server-only";

import type {
  ProductLabelDetail,
  ProductLabelsQueryClient,
  ProductLabelSearchItem,
} from "./product-labels";
import {
  createProductLabelsQueries,
  getDefaultProductLabelsPool,
} from "./product-labels";

export type FoodSearchItem = ProductLabelSearchItem;
export type FoodDetail = ProductLabelDetail;

let defaultFoodsQueriesInstance: ReturnType<typeof createFoodsQueries> | null =
  null;

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
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<FoodSearchItem[]>;
} {
  const queries = createProductLabelsQueries(client, "foods");

  return {
    getFoodById: queries.getById,
    getFoodByUpc: queries.getByUpc,
    searchFoods: queries.search,
  };
}

export async function searchFoods(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
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

function defaultFoodsQueries(): ReturnType<typeof createFoodsQueries> {
  defaultFoodsQueriesInstance ??= createFoodsQueries(
    getDefaultProductLabelsPool(),
  );

  return defaultFoodsQueriesInstance;
}

