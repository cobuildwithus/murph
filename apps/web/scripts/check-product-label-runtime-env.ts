import { pathToFileURL } from "node:url";

import pg from "pg";

import { normalizeProductLabelsConnectionString } from "../src/lib/product-labels-connection";

const { Pool } = pg;

export const PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE =
  "MURPH_LABELS_DB_URL is required for /api/foods and /api/supplements; MURPH_SUPPLEMENT_DB_URL is not a runtime fallback.";
export const PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE =
  "MURPH_LABELS_DB_URL must point at a labels database with the product contaminant schema applied; run apps/web/sql/product-tests/schema.sql before deploying.";
export const PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE =
  "Could not verify the product contaminant schema on MURPH_LABELS_DB_URL.";

const REQUIRED_PRODUCT_LABEL_SCHEMA_COLUMNS = [
  ["foods", "serving_grams"],
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
type ProductLabelSchemaColumnRow = {
  tableName: string;
  columnName: string;
};
type ProductLabelRuntimeEnvDependencies = {
  readMissingRequiredSchemaColumns?: (
    connectionString: string,
  ) => Promise<ProductLabelSchemaColumn[]>;
};

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

  let missingColumns: ProductLabelSchemaColumn[];
  try {
    missingColumns = await (
      dependencies.readMissingRequiredSchemaColumns ??
      readMissingRequiredProductLabelSchemaColumns
    )(labelsDatabaseConnectionString);
  } catch {
    return [PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE];
  }

  if (missingColumns.length === 0) {
    return [];
  }

  return [
    `${PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE} Missing columns: ${
      missingColumns.map(formatProductLabelSchemaColumn).join(", ")
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

async function readMissingRequiredProductLabelSchemaColumns(
  connectionString: string,
): Promise<ProductLabelSchemaColumn[]> {
  const pool = new Pool({
    connectionString,
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
    const result = await pool.query<ProductLabelSchemaColumnRow>(
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

    return result.rows;
  } finally {
    await pool.end();
  }
}

function formatProductLabelSchemaColumn(
  column: ProductLabelSchemaColumn,
): string {
  return `${column.tableName}.${column.columnName}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void assertProductLabelRuntimeEnv().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
