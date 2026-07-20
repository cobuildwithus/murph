import {
  PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES,
  PUBLIC_PRODUCTS_SCHEMA_VERSION,
  publicProductDetailSchema,
  publicProductSearchResponseSchema,
} from "@murphai/contracts";
import { describe, expect, it, vi } from "vitest";

import type {
  PublicProductLabelRecord,
  PublicProductLabelSearchItem,
  PublicProductTestEvidence,
} from "../src/lib/product-labels";
import { PublicProductDataUnavailableError } from "../src/lib/public-products/http";
import { encodePublicProductRef } from "../src/lib/public-products/product-ref";
import {
  createPublicProductsService,
  type PublicProductsDataSource,
} from "../src/lib/public-products/service";

describe("public product service", () => {
  it("searches requested corpora concurrently and preserves grouped ranking", async () => {
    const supplements = deferred<PublicProductLabelSearchItem[]>();
    const foods = deferred<PublicProductLabelSearchItem[]>();
    const source = createDataSource({
      searchSupplements: vi.fn(() => supplements.promise),
      searchFoods: vi.fn(() => foods.promise),
    });
    const service = createPublicProductsService(source);
    const resultPromise = service.search({
      query: "example",
      kinds: ["supplement", "food"],
      limitPerKind: 6,
    });

    expect(source.searchSupplements).toHaveBeenCalledOnce();
    expect(source.searchFoods).toHaveBeenCalledOnce();

    supplements.resolve([searchItem({ id: "dsld:1", name: "Supplement first" })]);
    foods.resolve([
      searchItem({ id: "fdc:1", name: "Food first", dataOrigin: "usda_branded" }),
      searchItem({ id: "brand:2", name: "Food second", dataOrigin: "brand_site" }),
    ]);

    const result = await resultPromise;
    expect(publicProductSearchResponseSchema.parse(result)).toEqual(result);
    expect(result.schema).toBe(PUBLIC_PRODUCTS_SCHEMA_VERSION);
    expect(result.results.supplements.map((item) => item.name)).toEqual([
      "Supplement first",
    ]);
    expect(result.results.foods.map((item) => item.name)).toEqual([
      "Food first",
      "Food second",
    ]);
    expect(JSON.stringify(result)).not.toContain("privateRawLabel");
  });

  it("does not query a corpus that was not requested", async () => {
    const source = createDataSource();
    const service = createPublicProductsService(source);

    await service.search({
      query: "example",
      kinds: ["supplement"],
      limitPerKind: 4,
    });

    expect(source.searchSupplements).toHaveBeenCalledWith({
      limit: 4,
      q: "example",
    });
    expect(source.searchFoods).not.toHaveBeenCalled();
  });

  it("normalizes one active detail record and exact-linked evidence", async () => {
    const record = productRecord();
    const evidence = productEvidence();
    const source = createDataSource({
      getSupplementRecord: vi.fn(async () => record),
      getSupplementEvidence: vi.fn(async () => evidence),
    });
    const service = createPublicProductsService(source);
    const ref = encodePublicProductRef("supplement", record.id);

    const result = await service.getDetail(ref);

    expect(result).not.toBeNull();
    expect(publicProductDetailSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      productRef: ref,
      kind: "supplement",
      marketStatus: "active",
      source: {
        key: "dsld",
        name: "Dietary Supplement Label Database",
        recordId: "source-record-1",
        releaseDate: null,
        lastSeenAt: null,
        importedAt: "2026-07-01T12:00:00.000Z",
      },
      productTests: {
        status: "known_product_tests",
        total: 1,
        returned: 1,
        truncated: false,
      },
    });
    expect(result?.ingredients.active[0]?.name).toBe("Example ingredient");
    expect(result?.productTests.observations[0]?.screening?.comparison).toBe(
      "does_not_exceed",
    );
    expect(result?.productTests.observations[0]).toMatchObject({
      result: {
        operator: "range",
        value: 0.1,
        upperValue: 0.2,
        qualifier: "estimated range",
      },
      sample: {
        evidenceType: "regulatory_laboratory",
        samplingContext: "retail_surveillance",
        lotCode: "LOT-1",
      },
    });
    expect(result?.unknowns.map((unknown) => unknown.code)).toEqual([
      "FORMULA_REVISION_NOT_TRACKED",
    ]);
    expect(source.getSupplementEvidence).toHaveBeenCalledWith({
      id: "dsld:1",
    });
    expect(JSON.stringify(result)).not.toContain("privateRawLabel");
  });

  it("preserves canonical FDC nutrient values in the public detail contract", async () => {
    const record = productRecord({
      id: "fdc:1",
      dataOrigin: "usda_branded",
      dataOriginId: "1",
      label: {
        ingredients: "Example ingredient",
        nutrientsPer100g: [
          { name: "Protein", value: 12.4, unit: "g" },
        ],
      },
      name: "Example branded food",
    });
    const source = createDataSource({
      getFoodRecord: vi.fn(async () => record),
    });
    const service = createPublicProductsService(source);

    const result = await service.getDetail(encodePublicProductRef("food", record.id));

    expect(result?.nutrition).toEqual({
      basis: "per_100_g",
      rows: [
        {
          name: "Protein",
          amount: { display: "12.4", unit: "g", value: 12.4 },
          dailyValuePercent: null,
          basis: "per_100_g",
        },
      ],
    });
  });

  it("derives honest unknowns from missing label and test evidence", async () => {
    const record = productRecord({
      label: { ingredients: "Ingredient statement only" },
      servingGrams: null,
    });
    const source = createDataSource({
      getSupplementRecord: vi.fn(async () => record),
    });
    const service = createPublicProductsService(source);

    const result = await service.getDetail(encodePublicProductRef("supplement", record.id));

    expect(result?.unknowns.map((unknown) => unknown.code)).toEqual([
      "FORMULA_REVISION_NOT_TRACKED",
      "INGREDIENTS_STATEMENT_ONLY",
      "NUTRITION_UNAVAILABLE",
      "SERVING_MASS_UNAVAILABLE",
      "NO_LINKED_PRODUCT_TESTS",
    ]);
    expect(result?.unknowns.find((unknown) =>
      unknown.code === "NO_LINKED_PRODUCT_TESTS")?.description).toContain(
      "not a safety finding",
    );
  });

  it("omits label content when the normalized detail would exceed its byte budget", async () => {
    const record = productRecord({
      label: {
        ingredientRows: Array.from({ length: 200 }, (_, index) => ({
          name: `Ingredient ${index} ${"x".repeat(480)}`,
          nestedRows: Array.from({ length: 50 }, (__, childIndex) => ({
            name: `Child ${childIndex} ${"y".repeat(490)}`,
          })),
        })),
      },
    });
    const source = createDataSource({
      getSupplementRecord: vi.fn(async () => record),
    });
    const service = createPublicProductsService(source);

    const result = await service.getDetail(encodePublicProductRef("supplement", record.id));

    expect(result?.ingredients.structure).toBe("unavailable");
    expect(result?.unknowns.map((unknown) => unknown.code)).toContain(
      "LABEL_CONTENT_OMITTED",
    );
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES,
    );
  });

  it("drops non-HTTP source and screening URLs at the public boundary", async () => {
    const record = productRecord({
      dataOriginUrl: "javascript:alert(1)",
    });
    const evidence = productEvidence();
    const observation = evidence.observations[0];
    if (!observation?.screening) {
      throw new Error("Expected screening fixture");
    }
    observation.screening.threshold.url = "data:text/plain,private";
    const source = createDataSource({
      getSupplementRecord: vi.fn(async () => record),
      getSupplementEvidence: vi.fn(async () => evidence),
    });
    const service = createPublicProductsService(source);

    const result = await service.getDetail(encodePublicProductRef("supplement", record.id));

    expect(result?.source.url).toBeNull();
    expect(result?.productTests.observations[0]?.screening?.threshold.url).toBeNull();
  });

  it("fails closed before data access for malformed references", async () => {
    const source = createDataSource();
    const service = createPublicProductsService(source);

    await expect(service.getDetail("supplement_not-canonical!")).resolves.toBeNull();
    expect(source.getSupplementRecord).not.toHaveBeenCalled();
    expect(source.getFoodRecord).not.toHaveBeenCalled();
  });

  it("does not load evidence when the record is absent", async () => {
    const source = createDataSource();
    const service = createPublicProductsService(source);

    await expect(
      service.getDetail(encodePublicProductRef("food", "fdc:missing")),
    ).resolves.toBeNull();
    expect(source.getFoodEvidence).not.toHaveBeenCalled();
  });

  it("converts database failures into a content-free availability error", async () => {
    const source = createDataSource({
      searchFoods: vi.fn(async () => {
        throw new Error("database query included private input");
      }),
    });
    const service = createPublicProductsService(source);

    await expect(service.search({
      query: "private input",
      kinds: ["food"],
      limitPerKind: 6,
    })).rejects.toEqual(expect.any(PublicProductDataUnavailableError));
  });
});

