import * as z from "./zod-runtime.ts";

import type { JsonSchema } from "./types.ts";

export const PUBLIC_PRODUCTS_SCHEMA_VERSION = "murph.public-products.v1" as const;
export const PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES = 1_000_000;

export const PUBLIC_PRODUCT_KINDS = ["supplement", "food"] as const;
export const PUBLIC_PRODUCT_API_ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_REQUEST",
  "REQUEST_BODY_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "PRODUCT_NOT_FOUND",
  "LABELS_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

const PUBLIC_PRODUCT_REF_PATTERN =
  /^(?:supplement|food)_[A-Za-z0-9_-]{1,1024}$/u;
const PUBLIC_PRODUCT_REF_MAX_LENGTH = 1_035;
const PUBLIC_PRODUCT_SEARCH_RESULT_LIMIT = 10;
const PUBLIC_PRODUCT_TEST_OBSERVATION_LIMIT = 20;
const PUBLIC_PRODUCT_TEST_ALERT_LIMIT = 5;

function boundedText(maxLength: number): z.ZodString {
  return z.string().trim().min(1).max(maxLength);
}

const nullableText = (maxLength: number) => boundedText(maxLength).nullable();
const nullableUrl = z
  .string()
  .trim()
  .max(2_048)
  .regex(/^https?:\/\//iu)
  .url()
  .nullable();
const nonnegativeFiniteNumber = z.number().finite().nonnegative();
const positiveFiniteNumber = z.number().finite().positive();
const nonnegativeInteger = z.number().int().safe().nonnegative();

export const publicProductKindSchema = z.enum(PUBLIC_PRODUCT_KINDS);

export const publicProductRefSchema = z
  .string()
  .min(6)
  .max(PUBLIC_PRODUCT_REF_MAX_LENGTH)
  .regex(PUBLIC_PRODUCT_REF_PATTERN);

const publicProductSearchKindsSchema = z
  .array(publicProductKindSchema)
  .min(1)
  .max(PUBLIC_PRODUCT_KINDS.length)
  .refine(
    (kinds) => new Set(kinds).size === kinds.length,
    "Product search kinds must be unique.",
  )
  .meta({ uniqueItems: true });

export const publicProductSearchRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(128),
    kinds: publicProductSearchKindsSchema.default(() => [
      ...PUBLIC_PRODUCT_KINDS,
    ]),
    limitPerKind: z.number().int().min(1).max(10).default(6),
  })
  .strict();

const publicProductTestStatusSchema = z.enum([
  "no_known_product_tests",
  "known_product_tests",
]);

const publicProductTestSummarySchema = z
  .object({
    status: publicProductTestStatusSchema,
    total: nonnegativeInteger,
  })
  .strict()
  .superRefine((summary, context) => {
    const expectedStatus = summary.total === 0
      ? "no_known_product_tests"
      : "known_product_tests";

    if (summary.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "Product test status must agree with the total.",
        path: ["status"],
      });
    }
  });

const publicProductSearchHitBaseSchema = z
  .object({
    productRef: publicProductRefSchema,
    name: boundedText(512),
    brand: nullableText(512),
    upc: z.string().regex(/^\d+$/u).max(32).nullable(),
    source: z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/u).max(128),
        name: boundedText(256),
      })
      .strict(),
    productTests: publicProductTestSummarySchema,
  })
  .strict();

const publicSupplementSearchHitSchema = publicProductSearchHitBaseSchema.extend({
  kind: z.literal("supplement"),
});

const publicFoodSearchHitSchema = publicProductSearchHitBaseSchema.extend({
  kind: z.literal("food"),
});

export const publicProductSearchHitSchema = z.discriminatedUnion("kind", [
  publicSupplementSearchHitSchema,
  publicFoodSearchHitSchema,
]);

export const publicProductSearchResponseSchema = z
  .object({
    schema: z.literal(PUBLIC_PRODUCTS_SCHEMA_VERSION),
    results: z
      .object({
        supplements: z
          .array(publicSupplementSearchHitSchema)
          .max(PUBLIC_PRODUCT_SEARCH_RESULT_LIMIT),
        foods: z
          .array(publicFoodSearchHitSchema)
          .max(PUBLIC_PRODUCT_SEARCH_RESULT_LIMIT),
      })
      .strict(),
  })
  .strict();

