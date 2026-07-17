#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/audit-product-tests.sh

Runs a read-only, aggregate-only integrity audit of product test links and
measurement metadata. The command exits nonzero when an invariant fails.

Required env:
  MURPH_LABELS_DB_URL  Postgres URL for the labels database.

Optional env:
  PSQL_BIN             psql binary to use. Defaults to psql.
USAGE
}

if [ "$#" -gt 0 ]; then
  usage
  exit 64
fi

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"

cleanup_product_test_audit() {
  cleanup_labels_db_psql_env
}

trap cleanup_product_test_audit EXIT
prepare_labels_db_psql_env

echo "Auditing product tests..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -f "$script_dir_abs/audit-product-tests.sql"
echo "Product test audit passed."
