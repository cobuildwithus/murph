import { pathToFileURL } from "node:url";

import pg from "pg";

import { normalizeProductLabelsConnectionString } from "../src/lib/product-labels-connection";

const { Pool } = pg;

export const PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE =
  "MURPH_LABELS_DB_URL is required for /api/foods and /api/supplements; MURPH_SUPPLEMENT_DB_URL is not a runtime fallback.";
export const PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE =
  "MURPH_LABELS_DB_URL must point at a labels database with the product contaminant schema and private-food search indexes applied; run apps/web/sql/product-tests/schema.sql and apps/web/sql/foods/private-search-indexes.sql before deploying.";
export const PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE =
  "Could not verify the product contaminant schema on MURPH_LABELS_DB_URL.";

const REQUIRED_PRODUCT_LABEL_SCHEMA_COLUMNS = [
  ["foods", "data_origin_url"],
  ["foods", "fdc_release_date"],
  ["foods", "imported_at"],
  ["foods", "last_seen_at"],
  ["foods", "serving_grams"],
  ["supplements", "data_origin_url"],
  ["supplements", "imported_at"],
  ["supplements", "serving_grams"],
  ["product_tests", "food_id"],
  ["product_tests", "supplement_id"],
  ["product_tests", "source_key"],
  ["product_tests", "source_name"],
  ["product_tests", "source_url"],
  ["product_tests", "source_report_title"],
  ["product_tests", "report_date"],
  ["product_tests", "source_result_id"],
  ["product_tests", "tested_product_name"],
  ["product_tests", "tested_product_brand"],
  ["product_tests", "tested_product_upc"],
  ["product_tests", "tested_source_product_id"],
  ["product_tests", "match_method"],
  ["product_tests", "contaminant_key"],
  ["product_tests", "contaminant_name"],
  ["product_tests", "result_operator"],
  ["product_tests", "result_value"],
  ["product_tests", "result_unit"],
  ["product_tests", "result_basis"],
  ["product_tests", "normalized_value"],
  ["product_tests", "normalized_unit"],
  ["product_tests", "normalized_basis"],
  ["product_tests", "lab_name"],
  ["product_tests", "test_method"],
  ["product_tests", "imported_at"],
  ["contaminant_thresholds", "active"],
  ["contaminant_thresholds", "contaminant_key"],
  ["contaminant_thresholds", "threshold_value"],
  ["contaminant_thresholds", "threshold_unit"],
  ["contaminant_thresholds", "threshold_basis"],
  ["contaminant_thresholds", "normalized_value"],
  ["contaminant_thresholds", "normalized_unit"],
  ["contaminant_thresholds", "normalized_basis"],
  ["contaminant_thresholds", "authority_name"],
  ["contaminant_thresholds", "threshold_name"],
  ["contaminant_thresholds", "threshold_url"],
  ["contaminant_thresholds", "concern_level_if_exceeded"],
] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;
type ProductLabelSchemaColumn = {
  tableName: string;
  columnName: string;
};
type ProductLabelSchemaProblem =
  | {
      kind: "column";
      name: string;
      reason: "missing";
    }
  | {
      kind: "index";
      name: string;
      reason: "missing" | "not_live" | "wrong_definition";
    };
type ProductLabelSchemaColumnRow = {
  tableName: string;
  columnName: string;
};
type ProductLabelSchemaIndexRow = {
  definition: string | null;
  indexName: string;
  isLive: boolean | null;
  isReady: boolean | null;
  isValid: boolean | null;
};
type ProductLabelRuntimeEnvDependencies = {
  readRequiredSchemaProblems?: (
    connectionString: string,
  ) => Promise<ProductLabelSchemaProblem[]>;
};

const REQUIRED_PRODUCT_LABEL_SEARCH_INDEXES = [
  {
    definitionSuffix: "USING gist (name gist_trgm_ops)",
    indexName: "foods_name_rank_idx",
  },
  {
    definitionSuffix:
      "USING btree (lower(name), data_origin_priority, id)",
    indexName: "foods_name_exact_rank_idx",
  },
  {
    definitionSuffix:
      "USING btree (canonical_key, data_origin_priority, id)",
    indexName: "foods_canonical_rank_idx",
  },
] as const;

export async function listProductLabelRuntimeEnvErrors(
  source: EnvSource = process.env,
  dependencies: ProductLabelRuntimeEnvDependencies = {},
): Promise<string[]> {
  if (!shouldRequireProductLabelsDatabase(source)) {
    return [];
  }

  const labelsDatabaseUrl = normalizeOptionalString(source.MURPH_LABELS_DB_URL);
  if (!labelsDatabaseUrl) {
    return [PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE];
  }
  const labelsDatabaseConnectionString =
    normalizeProductLabelsConnectionString(labelsDatabaseUrl);

  let schemaProblems: ProductLabelSchemaProblem[];
  try {
    schemaProblems = await (
      dependencies.readRequiredSchemaProblems ??
      readRequiredProductLabelSchemaProblems
    )(labelsDatabaseConnectionString);
  } catch {
    return [PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE];
  }

  if (schemaProblems.length === 0) {
    return [];
  }

  return [
    `${PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE} Missing or invalid objects: ${
      schemaProblems.map(formatProductLabelSchemaProblem).join(", ")
    }.`,
  ];
}

