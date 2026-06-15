import "server-only";

import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;

const LABELS_DATABASE_ENV = "MURPH_LABELS_DB_URL";
const LEGACY_SUPPLEMENT_DATABASE_ENV = "MURPH_SUPPLEMENT_DB_URL";
const DEFAULT_POOL_MAX = 3;
const DEFAULT_POOL_STATEMENT_TIMEOUT_MS = 8_000;
const PRODUCT_LABEL_BRAND_INDEX_TTL_MS = 10 * 60 * 1000;
const MAX_PRODUCT_LABEL_BRAND_SCOPES = 12;
const PRODUCT_CONTAMINANT_ALERT_LIMIT = 5;
const PRODUCT_CONTAMINANT_OBSERVATION_LIMIT = 5;
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

const PRODUCT_LABELS_TABLE_SQL = {
  supplements: "supplements",
  foods: "foods",
} as const;

export type ProductLabelsTable = keyof typeof PRODUCT_LABELS_TABLE_SQL;
type ProductLabelsTableSql =
  (typeof PRODUCT_LABELS_TABLE_SQL)[ProductLabelsTable];

const PRODUCT_LABEL_TEXT_SEARCH_HIDDEN_DATA_ORIGINS: Record<
  ProductLabelsTableSql,
  readonly string[]
> = {
  [PRODUCT_LABELS_TABLE_SQL.foods]: [
    "plasticlist_bay_area_2024",
    "nyc_dohmh_consumer_products",
    "king_county_consumer_products",
    "pure_earth_rms_2024",
  ],
  [PRODUCT_LABELS_TABLE_SQL.supplements]: [
    "nyc_dohmh_consumer_products",
    "king_county_consumer_products",
  ],
};

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
let defaultLegacySupplementPool: PgPool | null = null;

type ProductLabelBrandIndexEntry = {
  brand: string;
  normalizedBrand: string;
};

