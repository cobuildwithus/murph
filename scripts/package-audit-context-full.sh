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
  review_gpt_base_ref="$(
    gh pr view "$review_gpt_pr_ref" --json baseRefName --jq '.baseRefName'
  )"
  review_gpt_base_oid="$(
    gh pr view "$review_gpt_pr_ref" --json baseRefOid --jq '.baseRefOid'
  )"
  review_gpt_head_oid="$(
    gh pr view "$review_gpt_pr_ref" --json headRefOid --jq '.headRefOid'
  )"
  if [[ ! "$review_gpt_base_oid" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$review_gpt_head_oid" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: could not resolve PR base/head SHAs for ReviewGPT PR context." >&2
    exit 1
  fi

  if ! gh pr diff "$review_gpt_pr_ref" --patch > "$review_gpt_pr_context_dir/pr.diff"; then
    echo "Warning: gh pr diff failed; falling back to a local pushed-head git diff." >&2
    rm -f "$review_gpt_pr_context_dir/pr.diff"
    if ! git cat-file -e "$review_gpt_base_oid^{commit}" >/dev/null 2>&1; then
      git fetch --quiet origin "$review_gpt_base_ref"
    fi
    if ! git cat-file -e "$review_gpt_head_oid^{commit}" >/dev/null 2>&1; then
      echo "Error: local worktree does not contain pushed PR head $review_gpt_head_oid." >&2
      exit 1
    fi
    git diff --patch "$review_gpt_base_oid...$review_gpt_head_oid" \
      > "$review_gpt_pr_context_dir/pr.diff"
  fi
  if ! gh pr diff "$review_gpt_pr_ref" --name-only > "$review_gpt_pr_context_dir/changed-files.txt"; then
    echo "Warning: gh pr diff --name-only failed; falling back to local changed-file list." >&2
    git diff --name-only "$review_gpt_base_oid...$review_gpt_head_oid" \
      > "$review_gpt_pr_context_dir/changed-files.txt"
  fi

  COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"$'\n'"$review_gpt_pr_context_dir/pr.diff"$'\n'"$review_gpt_pr_context_dir/changed-files.txt"
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