function createDataSource(
  overrides: Partial<PublicProductsDataSource> = {},
): PublicProductsDataSource {
  return {
    searchFoods: vi.fn(async () => []),
    searchSupplements: vi.fn(async () => []),
    getFoodRecord: vi.fn(async () => null),
    getSupplementRecord: vi.fn(async () => null),
    getFoodEvidence: vi.fn(async () => emptyEvidence()),
    getSupplementEvidence: vi.fn(async () => emptyEvidence()),
    ...overrides,
  };
}

function searchItem(
  overrides: Partial<PublicProductLabelSearchItem> = {},
): PublicProductLabelSearchItem {
  return {
    id: "dsld:1",
    dataOrigin: "dsld",
    dataOriginId: "source-record-1",
    dataOriginUrl: null,
    importedAt: "2026-07-01T12:00:00.000Z",
    name: "Example product",
    brand: "Example brand",
    upc: "12345678",
    testing: {
      status: "no_known_product_tests",
      observationCount: 0,
      sourceCount: 0,
      latestReportDate: null,
    },
    ...overrides,
  };
}

function productRecord(
  overrides: Partial<PublicProductLabelRecord> = {},
): PublicProductLabelRecord {
  return {
    id: "dsld:1",
    dataOrigin: "dsld",
    dataOriginId: "source-record-1",
    dataOriginUrl: "https://example.test/source-record-1",
    importedAt: "2026-07-01T12:00:00.000Z",
    releaseDate: null,
    lastSeenAt: null,
    name: "Example supplement",
    brand: "Example brand",
    upc: "12345678",
    servingGrams: 1,
    labelOmitted: false,
    label: {
      privateRawLabel: "must not leave the service",
      ingredientRows: [{ amount: 100, name: "Example ingredient", unit: "mg" }],
      nutritionRows: [{ amount: 10, name: "Example nutrient", unit: "mg" }],
      servingSizes: [{ amount: 1, description: "One capsule", grams: 1, unit: "capsule" }],
    },
    ...overrides,
  };
}

