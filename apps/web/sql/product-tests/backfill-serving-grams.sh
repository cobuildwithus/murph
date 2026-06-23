#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: apps/web/sql/product-tests/backfill-serving-grams.sh [--dry-run|--apply]

Backfills foods.serving_grams and supplements.serving_grams from deterministic
gram evidence only. Dry-run is the default and rolls the transaction back.

Required env:
  MURPH_LABELS_DB_URL  Postgres URL for the labels database.

Optional env:
  REVIEWED_SERVING_GRAMS_TSV_PATH  Reviewed exact-label serving grams TSV.
USAGE
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apply=false
reviewed_serving_grams_tsv_path="${REVIEWED_SERVING_GRAMS_TSV_PATH:-$script_dir/reviewed-serving-grams.tsv}"

while [ "$#" -gt 0 ]; do
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
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir/labels-db-psql.sh"

prepared_sql=""

cleanup() {
  cleanup_labels_db_psql_env
  if [ -n "$prepared_sql" ]; then
    rm -f "$prepared_sql"
    prepared_sql=""
  fi
}

trap cleanup EXIT
prepare_labels_db_psql_env

if [ ! -f "$reviewed_serving_grams_tsv_path" ]; then
  echo "Reviewed serving grams TSV not found" >&2
  exit 66
fi

if [ "$apply" = true ]; then
  echo "Applying serving_grams backfill."
else
  echo "Dry-run: serving_grams backfill will roll back."
fi

reviewed_serving_grams_tsv_literal="$(labels_db_psql_copy_literal "$reviewed_serving_grams_tsv_path")"
prepared_sql="$(mktemp "${TMPDIR:-/tmp}/murph-serving-grams-backfill.XXXXXX.sql")"
sed \
  "s#__REVIEWED_SERVING_GRAMS_TSV__#$reviewed_serving_grams_tsv_literal#g" \
  "$script_dir/backfill-serving-grams.sql" > "$prepared_sql"

run_labels_psql \
  -v serving_grams_backfill_apply="$apply" \
  -f "$prepared_sql"