const publicProductMeasuredValueSchema = z
  .object({
    value: nonnegativeFiniteNumber.nullable(),
    unit: nullableText(64),
    display: nullableText(256),
  })
  .strict();

const publicProductIngredientChildSchema = z
  .object({
    name: boundedText(512),
    amount: publicProductMeasuredValueSchema.nullable(),
    dailyValuePercent: nonnegativeFiniteNumber.nullable(),
    notes: nullableText(2_000),
  })
  .strict();

const publicProductIngredientSchema = publicProductIngredientChildSchema.extend({
  children: z.array(publicProductIngredientChildSchema).max(50),
});

const publicProductIngredientsSchema = z
  .object({
    structure: z.enum(["structured", "statement_only", "unavailable"]),
    statement: nullableText(16_000),
    otherStatement: nullableText(16_000),
    active: z.array(publicProductIngredientSchema).max(200),
    other: z.array(publicProductIngredientSchema).max(200),
  })
  .strict();

const publicProductNutritionFactSchema = z
  .object({
    name: boundedText(512),
    amount: publicProductMeasuredValueSchema.nullable(),
    dailyValuePercent: nonnegativeFiniteNumber.nullable(),
    basis: z.enum(["per_serving", "per_100_g", "source_unspecified"]),
  })
  .strict();

const publicProductNutritionSchema = z
  .object({
    basis: z.enum(["per_serving", "per_100_g", "mixed", "unavailable"]),
    rows: z.array(publicProductNutritionFactSchema).max(256),
  })
  .strict();

const publicProductTestResultOperatorSchema = z.enum([
  "eq",
  "lt",
  "lte",
  "gt",
  "gte",
  "range",
  "not_detected",
  "detected",
  "trace",
]);

const publicProductTestMeasurementMetadataSchema = z
  .object({
    value: nonnegativeFiniteNumber,
    unit: boundedText(64),
  })
  .strict();

const publicProductTestResultSchema = z
  .object({
    operator: publicProductTestResultOperatorSchema,
    value: nonnegativeFiniteNumber.nullable(),
    upperValue: nonnegativeFiniteNumber.nullable().optional(),
    qualifier: nullableText(512).optional(),
    detectionLimit: publicProductTestMeasurementMetadataSchema.nullable().optional(),
    quantificationLimit:
      publicProductTestMeasurementMetadataSchema.nullable().optional(),
    reportingLimit: publicProductTestMeasurementMetadataSchema.nullable().optional(),
    uncertainty: publicProductTestMeasurementMetadataSchema.nullable().optional(),
    unit: boundedText(64),
    basis: boundedText(256),
  })
  .strict();

const publicProductNormalizedTestResultSchema = z
  .object({
    value: nonnegativeFiniteNumber,
    upperValue: nonnegativeFiniteNumber.nullable().optional(),
    unit: boundedText(64),
    basis: boundedText(256),
  })
  .strict();

const publicProductTestSampleSchema = z
  .object({
    evidenceType: z.enum([
      "laboratory_measurement",
      "regulatory_laboratory",
      "regulatory_finding",
      "xrf_screening",
      "manufacturer_coa",
    ]),
    samplingContext: z.string().regex(/^[a-z][a-z0-9_]*$/u).max(128),
    sourceSampleId: nullableText(512),
    sampleCount: z.number().int().positive().finite().nullable().optional(),
    reportedUpc: nullableText(128).optional(),
    lotCode: nullableText(512),
    bestBy: nullableText(512),
    packageSize: nullableText(256),
    collectedOn: z.iso.date().nullable(),
    testedOn: z.iso.date().nullable(),
    labName: nullableText(512),
    testMethod: nullableText(2_000),
  })
  .strict();

const publicProductTestSourceSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/u).max(128),
    name: boundedText(256),
    url: nullableUrl,
    reportTitle: nullableText(1_000),
    reportDate: z.iso.date().nullable(),
  })
  .strict();

const publicProductTestedProductSchema = z
  .object({
    name: nullableText(512),
    brand: nullableText(512),
    upc: nullableText(64),
    sourceProductId: nullableText(512),
    matchMethod: z.enum([
      "exact_upc",
      "exact_source_id",
      "manual_confirmed",
    ]),
  })
  .strict();

const publicProductTestAnalyteSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9_]*$/u).max(128),
    name: boundedText(256),
  })
  .strict();

const publicProductTestThresholdSchema = z
  .object({
    value: nonnegativeFiniteNumber,
    unit: boundedText(64),
    basis: boundedText(256),
    authority: boundedText(512),
    name: boundedText(512),
    url: nullableUrl,
  })
  .strict();

const publicProductScreeningPolicySchema = z
  .object({
    id: boundedText(128),
    assumedBodyWeightKg: positiveFiniteNumber,
    assumedServingsPerDay: positiveFiniteNumber,
    servingGrams: positiveFiniteNumber,
    exposure: z
      .object({
        value: nonnegativeFiniteNumber,
        unit: boundedText(64),
        basis: boundedText(256),
      })
      .strict(),
    ratio: nonnegativeFiniteNumber,
  })
  .strict();

const publicProductTestScreeningSchema = z
  .object({
    comparison: z.enum(["exceeds", "does_not_exceed"]),
    threshold: publicProductTestThresholdSchema,
    screeningPolicy: publicProductScreeningPolicySchema.optional(),
  })
  .strict();

const publicProductTestObservationSchema = z
  .object({
    id: boundedText(512),
    analyte: publicProductTestAnalyteSchema,
    result: publicProductTestResultSchema,
    normalizedResult: publicProductNormalizedTestResultSchema.nullable(),
    source: publicProductTestSourceSchema,
    testedProduct: publicProductTestedProductSchema,
    sample: publicProductTestSampleSchema.optional(),
    labName: nullableText(512),
    testMethod: nullableText(2_000),
    screening: publicProductTestScreeningSchema.nullable(),
  })
  .strict();

const publicProductTestAlertSchema = z
  .object({
    analyte: publicProductTestAnalyteSchema,
    concernLevel: z.enum(["low", "medium", "high"]),
    result: publicProductTestResultSchema,
    threshold: publicProductTestThresholdSchema,
    screeningPolicy: publicProductScreeningPolicySchema.optional(),
    source: publicProductTestSourceSchema,
    testedProduct: publicProductTestedProductSchema,
    sample: publicProductTestSampleSchema.optional(),
  })
  .strict();

const publicProductTestsSchema = z
  .object({
    status: publicProductTestStatusSchema,
    total: nonnegativeInteger,
    returned: nonnegativeInteger.max(PUBLIC_PRODUCT_TEST_OBSERVATION_LIMIT),
    truncated: z.boolean(),
    observations: z
      .array(publicProductTestObservationSchema)
      .max(PUBLIC_PRODUCT_TEST_OBSERVATION_LIMIT),
    alerts: z
      .array(publicProductTestAlertSchema)
      .max(PUBLIC_PRODUCT_TEST_ALERT_LIMIT),
  })
  .strict()
  .superRefine((tests, context) => {
    if (tests.returned !== tests.observations.length) {
      context.addIssue({
        code: "custom",
        message: "Returned product test count must equal the observations length.",
        path: ["returned"],
      });
    }

    if (tests.total < tests.returned) {
      context.addIssue({
        code: "custom",
        message: "Product test total cannot be smaller than the returned count.",
        path: ["total"],
      });
    }

    if (tests.truncated !== (tests.total > tests.returned)) {
      context.addIssue({
        code: "custom",
        message: "Product test truncation must agree with total and returned counts.",
        path: ["truncated"],
      });
    }

    const expectedStatus = tests.total === 0
      ? "no_known_product_tests"
      : "known_product_tests";
    if (tests.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "Product test status must agree with the total.",
        path: ["status"],
      });
    }
  })
  .meta({
    description:
      "Exact-linked product tests. Missing tests are an evidence gap, not a safety finding.",
  });

const publicProductSourceSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/u).max(128),
    name: boundedText(256),
    recordId: boundedText(512),
    url: nullableUrl,
    releaseDate: z.iso.date().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    importedAt: z.iso.datetime().nullable(),
  })
  .strict();

