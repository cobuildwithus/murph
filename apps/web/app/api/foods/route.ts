import {
  getFoodById,
  getFoodByUpc,
  searchFoods,
} from "@/src/lib/foods";
import { isProductContaminantSchemaMissingError } from "@/src/lib/product-labels";
import { createProductLabelsRouteHandlers } from "@/src/lib/product-labels-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createProductLabelsRouteHandlers({
  bareGtinQueryPriority: "upc",
  getById: getFoodById,
  getByUpc: getFoodByUpc,
  numericExactIdPrefix: "fdc:",
  search: searchFoods,
  errorCodes: {
    failed: "foods_api_failed",
    unconfigured: "foods_api_unconfigured",
  },
  isUnconfiguredError: isProductContaminantSchemaMissingError,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
