import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import pg, { type Pool as PgPool } from "pg";

import { normalizeProductLabelsConnectionString } from "./product-labels-connection";

export { normalizeProductLabelsConnectionString };

const { Pool } = pg;

const LABELS_DATABASE_ENV = "MURPH_LABELS_DB_URL";
const DEFAULT_POOL_MAX = 15;
const DEFAULT_POOL_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_STATEMENT_TIMEOUT_MS = 8_000;
const PRODUCT_LABEL_BRAND_INDEX_TTL_MS = 10 * 60 * 1000;
const MAX_PRODUCT_LABEL_BRAND_SCOPES = 12;
const PRODUCT_LABEL_GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const PRODUCT_CONTAMINANT_ALERT_LIMIT = 5;
const PRODUCT_CONTAMINANT_OBSERVATION_LIMIT = 20;
const PUBLIC_PRODUCT_LABEL_JSON_LIMIT_BYTES = 256 * 1_024;
const PRODUCT_LABEL_SEARCH_MATCH_LIMIT = 5_000;
const PRODUCT_LABEL_SEARCH_PHRASE_LIMIT = 250;
const PRODUCT_CONTAMINANT_CONCERN_RANK: Record<
  ProductContaminantConcernLevel,
  number
> = {
  unknown: 0,
  none: 1,
  low: 2,
  medium: 3,
  high: 4,
};
const PRODUCT_TEST_SOURCE_DATA_ORIGINS = [
  "plasticlist_bay_area_2024",
  "nyc_dohmh_consumer_products",
  "king_county_consumer_products",
  "pure_earth_rms_2024",
] as const;
const PRODUCT_CONTAMINANT_GRADING_POLICY = {
  id: "adult_one_serving_per_day_v1",
  bodyWeightKg: 70,
  servingsPerDay: 1,
} as const;
const NANOGRAMS_PER_GRAM_PER_PPM = 1000;
const PRODUCT_LABEL_SOURCE_FILTER_SQL = productLabelSourceFilterSql("data_origin");

const PRODUCT_LABELS_TABLE_SQL = {
  supplements: "supplements",
  foods: "foods",
} as const;

export type ProductLabelsTable = keyof typeof PRODUCT_LABELS_TABLE_SQL;
type ProductLabelsTableSql =
  (typeof PRODUCT_LABELS_TABLE_SQL)[ProductLabelsTable];

export type ProductLabelsQueryClient = {
  query<T>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
};

export class ProductContaminantSchemaMissingError extends Error {
  constructor() {
    super(
      "product contaminant schema is missing; apply product-tests schema before deploying contaminant-aware label lookup",
    );
    this.name = "ProductContaminantSchemaMissingError";
  }
}

export function isProductContaminantSchemaMissingError(
  error: unknown,
): error is Error {
  return error instanceof Error
    && error.name === "ProductContaminantSchemaMissingError";
}

let defaultLabelsPool: PgPool | null = null;

type ProductLabelBrandIndexEntry = {
  brand: string;
  normalizedBrand: string;
};

type ProductLabelBrandIndexCache = {
  expiresAt: number;
  promise: Promise<ProductLabelBrandIndexEntry[]>;
};

type ProductLabelGenericSearchOptions = {
  dataOrigins: readonly string[];
};

export type ProductLabelSearchItem = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  label: unknown;
  contaminants: ProductContaminantSummary;
};

export type ProductLabelDetail = ProductLabelSearchItem;
type ProductLabelSourceItem = Omit<
  ProductLabelSearchItem,
  "contaminants"
>;
type ProductLabelSearchRow = ProductLabelSourceItem & {
  canonicalKey?: string | null;
};

export type PublicProductLabelTestingSummary = {
  status: ProductContaminantStatus;
  observationCount: number;
  sourceCount: number;
  latestReportDate: string | null;
};

export type PublicProductLabelSearchItem = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  dataOriginUrl: string | null;
  importedAt: string;
  name: string;
  brand: string | null;
  upc: string | null;
  testing: PublicProductLabelTestingSummary;
};

export type PublicProductLabelRecord = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  dataOriginUrl: string | null;
  importedAt: string;
  releaseDate: string | null;
  lastSeenAt: string | null;
  name: string;
  brand: string | null;
  upc: string | null;
  servingGrams: number | null;
  label: unknown;
  labelOmitted: boolean;
};

type PublicProductLabelSearchRow = Omit<
  PublicProductLabelSearchItem,
  "testing"
> & {
  observationCount: number;
  sourceCount: number;
  latestReportDate: string | null;
};

export type ProductContaminantConcernLevel =
  | "unknown"
  | "none"
  | "low"
  | "medium"
  | "high";

export type ProductContaminantStatus =
  | "no_known_product_tests"
  | "known_product_tests";

export type ProductContaminantMatchMethod =
  | "exact_upc"
  | "exact_source_id"
  | "manual_confirmed";

export type ProductContaminantResultOperator =
  | "eq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "range"
  | "not_detected"
  | "detected"
  | "trace";

export type ProductContaminantEvidenceType =
  | "laboratory_measurement"
  | "regulatory_laboratory"
  | "regulatory_finding"
  | "xrf_screening"
  | "manufacturer_coa";

export type ProductContaminantMeasurementMetadata = {
  value: number;
  unit: string;
};

export type ProductContaminantSample = {
  evidenceType: ProductContaminantEvidenceType;
  samplingContext: string;
  sourceSampleId: string | null;
  sampleCount?: number | null;
  reportedUpc?: string | null;
  lotCode: string | null;
  bestBy: string | null;
  packageSize: string | null;
  collectedOn: string | null;
  testedOn: string | null;
  labName: string | null;
  testMethod: string | null;
};

type ProductContaminantResultMetadata = {
  upperValue?: number | null;
  qualifier?: string | null;
  detectionLimit?: ProductContaminantMeasurementMetadata | null;
  quantificationLimit?: ProductContaminantMeasurementMetadata | null;
  reportingLimit?: ProductContaminantMeasurementMetadata | null;
  uncertainty?: ProductContaminantMeasurementMetadata | null;
};

export type ProductContaminantAlert = {
  contaminantKey: string;
  contaminantName: string;
  concernLevel: Extract<ProductContaminantConcernLevel, "low" | "medium" | "high">;
  result: {
    operator: ProductContaminantResultOperator;
    value: number;
    unit: string;
    basis: string;
  } & ProductContaminantResultMetadata;
  threshold: {
    value: number;
    unit: string;
    basis: string;
    authority: string;
    name: string;
    url: string | null;
  };
  screeningPolicy?: {
    id: string;
    assumedBodyWeightKg: number;
    assumedServingsPerDay: number;
    servingGrams: number;
    exposure: {
      value: number;
      unit: string;
      basis: string;
    };
    ratio: number;
  };
  source: {
    key: string;
    name: string;
    url: string | null;
    reportTitle: string | null;
    reportDate: string | null;
  };
  testedProduct: {
    name: string | null;
    brand: string | null;
    upc: string | null;
    sourceProductId: string | null;
    matchMethod: ProductContaminantMatchMethod;
  };
  sample?: ProductContaminantSample;
};

export type ProductContaminantObservation = {
  contaminantKey: string;
  contaminantName: string;
  result: {
    operator: ProductContaminantResultOperator;
    value: number | null;
    unit: string;
    basis: string;
  } & ProductContaminantResultMetadata;
  normalizedResult: {
    value: number;
    upperValue?: number | null;
    unit: string;
    basis: string;
  } | null;
  source: ProductContaminantAlert["source"];
  testedProduct: ProductContaminantAlert["testedProduct"];
  sample?: ProductContaminantSample;
};

export type ProductContaminantSummary = {
  status: ProductContaminantStatus;
  murphConcernLevel: ProductContaminantConcernLevel;
  alertCount: number;
  alerts: ProductContaminantAlert[];
  observationCount: number;
  observations: ProductContaminantObservation[];
};

export type PublicProductTestObservation = ProductContaminantObservation & {
  id: string;
  sourceResultId: string;
  labName: string | null;
  testMethod: string | null;
  importedAt: string;
  screening: {
    comparison: "exceeds" | "does_not_exceed";
    threshold: ProductContaminantAlert["threshold"];
    screeningPolicy?: ProductContaminantAlert["screeningPolicy"];
  } | null;
  alert: ProductContaminantAlert | null;
};

export type PublicProductTestEvidence = {
  status: ProductContaminantStatus;
  total: number;
  returned: number;
  truncated: boolean;
  observations: PublicProductTestObservation[];
  alerts: ProductContaminantAlert[];
};

