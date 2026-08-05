import {
  getFoodById,
  getFoodByUpc,
  type FoodNutritionSourceItem,
  searchFoodNutritionSources,
  searchFoods,
  toFoodNutritionSearchItem,
} from "@/src/lib/foods";
import { isProductContaminantSchemaMissingError } from "@/src/lib/product-labels";
import { createProductLabelsRouteHandlers } from "@/src/lib/product-labels-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createProductLabelsRouteHandlers<FoodNutritionSourceItem>({
  bareGtinQueryPriority: "upc",
  getById: getFoodById,
  getByUpc: getFoodByUpc,
  numericExactIdPrefix: "fdc:",
  projectNutritionItem: toFoodNutritionSearchItem,
  search: searchFoods,
  searchNutrition: searchFoodNutritionSources,
  errorCodes: {
    failed: "foods_api_failed",
    unconfigured: "foods_api_unconfigured",
  },
  isUnconfiguredError: isProductContaminantSchemaMissingError,
  supportsGenericOnly: true,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
