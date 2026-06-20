#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-reviewed-threshold-applications.sh [--legacy-supplement-db] [--replace-applications]

Imports the committed reviewed exact-product threshold bundle:
  1. threshold-applications/required-thresholds.csv
  2. threshold-applications/reviewed.tsv
  3. postflight-threshold-applications.sql

Required env:
  MURPH_LABELS_DB_URL

Optional env:
  PSQL_BIN                       psql binary to use. Defaults to psql.

Flags:
  --legacy-supplement-db         Use the legacy supplement-only foods stub
                                 instead of the full foods search schema.
  --replace-applications         Accepted for compatibility. This committed
                                 bundle always treats reviewed.tsv as the
                                 complete reviewed application set.

The runner never prints the database URL or passes it to psql argv.
USAGE
}

legacy_supplement_db=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --legacy-supplement-db)
      legacy_supplement_db=true
      ;;
    --replace-applications)
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

thresholds_csv_path="$script_dir/threshold-applications/required-thresholds.csv"
applications_tsv_path="$script_dir/threshold-applications/reviewed.tsv"

cd "$repo_root"

if [ ! -f "$thresholds_csv_path" ]; then
  echo "Contaminant threshold CSV not found" >&2
  exit 66
fi

if [ ! -f "$applications_tsv_path" ]; then
  echo "Product threshold applications TSV not found" >&2
  exit 66
fi

IFS= read -r threshold_header < "$thresholds_csv_path" || {
  echo "Committed reviewed threshold CSV is empty" >&2
  exit 65
}
threshold_header="${threshold_header%$'\r'}"
expected_threshold_header="id,contaminant_key,authority_key,authority_name,threshold_name,threshold_url,threshold_value,threshold_unit,threshold_basis,concern_level_if_exceeded,effective_on,active,comparison_scope,normalized_value,normalized_unit,normalized_basis"
if [ "$threshold_header" != "$expected_threshold_header" ]; then
  echo "Committed reviewed threshold CSV must use the expected header" >&2
  exit 65
fi

IFS= read -r application_header < "$applications_tsv_path" || {
  echo "Committed reviewed threshold applications TSV is empty" >&2
  exit 65
}
application_header="${application_header%$'\r'}"
expected_application_header=$'threshold_id\tfood_id\tsupplement_id\treview_note'
if [ "$application_header" != "$expected_application_header" ]; then
  echo "Committed reviewed threshold applications TSV must use the expected header" >&2
  exit 65
fi

threshold_expected_rows="$(
  awk '
    NR > 1 {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$thresholds_csv_path"
)"

application_expected_rows="$(
  awk '
    NR > 1 {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$applications_tsv_path"
)"

if [ "$threshold_expected_rows" -le 0 ]; then
  echo "Committed reviewed threshold CSV prepared zero rows" >&2
  exit 65
fi

if [ "$application_expected_rows" -le 0 ]; then
  echo "Committed reviewed threshold applications TSV prepared zero rows" >&2
  exit 65
fi

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_reviewed_threshold_applications_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_reviewed_threshold_applications_import EXIT
prepare_labels_db_psql_env

work_dir=".product-tests-work/reviewed-threshold-applications"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
rendered_threshold_import_sql="$run_work_dir/import-thresholds.sql"
rendered_application_import_sql="$run_work_dir/import-threshold-applications.sql"
rendered_bundle_sql="$run_work_dir/import-reviewed-threshold-applications.sql"

awk \
  -v thresholds_csv="$(labels_db_psql_copy_literal "$thresholds_csv_path")" \
  '{ gsub(/__THRESHOLDS_CSV__/, thresholds_csv); print }' \
  "$script_dir/import-thresholds.sql" > "$rendered_threshold_import_sql"

awk \
  -v applications_tsv="$(labels_db_psql_copy_literal "$applications_tsv_path")" \
  '{ gsub(/__THRESHOLD_APPLICATIONS_TSV__/, applications_tsv); print }' \
  "$script_dir/import-threshold-applications.sql" > "$rendered_application_import_sql"

{
  cat <<SQL
\\set ON_ERROR_STOP on
BEGIN;
\\echo 'Applying product label and test schemas...'
SQL

  if [ "$legacy_supplement_db" = true ]; then
    printf '\\i %s/legacy-supplement-foods-stub.sql\n' "$script_dir"
  else
    printf '\\i apps/web/sql/foods/schema.sql\n'
    printf '\\i apps/web/sql/supplements/schema.sql\n'
  fi

  cat <<SQL
\\i $script_dir/schema.sql

\\echo 'Importing $threshold_expected_rows reviewed threshold prerequisite rows...'
\\set contaminant_threshold_import_standalone_transaction false
\\i $rendered_threshold_import_sql

\\echo 'Importing $application_expected_rows reviewed threshold application rows...'
\\set product_threshold_application_import_standalone_transaction false
\\set replace_applications true
\\i $rendered_application_import_sql

\\echo 'Deactivating orphaned reviewed threshold rows...'
UPDATE contaminant_thresholds thresholds
SET
  active = false,
  imported_at = now()
WHERE thresholds.active = true
  AND thresholds.comparison_scope = 'reviewed_application'
  AND NOT EXISTS (
    SELECT 1
    FROM product_contaminant_threshold_applications applications
    WHERE applications.threshold_id = thresholds.id
  );

\\echo 'Running reviewed threshold application postflight...'
\\set required_threshold_rows $threshold_expected_rows
\\set application_rows $application_expected_rows
\\i $script_dir/postflight-threshold-applications.sql
COMMIT;
SQL
} > "$rendered_bundle_sql"

echo "Importing reviewed threshold applications bundle..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -f "$rendered_bundle_sql"

echo "Imported reviewed threshold applications bundle."
