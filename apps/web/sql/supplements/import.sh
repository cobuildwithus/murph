#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/supplements/import.sh

Imports DSLD supplement label NDJSON into the labels DB supplements table.

Required env:
  DSLD_NDJSON_PATH    Path to the DSLD label NDJSON file.
  MURPH_LABELS_DB_URL Postgres URL for the labels database.

Optional env:
  PSQL_BIN            psql binary to use. Defaults to psql.

The runner applies the supplements schema and the normal DSLD importer. It
never prints the database URL.
USAGE
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    usage
    exit 64
    ;;
esac

if [ -z "${MURPH_LABELS_DB_URL:-}" ]; then
  echo "MURPH_LABELS_DB_URL is required" >&2
  exit 64
fi

if [ -z "${DSLD_NDJSON_PATH:-}" ]; then
  echo "DSLD_NDJSON_PATH is required" >&2
  exit 64
fi

if [ ! -f "$DSLD_NDJSON_PATH" ]; then
  echo "DSLD_NDJSON_PATH file not found" >&2
  exit 66
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
product_tests_script_dir_abs="$repo_root/apps/web/sql/product-tests"

case "$DSLD_NDJSON_PATH" in
  /*) ;;
  *) DSLD_NDJSON_PATH="$PWD/$DSLD_NDJSON_PATH" ;;
esac
export DSLD_NDJSON_PATH
export REVIEWED_SERVING_GRAMS_TSV_PATH="${REVIEWED_SERVING_GRAMS_TSV_PATH:-$product_tests_script_dir_abs/reviewed-serving-grams.tsv}"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$product_tests_script_dir_abs/labels-db-psql.sh"

trap cleanup_labels_db_psql_env EXIT
prepare_labels_db_psql_env

run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir_abs/schema.sql"
run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir_abs/import.sql"
