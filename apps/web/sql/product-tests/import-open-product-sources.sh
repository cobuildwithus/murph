#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-open-product-sources.sh [--schema-only]

Imports committed open-source product rows and exact product_tests rows.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.

Optional env:
  OPEN_PRODUCT_SOURCES_PRODUCTS_CSV_PATH
    Products CSV. Defaults to
    apps/web/sql/product-tests/open-data/open_product_sources_products.csv.
  OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH
    Product tests CSV. Defaults to
    apps/web/sql/product-tests/open-data/open_product_sources_product_tests.csv.
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --schema-only                  Apply schemas without importing rows.

The runner never prints the database URL or passes it to psql argv.
CSV paths must be repo-relative so local account paths do not leak to psql logs.
USAGE
}

schema_only=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --schema-only)
      schema_only=true
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_open_product_sources_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_open_product_sources_import EXIT
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

products_csv_path="${OPEN_PRODUCT_SOURCES_PRODUCTS_CSV_PATH:-$script_dir/open-data/open_product_sources_products.csv}"
product_tests_csv_path="${OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH:-$script_dir/open-data/open_product_sources_product_tests.csv}"

for csv_path in "$products_csv_path" "$product_tests_csv_path"; do
  case "$csv_path" in
    /*|../*|*/../*|..)
      echo "Open product source CSV paths must be repo-relative" >&2
      exit 64
      ;;
  esac

  if [ ! -f "$csv_path" ]; then
    echo "Open product source CSV not found" >&2
    exit 66
  fi

  if ! awk 'NR > 1 && /[^[:space:]]/ { found = 1; exit } END { exit found ? 0 : 1 }' "$csv_path"; then
    echo "Open product source CSV has no data rows; refusing to modify labels database." >&2
    exit 65
  fi
done

apply_product_test_schemas

echo "Importing open product source CSVs..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v products_csv="$products_csv_path" \
  -v product_tests_csv="$product_tests_csv_path" \
  -f "$script_dir/import-open-product-sources.sql"

echo "Imported open product source rows."
