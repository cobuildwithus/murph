import { describe, expect, it } from "vitest";

import {
  createPublicProductApiJsonSchemas,
  PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES,
  PUBLIC_PRODUCTS_SCHEMA_VERSION,
  publicProductApiErrorSchema,
  publicProductDetailResponseSchema,
  publicProductRefSchema,
  publicProductSearchRequestSchema,
  publicProductSearchResponseSchema,
} from "../src/public-products.ts";

const searchHit = {
  productRef: "supplement_ODIxMTg",
  kind: "supplement" as const,
  name: "Creatine Monohydrate",
  brand: "Example Brand",
  upc: "123456789012",
  source: {
    key: "dsld",
    name: "Dietary Supplement Label Database",
  },
  productTests: {
    status: "known_product_tests" as const,
    total: 1,
  },
};

const testObservation = {
  id: "test_1",
  analyte: {
    key: "lead",
    name: "Lead",
  },
  result: {
    operator: "eq" as const,
    value: 0.12,
    unit: "ppm",
    basis: "product_mass",
  },
  normalizedResult: {
    value: 0.12,
    unit: "ppm",
    basis: "product_mass",
  },
  source: {
    key: "plasticlist_bay_area_2024",
    name: "PlasticList",
    url: "https://example.test/report",
    reportTitle: "Synthetic test report",
    reportDate: "2026-01-02",
  },
  testedProduct: {
    name: "Creatine Monohydrate",
    brand: "Example Brand",
    upc: "123456789012",
    sourceProductId: "synthetic-1",
    matchMethod: "exact_upc" as const,
  },
  labName: "Example Lab",
  testMethod: "Synthetic method",
  screening: {
    comparison: "does_not_exceed" as const,
    threshold: {
      value: 0.5,
      unit: "ppm",
      basis: "product_mass",
      authority: "Example Authority",
      name: "Synthetic screening threshold",
      url: "https://example.test/threshold",
    },
  },
};

function detailResponse() {
  return {
    schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
    product: {
      productRef: "supplement_ODIxMTg",
      kind: "supplement" as const,
      name: "Creatine Monohydrate",
      brand: "Example Brand",
      upc: "123456789012",
      marketStatus: "active" as const,
      serving: {
        description: "1 scoop",
        amount: 1,
        unit: "scoop",
        grams: 5,
      },
      ingredients: {
        structure: "structured" as const,
        statement: null,
        otherStatement: null,
        active: [
          {
            name: "Creatine monohydrate",
            amount: {
              value: 5,
              unit: "g",
              display: "5 g",
            },
            dailyValuePercent: null,
            notes: null,
            children: [],
          },
        ],
        other: [],
      },
      nutrition: {
        basis: "unavailable" as const,
        rows: [],
      },
      productTests: {
        status: "known_product_tests" as const,
        total: 1,
        returned: 1,
        truncated: false,
        observations: [testObservation],
        alerts: [],
      },
      source: {
        key: "dsld",
        name: "Dietary Supplement Label Database",
        recordId: "82118",
        url: "https://example.test/label",
        releaseDate: null,
        lastSeenAt: null,
        importedAt: "2026-01-03T04:05:06.000Z",
      },
      unknowns: [
        {
          code: "FORMULA_REVISION_NOT_TRACKED" as const,
          title: "Formula revision is not tracked",
          description: "This record does not identify a formula revision.",
        },
      ],
    },
  };
}