export async function assertProductLabelRuntimeEnv(
  source: EnvSource = process.env,
  dependencies: ProductLabelRuntimeEnvDependencies = {},
): Promise<void> {
  const errors = await listProductLabelRuntimeEnvErrors(source, dependencies);

  if (errors.length > 0) {
    throw new TypeError(errors.join(" "));
  }
}

function shouldRequireProductLabelsDatabase(source: EnvSource): boolean {
  return normalizeOptionalString(source.VERCEL_ENV) === "production"
    || normalizeOptionalString(source.MURPH_REQUIRE_PRODUCT_LABELS_DB) === "1";
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function readRequiredProductLabelSchemaProblems(
  connectionString: string,
): Promise<ProductLabelSchemaProblem[]> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
    statement_timeout: 8_000,
  });

  try {
    const tableNames = REQUIRED_PRODUCT_LABEL_SCHEMA_COLUMNS.map(
      ([tableName]) => tableName,
    );
    const columnNames = REQUIRED_PRODUCT_LABEL_SCHEMA_COLUMNS.map(
      ([, columnName]) => columnName,
    );
    const missingColumns = await pool.query<ProductLabelSchemaColumnRow>(
      `
        WITH required(table_name, column_name) AS (
          SELECT * FROM unnest($1::text[], $2::text[])
        )
        SELECT
          required.table_name AS "tableName",
          required.column_name AS "columnName"
        FROM required
        LEFT JOIN information_schema.columns AS columns
          ON columns.table_schema = 'public'
          AND columns.table_name = required.table_name
          AND columns.column_name = required.column_name
        WHERE columns.column_name IS NULL
        ORDER BY required.table_name ASC, required.column_name ASC
      `,
      [tableNames, columnNames],
    );

    const requiredIndexNames = REQUIRED_PRODUCT_LABEL_SEARCH_INDEXES.map(
      ({ indexName }) => indexName,
    );
    const indexes = await pool.query<ProductLabelSchemaIndexRow>(
      `
        WITH required(index_name) AS (
          SELECT unnest($1::text[])
        )
        SELECT
          required.index_name AS "indexName",
          index_state.indisvalid AS "isValid",
          index_state.indisready AS "isReady",
          index_state.indislive AS "isLive",
          pg_get_indexdef(index_state.indexrelid) AS definition
        FROM required
        LEFT JOIN LATERAL (
          SELECT indexes.*
          FROM pg_class AS index_class
          JOIN pg_namespace AS index_namespace
            ON index_namespace.oid = index_class.relnamespace
          JOIN pg_index AS indexes
            ON indexes.indexrelid = index_class.oid
          JOIN pg_class AS table_class
            ON table_class.oid = indexes.indrelid
          JOIN pg_namespace AS table_namespace
            ON table_namespace.oid = table_class.relnamespace
          WHERE
            index_namespace.nspname = 'public'
            AND index_class.relname = required.index_name
            AND table_namespace.nspname = 'public'
            AND table_class.relname = 'foods'
          LIMIT 1
        ) AS index_state ON true
        ORDER BY required.index_name ASC
      `,
      [requiredIndexNames],
    );

    return [
      ...missingColumns.rows.map(({ tableName, columnName }) => ({
        kind: "column" as const,
        name: formatProductLabelSchemaColumn({ tableName, columnName }),
        reason: "missing" as const,
      })),
      ...findProductLabelSearchIndexProblems(indexes.rows),
    ];
  } finally {
    await pool.end();
  }
}

function findProductLabelSearchIndexProblems(
  rows: readonly ProductLabelSchemaIndexRow[],
): ProductLabelSchemaProblem[] {
  const rowsByName = new Map(rows.map((row) => [row.indexName, row]));
  const problems: ProductLabelSchemaProblem[] = [];

  for (const required of REQUIRED_PRODUCT_LABEL_SEARCH_INDEXES) {
    const row = rowsByName.get(required.indexName);
    if (!row || !row.definition) {
      problems.push({
        kind: "index",
        name: required.indexName,
        reason: "missing",
      });
      continue;
    }
    if (!row.isValid || !row.isReady || !row.isLive) {
      problems.push({
        kind: "index",
        name: required.indexName,
        reason: "not_live",
      });
      continue;
    }

    const normalizedDefinition = row.definition.replace(/\s+/gu, " ").trim();
    if (!normalizedDefinition.endsWith(required.definitionSuffix)) {
      problems.push({
        kind: "index",
        name: required.indexName,
        reason: "wrong_definition",
      });
    }
  }

  return problems;
}

function formatProductLabelSchemaColumn(
  column: ProductLabelSchemaColumn,
): string {
  return `${column.tableName}.${column.columnName}`;
}

function formatProductLabelSchemaProblem(
  problem: ProductLabelSchemaProblem,
): string {
  return `${problem.name} (${problem.reason})`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void assertProductLabelRuntimeEnv().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
