#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
  scripts/review-gpt-pr-head-preflight.sh --run [review-gpt arguments...]
EOF
  exit 64
}

review_gpt_require_pr_head() {
  local pr_ref="$1"
  local dirty_status
  local local_head
  local pr_head

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
}

review_gpt_phase_for_preset() {
  case "$1" in
    completion-specialists | completion-review | specialist-review | prompt-frontend-coverage)
      printf 'preliminary\n'
      ;;
    pr-review | pr-deep-review | deep-pr-review | pr-bugs-and-architecture)
      printf 'final\n'
      ;;
  esac
}

review_gpt_detect_pr_phase() {
  local argument
  local detected_phase=""
  local phase
  local positional_presets=1
  local preset_token
  local preset_value
  local read_preset_value=0

  for argument in "$@"; do
    preset_value=""
    if [[ "$read_preset_value" == "1" ]]; then
      preset_value="$argument"
      read_preset_value=0
    elif [[ "$argument" == "--preset" ]]; then
      read_preset_value=1
      positional_presets=0
      continue
    elif [[ "$argument" == --preset=* ]]; then
      preset_value="${argument#--preset=}"
      positional_presets=0
    elif [[ "$positional_presets" == "1" && "$argument" != -* ]]; then
      preset_value="$argument"
    elif [[ "$argument" == -* ]]; then
      positional_presets=0
    fi

    [[ -z "$preset_value" ]] && continue
    while IFS= read -r preset_token; do
      [[ -z "$preset_token" ]] && continue
      phase="$(review_gpt_phase_for_preset "$preset_token")"
      [[ -z "$phase" ]] && continue
      if [[ -n "$detected_phase" && "$detected_phase" != "$phase" ]]; then
        echo "Error: preliminary and final PR ReviewGPT presets cannot run together." >&2
        exit 64
      fi
      detected_phase="$phase"
    done < <(printf '%s\n' "$preset_value" | tr ',' '\n')
  done

  printf '%s\n' "$detected_phase"
}

review_gpt_run() {
  local detected_phase
  local explicit_phase="${REVIEW_GPT_REVIEW_PHASE:-}"
  local pr_ref="${REVIEW_GPT_PR_URL:-${REVIEW_GPT_PR_REF:-}}"

  detected_phase="$(review_gpt_detect_pr_phase "$@")"
  if [[ -n "$detected_phase" ]]; then
    if [[ -n "$explicit_phase" && "$explicit_phase" != "$detected_phase" ]]; then
      echo "Error: REVIEW_GPT_REVIEW_PHASE=$explicit_phase conflicts with the selected $detected_phase PR review preset." >&2
      exit 64
    fi
    if [[ -z "$pr_ref" ]]; then
      if ! command -v gh >/dev/null 2>&1; then
        echo "Error: gh is required to resolve the current branch PR for ReviewGPT." >&2
        exit 127
      fi
      pr_ref="$(gh pr view --json number --jq '.number')"
    fi
    if [[ -z "$pr_ref" ]]; then
      echo "Error: could not resolve a PR for the current branch." >&2
      exit 1
    fi
    review_gpt_require_pr_head "$pr_ref"
    export REVIEW_GPT_PR_URL="$pr_ref"
    export REVIEW_GPT_REVIEW_PHASE="$detected_phase"
  fi

  exec pnpm exec cobuild-review-gpt --config scripts/review-gpt.config.sh "$@"
}

if [[ "${1:-}" == "--run" ]]; then
  shift
  review_gpt_run "$@"
fi

if [[ "$#" -ne 1 ]]; then
  usage
fi

review_gpt_require_pr_head "$1"
