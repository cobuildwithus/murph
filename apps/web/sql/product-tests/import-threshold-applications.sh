#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-threshold-applications.sh [--schema-only] [--legacy-supplement-db] [--replace-applications]

Imports reviewed exact-product contaminant threshold applications.

Required env:
  MURPH_LABELS_DB_URL
  PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH

Optional env:
  PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS
                                 Required with --replace-applications. Must
                                 equal the TSV data row count before the import
                                 can delete rows absent from the input.
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --schema-only                  Apply schemas without importing applications.
  --legacy-supplement-db         Use the legacy supplement-only foods stub
                                 instead of the full foods search schema.
  --replace-applications         Treat the TSV as the complete reviewed
                                 application set and delete absent rows.

The runner never prints the database URL or passes it to psql argv.
USAGE
}

schema_only=false
legacy_supplement_db=false
replace_applications=false

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
    --replace-applications)
      replace_applications=true
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

if [ "$replace_applications" = true ] && [ "$schema_only" = true ]; then
  echo "--replace-applications cannot be used with --schema-only" >&2
  exit 64
fi

applications_tsv_path="${PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH:-}"
replace_applications_expected_rows="${PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS:-}"

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_threshold_application_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_threshold_application_import EXIT
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

if [ -z "$applications_tsv_path" ]; then
  echo "PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH is required" >&2
  exit 64
fi

case "$applications_tsv_path" in
  /*|../*|*/../*|..)
    echo "PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH must be repo-relative" >&2
    exit 64
    ;;
esac

applications_tsv="$applications_tsv_path"
if [ ! -f "$applications_tsv" ]; then
  echo "Product threshold applications TSV not found" >&2
  exit 66
fi

work_dir=".product-tests-work/threshold-applications"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
prepared_applications_tsv="$run_work_dir/product-threshold-applications.tsv"
rows_count_file="$run_work_dir/rows-in-file.count"
rendered_import_sql="$run_work_dir/import-threshold-applications.sql"
prepared_row_count=0

IFS= read -r header < "$applications_tsv" || {
  echo "Product threshold applications TSV is empty" >&2
  exit 65
}
header="${header%$'\r'}"
printf '%s\n' "$header" > "$prepared_applications_tsv"

awk -v count_file="$rows_count_file" '
  NR > 1 {
    count += 1
    print
  }

  END {
    print count + 0 > count_file
  }
' "$applications_tsv" >> "$prepared_applications_tsv"
prepared_row_count="$(cat "$rows_count_file")"

if [ "$replace_applications" = true ]; then
  if ! [[ "$replace_applications_expected_rows" =~ ^[0-9]+$ ]]; then
    echo "PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS is required with --replace-applications" >&2
    exit 64
  fi

  if [ "$prepared_row_count" -ne "$replace_applications_expected_rows" ]; then
    echo "Product threshold applications --replace-applications expected $replace_applications_expected_rows rows but found $prepared_row_count; refusing destructive import." >&2
    exit 65
  fi
elif [ "$prepared_row_count" -le 0 ]; then
  echo "Product threshold applications import prepared zero rows; refusing to run no-op import. Use --replace-applications with PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS=0 only to intentionally clear all reviewed applications." >&2
  exit 65
fi

apply_product_test_schemas

awk \
  -v applications_tsv="$(labels_db_psql_copy_literal "$prepared_applications_tsv")" \
  '{ gsub(/__THRESHOLD_APPLICATIONS_TSV__/, applications_tsv); print }' \
  "$script_dir/import-threshold-applications.sql" > "$rendered_import_sql"

echo "Importing $prepared_row_count product threshold application rows..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v replace_applications="$replace_applications" \
  -f "$rendered_import_sql"

echo "Imported product threshold applications TSV."