type ProductLabelBrandIndexCache = {
  expiresAt: number;
  promise: Promise<ProductLabelBrandIndexEntry[]>;
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
type ProductLabelSearchRow = Omit<ProductLabelSearchItem, "contaminants">;

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
  | "not_detected"
  | "detected"
  | "trace";

export type ProductContaminantAlert = {
  contaminantKey: string;
  contaminantName: string;
  concernLevel: Extract<ProductContaminantConcernLevel, "low" | "medium" | "high">;
  result: {
    operator: ProductContaminantResultOperator;
    value: number;
    unit: string;
    basis: string;
  };
  threshold: {
    value: number;
    unit: string;
    basis: string;
    authority: string;
    name: string;
    url: string | null;
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
};

export type ProductContaminantObservation = {
  contaminantKey: string;
  contaminantName: string;
  result: {
    operator: ProductContaminantResultOperator;
    value: number | null;
    unit: string;
    basis: string;
  };
  normalizedResult: {
    value: number;
    unit: string;
    basis: string;
  } | null;
  source: ProductContaminantAlert["source"];
  testedProduct: ProductContaminantAlert["testedProduct"];
};

export type ProductContaminantSummary = {
  status: ProductContaminantStatus;
  murphConcernLevel: ProductContaminantConcernLevel;
  alertCount: number;
  alerts: ProductContaminantAlert[];
  observationCount: number;
  observations: ProductContaminantObservation[];
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
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<ProductLabelSearchItem[]>;
};

export function createProductLabelsQueries(
  client: ProductLabelsQueryClient,
  table: ProductLabelsTable,
  options: { brandScoping?: boolean } = {},
): ProductLabelsQueries {
  const tableSql = productLabelsTableSql(table);
  // Brand scoping preloads every distinct brand into memory and narrows
  // matching queries to those brands exclusively. That is correct for the
  // supplement catalog but disabled by default: on the ~2M-row foods table the
  // brand preload is an unbounded cold-start cost, and exclusive scoping would
  // hide generic rows (brand IS NULL) whenever a query collides with a brand
  // name.
  const brandScoping = options.brandScoping ?? false;
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
    async getById(input) {
      const id = input.id.trim();

      if (!isProductLabelLookupId(id)) {
        return null;
      }

      const { rows } = await client.query<ProductLabelSearchRow>(
        `
        SELECT
          id,
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
      const q = input.q.trim();

      if (!q) {
        return [];
      }

      if (brandScoping) {
        const brandScopes = findProductLabelBrandScopes(await getBrandIndex(), q);

        if (brandScopes.length > 0) {
          const rows = await searchBrandScopedProductLabels(client, tableSql, {
            ...input,
            q,
            brandScopes,
          });

          return await attachProductContaminantSummaries(client, tableSql, rows);
        }
      }

      const rows = await searchGenericProductLabels(client, tableSql, {
        ...input,
        q,
      });

      return await attachProductContaminantSummaries(client, tableSql, rows);
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
  sourceKey: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceReportTitle: string | null;
  reportDate: string | null;
  sourceResultId: string;
  testedProductName: string | null;
  testedProductBrand: string | null;
  testedProductUpc: string | null;
  testedSourceProductId: string | null;
  matchMethod: ProductContaminantMatchMethod;
  contaminantKey: string;
  contaminantName: string;
  resultOperator: ProductContaminantResultOperator;
  resultValue: number | null;
  resultUnit: string;
  resultBasis: string;
  normalizedValue: number | null;
  normalizedUnit: string | null;
  normalizedBasis: string | null;
  thresholdNormalizedValue: number | null;
  thresholdNormalizedUnit: string | null;
  thresholdNormalizedBasis: string | null;
  thresholdAuthorityName: string | null;
  thresholdName: string | null;
  thresholdUrl: string | null;
  concernLevelIfExceeded: string | null;
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
    productContaminantProductColumnSql(tableSql),
    uniqueProductLabelIds(rows),
  );

  return rows.map((row) => ({
    ...row,
    contaminants:
      summaries.get(row.id) ?? createEmptyProductContaminantSummary(),
  }));
}

async function loadProductContaminantSummaries(
  client: ProductLabelsQueryClient,
  productColumnSql: ProductContaminantProductColumnSql,
  productIds: string[],
): Promise<Map<string, ProductContaminantSummary>> {
  let rows: ProductContaminantQueryRow[];

  try {
    const result = await client.query<ProductContaminantQueryRow>(
      `
    SELECT
      product_tests.${productColumnSql} AS "productId",
      product_tests.source_key AS "sourceKey",
      product_tests.source_name AS "sourceName",
      product_tests.source_url AS "sourceUrl",
      product_tests.source_report_title AS "sourceReportTitle",
      product_tests.report_date::text AS "reportDate",
      product_tests.source_result_id AS "sourceResultId",
      product_tests.tested_product_name AS "testedProductName",
      product_tests.tested_product_brand AS "testedProductBrand",
      product_tests.tested_product_upc AS "testedProductUpc",
      product_tests.tested_source_product_id AS "testedSourceProductId",
      product_tests.match_method AS "matchMethod",
      product_tests.contaminant_key AS "contaminantKey",
      product_tests.contaminant_name AS "contaminantName",
      product_tests.result_operator AS "resultOperator",
      product_tests.result_value::double precision AS "resultValue",
      product_tests.result_unit AS "resultUnit",
      product_tests.result_basis AS "resultBasis",
      product_tests.normalized_value::double precision AS "normalizedValue",
      product_tests.normalized_unit AS "normalizedUnit",
      product_tests.normalized_basis AS "normalizedBasis",
      contaminant_thresholds.normalized_value::double precision AS "thresholdNormalizedValue",
      contaminant_thresholds.normalized_unit AS "thresholdNormalizedUnit",
      contaminant_thresholds.normalized_basis AS "thresholdNormalizedBasis",
      contaminant_thresholds.authority_name AS "thresholdAuthorityName",
      contaminant_thresholds.threshold_name AS "thresholdName",
      contaminant_thresholds.threshold_url AS "thresholdUrl",
      contaminant_thresholds.concern_level_if_exceeded AS "concernLevelIfExceeded"
    FROM product_tests
    LEFT JOIN contaminant_thresholds
      ON contaminant_thresholds.active = true
      AND product_tests.result_operator IN ('eq', 'lt', 'lte', 'gt', 'gte')
      AND product_tests.normalized_value IS NOT NULL
      AND product_tests.normalized_unit IS NOT NULL
      AND product_tests.normalized_basis IS NOT NULL
      AND contaminant_thresholds.contaminant_key = product_tests.contaminant_key
      AND contaminant_thresholds.normalized_value IS NOT NULL
      AND contaminant_thresholds.normalized_unit = product_tests.normalized_unit
      AND contaminant_thresholds.normalized_basis = product_tests.normalized_basis
    WHERE product_tests.${productColumnSql} = ANY($1::text[])
    ORDER BY
      product_tests.${productColumnSql} ASC,
      product_tests.report_date DESC NULLS LAST,
      product_tests.contaminant_key ASC,
      product_tests.source_key ASC,
      product_tests.source_result_id ASC
    `,
      [productIds],
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

type ProductContaminantSummaryBuilder = {
  hasRows: boolean;
  hasComparableRows: boolean;
  hasNonComparableRows: boolean;
  concernLevel: ProductContaminantConcernLevel;
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
  builder.observationCount += 1;
  if (builder.observations.length < PRODUCT_CONTAMINANT_OBSERVATION_LIMIT) {
    builder.observations.push(createProductContaminantObservation(row));
  }

  if (
    !isThresholdComparableOperator(row.resultOperator) ||
    row.normalizedValue === null ||
    row.thresholdNormalizedValue === null ||
    row.thresholdNormalizedUnit === null ||
    row.thresholdNormalizedBasis === null ||
    row.thresholdAuthorityName === null ||
    row.thresholdName === null ||
    row.concernLevelIfExceeded === null
  ) {
    builder.hasNonComparableRows = true;
    return;
  }

  const thresholdComparison = productContaminantThresholdComparison(
    row.resultOperator,
    row.normalizedValue,
    row.thresholdNormalizedValue,
  );

  if (thresholdComparison === "unknown") {
    builder.hasNonComparableRows = true;
    return;
  }

  builder.hasComparableRows = true;

  if (thresholdComparison === "does_not_exceed") {
    if (builder.concernLevel === "unknown") {
      builder.concernLevel = "none";
    }
    return;
  }

  const concernLevel = parseExceededConcernLevel(row.concernLevelIfExceeded);
  builder.concernLevel = maxProductContaminantConcernLevel(
    builder.concernLevel,
    concernLevel,
  );
  builder.alerts.push({
    contaminantKey: row.contaminantKey,
    contaminantName: row.contaminantName,
    concernLevel,
    result: {
      operator: row.resultOperator,
      value: row.normalizedValue,
      unit: row.normalizedUnit ?? row.resultUnit,
      basis: row.normalizedBasis ?? row.resultBasis,
    },
    threshold: {
      value: row.thresholdNormalizedValue,
      unit: row.thresholdNormalizedUnit,
      basis: row.thresholdNormalizedBasis,
      authority: row.thresholdAuthorityName,
      name: row.thresholdName,
      url: row.thresholdUrl,
    },
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
  });
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
      unit: row.resultUnit,
      basis: row.resultBasis,
    },
    normalizedResult: row.normalizedValue !== null
      && row.normalizedUnit !== null
      && row.normalizedBasis !== null
      ? {
        value: row.normalizedValue,
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
  };
}

function isThresholdComparableOperator(
  operator: ProductContaminantResultOperator,
): operator is Extract<
  ProductContaminantResultOperator,
  "eq" | "lt" | "lte" | "gt" | "gte"
> {
  return operator === "eq"
    || operator === "lt"
    || operator === "lte"
    || operator === "gt"
    || operator === "gte";
}

function productContaminantThresholdComparison(
  operator: Extract<
    ProductContaminantResultOperator,
    "eq" | "lt" | "lte" | "gt" | "gte"
  >,
  normalizedValue: number,
  thresholdValue: number,
): "does_not_exceed" | "exceeds" | "unknown" {
  switch (operator) {
    case "eq":
      return normalizedValue > thresholdValue ? "exceeds" : "does_not_exceed";
    case "lt":
    case "lte":
      return normalizedValue <= thresholdValue ? "does_not_exceed" : "unknown";
    case "gt":
      return normalizedValue >= thresholdValue ? "exceeds" : "unknown";
    case "gte":
      return normalizedValue > thresholdValue ? "exceeds" : "unknown";
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
    observations: builder.observations,
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

function uniqueProductLabelIds(rows: ProductLabelSearchRow[]): string[] {
  return [...new Set(rows.map((row) => row.id))];
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

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}

async function searchGenericProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  },
): Promise<ProductLabelSearchRow[]> {
  const sourceBackedSearchFilter = sourceBackedProductSearchFilterSql(tableSql);
  const { rows } = await client.query<ProductLabelSearchRow>(
    `
        WITH query AS (
          SELECT
            $1::text AS raw_q,
            websearch_to_tsquery('simple', $1) AS tsq
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
            ts_rank_cd(to_tsvector('simple', search_text), query.tsq) AS search_rank,
            strict_word_similarity(name, query.raw_q) AS name_similarity,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN 1
              ELSE 0
            END AS name_phrase_match,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN char_length(name)
              ELSE 0
            END AS name_phrase_length,
            data_origin_priority
          FROM ${tableSql}, query
          WHERE
            to_tsvector('simple', search_text) @@ query.tsq
            AND ($2::boolean OR off_market = false)
            ${sourceBackedSearchFilter}
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
            strict_word_similarity(name, query.raw_q) AS name_similarity,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN 1
              ELSE 0
            END AS name_phrase_match,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN char_length(name)
              ELSE 0
            END AS name_phrase_length,
            data_origin_priority
          FROM ${tableSql}, query
          WHERE
            NOT EXISTS (SELECT 1 FROM fts_candidates)
            AND name % query.raw_q
            AND ($2::boolean OR off_market = false)
            ${sourceBackedSearchFilter}
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
            name_similarity DESC,
            search_rank DESC,
            data_origin_priority ASC,
            name ASC,
            id ASC
          LIMIT $3
        )
        SELECT
          selected.id,
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
        ORDER BY selected.result_rank
        `,
    [input.q, input.includeOffMarket, input.limit],
  );

  return rows;
}

function sourceBackedProductSearchFilterSql(
  tableSql: ProductLabelsTableSql,
): string {
  const hiddenDataOrigins =
    PRODUCT_LABEL_TEXT_SEARCH_HIDDEN_DATA_ORIGINS[tableSql];

  if (hiddenDataOrigins.length === 0) {
    return "";
  }

  return hiddenDataOrigins
    .map((dataOrigin) => `AND data_origin <> ${sqlStringLiteral(dataOrigin)}`)
    .join("\n");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function searchBrandScopedProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: {
    brandScopes: ProductLabelBrandIndexEntry[];
    includeOffMarket: boolean;
    limit: number;
    q: string;
  },
): Promise<ProductLabelSearchRow[]> {
  const sourceBackedSearchFilter = sourceBackedProductSearchFilterSql(tableSql);
  const { rows } = await client.query<ProductLabelSearchRow>(
    `
    WITH query AS (
      SELECT
        $1::text AS raw_q,
        btrim(regexp_replace(replace(lower($1::text), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_q,
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
        label,
        data_origin_priority,
        search_text,
        btrim(regexp_replace(replace(lower(name), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name,
        btrim(regexp_replace(replace(lower(brand), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_brand
      FROM ${tableSql}
      WHERE
        brand = ANY($4::text[])
        AND ($2::boolean OR off_market = false)
        ${sourceBackedSearchFilter}
    ),
    scored AS (
      SELECT
        brand_candidates.*,
        query.raw_q,
        query.normalized_q,
        query.tsq,
        btrim(replace(' ' || normalized_q || ' ', ' ' || normalized_brand || ' ', ' ')) AS product_q
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
          WHEN product_q = '' THEN strict_word_similarity(name, raw_q)
          ELSE strict_word_similarity(name, product_q)
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
          WHEN strict_word_similarity(name, product_q) >= 0.55 THEN 1
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
    )
    SELECT
      id,
      "dataOrigin",
      "dataOriginId",
      name,
      brand,
      upc,
      "offMarket",
      label
    FROM ranked
    WHERE dedupe_rank = 1
    ORDER BY
      name_phrase_match DESC,
      name_phrase_length DESC,
      data_origin_priority ASC,
      name_similarity DESC,
      search_rank DESC,
      name ASC
    LIMIT $3
    `,
    [
      input.q,
      input.includeOffMarket,
      input.limit,
      input.brandScopes.map((scope) => scope.brand),
    ],
  );

  return rows;
}

async function loadProductLabelBrandIndex(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
): Promise<ProductLabelBrandIndexEntry[]> {
  const sourceBackedSearchFilter = sourceBackedProductSearchFilterSql(tableSql);
  const { rows } = await client.query<{ brand: string | null }>(
    `
    SELECT brand
    FROM ${tableSql}
    WHERE
      brand IS NOT NULL
      AND brand <> ''
      ${sourceBackedSearchFilter}
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
    .filter((entry) => containsNormalizedPhrase(normalizedQ, entry.normalizedBrand))
    .sort(
      (left, right) =>
        right.normalizedBrand.length - left.normalizedBrand.length ||
        left.brand.localeCompare(right.brand),
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
      !matches.some(
        (other) =>
          other !== entry &&
          containsNormalizedPhrase(other.normalizedBrand, entry.normalizedBrand),
      )
    );
  });

  // Queries often name the parent brand while products are stored under a
  // sub-brand line (e.g. "Garden of Life Organics ..." rows live under
  // "Garden of Life MyKind Organics"). Scope those lines in too, preferring
  // lines whose extra words overlap the query.
  const queryTokens = new Set(normalizedQ.split(" "));
  const scopedBrands = new Set(directScopes.map((entry) => entry.brand));
  const lineScopes = brandIndex
    .filter(
      (entry) =>
        !scopedBrands.has(entry.brand) &&
        directScopes.some((scope) =>
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

  return [...directScopes, ...lineScopes].slice(
    0,
    MAX_PRODUCT_LABEL_BRAND_SCOPES,
  );
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

function containsNormalizedPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function containsNormalizedEdgePhrase(haystack: string, needle: string): boolean {
  return (
    needle.length > 0 &&
    (haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`))
  );
}

function normalizeProductLabelSearchPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/'/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
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
    if (variant) {
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
  const labelsDatabaseUrl = process.env[LABELS_DATABASE_ENV]?.trim();

  if (labelsDatabaseUrl) {
    return getDefaultProductLabelsPool();
  }

  defaultLegacySupplementPool ??= createProductLabelsPool(
    requireLegacySupplementDatabaseUrl(),
  );

  return defaultLegacySupplementPool;
}

function requireLabelsDatabaseUrl(): string {
  const databaseUrl = process.env[LABELS_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(`${LABELS_DATABASE_ENV} is required`);
  }

  return databaseUrl;
}

function requireLegacySupplementDatabaseUrl(): string {
  const databaseUrl = process.env[LEGACY_SUPPLEMENT_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(
      `${LABELS_DATABASE_ENV} or ${LEGACY_SUPPLEMENT_DATABASE_ENV} is required`,
    );
  }

  return databaseUrl;
}

function createProductLabelsPool(databaseUrl: string): PgPool {
  return new Pool({
    connectionString: normalizeProductLabelsConnectionString(databaseUrl),
    max: DEFAULT_POOL_MAX,
    statement_timeout: DEFAULT_POOL_STATEMENT_TIMEOUT_MS,
  });
}

export function normalizeProductLabelsConnectionString(
  databaseUrl: string,
): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  let changed = false;

  for (const key of ["sslcert", "sslkey", "sslrootcert"] as const) {
    if (parsed.searchParams.get(key) === "system") {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }

  return changed ? parsed.toString() : databaseUrl;
}