export type ProductLabelsQueries = {
  getById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<ProductLabelDetail | null>;
  getByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<ProductLabelDetail | null>;
  search: (input: {
    genericOnly?: boolean;
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<ProductLabelSearchItem[]>;
};

export type PublicProductLabelsQueries = {
  searchCompact: (input: {
    limit: number;
    q: string;
  }) => Promise<PublicProductLabelSearchItem[]>;
  getRecordById: (input: {
    id: string;
  }) => Promise<PublicProductLabelRecord | null>;
  getEvidence: (input: {
    id: string;
  }) => Promise<PublicProductTestEvidence>;
};

export function createProductLabelsQueries(
  client: ProductLabelsQueryClient,
  table: ProductLabelsTable,
  options: {
    brandScoping?: boolean;
    genericSearch?: ProductLabelGenericSearchOptions;
    stemmedSearch?: boolean;
    weakQueryTokens?: readonly string[];
  } = {},
): ProductLabelsQueries {
  const tableSql = productLabelsTableSql(table);
  // Brand scoping preloads every distinct brand into memory and narrows
  // matching queries to those brands exclusively. That is correct for the
  // supplement catalog but disabled by default: on the ~2M-row foods table the
  // brand preload is an unbounded cold-start cost, and exclusive scoping would
  // hide generic rows (brand IS NULL) whenever a query collides with a brand
  // name.
  const brandScoping = options.brandScoping ?? false;
  // Stemmed (english-config) matching widens the FTS candidate set and adds a
  // second on-the-fly to_tsvector ranking pass per candidate. That is cheap on
  // the supplements catalog but multiplies broad-query latency on the ~2M-row
  // foods table past the statement timeout, so it stays opt-in per table.
  const stemmedSearch = options.stemmedSearch ?? false;
  const genericSearchDataOrigins = options.genericSearch?.dataOrigins ?? null;
  const weakQueryTokens = new Set(
    (options.weakQueryTokens ?? [])
      .map((token) => normalizeProductLabelSearchPhrase(token))
      .filter((token) => token.length > 0 && !token.includes(" ")),
  );
  let brandIndexCache: ProductLabelBrandIndexCache | null = null;

  async function getBrandIndex(): Promise<ProductLabelBrandIndexEntry[]> {
    const now = Date.now();

    if (!brandIndexCache || brandIndexCache.expiresAt <= now) {
      brandIndexCache = {
        expiresAt: now + PRODUCT_LABEL_BRAND_INDEX_TTL_MS,
        promise: loadProductLabelBrandIndex(client, tableSql),
      };
    }

    const promise = brandIndexCache.promise;

    try {
      return await promise;
    } catch (error) {
      if (brandIndexCache?.promise === promise) {
        brandIndexCache = null;
      }
      throw error;
    }
  }

  async function searchRows(input: {
    genericOnly?: boolean;
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }): Promise<ProductLabelSearchRow[]> {
    const q = brandScoping
      ? normalizeProductLabelSearchInput(input.q)
      : input.q.trim();
    const searchQ = removeWeakProductLabelQueryTokens(q, weakQueryTokens);
    const genericOnly =
      input.genericOnly === true && genericSearchDataOrigins !== null;

    if (!q || !searchQ) {
      return [];
    }

    if (brandScoping && !genericOnly) {
      const brandScopes = findProductLabelBrandScopes(await getBrandIndex(), q);

      if (brandScopes.length > 0) {
        const rows = await searchBrandScopedProductLabels(client, tableSql, {
          ...input,
          brandScopes,
          excludedDataOrigins: [],
          productQ: buildBrandScopedProductLabelQuery(searchQ, brandScopes),
          projection: "private",
          q: searchQ,
        });

        // An exclusive brand scope can come up empty when an
        // ingredient-shaped brand hijacks the query or the scoped brand has
        // no such product; fall back to the generic path instead of
        // returning nothing.
        if (rows.length > 0) {
          return rows;
        }
      }
    }

    return await searchGenericProductLabels(client, tableSql, {
      ...input,
      excludedDataOrigins: [],
      genericSearchDataOrigins:
        genericOnly && genericSearchDataOrigins
          ? genericSearchDataOrigins
          : null,
      projection: "private",
      q: searchQ,
      stemmedSearch,
    });
  }

  return {
    async getById(input) {
      const id = input.id.trim();

      if (!isProductLabelLookupId(id)) {
        return null;
      }

      const { rows } = await client.query<ProductLabelSearchRow>(
        `
        SELECT
          id,
          canonical_key AS "canonicalKey",
          data_origin AS "dataOrigin",
          data_origin_id AS "dataOriginId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM ${tableSql}
        WHERE
          id = $1
          AND ($2::boolean OR off_market = false)
          AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
        LIMIT 1
        `,
        [id, input.includeOffMarket],
      );

      const [item] = await attachProductContaminantSummaries(
        client,
        tableSql,
        rows,
      );

      return item ?? null;
    },

    async getByUpc(input) {
      const normalizedUpc = input.upc.replace(/\D/gu, "");
      const upcVariants = buildUpcLookupVariants(normalizedUpc);

      if (upcVariants.length === 0) {
        return null;
      }

      const { rows } = await client.query<ProductLabelSearchRow>(
        `
        SELECT
          id,
          canonical_key AS "canonicalKey",
          data_origin AS "dataOrigin",
          data_origin_id AS "dataOriginId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM ${tableSql}
        WHERE
          upc = ANY($1::text[])
          AND ($2::boolean OR off_market = false)
          AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
        ORDER BY
          off_market ASC,
          array_position($1::text[], upc) ASC,
          data_origin_priority ASC,
          name ASC,
          id ASC
        LIMIT 1
        `,
        [upcVariants, input.includeOffMarket],
      );

      const [item] = await attachProductContaminantSummaries(
        client,
        tableSql,
        rows,
      );

      return item ?? null;
    },

    async search(input) {
      return await attachProductContaminantSummaries(
        client,
        tableSql,
        await searchRows(input),
      );
    },
  };
}

export function createPublicProductLabelsQueries(
  client: ProductLabelsQueryClient,
  table: ProductLabelsTable,
  options: {
    brandScoping?: boolean;
    excludedDataOrigins?: readonly string[];
    stemmedSearch?: boolean;
    weakQueryTokens?: readonly string[];
  } = {},
): PublicProductLabelsQueries {
  const tableSql = productLabelsTableSql(table);
  const brandScoping = options.brandScoping ?? false;
  const excludedDataOrigins = options.excludedDataOrigins ?? [];
  const stemmedSearch = options.stemmedSearch ?? false;
  const weakQueryTokens = new Set(
    (options.weakQueryTokens ?? [])
      .map((token) => normalizeProductLabelSearchPhrase(token))
      .filter((token) => token.length > 0 && !token.includes(" ")),
  );
  let brandIndexCache: ProductLabelBrandIndexCache | null = null;

  async function getBrandIndex(): Promise<ProductLabelBrandIndexEntry[]> {
    const now = Date.now();

    if (!brandIndexCache || brandIndexCache.expiresAt <= now) {
      brandIndexCache = {
        expiresAt: now + PRODUCT_LABEL_BRAND_INDEX_TTL_MS,
        promise: loadProductLabelBrandIndex(client, tableSql),
      };
    }

    const promise = brandIndexCache.promise;

    try {
      return await promise;
    } catch (error) {
      if (brandIndexCache?.promise === promise) {
        brandIndexCache = null;
      }
      throw error;
    }
  }

  return {
    async searchCompact(input) {
      const normalizedGtin = normalizeProductLabelGtinQuery(input.q);
      if (normalizedGtin) {
        const exact = await getPublicProductLabelByUpc(
          client,
          tableSql,
          normalizedGtin,
          excludedDataOrigins,
        );

        if (exact) {
          return [toPublicProductLabelSearchItem(exact)];
        }
      }

      const q = brandScoping
        ? normalizeProductLabelSearchInput(input.q)
        : input.q.trim();
      const searchQ = removeWeakProductLabelQueryTokens(q, weakQueryTokens);

      if (!q || !searchQ) {
        return [];
      }

      if (brandScoping) {
        const brandScopes = findProductLabelBrandScopes(await getBrandIndex(), q);

        if (brandScopes.length > 0) {
          const rows = await searchBrandScopedProductLabels(client, tableSql, {
            brandScopes,
            excludedDataOrigins,
            includeOffMarket: false,
            limit: input.limit,
            productQ: buildBrandScopedProductLabelQuery(searchQ, brandScopes),
            projection: "public",
            q: searchQ,
          });

          if (rows.length > 0) {
            return rows.map(toPublicProductLabelSearchItem);
          }
        }
      }

      const rows = await searchGenericProductLabels(client, tableSql, {
        excludedDataOrigins,
        genericSearchDataOrigins: null,
        includeOffMarket: false,
        limit: input.limit,
        projection: "public",
        q: searchQ,
        stemmedSearch,
      });

      return rows.map(toPublicProductLabelSearchItem);
    },

    async getRecordById(input) {
      const id = input.id.trim();

      if (!isProductLabelLookupId(id)) {
        return null;
      }

      return await getPublicProductLabelRecordById(
        client,
        tableSql,
        id,
        excludedDataOrigins,
      );
    },

    async getEvidence(input) {
      const id = input.id.trim();

      if (!isProductLabelLookupId(id)) {
        return createEmptyPublicProductTestEvidence();
      }

      return await loadPublicProductTestEvidence(
        client,
        tableSql,
        { productId: id },
        excludedDataOrigins,
      );
    },
  };
}

function productLabelsTableSql(
  table: ProductLabelsTable,
): ProductLabelsTableSql {
  switch (table) {
    case "supplements":
      return PRODUCT_LABELS_TABLE_SQL.supplements;
    case "foods":
      return PRODUCT_LABELS_TABLE_SQL.foods;
    default:
      throw new Error("unsupported product labels table");
  }
}

type ProductContaminantProductColumnSql = "food_id" | "supplement_id";

type ProductContaminantQueryRow = {
  productId: string;
  productTestId: string | null;
  servingGrams: number | null;
  sourceKey: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceReportTitle: string | null;
  reportDate: string | null;
  sourceResultId: string;
  testedProductName: string | null;
  testedProductBrand: string | null;
  testedProductUpc: string | null;
  testedProductUpcRaw: string | null;
  testedSourceProductId: string | null;
  evidenceType: ProductContaminantEvidenceType;
  samplingContext: string;
  sourceSampleId: string | null;
  sourceSampleCount: number | null;
  testedLotCode: string | null;
  testedBestBy: string | null;
  testedPackageSize: string | null;
  collectedOn: string | null;
  testedOn: string | null;
  matchMethod: ProductContaminantMatchMethod;
  contaminantKey: string;
  contaminantName: string;
  resultOperator: ProductContaminantResultOperator;
  resultValue: number | null;
  resultUpperValue: number | null;
  resultUnit: string;
  resultBasis: string;
  normalizedValue: number | null;
  normalizedUpperValue: number | null;
  normalizedUnit: string | null;
  normalizedBasis: string | null;
  resultQualifier: string | null;
  detectionLimitValue: number | null;
  detectionLimitUnit: string | null;
  quantificationLimitValue: number | null;
  quantificationLimitUnit: string | null;
  reportingLimitValue: number | null;
  reportingLimitUnit: string | null;
  uncertaintyValue: number | null;
  uncertaintyUnit: string | null;
  labName: string | null;
  testMethod: string | null;
  thresholdId: string | null;
  thresholdValue: number | null;
  thresholdUnit: string | null;
  thresholdBasis: string | null;
  thresholdNormalizedValue: number | null;
  thresholdNormalizedUnit: string | null;
  thresholdNormalizedBasis: string | null;
  thresholdAuthorityName: string | null;
  thresholdName: string | null;
  thresholdUrl: string | null;
  concernLevelIfExceeded: string | null;
};

type PublicProductTestQueryRow = ProductContaminantQueryRow & {
  productTestId: string;
  observationTotal: number;
  labName: string | null;
  testMethod: string | null;
  importedAt: string;
};

function productContaminantThresholdLateralSql(
  servingGramsSql: string,
): string {
  return `
    LEFT JOIN LATERAL (
      SELECT threshold_rows.*
      FROM contaminant_thresholds threshold_rows
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN threshold_rows.normalized_value IS NOT NULL
              AND threshold_rows.normalized_unit = product_tests.normalized_unit
              AND threshold_rows.normalized_basis = product_tests.normalized_basis
              THEN product_tests.normalized_value
            WHEN threshold_rows.threshold_unit = 'ng/kg_bw/day'
              AND threshold_rows.threshold_basis = 'oral_total_dietary_exposure'
              AND product_tests.normalized_unit = 'ppm'
              AND product_tests.normalized_basis = 'product_mass'
              AND ${servingGramsSql} IS NOT NULL
              THEN product_tests.normalized_value * ${NANOGRAMS_PER_GRAM_PER_PPM} * ${servingGramsSql} * ${PRODUCT_CONTAMINANT_GRADING_POLICY.servingsPerDay} / ${PRODUCT_CONTAMINANT_GRADING_POLICY.bodyWeightKg}
            ELSE NULL
          END AS comparison_value,
          CASE
            WHEN threshold_rows.normalized_value IS NOT NULL
              AND threshold_rows.normalized_unit = product_tests.normalized_unit
              AND threshold_rows.normalized_basis = product_tests.normalized_basis
              THEN product_tests.normalized_upper_value
            WHEN threshold_rows.threshold_unit = 'ng/kg_bw/day'
              AND threshold_rows.threshold_basis = 'oral_total_dietary_exposure'
              AND product_tests.normalized_unit = 'ppm'
              AND product_tests.normalized_basis = 'product_mass'
              AND product_tests.normalized_upper_value IS NOT NULL
              AND ${servingGramsSql} IS NOT NULL
              THEN product_tests.normalized_upper_value * ${NANOGRAMS_PER_GRAM_PER_PPM} * ${servingGramsSql} * ${PRODUCT_CONTAMINANT_GRADING_POLICY.servingsPerDay} / ${PRODUCT_CONTAMINANT_GRADING_POLICY.bodyWeightKg}
            ELSE NULL
          END AS comparison_upper_value,
          CASE
            WHEN threshold_rows.normalized_value IS NOT NULL
              AND threshold_rows.normalized_unit = product_tests.normalized_unit
              AND threshold_rows.normalized_basis = product_tests.normalized_basis
              THEN threshold_rows.normalized_value
            WHEN threshold_rows.threshold_unit = 'ng/kg_bw/day'
              AND threshold_rows.threshold_basis = 'oral_total_dietary_exposure'
              AND product_tests.normalized_unit = 'ppm'
              AND product_tests.normalized_basis = 'product_mass'
              AND ${servingGramsSql} IS NOT NULL
              THEN threshold_rows.threshold_value
            ELSE NULL
          END AS comparison_threshold
      ) scored_threshold
      WHERE threshold_rows.active = true
        AND threshold_rows.contaminant_key = product_tests.contaminant_key
        AND product_tests.result_operator IN ('eq', 'gt', 'gte', 'range')
        AND product_tests.normalized_value IS NOT NULL
        AND product_tests.normalized_unit IS NOT NULL
        AND product_tests.normalized_basis IS NOT NULL
        AND scored_threshold.comparison_value IS NOT NULL
        AND scored_threshold.comparison_threshold IS NOT NULL
      ORDER BY
        CASE
          WHEN product_tests.result_operator = 'eq'
            AND scored_threshold.comparison_value > scored_threshold.comparison_threshold
            THEN 1
          WHEN product_tests.result_operator = 'gt'
            AND scored_threshold.comparison_value >= scored_threshold.comparison_threshold
            THEN 1
          WHEN product_tests.result_operator = 'gte'
            AND scored_threshold.comparison_value > scored_threshold.comparison_threshold
            THEN 1
          WHEN product_tests.result_operator = 'range'
            AND scored_threshold.comparison_value > scored_threshold.comparison_threshold
            THEN 2
          WHEN product_tests.result_operator = 'range'
            AND scored_threshold.comparison_upper_value > scored_threshold.comparison_threshold
            THEN 1
          ELSE 0
        END DESC,
        CASE threshold_rows.concern_level_if_exceeded
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 1
          ELSE 0
        END DESC,
        threshold_rows.id ASC
      LIMIT 1
    ) thresholds ON true`;
}

type ProductContaminantLookupTarget = {
  productId: string;
  canonicalKey: string;
};

async function attachProductContaminantSummaries(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  rows: ProductLabelSearchRow[],
): Promise<ProductLabelSearchItem[]> {
  if (rows.length === 0) {
    return [];
  }

  const summaries = await loadProductContaminantSummaries(
    client,
    tableSql,
    productContaminantProductColumnSql(tableSql),
    uniqueProductLabelTargets(rows),
  );

  return rows.map((row) => ({
    ...toProductLabelSearchItem(row),
    contaminants:
      summaries.get(row.id) ?? createEmptyProductContaminantSummary(),
  }));
}

function toProductLabelSearchItem(
  row: ProductLabelSearchRow,
): ProductLabelSourceItem {
  return {
    id: row.id,
    dataOrigin: row.dataOrigin,
    dataOriginId: row.dataOriginId,
    name: row.name,
    brand: row.brand,
    upc: row.upc,
    offMarket: row.offMarket,
    label: row.label,
  };
}

async function loadProductContaminantSummaries(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  productColumnSql: ProductContaminantProductColumnSql,
  targets: ProductContaminantLookupTarget[],
): Promise<Map<string, ProductContaminantSummary>> {
  let rows: ProductContaminantQueryRow[];
  const useCanonicalAliases = tableSql === "supplements";
  const productIdSql = useCanonicalAliases
    ? "linked_labels.product_id"
    : `product_tests.${productColumnSql}`;
  const servingGramsSql = useCanonicalAliases
    ? "linked_labels.serving_grams"
    : "labels.serving_grams";
  const lookupTargetsSql = useCanonicalAliases
    ? `
    WITH lookup_targets AS (
      SELECT *
      FROM unnest($1::text[], $2::text[]) AS target(product_id, canonical_key)
    ),
    linked_labels AS MATERIALIZED (
      SELECT DISTINCT
        lookup_targets.product_id,
        labels.id AS label_id,
        labels.serving_grams
      FROM lookup_targets
      JOIN ${tableSql} labels
        ON labels.canonical_key = lookup_targets.canonical_key
        AND ${productLabelSourceFilterSql("labels.data_origin")}
    )`
    : "";
  const productTestsFromSql = useCanonicalAliases
    ? `
    FROM linked_labels
    JOIN product_tests
      ON product_tests.${productColumnSql} = linked_labels.label_id`
    : `
    FROM product_tests
    JOIN ${tableSql} labels
      ON labels.id = product_tests.${productColumnSql}`;
  const productTestsWhereSql = useCanonicalAliases
    ? ""
    : `
    WHERE product_tests.${productColumnSql} = ANY($1::text[])`;
  const queryValues = useCanonicalAliases
    ? [
        targets.map((target) => target.productId),
        targets.map((target) => target.canonicalKey),
      ]
    : [targets.map((target) => target.productId)];

  try {
    const result = await client.query<ProductContaminantQueryRow>(
      `
    ${lookupTargetsSql}
    SELECT
      ${productIdSql} AS "productId",
      product_tests.id AS "productTestId",
      ${servingGramsSql}::double precision AS "servingGrams",
      product_tests.source_key AS "sourceKey",
      product_tests.source_name AS "sourceName",
      product_tests.source_url AS "sourceUrl",
      product_tests.source_report_title AS "sourceReportTitle",
      product_tests.report_date::text AS "reportDate",
      product_tests.source_result_id AS "sourceResultId",
      product_tests.tested_product_name AS "testedProductName",
      product_tests.tested_product_brand AS "testedProductBrand",
      product_tests.tested_product_upc AS "testedProductUpc",
      product_tests.tested_product_upc_raw AS "testedProductUpcRaw",
      product_tests.tested_source_product_id AS "testedSourceProductId",
      product_tests.evidence_type AS "evidenceType",
      product_tests.sampling_context AS "samplingContext",
      product_tests.source_sample_id AS "sourceSampleId",
      product_tests.source_sample_count AS "sourceSampleCount",
      product_tests.tested_lot_code AS "testedLotCode",
      product_tests.tested_best_by AS "testedBestBy",
      product_tests.tested_package_size AS "testedPackageSize",
      product_tests.collected_on::text AS "collectedOn",
      product_tests.tested_on::text AS "testedOn",
      product_tests.match_method AS "matchMethod",
      product_tests.contaminant_key AS "contaminantKey",
      product_tests.contaminant_name AS "contaminantName",
      product_tests.result_operator AS "resultOperator",
      product_tests.result_value::double precision AS "resultValue",
      product_tests.result_upper_value::double precision AS "resultUpperValue",
      product_tests.result_unit AS "resultUnit",
      product_tests.result_basis AS "resultBasis",
      product_tests.normalized_value::double precision AS "normalizedValue",
      product_tests.normalized_upper_value::double precision AS "normalizedUpperValue",
      product_tests.normalized_unit AS "normalizedUnit",
      product_tests.normalized_basis AS "normalizedBasis",
      product_tests.result_qualifier AS "resultQualifier",
      product_tests.detection_limit_value::double precision AS "detectionLimitValue",
      product_tests.detection_limit_unit AS "detectionLimitUnit",
      product_tests.quantification_limit_value::double precision AS "quantificationLimitValue",
      product_tests.quantification_limit_unit AS "quantificationLimitUnit",
      product_tests.reporting_limit_value::double precision AS "reportingLimitValue",
      product_tests.reporting_limit_unit AS "reportingLimitUnit",
      product_tests.uncertainty_value::double precision AS "uncertaintyValue",
      product_tests.uncertainty_unit AS "uncertaintyUnit",
      product_tests.lab_name AS "labName",
      product_tests.test_method AS "testMethod",
      thresholds.id AS "thresholdId",
      thresholds.threshold_value::double precision AS "thresholdValue",
      thresholds.threshold_unit AS "thresholdUnit",
      thresholds.threshold_basis AS "thresholdBasis",
      thresholds.normalized_value::double precision AS "thresholdNormalizedValue",
      thresholds.normalized_unit AS "thresholdNormalizedUnit",
      thresholds.normalized_basis AS "thresholdNormalizedBasis",
      thresholds.authority_name AS "thresholdAuthorityName",
      thresholds.threshold_name AS "thresholdName",
      thresholds.threshold_url AS "thresholdUrl",
      thresholds.concern_level_if_exceeded AS "concernLevelIfExceeded"
    ${productTestsFromSql}
    ${productContaminantThresholdLateralSql(servingGramsSql)}
    ${productTestsWhereSql}
    ORDER BY
      ${productIdSql} ASC,
      product_tests.report_date DESC NULLS LAST,
      product_tests.contaminant_key ASC,
      product_tests.source_key ASC,
      product_tests.source_result_id ASC,
      thresholds.id ASC NULLS LAST
    `,
      queryValues,
    );
    rows = result.rows;
  } catch (error) {
    if (isMissingProductContaminantSchemaError(error)) {
      throw new ProductContaminantSchemaMissingError();
    }

    throw error;
  }

  const builders = new Map<string, ProductContaminantSummaryBuilder>();

  for (const row of rows) {
    const builder =
      builders.get(row.productId) ?? createProductContaminantSummaryBuilder();
    builders.set(row.productId, builder);
    addProductContaminantSummaryRow(builder, row);
  }

  return new Map(
    [...builders.entries()].map(([productId, builder]) => [
      productId,
      finalizeProductContaminantSummary(builder),
    ]),
  );
}

async function loadPublicProductTestEvidence(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  target: Pick<ProductContaminantLookupTarget, "productId">,
  excludedDataOrigins: readonly string[],
): Promise<PublicProductTestEvidence> {
  const excludedDataOriginsSql = productLabelExcludedDataOriginsFilterSql(
    "labels.data_origin",
    excludedDataOrigins,
  );
  const productColumnSql = productContaminantProductColumnSql(tableSql);
  const linkedObservationsSql = `
    WITH linked_observations AS MATERIALIZED (
      SELECT DISTINCT ON (product_tests.id)
        $1::text AS target_product_id,
        product_tests.*,
        labels.serving_grams
      FROM product_tests
      JOIN ${tableSql} labels
        ON labels.id = product_tests.${productColumnSql}
      WHERE
        labels.id = $1
        AND labels.off_market = false
        AND ${productLabelSourceFilterSql("labels.data_origin")}
        AND ${excludedDataOriginsSql}
      ORDER BY product_tests.id ASC
    )`;

  let rows: PublicProductTestQueryRow[];
  try {
    const result = await client.query<PublicProductTestQueryRow>(
      `
        ${linkedObservationsSql},
        ranked_observations AS MATERIALIZED (
          SELECT
            linked_observations.*,
            (COUNT(*) OVER ())::integer AS observation_total,
            (ROW_NUMBER() OVER (
              ORDER BY
                linked_observations.report_date DESC NULLS LAST,
                linked_observations.contaminant_key ASC,
                linked_observations.source_key ASC,
                linked_observations.source_result_id ASC,
                linked_observations.id ASC
            ))::integer AS observation_rank
          FROM linked_observations
        ),
        bounded_observations AS MATERIALIZED (
          SELECT *
          FROM ranked_observations
          WHERE observation_rank <= ${PRODUCT_CONTAMINANT_OBSERVATION_LIMIT}
        )
        SELECT
          product_tests.target_product_id AS "productId",
          product_tests.id AS "productTestId",
          product_tests.observation_total AS "observationTotal",
          product_tests.serving_grams::double precision AS "servingGrams",
          product_tests.source_key AS "sourceKey",
          product_tests.source_name AS "sourceName",
          product_tests.source_url AS "sourceUrl",
          product_tests.source_report_title AS "sourceReportTitle",
          product_tests.report_date::text AS "reportDate",
          product_tests.source_result_id AS "sourceResultId",
          product_tests.tested_product_name AS "testedProductName",
          product_tests.tested_product_brand AS "testedProductBrand",
          product_tests.tested_product_upc AS "testedProductUpc",
          product_tests.tested_product_upc_raw AS "testedProductUpcRaw",
          product_tests.tested_source_product_id AS "testedSourceProductId",
          product_tests.evidence_type AS "evidenceType",
          product_tests.sampling_context AS "samplingContext",
          product_tests.source_sample_id AS "sourceSampleId",
          product_tests.source_sample_count AS "sourceSampleCount",
          product_tests.tested_lot_code AS "testedLotCode",
          product_tests.tested_best_by AS "testedBestBy",
          product_tests.tested_package_size AS "testedPackageSize",
          product_tests.collected_on::text AS "collectedOn",
          product_tests.tested_on::text AS "testedOn",
          product_tests.match_method AS "matchMethod",
          product_tests.contaminant_key AS "contaminantKey",
          product_tests.contaminant_name AS "contaminantName",
          product_tests.result_operator AS "resultOperator",
          product_tests.result_value::double precision AS "resultValue",
          product_tests.result_upper_value::double precision AS "resultUpperValue",
          product_tests.result_unit AS "resultUnit",
          product_tests.result_basis AS "resultBasis",
          product_tests.normalized_value::double precision AS "normalizedValue",
          product_tests.normalized_upper_value::double precision AS "normalizedUpperValue",
          product_tests.normalized_unit AS "normalizedUnit",
          product_tests.normalized_basis AS "normalizedBasis",
          product_tests.result_qualifier AS "resultQualifier",
          product_tests.detection_limit_value::double precision AS "detectionLimitValue",
          product_tests.detection_limit_unit AS "detectionLimitUnit",
          product_tests.quantification_limit_value::double precision AS "quantificationLimitValue",
          product_tests.quantification_limit_unit AS "quantificationLimitUnit",
          product_tests.reporting_limit_value::double precision AS "reportingLimitValue",
          product_tests.reporting_limit_unit AS "reportingLimitUnit",
          product_tests.uncertainty_value::double precision AS "uncertaintyValue",
          product_tests.uncertainty_unit AS "uncertaintyUnit",
          product_tests.lab_name AS "labName",
          product_tests.test_method AS "testMethod",
          ${productLabelTimestampIsoSql("product_tests.imported_at")} AS "importedAt",
          thresholds.id AS "thresholdId",
          thresholds.threshold_value::double precision AS "thresholdValue",
          thresholds.threshold_unit AS "thresholdUnit",
          thresholds.threshold_basis AS "thresholdBasis",
          thresholds.normalized_value::double precision AS "thresholdNormalizedValue",
          thresholds.normalized_unit AS "thresholdNormalizedUnit",
          thresholds.normalized_basis AS "thresholdNormalizedBasis",
          thresholds.authority_name AS "thresholdAuthorityName",
          thresholds.threshold_name AS "thresholdName",
          thresholds.threshold_url AS "thresholdUrl",
          thresholds.concern_level_if_exceeded AS "concernLevelIfExceeded"
        FROM bounded_observations product_tests
        ${productContaminantThresholdLateralSql("product_tests.serving_grams")}
        ORDER BY
          product_tests.observation_rank ASC,
          thresholds.id ASC NULLS LAST
      `,
      [target.productId],
    );
    rows = result.rows;
  } catch (error) {
    if (isMissingProductContaminantSchemaError(error)) {
      throw new ProductContaminantSchemaMissingError();
    }

    throw error;
  }

  if (rows.length === 0) {
    return createEmptyPublicProductTestEvidence();
  }

  const observations = rows.map(createPublicProductTestObservation);
  const alerts = observations
    .flatMap((observation) => observation.alert ? [observation.alert] : [])
    .sort(compareProductContaminantAlerts)
    .slice(0, PRODUCT_CONTAMINANT_ALERT_LIMIT);
  const total = rows[0]?.observationTotal ?? 0;

  return {
    status: "known_product_tests",
    total,
    returned: observations.length,
    truncated: total > observations.length,
    observations,
    alerts,
  };
}

function createPublicProductTestObservation(
  row: PublicProductTestQueryRow,
): PublicProductTestObservation {
  const thresholdScore = scoreProductContaminantThreshold(row);

  return {
    ...createProductContaminantObservation(row),
    id: row.productTestId,
    sourceResultId: row.sourceResultId,
    labName: row.labName,
    testMethod: row.testMethod,
    importedAt: row.importedAt,
    screening: createPublicProductTestScreening(row, thresholdScore),
    alert: createProductContaminantAlert(row, thresholdScore),
  };
}

function createPublicProductTestScreening(
  row: ProductContaminantQueryRow,
  thresholdScore: ProductContaminantThresholdScore,
): PublicProductTestObservation["screening"] {
  if (
    thresholdScore.comparison === "unknown" ||
    row.thresholdAuthorityName == null ||
    row.thresholdName == null
  ) {
    return null;
  }

  return {
    comparison: thresholdScore.comparison,
    threshold: {
      value: thresholdScore.threshold.value,
      unit: thresholdScore.threshold.unit,
      basis: thresholdScore.threshold.basis,
      authority: row.thresholdAuthorityName,
      name: row.thresholdName,
      url: row.thresholdUrl,
    },
    ...(thresholdScore.screeningPolicy
      ? { screeningPolicy: thresholdScore.screeningPolicy }
      : {}),
  };
}

function createEmptyPublicProductTestEvidence(): PublicProductTestEvidence {
  return {
    status: "no_known_product_tests",
    total: 0,
    returned: 0,
    truncated: false,
    observations: [],
    alerts: [],
  };
}

type ProductContaminantSummaryBuilder = {
  hasRows: boolean;
  hasComparableRows: boolean;
  hasNonComparableRows: boolean;
  concernLevel: ProductContaminantConcernLevel;
  seenObservationIds: Set<string>;
  alerts: ProductContaminantAlert[];
  observationCount: number;
  observations: ProductContaminantObservation[];
};

function createProductContaminantSummaryBuilder(): ProductContaminantSummaryBuilder {
  return {
    hasRows: false,
    hasComparableRows: false,
    hasNonComparableRows: false,
    concernLevel: "unknown",
    seenObservationIds: new Set(),
    alerts: [],
    observationCount: 0,
    observations: [],
  };
}

function addProductContaminantSummaryRow(
  builder: ProductContaminantSummaryBuilder,
  row: ProductContaminantQueryRow,
): void {
  builder.hasRows = true;
  const observationId = productContaminantObservationKey(row);
  if (!builder.seenObservationIds.has(observationId)) {
    builder.seenObservationIds.add(observationId);
    builder.observationCount += 1;
    builder.observations.push(createProductContaminantObservation(row));
  }

  const thresholdScore = scoreProductContaminantThreshold(row);

  if (thresholdScore.comparison === "unknown") {
    builder.hasNonComparableRows = true;
    return;
  }

  if (
    row.thresholdAuthorityName == null ||
    row.thresholdName == null ||
    row.concernLevelIfExceeded == null
  ) {
    builder.hasNonComparableRows = true;
    return;
  }

  builder.hasComparableRows = true;

  if (thresholdScore.comparison === "does_not_exceed") {
    if (builder.concernLevel === "unknown") {
      builder.concernLevel = "none";
    }
    return;
  }

  if (
    row.normalizedValue == null ||
    row.normalizedUnit == null ||
    row.normalizedBasis == null
  ) {
    builder.hasNonComparableRows = true;
    return;
  }

  const alert = createProductContaminantAlert(row, thresholdScore);
  if (!alert) {
    builder.hasNonComparableRows = true;
    return;
  }

  builder.concernLevel = maxProductContaminantConcernLevel(
    builder.concernLevel,
    alert.concernLevel,
  );
  builder.alerts.push(alert);
}

function createProductContaminantAlert(
  row: ProductContaminantQueryRow,
  thresholdScore = scoreProductContaminantThreshold(row),
): ProductContaminantAlert | null {
  if (
    thresholdScore.comparison !== "exceeds" ||
    row.normalizedValue == null ||
    row.normalizedUnit == null ||
    row.normalizedBasis == null ||
    row.thresholdAuthorityName == null ||
    row.thresholdName == null ||
    row.concernLevelIfExceeded == null
  ) {
    return null;
  }

  return {
    contaminantKey: row.contaminantKey,
    contaminantName: row.contaminantName,
    concernLevel: parseExceededConcernLevel(row.concernLevelIfExceeded),
    result: {
      operator: row.resultOperator,
      value: row.normalizedValue,
      ...productContaminantResultMetadata(row, row.normalizedUpperValue),
      unit: row.normalizedUnit ?? row.resultUnit,
      basis: row.normalizedBasis ?? row.resultBasis,
    },
    threshold: {
      value: thresholdScore.threshold.value,
      unit: thresholdScore.threshold.unit,
      basis: thresholdScore.threshold.basis,
      authority: row.thresholdAuthorityName,
      name: row.thresholdName,
      url: row.thresholdUrl,
    },
    ...(thresholdScore.screeningPolicy
      ? { screeningPolicy: thresholdScore.screeningPolicy }
      : {}),
    source: {
      key: row.sourceKey,
      name: row.sourceName,
      url: row.sourceUrl,
      reportTitle: row.sourceReportTitle,
      reportDate: row.reportDate,
    },
    testedProduct: {
      name: row.testedProductName,
      brand: row.testedProductBrand,
      upc: row.testedProductUpc,
      sourceProductId: row.testedSourceProductId,
      matchMethod: row.matchMethod,
    },
    sample: productContaminantSample(row),
  };
}

function createProductContaminantObservation(
  row: ProductContaminantQueryRow,
): ProductContaminantObservation {
  return {
    contaminantKey: row.contaminantKey,
    contaminantName: row.contaminantName,
    result: {
      operator: row.resultOperator,
      value: row.resultValue,
      ...productContaminantResultMetadata(row, row.resultUpperValue),
      unit: row.resultUnit,
      basis: row.resultBasis,
    },
    normalizedResult: row.normalizedValue !== null
      && row.normalizedUnit !== null
      && row.normalizedBasis !== null
      ? {
        value: row.normalizedValue,
        upperValue: row.normalizedUpperValue ?? null,
        unit: row.normalizedUnit,
        basis: row.normalizedBasis,
      }
      : null,
    source: {
      key: row.sourceKey,
      name: row.sourceName,
      url: row.sourceUrl,
      reportTitle: row.sourceReportTitle,
      reportDate: row.reportDate,
    },
    testedProduct: {
      name: row.testedProductName,
      brand: row.testedProductBrand,
      upc: row.testedProductUpc,
      sourceProductId: row.testedSourceProductId,
      matchMethod: row.matchMethod,
    },
    sample: productContaminantSample(row),
  };
}

function productContaminantResultMetadata(
  row: ProductContaminantQueryRow,
  upperValue: number | null | undefined,
): ProductContaminantResultMetadata {
  return {
    upperValue: upperValue ?? null,
    qualifier: row.resultQualifier ?? null,
    detectionLimit: productContaminantMeasurementMetadata(
      row.detectionLimitValue,
      row.detectionLimitUnit,
    ),
    quantificationLimit: productContaminantMeasurementMetadata(
      row.quantificationLimitValue,
      row.quantificationLimitUnit,
    ),
    reportingLimit: productContaminantMeasurementMetadata(
      row.reportingLimitValue,
      row.reportingLimitUnit,
    ),
    uncertainty: productContaminantMeasurementMetadata(
      row.uncertaintyValue,
      row.uncertaintyUnit,
    ),
  };
}

function productContaminantMeasurementMetadata(
  value: number | null | undefined,
  unit: string | null | undefined,
): ProductContaminantMeasurementMetadata | null {
  return value != null && unit != null ? { value, unit } : null;
}

function productContaminantSample(
  row: ProductContaminantQueryRow,
): ProductContaminantSample {
  return {
    evidenceType: row.evidenceType ?? "laboratory_measurement",
    samplingContext: row.samplingContext ?? "unspecified",
    sourceSampleId: row.sourceSampleId ?? null,
    sampleCount: row.sourceSampleCount ?? null,
    reportedUpc: row.testedProductUpcRaw ?? null,
    lotCode: row.testedLotCode ?? null,
    bestBy: row.testedBestBy ?? null,
    packageSize: row.testedPackageSize ?? null,
    collectedOn: row.collectedOn ?? null,
    testedOn: row.testedOn ?? null,
    labName: row.labName ?? null,
    testMethod: row.testMethod ?? null,
  };
}

type ProductContaminantThresholdScore = {
  comparison: "does_not_exceed" | "exceeds" | "unknown";
  threshold: {
    value: number;
    unit: string;
    basis: string;
  };
  screeningPolicy?: ProductContaminantAlert["screeningPolicy"];
};

function scoreProductContaminantThreshold(
  row: ProductContaminantQueryRow,
): ProductContaminantThresholdScore {
  if (
    !isThresholdComparableOperator(row.resultOperator) ||
    row.normalizedValue == null ||
    row.normalizedUnit == null ||
    row.normalizedBasis == null ||
    row.thresholdAuthorityName == null ||
    row.thresholdName == null ||
    row.concernLevelIfExceeded == null
  ) {
    return unknownProductContaminantThresholdScore();
  }

  if (
    row.thresholdNormalizedValue != null &&
    row.thresholdNormalizedUnit != null &&
    row.thresholdNormalizedBasis != null &&
    row.thresholdNormalizedUnit === row.normalizedUnit &&
    row.thresholdNormalizedBasis === row.normalizedBasis
  ) {
    return {
      comparison: productContaminantThresholdComparison(
        row.resultOperator,
        row.normalizedValue,
        row.thresholdNormalizedValue,
        row.normalizedUpperValue,
      ),
      threshold: {
        value: row.thresholdNormalizedValue,
        unit: row.thresholdNormalizedUnit,
        basis: row.thresholdNormalizedBasis,
      },
    };
  }

  if (
    row.thresholdValue != null &&
    row.thresholdUnit === "ng/kg_bw/day" &&
    row.thresholdBasis === "oral_total_dietary_exposure" &&
    row.normalizedUnit === "ppm" &&
    row.normalizedBasis === "product_mass" &&
    row.servingGrams != null &&
    row.servingGrams > 0
  ) {
    const exposureValue =
      row.normalizedValue *
      NANOGRAMS_PER_GRAM_PER_PPM *
      row.servingGrams *
      PRODUCT_CONTAMINANT_GRADING_POLICY.servingsPerDay /
      PRODUCT_CONTAMINANT_GRADING_POLICY.bodyWeightKg;
    const exposureUpperValue = row.normalizedUpperValue == null
      ? null
      : row.normalizedUpperValue *
        NANOGRAMS_PER_GRAM_PER_PPM *
        row.servingGrams *
        PRODUCT_CONTAMINANT_GRADING_POLICY.servingsPerDay /
        PRODUCT_CONTAMINANT_GRADING_POLICY.bodyWeightKg;

    return {
      comparison: productContaminantThresholdComparison(
        row.resultOperator,
        exposureValue,
        row.thresholdValue,
        exposureUpperValue,
      ),
      threshold: {
        value: row.thresholdValue,
        unit: row.thresholdUnit,
        basis: row.thresholdBasis,
      },
      screeningPolicy: {
        id: PRODUCT_CONTAMINANT_GRADING_POLICY.id,
        assumedBodyWeightKg: PRODUCT_CONTAMINANT_GRADING_POLICY.bodyWeightKg,
        assumedServingsPerDay:
          PRODUCT_CONTAMINANT_GRADING_POLICY.servingsPerDay,
        servingGrams: row.servingGrams,
        exposure: {
          value: exposureValue,
          unit: row.thresholdUnit,
          basis: row.thresholdBasis,
        },
        ratio: exposureValue / row.thresholdValue,
      },
    };
  }

  return unknownProductContaminantThresholdScore();
}

function productContaminantObservationKey(
  row: ProductContaminantQueryRow,
): string {
  return row.productTestId ?? [
    row.productId,
    row.sourceKey,
    row.sourceResultId,
    row.contaminantKey,
    row.resultOperator,
    row.resultValue ?? "",
    row.resultUpperValue ?? "",
    row.resultUnit,
    row.resultBasis,
    row.normalizedValue ?? "",
    row.normalizedUpperValue ?? "",
    row.normalizedUnit ?? "",
    row.normalizedBasis ?? "",
    row.sourceSampleId ?? "",
    row.sourceSampleCount ?? "",
    row.testedLotCode ?? "",
  ].join("\u001f");
}

function unknownProductContaminantThresholdScore(): ProductContaminantThresholdScore {
  return {
    comparison: "unknown",
    threshold: {
      value: 0,
      unit: "",
      basis: "",
    },
  };
}

function isThresholdComparableOperator(
  operator: ProductContaminantResultOperator,
): operator is Extract<
  ProductContaminantResultOperator,
  "eq" | "gt" | "gte" | "range"
> {
  return operator === "eq"
    || operator === "gt"
    || operator === "gte"
    || operator === "range";
}

function productContaminantThresholdComparison(
  operator: Extract<
    ProductContaminantResultOperator,
    "eq" | "gt" | "gte" | "range"
  >,
  normalizedValue: number,
  thresholdValue: number,
  normalizedUpperValue: number | null,
): "does_not_exceed" | "exceeds" | "unknown" {
  switch (operator) {
    case "eq":
      return normalizedValue > thresholdValue ? "exceeds" : "does_not_exceed";
    case "gt":
      return normalizedValue >= thresholdValue ? "exceeds" : "unknown";
    case "gte":
      return normalizedValue > thresholdValue ? "exceeds" : "unknown";
    case "range":
      if (normalizedUpperValue == null) {
        return "unknown";
      }
      if (normalizedValue > thresholdValue) {
        return "exceeds";
      }
      return normalizedUpperValue <= thresholdValue
        ? "does_not_exceed"
        : "unknown";
  }
}

function finalizeProductContaminantSummary(
  builder: ProductContaminantSummaryBuilder,
): ProductContaminantSummary {
  if (!builder.hasRows) {
    return createEmptyProductContaminantSummary();
  }

  const alerts = [...builder.alerts].sort(compareProductContaminantAlerts);

  return {
    status: "known_product_tests",
    murphConcernLevel: alerts.length > 0
      ? builder.concernLevel
      : builder.hasComparableRows && !builder.hasNonComparableRows
        ? "none"
      : "unknown",
    alertCount: alerts.length,
    alerts: alerts.slice(0, PRODUCT_CONTAMINANT_ALERT_LIMIT),
    observationCount: builder.observationCount,
    observations: builder.observations.slice(
      0,
      PRODUCT_CONTAMINANT_OBSERVATION_LIMIT,
    ),
  };
}

function createEmptyProductContaminantSummary(): ProductContaminantSummary {
  return {
    status: "no_known_product_tests",
    murphConcernLevel: "unknown",
    alertCount: 0,
    alerts: [],
    observationCount: 0,
    observations: [],
  };
}

function parseExceededConcernLevel(
  value: string,
): ProductContaminantAlert["concernLevel"] {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      throw new Error(`unsupported contaminant threshold concern level: ${value}`);
  }
}

function maxProductContaminantConcernLevel(
  current: ProductContaminantConcernLevel,
  next: ProductContaminantConcernLevel,
): ProductContaminantConcernLevel {
  return PRODUCT_CONTAMINANT_CONCERN_RANK[next] >
    PRODUCT_CONTAMINANT_CONCERN_RANK[current]
    ? next
    : current;
}

function compareProductContaminantAlerts(
  left: ProductContaminantAlert,
  right: ProductContaminantAlert,
): number {
  return (
    PRODUCT_CONTAMINANT_CONCERN_RANK[right.concernLevel] -
      PRODUCT_CONTAMINANT_CONCERN_RANK[left.concernLevel] ||
    compareNullableDateDesc(left.source.reportDate, right.source.reportDate) ||
    left.contaminantKey.localeCompare(right.contaminantKey) ||
    left.source.key.localeCompare(right.source.key)
  );
}

function compareNullableDateDesc(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right.localeCompare(left);
}

function uniqueProductLabelTargets(
  rows: ProductLabelSearchRow[],
): ProductContaminantLookupTarget[] {
  const targetsByProductId = new Map<string, ProductContaminantLookupTarget>();

  for (const row of rows) {
    if (!targetsByProductId.has(row.id)) {
      targetsByProductId.set(row.id, {
        productId: row.id,
        canonicalKey: row.canonicalKey ?? row.id,
      });
    }
  }

  return [...targetsByProductId.values()];
}

function productContaminantProductColumnSql(
  tableSql: ProductLabelsTableSql,
): ProductContaminantProductColumnSql {
  switch (tableSql) {
    case "foods":
      return "food_id";
    case "supplements":
      return "supplement_id";
    default:
      throw new Error("unsupported product labels table");
  }
}

function isMissingProductContaminantSchemaError(error: unknown): boolean {
  return isObjectRecord(error)
    && (error.code === "42P01" || error.code === "42703");
}

function productLabelSourceFilterSql(columnSql: string): string {
  return `${columnSql} NOT IN (${PRODUCT_TEST_SOURCE_DATA_ORIGINS
    .map(sqlStringLiteral)
    .join(", ")})`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}

function productLabelExcludedDataOriginsFilterSql(
  columnSql: string,
  excludedDataOrigins: readonly string[],
): string {
  if (excludedDataOrigins.length === 0) {
    return "true";
  }

  return `${columnSql} NOT IN (${excludedDataOrigins
    .map(sqlStringLiteral)
    .join(", ")})`;
}

function productLabelTimestampIsoSql(columnSql: string): string {
  return `to_char(${columnSql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

function publicProductTestingSummaryLateralSql(
  tableSql: ProductLabelsTableSql,
): string {
  const productColumnSql = productContaminantProductColumnSql(tableSql);
  return `
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT product_tests.id)::integer AS "observationCount",
        COUNT(DISTINCT product_tests.source_key)::integer AS "sourceCount",
        MAX(product_tests.report_date)::text AS "latestReportDate"
      FROM product_tests
      WHERE product_tests.${productColumnSql} = selected.id
    ) test_summary ON true`;
}

function productLabelSearchFinalProjectionSql(
  tableSql: ProductLabelsTableSql,
  projection: ProductLabelSearchProjection,
): string {
  if (projection === "private") {
    return `
      SELECT
        selected.id,
        selected.canonical_key AS "canonicalKey",
        selected."dataOrigin",
        selected."dataOriginId",
        selected.name,
        selected.brand,
        selected.upc,
        selected."offMarket",
        labels.label
      FROM selected
      JOIN ${tableSql} labels
        ON labels.id = selected.id
      ORDER BY selected.result_rank`;
  }

  return `
    SELECT
      selected.id,
      selected."dataOrigin",
      selected."dataOriginId",
      labels.data_origin_url AS "dataOriginUrl",
      ${productLabelTimestampIsoSql("labels.imported_at")} AS "importedAt",
      selected.name,
      selected.brand,
      selected.upc,
      COALESCE(test_summary."observationCount", 0)::integer AS "observationCount",
      COALESCE(test_summary."sourceCount", 0)::integer AS "sourceCount",
      test_summary."latestReportDate"
    FROM selected
    JOIN ${tableSql} labels
      ON labels.id = selected.id
    ${publicProductTestingSummaryLateralSql(tableSql)}
    ORDER BY selected.result_rank`;
}

function toPublicProductLabelSearchItem(
  row: PublicProductLabelSearchRow,
): PublicProductLabelSearchItem {
  return {
    id: row.id,
    dataOrigin: row.dataOrigin,
    dataOriginId: row.dataOriginId,
    dataOriginUrl: row.dataOriginUrl,
    importedAt: row.importedAt,
    name: row.name,
    brand: row.brand,
    upc: row.upc,
    testing: {
      status: row.observationCount > 0
        ? "known_product_tests"
        : "no_known_product_tests",
      observationCount: row.observationCount,
      sourceCount: row.sourceCount,
      latestReportDate: row.latestReportDate,
    },
  };
}

function normalizeProductLabelGtinQuery(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[\d\s().-]+$/u.test(trimmed)) {
    return null;
  }

  const digits = trimmed.replace(/\D/gu, "");
  return PRODUCT_LABEL_GTIN_LENGTHS.has(digits.length) ? digits : null;
}

async function getPublicProductLabelByUpc(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  upc: string,
  excludedDataOrigins: readonly string[],
): Promise<PublicProductLabelSearchRow | null> {
  const upcVariants = buildUpcLookupVariants(upc);
  if (upcVariants.length === 0) {
    return null;
  }

  const excludedDataOriginsSql = productLabelExcludedDataOriginsFilterSql(
    "data_origin",
    excludedDataOrigins,
  );
  const { rows } = await client.query<PublicProductLabelSearchRow>(
    `
      WITH selected AS (
        SELECT
          id,
          canonical_key,
          data_origin AS "dataOrigin",
          data_origin_id AS "dataOriginId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          1::integer AS result_rank
        FROM ${tableSql}
        WHERE
          upc = ANY($1::text[])
          AND off_market = false
          AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
          AND ${excludedDataOriginsSql}
        ORDER BY
          array_position($1::text[], upc) ASC,
          data_origin_priority ASC,
          name ASC,
          id ASC
        LIMIT 1
      )
      ${productLabelSearchFinalProjectionSql(tableSql, "public")}
    `,
    [upcVariants],
  );

  return rows[0] ?? null;
}

async function getPublicProductLabelRecordById(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  id: string,
  excludedDataOrigins: readonly string[],
): Promise<PublicProductLabelRecord | null> {
  const excludedDataOriginsSql = productLabelExcludedDataOriginsFilterSql(
    "labels.data_origin",
    excludedDataOrigins,
  );
  const sourceDatesSql = tableSql === "foods"
    ? `
      labels.fdc_release_date::text AS "releaseDate",
      ${productLabelTimestampIsoSql("labels.last_seen_at")} AS "lastSeenAt",`
    : `
      NULL::text AS "releaseDate",
      NULL::text AS "lastSeenAt",`;
  const { rows } = await client.query<PublicProductLabelRecord>(
    `
      SELECT
        labels.id,
        labels.data_origin AS "dataOrigin",
        labels.data_origin_id AS "dataOriginId",
        labels.data_origin_url AS "dataOriginUrl",
        ${productLabelTimestampIsoSql("labels.imported_at")} AS "importedAt",
        ${sourceDatesSql}
        labels.name,
        labels.brand,
        labels.upc,
        labels.serving_grams::double precision AS "servingGrams",
        CASE
          WHEN octet_length(labels.label::text) <= ${PUBLIC_PRODUCT_LABEL_JSON_LIMIT_BYTES}
            THEN labels.label
          ELSE NULL
        END AS label,
        (
          COALESCE(octet_length(labels.label::text), 0) >
            ${PUBLIC_PRODUCT_LABEL_JSON_LIMIT_BYTES}
        ) AS "labelOmitted"
      FROM ${tableSql} labels
      WHERE
        labels.id = $1
        AND labels.off_market = false
        AND ${productLabelSourceFilterSql("labels.data_origin")}
        AND ${excludedDataOriginsSql}
      LIMIT 1
    `,
    [id],
  );

  return rows[0] ?? null;
}

type ProductLabelSearchProjection = "private" | "public";

type GenericProductLabelSearchInput = {
  excludedDataOrigins: readonly string[];
  genericSearchDataOrigins: readonly string[] | null;
  includeOffMarket: boolean;
  limit: number;
  projection: ProductLabelSearchProjection;
  q: string;
  stemmedSearch: boolean;
};

async function searchGenericProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: GenericProductLabelSearchInput & { projection: "private" },
): Promise<ProductLabelSearchRow[]>;
async function searchGenericProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: GenericProductLabelSearchInput & { projection: "public" },
): Promise<PublicProductLabelSearchRow[]>;
async function searchGenericProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: GenericProductLabelSearchInput,
): Promise<ProductLabelSearchRow[] | PublicProductLabelSearchRow[]> {
  const stemmed = input.stemmedSearch;
  const excludedDataOriginsSql = productLabelExcludedDataOriginsFilterSql(
    "data_origin",
    input.excludedDataOrigins,
  );
  const queryText = `
        WITH query AS (
          SELECT
            $1::text AS raw_q,
            websearch_to_tsquery('simple', $1) AS tsq${stemmed ? `,
            websearch_to_tsquery('english', $1) AS stemmed_tsq` : ""}
        ),
        query_words AS (
          SELECT
            query.*,
            regexp_split_to_array(query.raw_q, '\\s+') AS words
          FROM query
        ),
        query_phrases AS MATERIALIZED (
          SELECT phrase
          FROM (
            SELECT query.raw_q AS phrase
            FROM query

            UNION

            SELECT array_to_string(
              query_words.words[start_index:end_index],
              ' '
            ) AS phrase
            FROM query_words
            CROSS JOIN LATERAL
              generate_subscripts(query_words.words, 1) AS starts(start_index)
            CROSS JOIN LATERAL generate_series(
              start_index,
              LEAST(array_length(query_words.words, 1), start_index + 15)
            ) AS ends(end_index)
          ) phrases
          WHERE phrase <> ''
          ORDER BY char_length(phrase) DESC, phrase ASC
          LIMIT 256
        ),
        fts_phrase_matches AS MATERIALIZED (
          SELECT
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            upc,
            off_market,
            search_text,
            data_origin_priority
          FROM (
            SELECT DISTINCT ON (canonical_key)
              id,
              canonical_key,
              data_origin,
              data_origin_id,
              name,
              brand,
              upc,
              off_market,
              search_text,
              data_origin_priority
            FROM ${tableSql}, query_phrases
            WHERE
              name ILIKE query_phrases.phrase
              AND ${stemmed ? `(
                to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)
                OR to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $1)
              )` : `to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)`}
              AND ($2::boolean OR off_market = false)
              AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
              AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))
              AND ${excludedDataOriginsSql}
            ORDER BY
              canonical_key ASC,
              data_origin_priority ASC,
              name ASC,
              id ASC
          ) canonical_phrase_matches
          ORDER BY
            char_length(name) DESC,
            data_origin_priority ASC,
            name ASC,
            id ASC
          LIMIT ${PRODUCT_LABEL_SEARCH_PHRASE_LIMIT}
        ),
        fts_nearest_matches AS MATERIALIZED (
          SELECT
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            upc,
            off_market,
            search_text,
            data_origin_priority
          FROM ${tableSql}
          WHERE
            -- With stemming on, match both dictionaries: 'simple' keeps
            -- exact tokens that 'english' would drop or mangle
            -- (stopword-shaped brands like "NOW"), while 'english' stems so
            -- singular/plural queries reach rows indexed under the other
            -- form. Both arms are GIN-indexed.
            ${stemmed ? `(
              to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)
              OR to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $1)
            )` : `to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)`}
            AND ($2::boolean OR off_market = false)
            AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
            AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))
            AND ${excludedDataOriginsSql}
          -- The GiST trigram index admits the closest names without scoring
          -- and sorting the entire FTS match set.
          ORDER BY name <->>> $1::text
          LIMIT ${PRODUCT_LABEL_SEARCH_MATCH_LIMIT}
        ),
        fts_canonical_matches AS MATERIALIZED (
          SELECT DISTINCT ON (canonical_key)
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            upc,
            off_market,
            search_text,
            data_origin_priority
          FROM ${tableSql}
          WHERE
            ${stemmed ? `(
              to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)
              OR to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $1)
            )` : `to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $1)`}
            AND ($2::boolean OR off_market = false)
            AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
            AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))
            AND ${excludedDataOriginsSql}
          -- The canonical-rank btree keeps this diversity lane deterministic
          -- and selects the highest-priority representative for each key.
          ORDER BY
            canonical_key ASC,
            data_origin_priority ASC,
            id ASC
          LIMIT ${PRODUCT_LABEL_SEARCH_MATCH_LIMIT}
        ),
        fts_matches AS MATERIALIZED (
          SELECT * FROM fts_phrase_matches
          UNION
          SELECT * FROM fts_nearest_matches
          UNION
          SELECT * FROM fts_canonical_matches
        ),
        fts_candidates AS MATERIALIZED (
          SELECT
            id,
            canonical_key,
            data_origin AS "dataOrigin",
            data_origin_id AS "dataOriginId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            ${stemmed ? `greatest(
              ts_rank_cd(to_tsvector('simple', search_text), query.tsq),
              ts_rank_cd(to_tsvector('english', search_text), query.stemmed_tsq)
            )` : `ts_rank_cd(to_tsvector('simple', search_text), query.tsq)`} AS search_rank,
            strict_word_similarity(query.raw_q, name) AS name_similarity,
            CASE
              WHEN strpos(' ' || lower(query.raw_q) || ' ', ' ' || lower(name) || ' ') > 0 THEN 1
              ELSE 0
            END AS name_phrase_match,
            CASE
              WHEN strpos(' ' || lower(query.raw_q) || ' ', ' ' || lower(name) || ' ') > 0 THEN char_length(name)
              ELSE 0
            END AS name_phrase_length,
            ${stemmed ? `CASE
              WHEN to_tsvector('english', name) = to_tsvector('english', query.raw_q) THEN 1
              ELSE 0
            END` : "0"} AS stemmed_name_match,
            data_origin_priority
          FROM fts_matches, query
        ),
        trigram_nearest_matches AS MATERIALIZED (
          SELECT
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            upc,
            off_market,
            data_origin_priority
          FROM ${tableSql}
          WHERE
            NOT EXISTS (SELECT 1 FROM fts_matches)
            AND name % $1::text
            AND ($2::boolean OR off_market = false)
            AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
            AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))
            AND ${excludedDataOriginsSql}
          ORDER BY name <->>> $1::text
          LIMIT ${PRODUCT_LABEL_SEARCH_MATCH_LIMIT}
        ),
        trigram_canonical_matches AS MATERIALIZED (
          SELECT DISTINCT ON (canonical_key)
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            upc,
            off_market,
            data_origin_priority
          FROM ${tableSql}
          WHERE
            NOT EXISTS (SELECT 1 FROM fts_matches)
            AND name % $1::text
            AND ($2::boolean OR off_market = false)
            AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
            AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))
            AND ${excludedDataOriginsSql}
          ORDER BY
            canonical_key ASC,
            data_origin_priority ASC,
            id ASC
          LIMIT ${PRODUCT_LABEL_SEARCH_MATCH_LIMIT}
        ),
        trigram_matches AS MATERIALIZED (
          SELECT * FROM trigram_nearest_matches
          UNION
          SELECT * FROM trigram_canonical_matches
        ),
        trigram_candidates AS MATERIALIZED (
          SELECT
            id,
            canonical_key,
            data_origin AS "dataOrigin",
            data_origin_id AS "dataOriginId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            0::real AS search_rank,
            strict_word_similarity(query.raw_q, name) AS name_similarity,
            CASE
              WHEN strpos(' ' || lower(query.raw_q) || ' ', ' ' || lower(name) || ' ') > 0 THEN 1
              ELSE 0
            END AS name_phrase_match,
            CASE
              WHEN strpos(' ' || lower(query.raw_q) || ' ', ' ' || lower(name) || ' ') > 0 THEN char_length(name)
              ELSE 0
            END AS name_phrase_length,
            ${stemmed ? `CASE
              WHEN to_tsvector('english', name) = to_tsvector('english', query.raw_q) THEN 1
              ELSE 0
            END` : "0"} AS stemmed_name_match,
            data_origin_priority
          FROM trigram_matches, query
        ),
        candidates AS (
          SELECT * FROM fts_candidates
          UNION ALL
          SELECT * FROM trigram_candidates
        ),
        ranked AS (
          SELECT
            *,
            row_number() OVER (
              PARTITION BY canonical_key
              ORDER BY
                name_phrase_match DESC,
                name_phrase_length DESC,
                stemmed_name_match DESC,
                name_similarity DESC,
                search_rank DESC,
                "offMarket" ASC,
                data_origin_priority ASC,
                name ASC,
                id ASC
            ) AS dedupe_rank
          FROM candidates
        ),
        selected AS (
          SELECT
            *,
            row_number() OVER (
              ORDER BY
                name_phrase_match DESC,
                name_phrase_length DESC,
                stemmed_name_match DESC,
                name_similarity DESC,
                search_rank DESC,
                data_origin_priority ASC,
                name ASC,
                id ASC
            ) AS result_rank
          FROM ranked
          WHERE dedupe_rank = 1
          ORDER BY
            name_phrase_match DESC,
            name_phrase_length DESC,
            stemmed_name_match DESC,
            name_similarity DESC,
            search_rank DESC,
            data_origin_priority ASC,
            name ASC,
            id ASC
          LIMIT $3
        )
        ${productLabelSearchFinalProjectionSql(tableSql, input.projection)}
        `;
  const values = [
    input.q,
    input.includeOffMarket,
    input.limit,
    input.genericSearchDataOrigins,
  ];

  if (input.projection === "public") {
    const { rows } = await client.query<PublicProductLabelSearchRow>(
      queryText,
      values,
    );
    return rows;
  }

  const { rows } = await client.query<ProductLabelSearchRow>(queryText, values);
  return rows;
}

