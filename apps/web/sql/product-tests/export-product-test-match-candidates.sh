#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/export-product-test-match-candidates.sh

Exports reviewed-remap candidate rows for source-only product_tests.

Required env:
  MURPH_LABELS_DB_URL                         Postgres URL for the labels database.
  PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH      Repo-relative output TSV path.

Optional env:
  PRODUCT_TEST_MATCH_SOURCE_KEY               Limit export to one product_tests.source_key.
  PRODUCT_TEST_MATCH_CANDIDATE_LIMIT          Candidates per source product. Defaults to 5.
  PSQL_BIN                                    psql binary to use. Defaults to psql.

This is read-only. Confirmed links must still be copied into a reviewed remap
TSV and applied with import-product-test-remaps.sh.
USAGE
}

if [ "$#" -gt 0 ]; then
  usage
  exit 64
fi

candidates_tsv_path="${PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH:-}"
source_key_filter="${PRODUCT_TEST_MATCH_SOURCE_KEY:-}"
candidate_limit="${PRODUCT_TEST_MATCH_CANDIDATE_LIMIT:-5}"

if [ -z "$candidates_tsv_path" ]; then
  echo "PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH is required" >&2
  exit 64
fi

case "$candidates_tsv_path" in
  /*|../*|*/../*|..)
    echo "PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH must be repo-relative" >&2
    exit 64
    ;;
esac

case "$candidate_limit" in
  ''|*[!0-9]*)
    echo "PRODUCT_TEST_MATCH_CANDIDATE_LIMIT must be a positive integer" >&2
    exit 64
    ;;
esac

if [ "$candidate_limit" -lt 1 ] || [ "$candidate_limit" -gt 25 ]; then
  echo "PRODUCT_TEST_MATCH_CANDIDATE_LIMIT must be between 1 and 25" >&2
  exit 64
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_product_test_match_candidates_export() {
  cleanup_labels_db_psql_env
}

trap cleanup_product_test_match_candidates_export EXIT
prepare_labels_db_psql_env

cd "$repo_root"

mkdir -p "$(dirname "$candidates_tsv_path")"

work_dir=".product-tests-work/product-test-match-candidates"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
candidate_tmp="$run_work_dir/candidates.tsv"

echo "Exporting product test match candidates..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v source_key_filter="$source_key_filter" \
  -v candidate_limit="$candidate_limit" \
  -f "$script_dir/export-product-test-match-candidates.sql" > "$candidate_tmp"
mv "$candidate_tmp" "$candidates_tsv_path"

echo "Exported product test match candidates."
