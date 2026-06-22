#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-product-test-remaps.sh

Imports reviewed product-test remaps into product_tests.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.
  PRODUCT_TEST_REMAPS_TSV_PATH   Repo-relative TSV path.

Optional env:
  PSQL_BIN                       psql binary to use. Defaults to psql.

The TSV columns are: source_key, tested_source_product_id, tested_product_name,
tested_product_brand, tested_product_upc, food_id, supplement_id, match_method,
review_note. Use source_only with blank product ids to intentionally unlink a
source product. Use exact_upc, exact_source_id, or manual_confirmed with exactly
one product id to attach every matching source product test to a real Murph
label row.

The runner never prints the database URL or passes it to psql argv.
USAGE
}

if [ "$#" -gt 0 ]; then
  usage
  exit 64
fi

remaps_tsv_path="${PRODUCT_TEST_REMAPS_TSV_PATH:-}"

if [ -z "$remaps_tsv_path" ]; then
  echo "PRODUCT_TEST_REMAPS_TSV_PATH is required" >&2
  exit 64
fi

case "$remaps_tsv_path" in
  /*|../*|*/../*|..)
    echo "PRODUCT_TEST_REMAPS_TSV_PATH must be repo-relative" >&2
    exit 64
    ;;
esac

if [ ! -f "$remaps_tsv_path" ]; then
  echo "Product test remaps TSV not found" >&2
  exit 66
fi

if ! awk 'NR > 1 && /[^[:space:]]/ { found = 1; exit } END { exit found ? 0 : 1 }' "$remaps_tsv_path"; then
  echo "Product test remaps TSV has no data rows; refusing to modify labels database." >&2
  exit 65
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_product_test_remaps_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_product_test_remaps_import EXIT
prepare_labels_db_psql_env

cd "$repo_root"

echo "Applying product label and test schemas..."
run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/schema.sql"
run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/supplements/schema.sql"
run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql"

work_dir=".product-tests-work/product-test-remaps"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
rendered_import_sql="$run_work_dir/import-product-test-remaps.sql"

awk \
  -v remaps_tsv="$(labels_db_psql_copy_literal "$remaps_tsv_path")" \
  '{
    gsub(/__REMAPS_TSV__/, remaps_tsv)
    print
  }' \
  "$script_dir/import-product-test-remaps.sql" > "$rendered_import_sql"

echo "Importing product test remaps..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -f "$rendered_import_sql"

echo "Imported product test remaps."