const publicProductUnknownCodeSchema = z.enum([
  "NO_LINKED_PRODUCT_TESTS",
  "INGREDIENTS_STATEMENT_ONLY",
  "INGREDIENTS_UNAVAILABLE",
  "NUTRITION_UNAVAILABLE",
  "SERVING_MASS_UNAVAILABLE",
  "FORMULA_REVISION_NOT_TRACKED",
  "LABEL_CONTENT_OMITTED",
  "TESTED_LOT_NOT_REPORTED",
  "TEST_LAB_NOT_REPORTED",
  "TEST_METHOD_NOT_REPORTED",
  "TEST_THRESHOLD_NOT_COMPARABLE",
]);

const publicProductUnknownSchema = z
  .object({
    code: publicProductUnknownCodeSchema,
    title: boundedText(160),
    description: boundedText(1_000),
  })
  .strict();

const publicProductServingSchema = z
  .object({
    description: nullableText(512),
    amount: positiveFiniteNumber.nullable(),
    unit: nullableText(64),
    grams: positiveFiniteNumber.nullable(),
  })
  .strict();

export const publicProductDetailSchema = z
  .object({
    productRef: publicProductRefSchema,
    kind: publicProductKindSchema,
    name: boundedText(512),
    brand: nullableText(512),
    upc: z.string().regex(/^\d+$/u).max(32).nullable(),
    marketStatus: z.enum(["active", "off_market"]),
    serving: publicProductServingSchema.nullable(),
    ingredients: publicProductIngredientsSchema,
    nutrition: publicProductNutritionSchema,
    productTests: publicProductTestsSchema,
    source: publicProductSourceSchema,
    unknowns: z.array(publicProductUnknownSchema).max(16),
  })
  .strict()
  .superRefine((detail, context) => {
    if (serializedByteLength(detail) > PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Public product detail exceeds the serialized response bound.",
      });
    }
  });

export const publicProductDetailResponseSchema = z
  .object({
    schema: z.literal(PUBLIC_PRODUCTS_SCHEMA_VERSION),
    product: publicProductDetailSchema,
  })
  .strict();

export const publicProductApiErrorCodeSchema = z.enum(
  PUBLIC_PRODUCT_API_ERROR_CODES,
);

export const publicProductApiErrorSchema = z
  .object({
    error: z
      .object({
        code: publicProductApiErrorCodeSchema,
        message: boundedText(512),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export interface PublicProductApiJsonSchemas {
  PublicProductApiError: JsonSchema;
  PublicProductDetailResponse: JsonSchema;
  PublicProductRef: JsonSchema;
  PublicProductSearchRequest: JsonSchema;
  PublicProductSearchResponse: JsonSchema;
}

/**
 * Materialize OpenAPI component schemas only in the server-side spec builder.
 * Browser consumers can import the Zod contracts without paying this work at
 * module initialization.
 */
export function createPublicProductApiJsonSchemas(): PublicProductApiJsonSchemas {
  return Object.freeze({
    PublicProductApiError: toComponentJsonSchema(publicProductApiErrorSchema),
    PublicProductDetailResponse: toComponentJsonSchema(
      publicProductDetailResponseSchema,
    ),
    PublicProductRef: toComponentJsonSchema(publicProductRefSchema),
    PublicProductSearchRequest: toComponentJsonSchema(
      publicProductSearchRequestSchema,
      "input",
    ),
    PublicProductSearchResponse: toComponentJsonSchema(
      publicProductSearchResponseSchema,
    ),
  });
}

function toComponentJsonSchema(
  schema: z.ZodType,
  io: "input" | "output" = "output",
): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema, { io }) as JsonSchema;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export type PublicProductKind = z.infer<typeof publicProductKindSchema>;
export type PublicProductRef = z.infer<typeof publicProductRefSchema>;
export type PublicProductSearchRequestInput = z.input<
  typeof publicProductSearchRequestSchema
>;
export type PublicProductSearchRequest = z.output<
  typeof publicProductSearchRequestSchema
>;
export type PublicProductSearchHit = z.infer<
  typeof publicProductSearchHitSchema
>;
export type PublicProductSearchResponse = z.infer<
  typeof publicProductSearchResponseSchema
>;
export type PublicProductDetail = z.infer<typeof publicProductDetailSchema>;
export type PublicProductDetailResponse = z.infer<
  typeof publicProductDetailResponseSchema
>;
export type PublicProductApiErrorCode = z.infer<
  typeof publicProductApiErrorCodeSchema
>;
export type PublicProductApiError = z.infer<
  typeof publicProductApiErrorSchema
>;
