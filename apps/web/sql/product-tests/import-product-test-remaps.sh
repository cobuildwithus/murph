#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-product-test-remaps.sh [--apply]

Validates reviewed product-test remaps against product_tests. The default is a
transactional dry run. Pass --apply explicitly to persist validated mutations.

Required env:
  MURPH_LABELS_DB_URL            Postgres URL for the labels database.
  PRODUCT_TEST_REMAPS_TSV_PATH   Repo-relative TSV path.

Optional env:
  PSQL_BIN                       psql binary to use. Defaults to psql.

The TSV columns are: source_key, tested_source_product_id, tested_product_name,
tested_product_brand, tested_product_upc, tested_package_size, source_fingerprint,
expected_current_state_fingerprint, food_id, supplement_id, target_fingerprint,
match_method, source_id_namespace, review_note. Use source_only with blank product
ids and a blank target fingerprint.
Use exact_upc, exact_source_id, or manual_confirmed with exactly one product id.
exact_source_id additionally requires a mechanically verifiable namespace.

An apply writes a private, ignored preimage/postimage mutation manifest under
.product-tests-work/. The runner prints aggregate counts only and never prints
the database URL or passes it to psql argv.
USAGE
}

apply=false
case "$#" in
  0)
    ;;
  1)
    case "$1" in
      --apply)
        apply=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage
        exit 64
        ;;
    esac
    ;;
  *)
    usage
    exit 64
    ;;
esac

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

expected_header=$'source_key\ttested_source_product_id\ttested_product_name\ttested_product_brand\ttested_product_upc\ttested_package_size\tsource_fingerprint\texpected_current_state_fingerprint\tfood_id\tsupplement_id\ttarget_fingerprint\tmatch_method\tsource_id_namespace\treview_note'
IFS= read -r actual_header < "$remaps_tsv_path" || true
actual_header="${actual_header%$'\r'}"
if [ "$actual_header" != "$expected_header" ]; then
  echo "Product test remaps TSV header does not match the reviewed import contract" >&2
  exit 65
fi

if ! awk 'NR > 1 && /[^[:space:]]/ { found = 1; exit } END { exit found ? 0 : 1 }' "$remaps_tsv_path"; then
  echo "Product test remaps TSV has no data rows; refusing to validate labels database." >&2
  exit 65
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"
manifest_tsv=""
manifest_complete=false
run_work_dir=""

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_product_test_remaps_import() {
  if [ "$apply" = true ] && [ "$manifest_complete" = false ] && [ -n "$manifest_tsv" ]; then
    rm -f "$manifest_tsv"
  fi
  if [ -n "$run_work_dir" ]; then
    rm -rf "$run_work_dir"
  fi
  cleanup_labels_db_psql_env
}

trap cleanup_product_test_remaps_import EXIT
prepare_labels_db_psql_env

cd "$repo_root"
umask 077

work_dir=".product-tests-work/product-test-remaps"
mkdir -p "$work_dir"
chmod 700 "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
rendered_import_sql="$run_work_dir/import-product-test-remaps.sql"
manifest_tsv="$run_work_dir/dry-run-unused.tsv"

if [ "$apply" = true ]; then
  manifest_dir="$work_dir/manifests"
  mkdir -p "$manifest_dir"
  chmod 700 "$manifest_dir"
  manifest_tsv="$(mktemp "$manifest_dir/mutation.$(date -u +%Y%m%dT%H%M%SZ).tsv.XXXXXX")"
  chmod 600 "$manifest_tsv"
fi

awk \
  -v remaps_tsv="$(labels_db_psql_copy_literal "$remaps_tsv_path")" \
  -v manifest_tsv="$(labels_db_psql_copy_literal "$manifest_tsv")" \
  '{
    gsub(/__REMAPS_TSV__/, remaps_tsv)
    gsub(/__MANIFEST_TSV__/, manifest_tsv)
    print
  }' \
  "$script_dir/import-product-test-remaps.sql" > "$rendered_import_sql"
chmod 600 "$rendered_import_sql"

if [ "$apply" = true ]; then
  echo "Validating and applying product test remaps..."
else
  echo "Validating product test remaps (dry run)..."
fi

summary_output="$(run_labels_psql \
  -qAt \
  -v ON_ERROR_STOP=1 \
  -v remap_apply="$apply" \
  -f "$rendered_import_sql")"

if [ -n "$summary_output" ]; then
  printf '%s\n' "$summary_output"
fi

if [ "$apply" = true ]; then
  chmod 600 "$manifest_tsv"
  manifest_complete=true
  echo "Applied product test remaps; private mutation manifest written."
else
  echo "Product test remap dry run passed; no database changes were committed."
fi
