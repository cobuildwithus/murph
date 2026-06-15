#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-thresholds.sh [--schema-only] [--legacy-supplement-db]

Imports curated contaminant threshold CSV seeds into contaminant_thresholds.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.

Optional env:
  CONTAMINANT_THRESHOLDS_CSV_PATH
    Import one CSV instead of every CSV under
    apps/web/sql/product-tests/thresholds/. Single-file imports upsert rows
    without deactivating other active thresholds for the same authority.
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --schema-only                  Apply schemas without importing thresholds.
  --legacy-supplement-db         Use the legacy supplement fallback foods stub
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
replace_missing_authority_thresholds=true

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

threshold_files=()
if [ -n "$thresholds_csv_path" ]; then
  replace_missing_authority_thresholds=false
  case "$thresholds_csv_path" in
    /*|../*|*/../*|..)
      echo "CONTAMINANT_THRESHOLDS_CSV_PATH must be repo-relative" >&2
      exit 64
      ;;
  esac
  threshold_files+=("$thresholds_csv_path")
else
  shopt -s nullglob
  threshold_files=("$script_dir/thresholds/"*.csv)
  shopt -u nullglob
fi

if [ "${#threshold_files[@]}" -eq 0 ]; then
  echo "No contaminant threshold CSV files found" >&2
  exit 66
fi

for thresholds_csv in "${threshold_files[@]}"; do
  if [ ! -f "$thresholds_csv" ]; then
    echo "Contaminant threshold CSV not found" >&2
    exit 66
  fi
done

work_dir=".product-tests-work/thresholds"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
prepared_thresholds_csv="$run_work_dir/contaminant-thresholds.csv"
rows_count_file="$run_work_dir/rows-in-file.count"
expected_header=""
prepared_row_count=0

for thresholds_csv in "${threshold_files[@]}"; do
  IFS= read -r header < "$thresholds_csv" || {
    echo "Contaminant threshold CSV is empty" >&2
    exit 65
  }
  header="${header%$'\r'}"
  if [ -z "$expected_header" ]; then
    expected_header="$header"
    printf '%s\n' "$header" > "$prepared_thresholds_csv"
  elif [ "$header" != "$expected_header" ]; then
    echo "Contaminant threshold CSV headers do not match" >&2
    exit 65
  fi

  awk -v count_file="$rows_count_file" '
    NR > 1 {
      count += 1
      print
    }

    END {
      print count + 0 > count_file
    }
  ' "$thresholds_csv" >> "$prepared_thresholds_csv"
  rows_in_file="$(cat "$rows_count_file")"
  prepared_row_count=$((prepared_row_count + rows_in_file))
done

if [ "$prepared_row_count" -le 0 ]; then
  echo "Contaminant threshold import prepared zero rows; refusing to modify labels database." >&2
  exit 65
fi

apply_product_test_schemas

echo "Importing $prepared_row_count contaminant threshold rows from ${#threshold_files[@]} CSV file(s)..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v thresholds_csv="$prepared_thresholds_csv" \
  -v replace_missing_authority_thresholds="$replace_missing_authority_thresholds" \
  -f "$script_dir/import-thresholds.sql"

echo "Imported contaminant threshold CSV files: ${#threshold_files[@]}"
