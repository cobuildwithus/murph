#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
pnpm no-js
source scripts/repo-tools.config.sh

review_gpt_pr_context_dir="$ROOT_DIR/docs/review-gpt-pr-context"
review_gpt_pr_context_backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-review-gpt-pr-context.XXXXXX")"

cleanup_review_gpt_pr_context() {
  rm -rf "$review_gpt_pr_context_dir"
  mkdir -p "$review_gpt_pr_context_dir"
  cp -R "$review_gpt_pr_context_backup_dir"/. "$review_gpt_pr_context_dir"/
  rm -rf "$review_gpt_pr_context_backup_dir"
}

write_review_gpt_pr_context() {
  if ! command -v gh >/dev/null 2>&1; then
    return
  fi

  review_gpt_pr_fields() {
    gh pr view "$@" \
      --json number,url,title,baseRefName,baseRefOid,headRefName,headRefOid \
      --jq '[.number,.url,.title,.baseRefName,.baseRefOid,.headRefName,.headRefOid] | @tsv' \
      2>/dev/null || true
  }

  local pr_fields
  pr_fields="$(review_gpt_pr_fields)"

  if [[ -z "$pr_fields" ]]; then
    local upstream_ref upstream_branch
    upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    upstream_branch="${upstream_ref#*/}"
    if [[ -n "$upstream_branch" && "$upstream_branch" != "$upstream_ref" ]]; then
      pr_fields="$(review_gpt_pr_fields "$upstream_branch")"
    fi
  fi

  if [[ -z "$pr_fields" ]]; then
    return
  fi

  local pr_number pr_url pr_title base_ref base_oid head_ref head_oid
  IFS=$'\t' read -r pr_number pr_url pr_title base_ref base_oid head_ref head_oid <<<"$pr_fields"

  if [[ ! "$base_oid" =~ ^[0-9a-f]{40}$ || ! "$head_oid" =~ ^[0-9a-f]{40}$ ]]; then
    return
  fi

  local diff_base
  diff_base="$(git merge-base "$base_oid" "$head_oid" 2>/dev/null || true)"
  if [[ -z "$diff_base" ]]; then
    diff_base="$base_oid"
  fi

  {
    printf '# ReviewGPT PR Context\n\n'
    printf 'PR: #%s\n' "$pr_number"
    printf 'URL: %s\n' "$pr_url"
    printf 'Title: %s\n' "$pr_title"
    printf 'Base ref: %s\n' "$base_ref"
    printf 'Head ref: %s\n' "$head_ref"
    printf 'Base comparison SHA: %s\n' "$diff_base"
    printf 'Head SHA: %s\n' "$head_oid"
  } > "$review_gpt_pr_context_dir/README.md"

  git diff --no-ext-diff --find-renames --find-copies "$diff_base..$head_oid" -- \
    > "$review_gpt_pr_context_dir/pr.diff.patch"
  git diff --no-ext-diff --name-status "$diff_base..$head_oid" -- \
    > "$review_gpt_pr_context_dir/touched-files.txt"
  git log --no-decorate --oneline "$diff_base..$head_oid" -- \
    > "$review_gpt_pr_context_dir/commit-history.txt"
}

trap cleanup_review_gpt_pr_context EXIT

cp -R "$review_gpt_pr_context_dir"/. "$review_gpt_pr_context_backup_dir"/

write_review_gpt_pr_context

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
"$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"
