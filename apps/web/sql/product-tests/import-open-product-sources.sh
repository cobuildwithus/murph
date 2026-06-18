#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-open-product-sources.sh [--schema-only] [--replace-source]

Imports open-source product_tests rows from a local CSV.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.
  OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH
                                  Repo-relative CSV path to import. Local
                                  generated files should live under
                                  .product-tests-work/.

Optional env:
  OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS
                                  Required with --replace-source. Must equal
                                  the CSV data row count before the import can
                                  unlink rows absent from the complete input.
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --schema-only                  Apply schemas without importing rows.
  --replace-source               Treat the CSV as a complete source snapshot.
                                  Rows absent for imported source keys are
                                  repaired back to source_only.

The runner never prints the database URL or passes it to psql argv.
USAGE
}

schema_only=false
replace_source=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --schema-only)
      schema_only=true
      ;;
    --replace-source)
      replace_source=true
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

if [ "$replace_source" = true ] && [ "$schema_only" = true ]; then
  echo "--replace-source cannot be used with --schema-only" >&2
  exit 64
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

trap cleanup_labels_db_psql_env EXIT
prepare_labels_db_psql_env

cd "$repo_root"

apply_product_test_schemas() {
  echo "Applying product label and test schemas..."
  run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/schema.sql"
  run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/supplements/schema.sql"
  run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql"
}

if [ "$schema_only" = true ]; then
  apply_product_test_schemas
  echo "Applied product label and test schemas."
  exit 0
fi

product_tests_csv_path="${OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH:-}"
replace_source_expected_rows="${OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS:-}"

if [ -z "$product_tests_csv_path" ]; then
  echo "OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH is required" >&2
  exit 64
fi

case "$product_tests_csv_path" in
  /*|../*|*/../*|..)
    echo "OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH must be repo-relative" >&2
    exit 64
    ;;
esac

if [ ! -f "$product_tests_csv_path" ]; then
  echo "Open product source CSV not found" >&2
  exit 66
fi

if ! awk 'NR > 1 && /[^[:space:]]/ { found = 1; exit } END { exit found ? 0 : 1 }' "$product_tests_csv_path"; then
  echo "Open product source CSV has no data rows; refusing to modify labels database." >&2
  exit 65
fi

work_dir=".product-tests-work/open-product-sources"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
rendered_import_sql="$run_work_dir/import-open-product-sources.sql"

if [ "$replace_source" = true ]; then
  if ! [[ "$replace_source_expected_rows" =~ ^[0-9]+$ ]]; then
    echo "OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS is required with --replace-source" >&2
    exit 64
  fi

  product_test_rows=$(awk 'NR > 1 && /[^[:space:]]/ { count += 1 } END { print count + 0 }' "$product_tests_csv_path")
  if [ "$product_test_rows" -ne "$replace_source_expected_rows" ]; then
    echo "Open product sources --replace-source expected $replace_source_expected_rows product test rows but found $product_test_rows; refusing destructive import." >&2
    exit 65
  fi
fi

apply_product_test_schemas

awk \
  -v product_tests_csv="$(labels_db_psql_copy_literal "$product_tests_csv_path")" \
  '{
    gsub(/__PRODUCT_TESTS_CSV__/, product_tests_csv)
    print
  }' \
  "$script_dir/import-open-product-sources.sql" > "$rendered_import_sql"

echo "Importing open product source CSVs..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v replace_source="$replace_source" \
  -v replace_source_expected_product_test_rows="$replace_source_expected_rows" \
  -f "$rendered_import_sql"

echo "Imported open product source rows."
