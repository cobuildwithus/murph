import "server-only";

import {
  PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES,
  PUBLIC_PRODUCTS_SCHEMA_VERSION,
  publicProductDetailSchema,
  publicProductSearchResponseSchema,
  type PublicProductDetail,
  type PublicProductKind,
  type PublicProductSearchHit,
  type PublicProductSearchRequest,
  type PublicProductSearchResponse,
} from "@murphai/contracts";

import {
  getPublicFoodEvidence,
  getPublicFoodRecordById,
  searchPublicFoods,
} from "../foods";
import type {
  PublicProductLabelRecord,
  PublicProductLabelSearchItem,
  PublicProductTestEvidence,
} from "../product-labels";
import {
  getPublicSupplementEvidence,
  getPublicSupplementRecordById,
  searchPublicSupplements,
} from "../supplements";
import { PublicProductDataUnavailableError } from "./http";
import { normalizePublicProductLabel } from "./normalize-label";
import {
  decodePublicProductRef,
  encodePublicProductRef,
} from "./product-ref";

export interface PublicProductsDataSource {
  searchFoods(input: { limit: number; q: string }): Promise<PublicProductLabelSearchItem[]>;
  searchSupplements(input: { limit: number; q: string }): Promise<PublicProductLabelSearchItem[]>;
  getFoodRecord(input: { id: string }): Promise<PublicProductLabelRecord | null>;
  getSupplementRecord(input: { id: string }): Promise<PublicProductLabelRecord | null>;
  getFoodEvidence(input: {
    id: string;
  }): Promise<PublicProductTestEvidence>;
  getSupplementEvidence(input: {
    id: string;
  }): Promise<PublicProductTestEvidence>;
}

export interface PublicProductsService {
  search(input: PublicProductSearchRequest): Promise<PublicProductSearchResponse>;
  getDetail(productRef: string): Promise<PublicProductDetail | null>;
}

const defaultDataSource: PublicProductsDataSource = {
  searchFoods: searchPublicFoods,
  searchSupplements: searchPublicSupplements,
  getFoodRecord: getPublicFoodRecordById,
  getSupplementRecord: getPublicSupplementRecordById,
  getFoodEvidence: getPublicFoodEvidence,
  getSupplementEvidence: getPublicSupplementEvidence,
};

export function createPublicProductsService(
  dataSource: PublicProductsDataSource,
): PublicProductsService {
  return {
    async search(input) {
      const includeSupplements = input.kinds.includes("supplement");
      const includeFoods = input.kinds.includes("food");
      const [supplements, foods] = await Promise.all([
        includeSupplements
          ? readProductData(() => dataSource.searchSupplements({
              limit: input.limitPerKind,
              q: input.query,
            }))
          : Promise.resolve([]),
        includeFoods
          ? readProductData(() => dataSource.searchFoods({
              limit: input.limitPerKind,
              q: input.query,
            }))
          : Promise.resolve([]),
      ]);

      return publicProductSearchResponseSchema.parse({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        results: {
          supplements: supplements.map((item) =>
            toPublicProductSearchHit("supplement", item)),
          foods: foods.map((item) => toPublicProductSearchHit("food", item)),
        },
      });
    },

    async getDetail(productRef) {
      const decoded = decodePublicProductRef(productRef);
      if (!decoded) {
        return null;
      }

      const record = await readProductData(() => decoded.kind === "supplement"
        ? dataSource.getSupplementRecord({ id: decoded.id })
        : dataSource.getFoodRecord({ id: decoded.id }));
      if (!record) {
        return null;
      }

      const evidence = await readProductData(() => decoded.kind === "supplement"
        ? dataSource.getSupplementEvidence({
            id: record.id,
          })
        : dataSource.getFoodEvidence({
            id: record.id,
          }));
      let label = normalizePublicProductLabel({
        kind: decoded.kind,
        label: record.label,
        servingGrams: record.servingGrams,
      });
      let labelOmitted = record.labelOmitted;
      const buildDetail = () => ({
          productRef: encodePublicProductRef(decoded.kind, record.id),
          kind: decoded.kind,
          name: boundedRequiredText(record.name, 512),
          brand: boundedText(record.brand, 512),
          upc: normalizeUpc(record.upc),
          marketStatus: "active" as const,
          serving: label.serving,
          ingredients: label.ingredients,
          nutrition: label.nutrition,
          productTests: toPublicProductTests(evidence),
          source: {
            key: normalizeSourceKey(record.dataOrigin),
            name: publicProductSourceName(record.dataOrigin),
            recordId: boundedRequiredText(record.dataOriginId, 512),
            url: normalizePublicUrl(record.dataOriginUrl),
            releaseDate: normalizeDate(record.releaseDate),
            lastSeenAt: normalizeTimestamp(record.lastSeenAt),
            importedAt: normalizeTimestamp(record.importedAt),
          },
          unknowns: buildPublicProductUnknowns(
            label.unknownCodes,
            evidence,
            labelOmitted,
          ),
        });
      let detail = buildDetail();

      if (
        !labelOmitted
        && serializedByteLength(detail) > PUBLIC_PRODUCT_DETAIL_MAX_SERIALIZED_BYTES
      ) {
        labelOmitted = true;
        label = normalizePublicProductLabel({
          kind: decoded.kind,
          label: null,
          servingGrams: record.servingGrams,
        });
        detail = buildDetail();
      }

      return publicProductDetailSchema.parse(detail);
    },
  };
}