function emptyEvidence(): PublicProductTestEvidence {
  return {
    status: "no_known_product_tests",
    total: 0,
    returned: 0,
    truncated: false,
    observations: [],
    alerts: [],
  };
}

function productEvidence(): PublicProductTestEvidence {
  return {
    status: "known_product_tests",
    total: 1,
    returned: 1,
    truncated: false,
    observations: [
      {
        id: "test:1",
        sourceResultId: "source-result-1",
        labName: "Example laboratory",
        testMethod: "Example method",
        importedAt: "2026-07-02T12:00:00.000Z",
        contaminantKey: "lead",
        contaminantName: "Lead",
        result: {
          operator: "range",
          value: 0.1,
          upperValue: 0.2,
          qualifier: "estimated range",
          detectionLimit: { value: 0.01, unit: "ppm" },
          quantificationLimit: null,
          reportingLimit: null,
          uncertainty: { value: 0.02, unit: "ppm" },
          unit: "ppm",
          basis: "product_mass",
        },
        normalizedResult: {
          value: 0.1,
          upperValue: 0.2,
          unit: "ppm",
          basis: "product_mass",
        },
        sample: {
          evidenceType: "regulatory_laboratory",
          samplingContext: "retail_surveillance",
          sourceSampleId: "sample-1",
          sampleCount: 3,
          reportedUpc: "1234 5678",
          lotCode: "LOT-1",
          bestBy: "2027-01",
          packageSize: "100 g",
          collectedOn: "2026-06-01",
          testedOn: "2026-06-03",
          labName: "Example laboratory",
          testMethod: "Example method",
        },
        screening: {
          comparison: "does_not_exceed",
          threshold: {
            value: 0.5,
            unit: "ppm",
            basis: "product_mass",
            authority: "Example authority",
            name: "Example screening threshold",
            url: "https://example.test/threshold",
          },
        },
        source: {
          key: "example_source",
          name: "Example source",
          url: "https://example.test/report",
          reportTitle: "Example report",
          reportDate: "2026-06-01",
        },
        testedProduct: {
          name: "Example supplement",
          brand: "Example brand",
          upc: "12345678",
          sourceProductId: "source-product-1",
          matchMethod: "exact_upc",
        },
        alert: null,
      },
    ],
    alerts: [],
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
