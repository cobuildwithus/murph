#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_REVIEW_GPT_ROOT="$ROOT_DIR/../review-gpt"
LOCAL_REVIEW_GPT_PACKAGE_JSON="$LOCAL_REVIEW_GPT_ROOT/package.json"
LOCAL_REVIEW_GPT_BIN="$LOCAL_REVIEW_GPT_ROOT/dist/bin.mjs"

if [[ -f "$LOCAL_REVIEW_GPT_PACKAGE_JSON" ]]; then
  if [[ ! -f "$LOCAL_REVIEW_GPT_BIN" ]]; then
    echo "Error: local ../review-gpt checkout found but dist/bin.mjs is missing. Run 'pnpm --dir ../review-gpt build' first." >&2
    exit 1
  fi
  exec node "$LOCAL_REVIEW_GPT_BIN" "$@"
fi

exec pnpm exec cobuild-review-gpt "$@"