const defaultService = createPublicProductsService(defaultDataSource);

export async function searchPublicProducts(
  input: PublicProductSearchRequest,
): Promise<PublicProductSearchResponse> {
  return await defaultService.search(input);
}

export async function getPublicProductDetail(
  productRef: string,
): Promise<PublicProductDetail | null> {
  return await defaultService.getDetail(productRef);
}

function toPublicProductSearchHit(
  kind: PublicProductKind,
  item: PublicProductLabelSearchItem,
): PublicProductSearchHit {
  return {
    productRef: encodePublicProductRef(kind, item.id),
    kind,
    name: boundedRequiredText(item.name, 512),
    brand: boundedText(item.brand, 512),
    upc: normalizeUpc(item.upc),
    source: {
      key: normalizeSourceKey(item.dataOrigin),
      name: publicProductSourceName(item.dataOrigin),
    },
    productTests: {
      status: item.testing.status,
      total: item.testing.observationCount,
    },
  };
}

function toPublicProductTests(
  evidence: PublicProductTestEvidence,
): PublicProductDetail["productTests"] {
  return {
    status: evidence.status,
    total: evidence.total,
    returned: evidence.returned,
    truncated: evidence.truncated,
    observations: evidence.observations.map((observation) => ({
      id: boundedRequiredText(observation.id, 512),
      analyte: {
        key: normalizeAnalyteKey(observation.contaminantKey),
        name: boundedRequiredText(observation.contaminantName, 256),
      },
      result: normalizeProductTestResult(observation.result),
      normalizedResult: observation.normalizedResult
        ? {
            value: observation.normalizedResult.value,
            upperValue: observation.normalizedResult.upperValue ?? null,
            unit: boundedRequiredText(observation.normalizedResult.unit, 64),
            basis: boundedRequiredText(observation.normalizedResult.basis, 256),
          }
        : null,
      screening: observation.screening
        ? {
            ...observation.screening,
            threshold: normalizeProductTestThreshold(
              observation.screening.threshold,
            ),
          }
        : null,
      source: normalizeProductTestSource(observation.source),
      testedProduct: {
        name: boundedText(observation.testedProduct.name, 512),
        brand: boundedText(observation.testedProduct.brand, 512),
        upc: boundedText(observation.testedProduct.upc, 64),
        sourceProductId: boundedText(
          observation.testedProduct.sourceProductId,
          512,
        ),
        matchMethod: observation.testedProduct.matchMethod,
      },
      ...(observation.sample
        ? { sample: normalizeProductTestSample(observation.sample) }
        : {}),
      labName: boundedText(observation.labName, 512),
      testMethod: boundedText(observation.testMethod, 2_000),
    })),
    alerts: evidence.alerts.map((alert) => ({
      analyte: {
        key: normalizeAnalyteKey(alert.contaminantKey),
        name: boundedRequiredText(alert.contaminantName, 256),
      },
      concernLevel: alert.concernLevel,
      result: normalizeProductTestResult(alert.result),
      threshold: normalizeProductTestThreshold(alert.threshold),
      ...(alert.screeningPolicy
        ? { screeningPolicy: alert.screeningPolicy }
        : {}),
      source: normalizeProductTestSource(alert.source),
      testedProduct: {
        name: boundedText(alert.testedProduct.name, 512),
        brand: boundedText(alert.testedProduct.brand, 512),
        upc: boundedText(alert.testedProduct.upc, 64),
        sourceProductId: boundedText(alert.testedProduct.sourceProductId, 512),
        matchMethod: alert.testedProduct.matchMethod,
      },
      ...(alert.sample
        ? { sample: normalizeProductTestSample(alert.sample) }
        : {}),
    })),
  };
}