type BrandScopedProductLabelSearchInput = {
  brandScopes: ProductLabelBrandIndexEntry[];
  excludedDataOrigins: readonly string[];
  includeOffMarket: boolean;
  limit: number;
  productQ: string;
  projection: ProductLabelSearchProjection;
  q: string;
};

async function searchBrandScopedProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: BrandScopedProductLabelSearchInput & { projection: "private" },
): Promise<ProductLabelSearchRow[]>;
async function searchBrandScopedProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: BrandScopedProductLabelSearchInput & { projection: "public" },
): Promise<PublicProductLabelSearchRow[]>;
async function searchBrandScopedProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: BrandScopedProductLabelSearchInput,
): Promise<ProductLabelSearchRow[] | PublicProductLabelSearchRow[]> {
  const excludedDataOriginsSql = productLabelExcludedDataOriginsFilterSql(
    "data_origin",
    input.excludedDataOrigins,
  );
  const queryText = `
    WITH query AS (
      SELECT
        $1::text AS raw_q,
        $5::text AS product_q,
        websearch_to_tsquery('simple', $1) AS tsq
    ),
    brand_candidates AS MATERIALIZED (
      SELECT
        id,
        canonical_key,
        data_origin AS "dataOrigin",
        data_origin_id AS "dataOriginId",
        name,
        brand,
        upc,
        off_market AS "offMarket",
        data_origin_priority,
        search_text,
        btrim(regexp_replace(replace(lower(name), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name
      FROM ${tableSql}
      WHERE
        brand = ANY($4::text[])
        AND ($2::boolean OR off_market = false)
        AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
        AND ${excludedDataOriginsSql}
    ),
    scored AS (
      SELECT
        brand_candidates.*,
        query.raw_q,
        query.tsq,
        query.product_q
      FROM brand_candidates, query
    ),
    product_scored AS (
      SELECT
        *,
        CASE
          WHEN product_q = '' THEN ts_rank_cd(to_tsvector('simple', search_text), tsq)
          ELSE ts_rank_cd(to_tsvector('simple', search_text), websearch_to_tsquery('simple', product_q))
        END AS search_rank,
        CASE
          WHEN product_q = '' THEN strict_word_similarity(raw_q, name)
          ELSE strict_word_similarity(product_q, name)
        END AS name_similarity,
        CASE
          WHEN strpos(' ' || product_q || ' ', ' ' || normalized_name || ' ') > 0 THEN 1
          ELSE 0
        END AS name_phrase_match,
        CASE
          WHEN strpos(' ' || product_q || ' ', ' ' || normalized_name || ' ') > 0 THEN char_length(normalized_name)
          ELSE 0
        END AS name_phrase_length,
        CASE
          WHEN product_q = '' THEN 1
          WHEN strpos(normalized_name, product_q) > 0 THEN 1
          WHEN strpos(product_q, normalized_name) > 0 THEN 1
          WHEN strict_word_similarity(product_q, name) >= 0.55 THEN 1
          WHEN similarity(name, product_q) >= 0.30 THEN 1
          ELSE 0
        END AS product_identity_match
      FROM scored
    ),
    ranked AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY canonical_key
          ORDER BY
            name_phrase_match DESC,
            name_phrase_length DESC,
            "offMarket" ASC,
            data_origin_priority ASC,
            name_similarity DESC,
            search_rank DESC,
            name ASC,
            id ASC
        ) AS dedupe_rank
      FROM product_scored
      WHERE product_identity_match = 1
    ),
    selected AS (
      SELECT
        *,
        row_number() OVER (
          ORDER BY
            name_phrase_match DESC,
            name_phrase_length DESC,
            data_origin_priority ASC,
            name_similarity DESC,
            search_rank DESC,
            name ASC,
            id ASC
        ) AS result_rank
      FROM ranked
      WHERE dedupe_rank = 1
      ORDER BY
        name_phrase_match DESC,
        name_phrase_length DESC,
        data_origin_priority ASC,
        name_similarity DESC,
        search_rank DESC,
        name ASC,
        id ASC
      LIMIT $3
    )
    ${productLabelSearchFinalProjectionSql(tableSql, input.projection)}
    `;
  const values = [
    input.q,
    input.includeOffMarket,
    input.limit,
    input.brandScopes.map((scope) => scope.brand),
    input.productQ,
  ];

  if (input.projection === "public") {
    const { rows } = await client.query<PublicProductLabelSearchRow>(
      queryText,
      values,
    );
    return rows;
  }

  const { rows } = await client.query<ProductLabelSearchRow>(queryText, values);
  return rows;
}

