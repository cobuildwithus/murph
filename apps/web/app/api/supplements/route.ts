import {
  getSupplementById,
  getSupplementByUpc,
  searchSupplements,
} from "@/src/lib/supplements";
import { isProductContaminantSchemaMissingError } from "@/src/lib/product-labels";
import { createProductLabelsRouteHandlers } from "@/src/lib/product-labels-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createProductLabelsRouteHandlers({
  getById: getSupplementById,
  getByUpc: getSupplementByUpc,
  search: searchSupplements,
  errorCodes: {
    failed: "supplements_api_failed",
    unconfigured: "supplements_api_unconfigured",
  },
  isUnconfiguredError: isProductContaminantSchemaMissingError,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
