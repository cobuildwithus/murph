import {
  PUBLIC_PRODUCT_OPENAPI_CACHE_CONTROL,
  publicProductsJsonOk,
} from "@/src/lib/public-products/http";
import { createPublicProductsOpenApiDocument } from "@/src/lib/public-products/openapi";

export async function GET(): Promise<Response> {
  return publicProductsJsonOk(createPublicProductsOpenApiDocument(), {
    cacheControl: PUBLIC_PRODUCT_OPENAPI_CACHE_CONTROL,
  });
}
