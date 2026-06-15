import {
  getFoodById,
  getFoodByUpc,
  searchFoods,
} from "@/src/lib/foods";
import { createProductLabelsRouteHandlers } from "@/src/lib/product-labels-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createProductLabelsRouteHandlers({
  getById: getFoodById,
  getByUpc: getFoodByUpc,
  search: searchFoods,
  errorCodes: {
    failed: "foods_api_failed",
    unconfigured: "foods_api_unconfigured",
  },
  supportsGenericOnly: true,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
