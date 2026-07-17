import "server-only";

import {
  PUBLIC_PRODUCTS_SCHEMA_VERSION,
  createPublicProductApiJsonSchemas,
} from "@murphai/contracts";

const JSON_CONTENT = "application/json";

export function createPublicProductsOpenApiDocument(): Record<string, unknown> {
  const schemas = createPublicProductApiJsonSchemas();

  return {
    openapi: "3.1.0",
    info: {
      title: "Murph Product Data API",
      version: "1.0.0",
      description:
        "Normalized food, supplement, and exact-linked product-test data. Missing product tests are an evidence gap, not a safety finding.",
    },
    tags: [
      {
        name: "Products",
        description: "Search and retrieve current source-backed product records.",
      },
      {
        name: "Specification",
        description: "Machine-readable API contract.",
      },
    ],
    paths: {
      "/api/public/v1/products/search": {
        post: {
          operationId: "searchProducts",
          summary: "Search supplements and branded foods",
          description:
            "Returns separately ranked supplement and branded-food matches. The submitted query is not echoed in the response.",
          tags: ["Products"],
          security: [],
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT]: {
                schema: componentRef("PublicProductSearchRequest"),
                example: {
                  query: "example product",
                  kinds: ["supplement", "food"],
                  limitPerKind: 6,
                },
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "Grouped product matches.",
              "PublicProductSearchResponse",
              {
                schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
                results: {
                  supplements: [],
                  foods: [],
                },
              },
            ),
            "400": errorResponse("Invalid JSON or request fields."),
            "413": errorResponse("Request body exceeds 4 KiB."),
            "415": errorResponse("Content-Type must be application/json."),
            "429": rateLimitResponse(),
            "500": errorResponse("Unexpected server failure."),
            "503": errorResponse("Product labels are temporarily unavailable."),
          },
        },
      },
      "/api/public/v1/products/{productRef}": {
        get: {
          operationId: "getProduct",
          summary: "Get normalized product evidence",
          description:
            "Returns label contents, nutrition, up to 20 exact-linked product-test observations, explicit counts, provenance, and known evidence gaps.",
          tags: ["Products"],
          security: [],
          parameters: [
            {
              name: "productRef",
              in: "path",
              required: true,
              description: "Opaque product record identifier. It is not authorization.",
              schema: componentRef("PublicProductRef"),
              example: "supplement_ZHNsZDoxMjM",
            },
          ],
          responses: {
            "200": jsonResponse(
              "Normalized product evidence.",
              "PublicProductDetailResponse",
            ),
            "404": errorResponse("Product record not found."),
            "429": rateLimitResponse(),
            "500": errorResponse("Unexpected server failure."),
            "503": errorResponse("Product labels are temporarily unavailable."),
          },
        },
      },
      "/api/public/v1/openapi.json": {
        get: {
          operationId: "getPublicProductsOpenApi",
          summary: "Get the OpenAPI document",
          tags: ["Specification"],
          security: [],
          responses: {
            "200": {
              description: "OpenAPI 3.1 document.",
              content: {
                [JSON_CONTENT]: {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas,
    },
  };
}

function componentRef(name: keyof ReturnType<typeof createPublicProductApiJsonSchemas>) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(
  description: string,
  schemaName: keyof ReturnType<typeof createPublicProductApiJsonSchemas>,
  example?: unknown,
) {
  return {
    description,
    content: {
      [JSON_CONTENT]: {
        schema: componentRef(schemaName),
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

function errorResponse(description: string) {
  return jsonResponse(description, "PublicProductApiError");
}

function rateLimitResponse() {
  return {
    description:
      "Per-IP request limit exceeded by the upstream firewall. The response body and headers are platform-defined and are not part of this API contract.",
  };
}
