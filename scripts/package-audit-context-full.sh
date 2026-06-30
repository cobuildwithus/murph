#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
pnpm no-js
source scripts/repo-tools.config.sh

review_gpt_pr_ref="${REVIEW_GPT_PR_URL:-${REVIEW_GPT_PR_REF:-}}"
review_gpt_pr_context_dir="review-gpt-pr-context"
review_gpt_cleanup_pr_context=0

cleanup_review_gpt_pr_context() {
  if [[ "$review_gpt_cleanup_pr_context" == "1" ]]; then
    rm -rf "$review_gpt_pr_context_dir"
  fi
}
trap cleanup_review_gpt_pr_context EXIT

if [[ -n "$review_gpt_pr_ref" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh is required to add ReviewGPT PR diff artifacts." >&2
    exit 127
  fi

  rm -rf "$review_gpt_pr_context_dir"
  mkdir -p "$review_gpt_pr_context_dir"
  review_gpt_cleanup_pr_context=1

  gh pr diff "$review_gpt_pr_ref" --patch > "$review_gpt_pr_context_dir/pr.diff"
  gh pr diff "$review_gpt_pr_ref" --name-only > "$review_gpt_pr_context_dir/changed-files.txt"

  COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"$'\n'"$review_gpt_pr_context_dir/pr.diff"$'\n'"$review_gpt_pr_context_dir/changed-files.txt"
  COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$(cat "$review_gpt_pr_context_dir/changed-files.txt")"
  export COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS
fi

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
package_audit_context_bin="$(cobuild_repo_tool_bin cobuild-package-audit-context)"
if [[ "$review_gpt_cleanup_pr_context" == "1" ]]; then
  "$package_audit_context_bin" "$@"
else
  exec "$package_audit_context_bin" "$@"
fi
