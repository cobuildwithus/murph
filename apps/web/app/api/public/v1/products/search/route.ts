import {
  publicProductSearchRequestSchema,
} from "@murphai/contracts";

import { readJsonObject } from "@/src/lib/http";
import {
  PUBLIC_PRODUCT_SEARCH_BODY_LIMIT_BYTES,
  invalidPublicProductRequest,
  publicProductsJsonOk,
  requirePublicProductJsonContentType,
  withPublicProductsJsonError,
} from "@/src/lib/public-products/http";
import { searchPublicProducts } from "@/src/lib/public-products/service";

export const POST = withPublicProductsJsonError(async (request: Request) => {
  requirePublicProductJsonContentType(request);
  const body = await readJsonObject(request, {
    limitBytes: PUBLIC_PRODUCT_SEARCH_BODY_LIMIT_BYTES,
  });
  const parsed = publicProductSearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw invalidPublicProductRequest();
  }

  return publicProductsJsonOk(await searchPublicProducts(parsed.data));
});
