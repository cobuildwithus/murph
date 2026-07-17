import {
  PUBLIC_PRODUCTS_SCHEMA_VERSION,
  publicProductDetailResponseSchema,
} from "@murphai/contracts";

import { resolveRouteParams } from "@/src/lib/http";
import {
  PUBLIC_PRODUCT_DETAIL_CACHE_CONTROL,
  publicProductNotFound,
  publicProductsJsonOk,
  withPublicProductsJsonError,
} from "@/src/lib/public-products/http";
import { getPublicProductDetail } from "@/src/lib/public-products/service";

interface PublicProductDetailRouteContext {
  params: Promise<{ productRef: string }> | { productRef: string };
}

export const GET = withPublicProductsJsonError(async (
  _request: Request,
  context: PublicProductDetailRouteContext,
) => {
  const { productRef } = await resolveRouteParams(context.params);
  const product = await getPublicProductDetail(productRef);
  if (!product) {
    throw publicProductNotFound();
  }

  const response = publicProductDetailResponseSchema.parse({
    schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
    product,
  });
  return publicProductsJsonOk(response, {
    cacheControl: PUBLIC_PRODUCT_DETAIL_CACHE_CONTROL,
  });
});
