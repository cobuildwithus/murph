#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: apps/web/sql/supplements/repair-data-quality-2026-07.sh [--dry-run|--apply]

Replays the exact, one-time supplement repairs recorded in the July 2026 data
audit. Dry-run is the default and rolls the transaction back. Every target is
hash-guarded, so rerunning after a successful apply intentionally fails closed.

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
. "$script_dir/../product-tests/labels-db-psql.sh"
trap cleanup_labels_db_psql_env EXIT
prepare_labels_db_psql_env

if [ "$apply" = true ]; then
  echo "Applying supplement data-quality repair."
else
  echo "Dry-run: supplement data-quality repair will roll back."
fi

run_labels_psql \
  -v supplement_data_repair_apply="$apply" \
  -f "$script_dir/repair-data-quality-2026-07.sql"
