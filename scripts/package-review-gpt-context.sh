#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm no-js
source scripts/repo-tools.config.sh

append_audit_context_lines() {
  local variable_name="$1"
  shift
  local current_value
  local line
  local -a values=()

  current_value="$(printenv "$variable_name" 2>/dev/null || true)"
  if [[ -n "$current_value" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && values+=("$line")
    done <<<"$current_value"
  fi

  values+=("$@")
  repo_tools_join_lines "$variable_name" "${values[@]}"
}

if [[ "${MURPH_REVIEW_GPT_CONTEXT_FULL:-0}" =~ ^(1|true|yes|on)$ ]]; then
  export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="${COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS:-}"
  repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
    "config" \
    "packages" \
    "src" \
    "app" \
    "apps" \
    "contracts" \
    "scripts" \
    "docs"
fi

append_audit_context_lines COBUILD_AUDIT_CONTEXT_PRUNE_DIR_NAMES \
  "output-packages"

append_audit_context_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
  "output-packages/**" \
  "packages/health-commons/content/**" \
  "packages/health-commons/generated/**"

"$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@" \
  2> >(sed '/^Warning: excluding path from audit package: /d' >&2)
