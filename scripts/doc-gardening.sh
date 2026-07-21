#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source scripts/repo-tools.config.sh

fail_on_issues=0
upstream_args=()
for arg in "$@"; do
  case "$arg" in
    --fail-on-issues)
      fail_on_issues=1
      ;;
    *)
      upstream_args+=("$arg")
      ;;
  esac
done

if [[ "${FAIL_ON_DOC_ISSUES:-0}" == "1" ]]; then
  fail_on_issues=1
fi

set +e
if [[ "${#upstream_args[@]}" -gt 0 ]]; then
  upstream_output="$(
    FAIL_ON_DOC_ISSUES=0 "$(cobuild_repo_tool_bin cobuild-doc-gardening)" "${upstream_args[@]}"
  )"
else
  upstream_output="$(
    FAIL_ON_DOC_ISSUES=0 "$(cobuild_repo_tool_bin cobuild-doc-gardening)"
  )"
fi
upstream_status=$?
set -e
if [[ "$upstream_status" -ne 0 ]]; then
  printf '%s\n' "$upstream_output"
  exit "$upstream_status"
fi

DOC_GARDENING_FAIL_ON_ISSUES="$fail_on_issues" node scripts/doc-gardening-report.mjs
