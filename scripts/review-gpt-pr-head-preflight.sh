#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>" >&2
  exit 64
fi

pr_ref="$1"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh is required to verify the pushed PR head before packaging ReviewGPT artifacts." >&2
  exit 127
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: ReviewGPT PR preflight must run inside a git worktree." >&2
  exit 1
fi

dirty_status="$(git status --porcelain --untracked-files=all)"
if [[ -n "$dirty_status" ]]; then
  echo "Error: ReviewGPT PR attachment preflight requires a clean worktree before packaging pushed-head artifacts." >&2
  echo "$dirty_status" | sed -n '1,40p' >&2
  if [[ "$(printf '%s\n' "$dirty_status" | wc -l | tr -d ' ')" -gt 40 ]]; then
    echo "... additional dirty paths omitted" >&2
  fi
  exit 1
fi

local_head="$(git rev-parse --verify HEAD)"
pr_head="$(gh pr view "$pr_ref" --json headRefOid --jq '.headRefOid')"

if [[ ! "$pr_head" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Error: could not resolve pushed PR head SHA for $pr_ref." >&2
  exit 1
fi

if [[ "$local_head" != "$pr_head" ]]; then
  echo "Error: local HEAD does not match the pushed PR head." >&2
  echo "local HEAD: $local_head" >&2
  echo "PR head:    $pr_head" >&2
  exit 1
fi

echo "ReviewGPT PR attachment preflight passed for $pr_ref at $local_head."
