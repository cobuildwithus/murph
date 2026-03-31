#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
pnpm no-js
source scripts/repo-tools.config.sh
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS=''
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "config" \
  "packages" \
  "src" \
  "app" \
  "apps" \
  "contracts" \
  "scripts" \
  "docs"
exec "$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"
