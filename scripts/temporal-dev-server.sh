#!/usr/bin/env bash
set -euo pipefail

if ! command -v temporal >/dev/null 2>&1; then
  echo "Temporal CLI is required for pnpm temporal:dev." >&2
  echo "Install the Temporal CLI, then rerun pnpm temporal:dev." >&2
  exit 127
fi

namespace="${TEMPORAL_NAMESPACE:-default}"
ip="${TEMPORAL_DEV_IP:-127.0.0.1}"
port="${TEMPORAL_DEV_PORT:-7233}"

exec temporal server start-dev \
  --namespace "$namespace" \
  --ip "$ip" \
  --port "$port"
