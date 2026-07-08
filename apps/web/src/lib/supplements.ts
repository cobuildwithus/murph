import "server-only";

import type {
  ProductLabelDetail,
  ProductLabelsQueryClient,
  ProductLabelSearchItem,
} from "./product-labels";
import {
  createProductLabelsQueries,
  getDefaultSupplementProductLabelsPool,
  normalizeProductLabelsConnectionString,
} from "./product-labels";

export type {
  ProductLabelDetail,
  ProductLabelsQueries,
  ProductLabelSearchItem,
} from "./product-labels";
export { createProductLabelsQueries } from "./product-labels";
export type { FoodDetail, FoodSearchItem } from "./foods";
export {
  createFoodsQueries,
  getFoodById,
  getFoodByUpc,
  searchFoods,
} from "./foods";

const SUPPLEMENT_SEARCH_WEAK_QUERY_TOKENS = [
  "supplement",
  "supplements",
] as const;

export type SupplementSearchItem = ProductLabelSearchItem;
export type SupplementDetail = ProductLabelDetail;

let defaultSupplementsQueriesInstance: ReturnType<
  typeof createSupplementsQueries
> | null = null;

export function createSupplementsQueries(client: ProductLabelsQueryClient): {
  getSupplementById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<SupplementDetail | null>;
  getSupplementByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<SupplementDetail | null>;
  searchSupplements: (input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<SupplementSearchItem[]>;
} {
  const queries = createProductLabelsQueries(client, "supplements", {
    brandScoping: true,
    stemmedSearch: true,
    weakQueryTokens: SUPPLEMENT_SEARCH_WEAK_QUERY_TOKENS,
  });

  return {
    getSupplementById: queries.getById,
    getSupplementByUpc: queries.getByUpc,
    searchSupplements: queries.search,
  };
}

export async function searchSupplements(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
}): Promise<SupplementSearchItem[]> {
  return await defaultSupplementsQueries().searchSupplements(input);
}

export async function getSupplementById(input: {
  id: string;
  includeOffMarket: boolean;
}): Promise<SupplementDetail | null> {
  return await defaultSupplementsQueries().getSupplementById(input);
}

export async function getSupplementByUpc(input: {
  includeOffMarket: boolean;
  upc: string;
}): Promise<SupplementDetail | null> {
  return await defaultSupplementsQueries().getSupplementByUpc(input);
}

function defaultSupplementsQueries(): ReturnType<typeof createSupplementsQueries> {
  defaultSupplementsQueriesInstance ??= createSupplementsQueries(
    getDefaultSupplementProductLabelsPool(),
  );

  return defaultSupplementsQueriesInstance;
}

export const normalizeSupplementConnectionString =
  normalizeProductLabelsConnectionString;
