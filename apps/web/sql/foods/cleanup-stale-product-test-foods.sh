#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/foods/cleanup-stale-product-test-foods.sh [--dry-run|--apply]

Validates and removes the two retired food rows whose identities or provenance
do not match the tested PlasticList products. The default is a transactional
dry run. Pass --apply explicitly to commit validated deletions.

The cleanup is replay-safe when an exact expected row is already absent. It
aborts if an expected id or source identity has divergent provenance, if any
product_tests row still links to either food, or if the exact delete count
changes during the transaction.

Required env:
  MURPH_LABELS_DB_URL  Postgres URL for the labels database.

Optional env:
  PSQL_BIN             psql binary to use. Defaults to psql.

The runner prints aggregate counts only and never prints the database URL or
passes it to psql argv.
USAGE
}

apply=false
case "$#" in
  0)
    ;;
  1)
    case "$1" in
      --dry-run)
        apply=false
        ;;
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

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
product_tests_script_dir_abs="$script_dir_abs/../product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$product_tests_script_dir_abs/labels-db-psql.sh"

cleanup_stale_product_test_foods() {
  cleanup_labels_db_psql_env
}

trap cleanup_stale_product_test_foods EXIT
prepare_labels_db_psql_env

if [ "$apply" = true ]; then
  echo "Validating and applying stale food cleanup..."
else
  echo "Validating stale food cleanup (dry run)..."
fi

summary_output="$(run_labels_psql \
  -qAt \
  -v ON_ERROR_STOP=1 \
  -v stale_food_cleanup_apply="$apply" \
  -f "$script_dir_abs/cleanup-stale-product-test-foods.sql")"

if [ -n "$summary_output" ]; then
  printf '%s\n' "$summary_output"
fi

if [ "$apply" = true ]; then
  echo "Applied stale food cleanup."
else
  echo "Stale food cleanup dry run passed; no database changes were committed."
fi
