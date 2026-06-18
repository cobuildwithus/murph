#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-thresholds.sh [--schema-only] [--legacy-supplement-db]

Imports contaminant threshold CSV rows into contaminant_thresholds.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.
  CONTAMINANT_THRESHOLDS_CSV_PATH

Optional env:
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --schema-only                  Apply schemas without importing thresholds.
  --legacy-supplement-db         Use the legacy supplement-only foods stub
                                 instead of the full foods search schema.

The runner never prints the database URL or passes it to psql argv.
USAGE
}

schema_only=false
legacy_supplement_db=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --schema-only)
      schema_only=true
      ;;
    --legacy-supplement-db)
      legacy_supplement_db=true
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

thresholds_csv_path="${CONTAMINANT_THRESHOLDS_CSV_PATH:-}"

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_threshold_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_threshold_import EXIT
prepare_labels_db_psql_env

cd "$repo_root"

apply_product_test_schemas() {
  echo "Applying product label and test schemas..."
  if [ "$legacy_supplement_db" = true ]; then
    run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/legacy-supplement-foods-stub.sql"
  else
    run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/schema.sql"
    run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/supplements/schema.sql"
  fi
  run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql"
}

if [ "$schema_only" = true ]; then
  apply_product_test_schemas
  echo "Applied product label and test schemas."
  exit 0
fi

if [ -z "$thresholds_csv_path" ]; then
  echo "CONTAMINANT_THRESHOLDS_CSV_PATH is required" >&2
  exit 64
fi

case "$thresholds_csv_path" in
  /*|../*|*/../*|..)
    echo "CONTAMINANT_THRESHOLDS_CSV_PATH must be repo-relative" >&2
    exit 64
    ;;
esac

thresholds_csv="$thresholds_csv_path"
if [ ! -f "$thresholds_csv" ]; then
  echo "Contaminant threshold CSV not found" >&2
  exit 66
fi

work_dir=".product-tests-work/thresholds"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
prepared_thresholds_csv="$run_work_dir/contaminant-thresholds.csv"
rows_count_file="$run_work_dir/rows-in-file.count"
rendered_import_sql="$run_work_dir/import-thresholds.sql"
prepared_row_count=0

IFS= read -r header < "$thresholds_csv" || {
  echo "Contaminant threshold CSV is empty" >&2
  exit 65
}
header="${header%$'\r'}"
printf '%s\n' "$header" > "$prepared_thresholds_csv"

awk -v count_file="$rows_count_file" '
  NR > 1 {
    count += 1
    print
  }

  END {
    print count + 0 > count_file
  }
' "$thresholds_csv" >> "$prepared_thresholds_csv"
prepared_row_count="$(cat "$rows_count_file")"

if [ "$prepared_row_count" -le 0 ]; then
  echo "Contaminant threshold import prepared zero rows; refusing to modify labels database." >&2
  exit 65
fi

apply_product_test_schemas

awk \
  -v thresholds_csv="$(labels_db_psql_copy_literal "$prepared_thresholds_csv")" \
  '{ gsub(/__THRESHOLDS_CSV__/, thresholds_csv); print }' \
  "$script_dir/import-thresholds.sql" > "$rendered_import_sql"

echo "Importing $prepared_row_count contaminant threshold rows..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -f "$rendered_import_sql"

echo "Imported contaminant threshold CSV."
