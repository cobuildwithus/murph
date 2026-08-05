#!/usr/bin/env bash

# Review the full current PR again when its total shape is large enough that a
# narrow correction packet could hide another material interaction. These
# thresholds intentionally count the whole PR, not only the latest correction.
readonly REVIEW_GPT_LARGE_PR_CHANGED_LINES_THRESHOLD=500
readonly REVIEW_GPT_LARGE_PR_CHANGED_FILES_THRESHOLD=10

review_gpt_load_pr_shape() {
  local pr_ref="$1"
  local pr_shape

  if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh is required to classify ReviewGPT PR context." >&2
    return 127
  fi
  if ! pr_shape="$(
    gh pr view "$pr_ref" \
      --json headRefOid,additions,deletions,changedFiles \
      --jq '[.headRefOid, .additions, .deletions, .changedFiles] | @tsv'
  )"; then
    echo "Error: could not resolve the current PR shape for ReviewGPT context." >&2
    return 1
  fi
  IFS=$'\t' read -r \
    review_gpt_pr_head_oid \
    review_gpt_pr_additions \
    review_gpt_pr_deletions \
    review_gpt_pr_changed_files <<< "$pr_shape"
  if [[ ! "$review_gpt_pr_head_oid" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$review_gpt_pr_additions" =~ ^[0-9]+$ ]] \
    || [[ ! "$review_gpt_pr_deletions" =~ ^[0-9]+$ ]] \
    || [[ ! "$review_gpt_pr_changed_files" =~ ^[0-9]+$ ]]; then
    echo "Error: ReviewGPT PR shape must contain a full head SHA and non-negative integer counts." >&2
    return 1
  fi
  review_gpt_pr_changed_lines=$((
    review_gpt_pr_additions + review_gpt_pr_deletions
  ))
}

review_gpt_default_full_review_reason() {
  if ((
    review_gpt_pr_changed_lines >= REVIEW_GPT_LARGE_PR_CHANGED_LINES_THRESHOLD
      || review_gpt_pr_changed_files >= REVIEW_GPT_LARGE_PR_CHANGED_FILES_THRESHOLD
  )); then
    printf \
      'Automatic full audit: current PR has %d changed lines across %d files; the cutoff is %d lines or %d files.\n' \
      "$review_gpt_pr_changed_lines" \
      "$review_gpt_pr_changed_files" \
      "$REVIEW_GPT_LARGE_PR_CHANGED_LINES_THRESHOLD" \
      "$REVIEW_GPT_LARGE_PR_CHANGED_FILES_THRESHOLD"
  fi
}
