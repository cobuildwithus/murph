import "server-only";

import type { PublicProductApiErrorCode } from "@murphai/contracts";

import {
  createJsonRouteHelpers,
  InvalidJsonObjectBodyError,
  type JsonErrorMapping,
} from "../http";

export const PUBLIC_PRODUCT_SEARCH_BODY_LIMIT_BYTES = 4 * 1_024;
export const PUBLIC_PRODUCT_SEARCH_CACHE_CONTROL = "no-store";
export const PUBLIC_PRODUCT_DETAIL_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
export const PUBLIC_PRODUCT_OPENAPI_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

const PUBLIC_PRODUCT_DEFAULT_HEADERS = {
  "Cache-Control": PUBLIC_PRODUCT_SEARCH_CACHE_CONTROL,
  "X-Content-Type-Options": "nosniff",
} as const;

export class PublicProductsHttpError extends Error {
  readonly code: PublicProductApiErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(input: {
    code: PublicProductApiErrorCode;
    httpStatus: number;
    message: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "PublicProductsHttpError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryable = input.retryable ?? false;
  }
}

export class PublicProductDataUnavailableError extends PublicProductsHttpError {
  constructor() {
    super({
      code: "LABELS_UNAVAILABLE",
      httpStatus: 503,
      message: "Product labels are unavailable right now.",
      retryable: true,
    });
    this.name = "PublicProductDataUnavailableError";
  }
}

export function invalidPublicProductRequest(): PublicProductsHttpError {
  return new PublicProductsHttpError({
    code: "INVALID_REQUEST",
    httpStatus: 400,
    message: "Invalid request.",
  });
}

export function publicProductNotFound(): PublicProductsHttpError {
  return new PublicProductsHttpError({
    code: "PRODUCT_NOT_FOUND",
    httpStatus: 404,
    message: "Product not found.",
  });
}

export function requirePublicProductJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new PublicProductsHttpError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      httpStatus: 415,
      message: "Content-Type must be application/json.",
    });
  }
}

const publicProductsJsonHelpers = createJsonRouteHelpers({
  defaultHeaders: PUBLIC_PRODUCT_DEFAULT_HEADERS,
  internalMessage: "Public product request failed.",
  logMessage: "Public product API request failed.",
  sanitizeLogString: () => null,
  matchers: [
    mapPublicProductsHttpError,
    (error) => error instanceof SyntaxError
      ? quietError("INVALID_JSON", "Invalid JSON.", 400)
      : null,
    (error) => isBodyTooLargeError(error)
      ? quietError("REQUEST_BODY_TOO_LARGE", "Request body too large.", 413)
      : null,
    (error) => error instanceof InvalidJsonObjectBodyError
      ? quietError("INVALID_REQUEST", "Invalid request.", 400)
      : null,
    () => ({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
        retryable: false,
      },
      log: {
        level: "error",
        details: { boundary: "public-products" },
      },
      status: 500,
    }),
  ],
});

export const withPublicProductsJsonError = publicProductsJsonHelpers.withJsonError;

export function publicProductsJsonOk(
  payload: unknown,
  options: {
    cacheControl?: string;
    status?: number;
  } = {},
): Response {
  return publicProductsJsonHelpers.jsonOk(
    payload,
    options.status ?? 200,
    options.cacheControl
      ? { "Cache-Control": options.cacheControl }
      : undefined,
  );
}

function mapPublicProductsHttpError(error: unknown): JsonErrorMapping | null {
  if (!(error instanceof PublicProductsHttpError)) {
    return null;
  }

  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    log: error.httpStatus >= 500
      ? {
          level: "error",
          details: { boundary: "public-products" },
        }
      : null,
    status: error.httpStatus,
  };
}

function quietError(
  code: PublicProductApiErrorCode,
  message: string,
  status: number,
): JsonErrorMapping {
  return {
    error: {
      code,
      message,
      retryable: false,
    },
    log: null,
    status,
  };
}

function isBodyTooLargeError(error: unknown): boolean {
  return error instanceof RangeError
    && error.message.startsWith("Request body exceeded ");
}