function normalizeProductTestResult(
  result: PublicProductTestEvidence["observations"][number]["result"],
): PublicProductDetail["productTests"]["observations"][number]["result"] {
  return {
    operator: result.operator,
    value: result.value,
    upperValue: result.upperValue ?? null,
    qualifier: boundedText(result.qualifier ?? null, 512),
    detectionLimit: normalizeProductTestMeasurement(result.detectionLimit),
    quantificationLimit: normalizeProductTestMeasurement(
      result.quantificationLimit,
    ),
    reportingLimit: normalizeProductTestMeasurement(result.reportingLimit),
    uncertainty: normalizeProductTestMeasurement(result.uncertainty),
    unit: boundedRequiredText(result.unit, 64),
    basis: boundedRequiredText(result.basis, 256),
  };
}

function normalizeProductTestMeasurement(
  measurement:
    | NonNullable<
        PublicProductTestEvidence["observations"][number]["result"]["detectionLimit"]
      >
    | null
    | undefined,
): { value: number; unit: string } | null {
  return measurement
    ? {
        value: measurement.value,
        unit: boundedRequiredText(measurement.unit, 64),
      }
    : null;
}

function normalizeProductTestSample(
  sample: NonNullable<
    PublicProductTestEvidence["observations"][number]["sample"]
  >,
): NonNullable<
  PublicProductDetail["productTests"]["observations"][number]["sample"]
> {
  return {
    evidenceType: sample.evidenceType,
    samplingContext: boundedRequiredText(sample.samplingContext, 128),
    sourceSampleId: boundedText(sample.sourceSampleId, 512),
    sampleCount: sample.sampleCount ?? null,
    reportedUpc: boundedText(sample.reportedUpc ?? null, 128),
    lotCode: boundedText(sample.lotCode, 512),
    bestBy: boundedText(sample.bestBy, 512),
    packageSize: boundedText(sample.packageSize, 256),
    collectedOn: normalizeDate(sample.collectedOn),
    testedOn: normalizeDate(sample.testedOn),
    labName: boundedText(sample.labName, 512),
    testMethod: boundedText(sample.testMethod, 2_000),
  };
}

function normalizeProductTestThreshold(
  threshold: PublicProductDetail["productTests"]["alerts"][number]["threshold"],
): PublicProductDetail["productTests"]["alerts"][number]["threshold"] {
  return {
    ...threshold,
    url: normalizePublicUrl(threshold.url),
  };
}

function normalizeProductTestSource(
  source: PublicProductTestEvidence["observations"][number]["source"],
): PublicProductDetail["productTests"]["observations"][number]["source"] {
  return {
    key: normalizeSourceKey(source.key),
    name: boundedRequiredText(source.name, 256),
    url: normalizePublicUrl(source.url),
    reportTitle: boundedText(source.reportTitle, 1_000),
    reportDate: normalizeDate(source.reportDate),
  };
}

const UNKNOWN_COPY: Record<
  PublicProductDetail["unknowns"][number]["code"],
  Omit<PublicProductDetail["unknowns"][number], "code">