describe("public product API contracts", () => {
  it("trims search text and applies bounded defaults", () => {
    expect(
      publicProductSearchRequestSchema.parse({
        query: "  creatine  ",
      }),
    ).toEqual({
      query: "creatine",
      kinds: ["supplement", "food"],
      limitPerKind: 6,
    });

    expect(
      publicProductSearchRequestSchema.safeParse({
        query: "a",
      }).success,
    ).toBe(false);
    expect(
      publicProductSearchRequestSchema.safeParse({
        query: "a".repeat(129),
      }).success,
    ).toBe(false);
    expect(
      publicProductSearchRequestSchema.safeParse({
        query: "creatine",
        kinds: ["supplement", "supplement"],
      }).success,
    ).toBe(false);
    expect(
      publicProductSearchRequestSchema.safeParse({
        query: "creatine",
        limitPerKind: 11,
      }).success,
    ).toBe(false);
    expect(
      publicProductSearchRequestSchema.safeParse({
        query: "creatine",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded opaque product references", () => {
    expect(publicProductRefSchema.parse("food_ZmRjOjEyMw")).toBe(
      "food_ZmRjOjEyMw",
    );
    expect(publicProductRefSchema.safeParse("food:fdc:123").success).toBe(false);
    expect(publicProductRefSchema.safeParse("other_ZmRjOjEyMw").success).toBe(
      false,
    );
    expect(
      publicProductRefSchema.safeParse(`food_${"a".repeat(1_025)}`).success,
    ).toBe(false);
  });

  it("keeps search results grouped and excludes a query echo", () => {
    const response = {
      schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
      results: {
        supplements: [searchHit],
        foods: [],
      },
    };

    expect(publicProductSearchResponseSchema.parse(response)).toEqual(response);
    expect(
      publicProductSearchResponseSchema.safeParse({
        ...response,
        query: "creatine",
      }).success,
    ).toBe(false);
    expect(
      publicProductSearchResponseSchema.safeParse({
        ...response,
        results: {
          supplements: [],
          foods: [searchHit],
        },
      }).success,
    ).toBe(false);
  });

  it("enforces honest total, returned, and truncation semantics", () => {
    const response = detailResponse();
    expect(publicProductDetailResponseSchema.parse(response)).toEqual(response);

    expect(
      publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            returned: 0,
          },
        },
      }).success,
    ).toBe(false);

    expect(
      publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            total: 2,
            truncated: false,
          },
        },
      }).success,
    ).toBe(false);

    expect(
      publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            total: 21,
            returned: 21,
            observations: Array.from({ length: 21 }, () => testObservation),
          },
        },
      }).success,
    ).toBe(false);
  });

  it("represents threshold comparisons on each observation explicitly", () => {
    const response = detailResponse();
    expect(
      response.product.productTests.observations[0]?.screening,
    ).toMatchObject({
      comparison: "does_not_exceed",
      threshold: {
        authority: "Example Authority",
        value: 0.5,
      },
    });
    expect(publicProductDetailResponseSchema.safeParse(response).success).toBe(
      true,
    );

    expect(
      publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            observations: [
              {
                ...testObservation,
                screening: {
                  ...testObservation.screening,
                  comparison: "unknown",
                },
              },
            ],
          },
        },
      }).success,
    ).toBe(false);

    expect(
      publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            observations: [{ ...testObservation, screening: null }],
          },
        },
      }).success,
    ).toBe(true);
  });

  it("accepts only HTTP or HTTPS URLs at every public link boundary", () => {
    const response = detailResponse();
    expect(publicProductDetailResponseSchema.safeParse(response).success).toBe(true);

    for (const unsafeUrl of [
      "javascript:alert(1)",
      "data:text/plain,private",
      "file:///tmp/private",
    ]) {
      expect(publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          source: { ...response.product.source, url: unsafeUrl },
        },
      }).success).toBe(false);
      expect(publicProductDetailResponseSchema.safeParse({
        ...response,
        product: {
          ...response.product,
          productTests: {
            ...response.product.productTests,
            observations: [{
              ...testObservation,
              screening: {
                ...testObservation.screening,
                threshold: {
                  ...testObservation.screening.threshold,
                  url: unsafeUrl,
                },
              },
            }],
          },
        },
      }).success).toBe(false);
    }
  });

  it("rejects contract-valid fields whose aggregate detail exceeds the byte budget", () => {
    const response = detailResponse();
    const oversizedProduct = {
      ...response.product,
      ingredients: {
        ...response.product.ingredients,
        active: Array.from({ length: 200 }, (_, index) => ({
          ...response.product.ingredients.active[0],
          name: `Ingredient ${index} ${"x".repeat(480)}`,
          children: Array.from({ length: 50 }, (__, childIndex) => ({
            name: `Child ${childIndex} ${"y".repeat(490)}`,
            amount: null,
            dailyValuePercent: null,
            notes: null,
          })),
        })),
      },
    };

    expect(new TextEncoder().encode(JSON.stringify(oversizedProduct)).byteLength)
      .toBeGreaterThan(PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES);
    expect(publicProductDetailResponseSchema.safeParse({
      ...response,
      product: oversizedProduct,
    }).success).toBe(false);
  });

  it("keeps public API errors stable and free of arbitrary details", () => {
    expect(
      publicProductApiErrorSchema.parse({
        error: {
          code: "LABELS_UNAVAILABLE",
          message: "Product data is temporarily unavailable.",
          retryable: true,
        },
      }),
    ).toEqual({
      error: {
        code: "LABELS_UNAVAILABLE",
        message: "Product data is temporarily unavailable.",
        retryable: true,
      },
    });
    expect(
      publicProductApiErrorSchema.safeParse({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
          retryable: false,
          details: { query: "must not be reflected" },
        },
      }).success,
    ).toBe(false);
  });

  it("lazily produces OpenAPI component schemas from the same contracts", () => {
    const schemas = createPublicProductApiJsonSchemas();

    expect(Object.isFrozen(schemas)).toBe(true);
    expect(Object.keys(schemas).sort()).toEqual([
      "PublicProductApiError",
      "PublicProductDetailResponse",
      "PublicProductRef",
      "PublicProductSearchRequest",
      "PublicProductSearchResponse",
    ]);
    expect(schemas.PublicProductSearchRequest.$schema).toBeUndefined();
    expect(schemas.PublicProductSearchRequest).toMatchObject({
      additionalProperties: false,
      properties: {
        kinds: {
          default: ["supplement", "food"],
          maxItems: 2,
          minItems: 1,
          uniqueItems: true,
        },
        limitPerKind: {
          default: 6,
          maximum: 10,
          minimum: 1,
        },
        query: {
          maxLength: 128,
          minLength: 2,
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    });
  });
});
