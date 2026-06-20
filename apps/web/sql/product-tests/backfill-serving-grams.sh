#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: apps/web/sql/product-tests/backfill-serving-grams.sh [--dry-run|--apply]

Backfills foods.serving_grams and supplements.serving_grams from deterministic
gram evidence only. Dry-run is the default and rolls the transaction back.

Required env:
  MURPH_LABELS_DB_URL  Postgres URL for the labels database.
USAGE
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apply=false

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

trap cleanup_labels_db_psql_env EXIT
prepare_labels_db_psql_env

if [ "$apply" = true ]; then
  echo "Applying strict serving_grams backfill."
else
  echo "Dry-run: strict serving_grams backfill will roll back."
fi

run_labels_psql \
  -v serving_grams_backfill_apply="$apply" \
  -f "$script_dir/backfill-serving-grams.sql"
