#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source scripts/repo-tools.config.sh

fail_on_issues=0
for arg in "$@"; do
  case "$arg" in
    --fail-on-issues)
      fail_on_issues=1
      ;;
  esac
done

if [[ "${FAIL_ON_DOC_ISSUES:-0}" == "1" ]]; then
  fail_on_issues=1
fi

DOC_GARDENING_FAIL_ON_ISSUES="$fail_on_issues" node scripts/doc-gardening-report.mjs