async function loadProductLabelBrandIndex(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
): Promise<ProductLabelBrandIndexEntry[]> {
  const { rows } = await client.query<{ brand: string | null }>(
    `
    SELECT brand
    FROM ${tableSql}
    WHERE
      brand IS NOT NULL
      AND brand <> ''
      AND ${PRODUCT_LABEL_SOURCE_FILTER_SQL}
    GROUP BY brand
    `,
    [],
  );

  return rows.flatMap((row) => {
    const brand = row.brand ?? "";
    const normalizedBrand = normalizeProductLabelSearchPhrase(brand);

    if (!normalizedBrand) {
      return [];
    }

    return [
      {
        brand,
        normalizedBrand,
      },
    ];
  });
}

function findProductLabelBrandScopes(
  brandIndex: ProductLabelBrandIndexEntry[],
  q: string,
): ProductLabelBrandIndexEntry[] {
  const normalizedQ = normalizeProductLabelSearchPhrase(q);

  if (!normalizedQ) {
    return [];
  }

  const matches = brandIndex
    .filter(
      (entry) =>
        containsNormalizedPhrase(normalizedQ, entry.normalizedBrand) ||
        containsNormalizedTokenPermutation(normalizedQ, entry.normalizedBrand),
    )
    .sort(
      (left, right) =>
        right.normalizedBrand.length - left.normalizedBrand.length ||
        left.brand.localeCompare(right.brand),
    );

  const reorderedMatches = matches.filter(
    (entry) =>
      !containsNormalizedPhrase(normalizedQ, entry.normalizedBrand) &&
      containsNormalizedTokenPermutation(normalizedQ, entry.normalizedBrand),
  );

  const directScopes = matches.filter((entry) => {
    const isSingleWordBrand = !entry.normalizedBrand.includes(" ");

    if (
      isSingleWordBrand &&
      (normalizedQ === entry.normalizedBrand ||
        !containsNormalizedEdgePhrase(normalizedQ, entry.normalizedBrand))
    ) {
      return false;
    }

    return (
      !isSingleWordBrand ||
      !hasLongerContainingBrandMatch(matches, entry)
    );
  });

  const onlyDirectScope = directScopes.length === 1 ? directScopes[0] : null;
  const directScopeSet = new Set(directScopes.map((entry) => entry.brand));
  // A trailing product-line word can also be a brand in the catalog
  // ("... Blueprint Essentials"). In that ambiguous shape, keep other
  // standalone one-word brand matches that look like the named product line
  // inside the exclusive brand-scoped search.
  const ambiguousSingleWordScopes =
    onlyDirectScope &&
    !onlyDirectScope.normalizedBrand.includes(" ") &&
    normalizedQ.endsWith(` ${onlyDirectScope.normalizedBrand}`)
      ? matches.filter(
          (entry) =>
            !directScopeSet.has(entry.brand) &&
            !entry.normalizedBrand.includes(" ") &&
            isLineBrandBeforeTrailingScope(normalizedQ, entry, onlyDirectScope) &&
            !hasLongerContainingBrandMatch(matches, entry),
        )
      : [];
  const lineScopeRoots = [...directScopes, ...ambiguousSingleWordScopes];
  const lineScopeRootSet = new Set(lineScopeRoots.map((entry) => entry.brand));

  // When a multiword catalog brand is typed in a different token order, also
  // include a shorter catalog parent that appears in that alias. This lets an
  // official parent-brand row compete with a source-specific alias without
  // broadening ordinary exact brand searches to every substring brand.
  const reorderedParentScopes = matches.filter(
    (entry) =>
      !lineScopeRootSet.has(entry.brand) &&
      reorderedMatches.some((scope) =>
        scope.normalizedBrand.startsWith(`${entry.normalizedBrand} `),
      ),
  );

  const scopedDirectMatches = [...lineScopeRoots, ...reorderedParentScopes];

  // Queries often name the parent brand while products are stored under a
  // sub-brand line (e.g. "Garden of Life Organics ..." rows live under
  // "Garden of Life MyKind Organics"). Scope those lines in too, preferring
  // lines whose extra words overlap the query.
  const queryTokens = new Set(normalizedQ.split(" "));
  const scopedBrands = new Set(scopedDirectMatches.map((entry) => entry.brand));
  const lineScopes = brandIndex
    .filter(
      (entry) =>
        !scopedBrands.has(entry.brand) &&
        lineScopeRoots.some((scope) =>
          entry.normalizedBrand.startsWith(`${scope.normalizedBrand} `),
        ),
    )
    .sort(
      (left, right) =>
        countQueryTokenOverlap(right, queryTokens) -
          countQueryTokenOverlap(left, queryTokens) ||
        left.normalizedBrand.length - right.normalizedBrand.length ||
        left.brand.localeCompare(right.brand),
    );

  return [...scopedDirectMatches, ...lineScopes].slice(
    0,
    MAX_PRODUCT_LABEL_BRAND_SCOPES,
  );
}