> = {
  NO_LINKED_PRODUCT_TESTS: {
    title: "No linked product tests",
    description:
      "Murph has no product-level test tied to this exact record. This is an evidence gap, not a safety finding.",
  },
  INGREDIENTS_STATEMENT_ONLY: {
    title: "Ingredient structure unavailable",
    description:
      "The source provides an ingredient statement but not trustworthy structured ingredient rows.",
  },
  INGREDIENTS_UNAVAILABLE: {
    title: "Ingredients unavailable",
    description: "The source does not provide ingredient information for this record.",
  },
  NUTRITION_UNAVAILABLE: {
    title: "Nutrition unavailable",
    description: "The source does not provide normalized nutrition facts for this record.",
  },
  SERVING_MASS_UNAVAILABLE: {
    title: "Serving mass unavailable",
    description: "The source does not provide a defensible serving mass in grams.",
  },
  FORMULA_REVISION_NOT_TRACKED: {
    title: "Formula revision not tracked",
    description:
      "This record identifies the current source-backed product, not an immutable formula revision.",
  },
  LABEL_CONTENT_OMITTED: {
    title: "Label contents too large",
    description:
      "This source label exceeds the public response bound, so Murph omits its label contents from this record.",
  },
  TESTED_LOT_NOT_REPORTED: {
    title: "Tested lot not reported",
    description:
      "The product-test records do not identify a lot or batch, so results may not represent every package or current formula.",
  },
  TEST_LAB_NOT_REPORTED: {
    title: "Laboratory not reported",
    description: "At least one linked product-test observation does not name a laboratory.",
  },
  TEST_METHOD_NOT_REPORTED: {
    title: "Test method not reported",
    description: "At least one linked product-test observation does not name a test method.",
  },
  TEST_THRESHOLD_NOT_COMPARABLE: {
    title: "Screening threshold unavailable",
    description:
      "At least one result has no compatible Murph screening threshold. This is not a safety determination.",
  },
};

function buildPublicProductUnknowns(
  labelUnknownCodes: PublicProductDetail["unknowns"][number]["code"][],
  evidence: PublicProductTestEvidence,
  labelOmitted: boolean,
): PublicProductDetail["unknowns"] {
  const codes = new Set(labelUnknownCodes);

  if (labelOmitted) {
    codes.add("LABEL_CONTENT_OMITTED");
  }

  if (evidence.total === 0) {
    codes.add("NO_LINKED_PRODUCT_TESTS");
  } else if (
    evidence.truncated ||
    evidence.observations.some((observation) => !observation.sample?.lotCode)
  ) {
    codes.add("TESTED_LOT_NOT_REPORTED");
  }
  if (evidence.observations.some((observation) => !observation.labName)) {
    codes.add("TEST_LAB_NOT_REPORTED");
  }
  if (evidence.observations.some((observation) => !observation.testMethod)) {
    codes.add("TEST_METHOD_NOT_REPORTED");
  }
  if (evidence.observations.some((observation) => observation.screening === null)) {
    codes.add("TEST_THRESHOLD_NOT_COMPARABLE");
  }

  return [...codes].map((code) => ({ code, ...UNKNOWN_COPY[code] }));
}

async function readProductData<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof PublicProductDataUnavailableError) {
      throw error;
    }
    throw new PublicProductDataUnavailableError();
  }
}

function publicProductSourceName(key: string): string {
  switch (key) {
    case "dsld":
      return "Dietary Supplement Label Database";
    case "dailymed":
      return "DailyMed";
    case "usda_branded":
      return "USDA FoodData Central";
    case "brand_site":
      return "Official brand label";
    default:
      return normalizeSourceKey(key)
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function normalizeSourceKey(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/gu, "_");
  if (!/^[a-z][a-z0-9_]*$/u.test(normalized)) {
    throw new TypeError("Public product source key is invalid.");
  }
  return normalized.slice(0, 128);
}

function normalizeAnalyteKey(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/gu, "_");
  if (!/^[a-z0-9][a-z0-9_]*$/u.test(normalized)) {
    throw new TypeError("Public product analyte key is invalid.");
  }
  return normalized.slice(0, 128);
}

function normalizeUpc(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\D/gu, "");
  return normalized ? normalized.slice(0, 32) : null;
}

function normalizePublicUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function boundedRequiredText(value: string, maxLength: number): string {
  const normalized = boundedText(value, maxLength);
  if (!normalized) {
    throw new TypeError("Required public product text is missing.");
  }
  return normalized;
}

function boundedText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= maxLength
    ? normalized
    : normalized.slice(0, maxLength).trimEnd();
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