function hasLongerContainingBrandMatch(
  matches: ProductLabelBrandIndexEntry[],
  entry: ProductLabelBrandIndexEntry,
): boolean {
  return matches.some(
    (other) =>
      other !== entry &&
      other.normalizedBrand.length > entry.normalizedBrand.length &&
      containsNormalizedPhrase(other.normalizedBrand, entry.normalizedBrand),
  );
}

function isLineBrandBeforeTrailingScope(
  normalizedQ: string,
  entry: ProductLabelBrandIndexEntry,
  trailingScope: ProductLabelBrandIndexEntry,
): boolean {
  const suffix = ` ${entry.normalizedBrand} ${trailingScope.normalizedBrand}`;

  if (!normalizedQ.endsWith(suffix)) {
    return false;
  }

  const leadingPhrase = normalizedQ.slice(0, -suffix.length).trim();

  return leadingPhrase.split(" ").filter(Boolean).length >= 2;
}

function countQueryTokenOverlap(
  entry: ProductLabelBrandIndexEntry,
  queryTokens: Set<string>,
): number {
  let count = 0;

  for (const token of entry.normalizedBrand.split(" ")) {
    if (queryTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function buildBrandScopedProductLabelQuery(
  q: string,
  brandScopes: ProductLabelBrandIndexEntry[],
): string {
  const normalizedQ = normalizeProductLabelSearchPhrase(q);

  if (!normalizedQ) {
    return "";
  }

  const queryTokenList = normalizedQ.split(" ");
  const queryTokens = new Set(queryTokenList);
  const bestScope = [...brandScopes].sort(
    (left, right) =>
      countQueryTokenOverlap(right, queryTokens) -
        countQueryTokenOverlap(left, queryTokens) ||
      right.normalizedBrand.length - left.normalizedBrand.length ||
      left.brand.localeCompare(right.brand),
  )[0];

  if (!bestScope) {
    return normalizedQ;
  }

  const brandTokens = new Set(bestScope.normalizedBrand.split(" "));

  return queryTokenList
    .filter((token) => !brandTokens.has(token))
    .join(" ");
}

function removeWeakProductLabelQueryTokens(
  q: string,
  weakQueryTokens: ReadonlySet<string>,
): string {
  if (weakQueryTokens.size === 0) {
    return q;
  }

  const normalizedQ = normalizeProductLabelSearchPhrase(q);

  if (!normalizedQ) {
    return q;
  }

  const queryTokens = normalizedQ.split(" ");
  const strongQueryTokens = queryTokens.filter(
    (token) => !weakQueryTokens.has(token),
  );

  if (strongQueryTokens.length === 0) {
    return "";
  }

  if (strongQueryTokens.length === queryTokens.length) {
    return q;
  }

  return strongQueryTokens.join(" ");
}

function containsNormalizedPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function containsNormalizedTokenPermutation(
  haystack: string,
  needle: string,
): boolean {
  const needleTokens = needle.split(" ");

  // Two-word permutations collide too easily with product and ingredient
  // phrases; reserve this alias fallback for more specific brand identities.
  if (needleTokens.length < 3) {
    return false;
  }

  const haystackTokens = haystack.split(" ");
  const needleSignature = [...needleTokens].sort().join("\u0000");

  for (
    let index = 0;
    index <= haystackTokens.length - needleTokens.length;
    index += 1
  ) {
    const windowSignature = haystackTokens
      .slice(index, index + needleTokens.length)
      .sort()
      .join("\u0000");

    if (windowSignature === needleSignature) {
      return true;
    }
  }

  return false;
}

function containsNormalizedEdgePhrase(haystack: string, needle: string): boolean {
  return (
    needle.length > 0 &&
    (haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`))
  );
}

function normalizeProductLabelSearchPhrase(value: string): string {
  return normalizeProductLabelSearchInput(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeProductLabelSearchInput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/['‘’‛ʻʼʹ]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function isProductLabelLookupId(id: string): boolean {
  if (id.length > 256) {
    return false;
  }

  return /^\d+$/u.test(id) || /^[a-z][a-z0-9_-]*:\S+$/u.test(id);
}

function buildUpcLookupVariants(upc: string): string[] {
  if (!upc) {
    return [];
  }

  const variants = new Set([upc]);
  const addVariant = (variant: string) => {
    if (PRODUCT_LABEL_GTIN_LENGTHS.has(variant.length)) {
      variants.add(variant);
    }
  };

  if (/^\d{8}$/u.test(upc)) {
    addVariant(upc.padStart(14, "0"));
  } else if (/^\d{12}$/u.test(upc)) {
    addVariant(`0${upc}`);
    addVariant(`00${upc}`);
  } else if (/^\d{13}$/u.test(upc)) {
    if (upc.startsWith("0")) {
      addVariant(upc.slice(1));
    }
    addVariant(`0${upc}`);
  } else if (upc.length === 14 && /^0+\d{13}$/u.test(upc)) {
    const stripped = upc.replace(/^0+/u, "");
    addVariant(stripped);
    for (let index = 1; index < upc.length; index += 1) {
      if (upc[index] !== "0") {
        break;
      }
      addVariant(upc.slice(index));
    }
  }

  return [...variants];
}

export function getDefaultProductLabelsPool(): PgPool {
  defaultLabelsPool ??= createProductLabelsPool(requireLabelsDatabaseUrl());

  return defaultLabelsPool;
}

export function getDefaultSupplementProductLabelsPool(): PgPool {
  return getDefaultProductLabelsPool();
}

function requireLabelsDatabaseUrl(): string {
  const databaseUrl = process.env[LABELS_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(`${LABELS_DATABASE_ENV} is required`);
  }

  return databaseUrl;
}

function createProductLabelsPool(databaseUrl: string): PgPool {
  const pool = new Pool({
    connectionString: normalizeProductLabelsConnectionString(databaseUrl),
    connectionTimeoutMillis: DEFAULT_POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
    max: DEFAULT_POOL_MAX,
    statement_timeout: DEFAULT_POOL_STATEMENT_TIMEOUT_MS,
  });

  pool.on("error", () => {
    console.warn("Product labels database pool idle connection error.");
  });
  attachDatabasePool(pool);

  return pool;
}
