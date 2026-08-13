#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
review_gpt_repo_root_absolute="$(realpath -q "$ROOT_DIR")"
pnpm no-js
source scripts/repo-tools.config.sh
# shellcheck source=review-gpt-context-policy.sh
source scripts/review-gpt-context-policy.sh

review_gpt_pr_ref="${REVIEW_GPT_PR_URL:-${REVIEW_GPT_PR_REF:-}}"
review_gpt_pr_context_dir="review-gpt-pr-context"
review_gpt_cleanup_pr_context=0
review_gpt_review_phase="${REVIEW_GPT_REVIEW_PHASE:-final}"
review_gpt_round_number="${REVIEW_GPT_ROUND_NUMBER:-}"
review_gpt_first_reviewed_head="${REVIEW_GPT_FIRST_REVIEWED_HEAD:-}"
review_gpt_previous_reviewed_head="${REVIEW_GPT_PREVIOUS_REVIEWED_HEAD:-}"
review_gpt_context_anchor_head="${REVIEW_GPT_CONTEXT_ANCHOR_HEAD:-}"
review_gpt_rendered_evidence_paths="${REVIEW_GPT_RENDERED_EVIDENCE_PATHS:-}"
review_gpt_supplemental_evidence_paths="${REVIEW_GPT_SUPPLEMENTAL_EVIDENCE_PATHS:-}"
review_gpt_full_review_reason="${REVIEW_GPT_FULL_REVIEW_REASON:-}"
review_gpt_expected_pr_body_path="${REVIEW_GPT_EXPECTED_PR_BODY_PATH:-}"
review_gpt_expected_pr_body_sha256="${REVIEW_GPT_EXPECTED_PR_BODY_SHA256:-}"
review_gpt_context_mode="full_snapshot"
review_gpt_pr_touches_health_commons=0

if [[ -n "$review_gpt_full_review_reason" ]] \
  && [[ -z "${review_gpt_full_review_reason//[[:space:]]/}" ]]; then
  echo "Error: REVIEW_GPT_FULL_REVIEW_REASON must contain a concrete reason." >&2
  exit 1
fi

review_gpt_require_full_sha() {
  local label="$1"
  local commit="$2"
  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: $label must be a full lowercase 40-character commit SHA." >&2
    exit 1
  fi
}

review_gpt_require_available_commit() {
  local label="$1"
  local commit="$2"
  review_gpt_require_full_sha "$label" "$commit"
  if ! git cat-file -e "$commit^{commit}" >/dev/null 2>&1; then
    echo "Error: $label commit is not available locally." >&2
    exit 1
  fi
}

review_gpt_validate_expected_pr_body() {
  local actual_sha256
  local body_bytes
  local body_realpath

  if [[ "$review_gpt_expected_pr_body_path" != "audit-packages/frog-autofix-pr-body.md" ]] \
    || [[ ! "$review_gpt_expected_pr_body_sha256" =~ ^[0-9a-f]{64}$ ]] \
    || [[ ! -f "$review_gpt_expected_pr_body_path" ]] \
    || [[ -L "$review_gpt_expected_pr_body_path" ]]; then
    echo "Error: expected ReviewGPT PR body evidence is invalid." >&2
    exit 1
  fi
  if ! body_realpath="$(realpath -q "$review_gpt_expected_pr_body_path")" \
    || [[ "$body_realpath" != "$review_gpt_repo_root_absolute/$review_gpt_expected_pr_body_path" ]]; then
    echo "Error: expected ReviewGPT PR body evidence escaped its checkout." >&2
    exit 1
  fi
  body_bytes="$(wc -c < "$review_gpt_expected_pr_body_path" | tr -d '[:space:]')"
  if [[ ! "$body_bytes" =~ ^[0-9]+$ ]] || (( body_bytes > 32768 )); then
    echo "Error: expected ReviewGPT PR body evidence exceeds its bound." >&2
    exit 1
  fi
  if command -v shasum >/dev/null 2>&1; then
    actual_sha256="$(shasum -a 256 "$review_gpt_expected_pr_body_path" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual_sha256="$(sha256sum "$review_gpt_expected_pr_body_path" | awk '{print $1}')"
  else
    echo "Error: no SHA-256 utility is available for ReviewGPT PR body evidence." >&2
    exit 127
  fi
  if [[ "$actual_sha256" != "$review_gpt_expected_pr_body_sha256" ]]; then
    echo "Error: expected ReviewGPT PR body evidence changed before packaging." >&2
    exit 1
  fi
}

review_gpt_is_ancestor() {
  if git merge-base --is-ancestor "$1" "$2"; then
    printf 'true'
  else
    printf 'false'
  fi
}

review_gpt_add_rendered_evidence() {
  local evidence_manifest="$review_gpt_pr_context_dir/rendered-evidence.txt"
  local evidence_absolute_path
  local evidence_index=0
  local evidence_package_dir="$review_gpt_pr_context_dir/rendered-evidence"
  local evidence_package_name
  local evidence_package_path
  local evidence_path

  rm -rf "$evidence_package_dir"
  mkdir -p "$evidence_package_dir"
  : > "$evidence_manifest"
  while IFS= read -r evidence_path; do
    [[ -z "$evidence_path" ]] && continue
    case "$evidence_path" in
      /* | .. | ../* | */../* | */..)
        echo "Error: ReviewGPT rendered evidence paths must be repo-relative and boundary-safe." >&2
        exit 1
        ;;
    esac
    case "$evidence_path" in
      .artifacts/review-gpt/* | audit-packages/*) ;;
      *)
        echo "Error: ReviewGPT rendered evidence must stay under .artifacts/review-gpt/ or audit-packages/." >&2
        exit 1
        ;;
    esac
    case "$evidence_path" in
      *.png | *.jpg | *.jpeg | *.webp) ;;
      *)
        echo "Error: ReviewGPT rendered evidence must be a PNG, JPEG, or WebP image." >&2
        exit 1
        ;;
    esac
    if [[ ! -f "$evidence_path" ]] || [[ -L "$evidence_path" ]]; then
      echo "Error: ReviewGPT rendered evidence must be a regular non-symlink file: $evidence_path" >&2
      exit 1
    fi
    if ! evidence_absolute_path="$(realpath -q "$evidence_path")"; then
      echo "Error: ReviewGPT rendered evidence path could not be resolved: $evidence_path" >&2
      exit 1
    fi
    case "$evidence_absolute_path" in
      "$review_gpt_repo_root_absolute"/.artifacts/review-gpt/* \
        | "$review_gpt_repo_root_absolute"/audit-packages/*) ;;
      *)
        echo "Error: ReviewGPT rendered evidence must resolve inside an allowed artifact directory." >&2
        exit 1
        ;;
    esac
    evidence_index=$((evidence_index + 1))
    printf -v evidence_package_name '%02d-%s' \
      "$evidence_index" \
      "$(basename "$evidence_path")"
    evidence_package_path="$evidence_package_dir/$evidence_package_name"
    cp -- "$evidence_path" "$evidence_package_path"
    printf '%s\n' "$evidence_package_path" >> "$evidence_manifest"
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$evidence_package_path"
  done <<< "$review_gpt_rendered_evidence_paths"
}

review_gpt_add_supplemental_evidence() {
  local evidence_absolute_path
  local evidence_count=0
  local evidence_manifest="$review_gpt_pr_context_dir/supplemental-evidence.txt"
  local evidence_package_dir="$review_gpt_pr_context_dir/supplemental-evidence"
  local evidence_package_name
  local evidence_package_path
  local evidence_path
  local evidence_size
  local evidence_total_bytes=0

  rm -rf "$evidence_package_dir"
  mkdir -p "$evidence_package_dir"
  : > "$evidence_manifest"
  while IFS= read -r evidence_path; do
    [[ -z "$evidence_path" ]] && continue
    case "$evidence_path" in
      /* | .. | ../* | */../* | */..)
        echo "Error: ReviewGPT supplemental evidence paths must be repo-relative and boundary-safe." >&2
        exit 1
        ;;
    esac
    case "$evidence_path" in
      .artifacts/review-gpt/* | audit-packages/*) ;;
      *)
        echo "Error: ReviewGPT supplemental evidence must stay under .artifacts/review-gpt/ or audit-packages/." >&2
        exit 1
        ;;
    esac
    case "$evidence_path" in
      *.md | *.txt | *.json | *.ts | *.tsx | *.js | *.mjs | *.cjs | *.sh) ;;
      *)
        echo "Error: ReviewGPT supplemental evidence must be a supported text or code file." >&2
        exit 1
        ;;
    esac
    if [[ ! -f "$evidence_path" ]] || [[ -L "$evidence_path" ]]; then
      echo "Error: ReviewGPT supplemental evidence must be a regular non-symlink file: $evidence_path" >&2
      exit 1
    fi
    if ! evidence_absolute_path="$(realpath -q "$evidence_path")"; then
      echo "Error: ReviewGPT supplemental evidence path could not be resolved: $evidence_path" >&2
      exit 1
    fi
    case "$evidence_absolute_path" in
      "$review_gpt_repo_root_absolute"/.artifacts/review-gpt/* \
        | "$review_gpt_repo_root_absolute"/audit-packages/*) ;;
      *)
        echo "Error: ReviewGPT supplemental evidence must resolve inside an allowed artifact directory." >&2
        exit 1
        ;;
    esac
    evidence_count=$((evidence_count + 1))
    if (( evidence_count > 12 )); then
      echo "Error: ReviewGPT supplemental evidence is limited to 12 explicit files." >&2
      exit 1
    fi
    evidence_size="$(wc -c < "$evidence_path" | tr -d '[:space:]')"
    evidence_total_bytes=$((evidence_total_bytes + evidence_size))
    if (( evidence_total_bytes > 2097152 )); then
      echo "Error: ReviewGPT supplemental evidence is limited to 2 MiB in total." >&2
      exit 1
    fi
    printf -v evidence_package_name '%02d-%s' \
      "$evidence_count" \
      "$(basename "$evidence_path")"
    evidence_package_path="$evidence_package_dir/$evidence_package_name"
    cp -- "$evidence_path" "$evidence_package_path"
    printf '%s\t%s\n' "$evidence_path" "$evidence_package_path" >> "$evidence_manifest"
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$evidence_package_path"
  done <<< "$review_gpt_supplemental_evidence_paths"
}

cleanup_review_gpt_pr_context() {
  if [[ "$review_gpt_cleanup_pr_context" == "1" ]]; then
    rm -rf "$review_gpt_pr_context_dir"
  fi
}
trap cleanup_review_gpt_pr_context EXIT

case "$review_gpt_review_phase" in
  preliminary | final) ;;
  *)
    echo "Error: REVIEW_GPT_REVIEW_PHASE must be preliminary or final." >&2
    exit 1
    ;;
esac

if [[ "$review_gpt_review_phase" != "preliminary" ]] \
  && [[ -n "$review_gpt_supplemental_evidence_paths" ]]; then
  echo "Error: ReviewGPT supplemental evidence is allowed only for the preliminary specialist review." >&2
  exit 1
fi

if [[ "$review_gpt_review_phase" == "preliminary" ]] \
  && [[ -z "$review_gpt_pr_ref" ]]; then
  echo "Error: the preliminary specialist ReviewGPT pass requires REVIEW_GPT_PR_URL or REVIEW_GPT_PR_REF." >&2
  exit 1
fi

if [[ -z "$review_gpt_pr_ref" ]] \
  && { [[ -n "$review_gpt_round_number" ]] \
    || [[ -n "$review_gpt_first_reviewed_head" ]] \
    || [[ -n "$review_gpt_previous_reviewed_head" ]] \
    || [[ -n "$review_gpt_context_anchor_head" ]]; }; then
  echo "Error: ReviewGPT round metadata requires REVIEW_GPT_PR_URL or REVIEW_GPT_PR_REF." >&2
  exit 1
fi

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
  if [[ -n "$review_gpt_expected_pr_body_path" ]] \
    || [[ -n "$review_gpt_expected_pr_body_sha256" ]]; then
    review_gpt_validate_expected_pr_body
    review_gpt_pr_body="$(< "$review_gpt_expected_pr_body_path")"
  else
    review_gpt_pr_body="$(
      gh pr view "$review_gpt_pr_ref" --json body --jq '.body // ""'
    )"
  fi
  review_gpt_load_context_sensitivity "$review_gpt_pr_body"
  if [[ -n "$review_gpt_expected_pr_body_path" ]]; then
    cp -- "$review_gpt_expected_pr_body_path" \
      "$review_gpt_pr_context_dir/pr-body.md"
  else
    printf '%s\n' "$review_gpt_pr_body" \
      > "$review_gpt_pr_context_dir/pr-body.md"
  fi
  if [[ ! "$review_gpt_base_oid" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$review_gpt_head_oid" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: could not resolve PR base/head SHAs for ReviewGPT PR context." >&2
    exit 1
  fi
  if [[ "$review_gpt_review_phase" == "preliminary" ]]; then
    if [[ -n "$review_gpt_round_number" ]] \
      || [[ -n "$review_gpt_first_reviewed_head" ]] \
      || [[ -n "$review_gpt_previous_reviewed_head" ]] \
      || [[ -n "$review_gpt_context_anchor_head" ]]; then
      echo "Error: preliminary specialist review must not set final ReviewGPT round metadata." >&2
      exit 1
    fi
  else
    review_gpt_round_number="${review_gpt_round_number:-1}"
    if [[ ! "$review_gpt_round_number" =~ ^[1-9][0-9]*$ ]]; then
      echo "Error: REVIEW_GPT_ROUND_NUMBER must be a positive integer." >&2
      exit 1
    fi
    review_gpt_load_pr_shape "$review_gpt_pr_ref" || exit 1
    if [[ "$review_gpt_pr_head_oid" != "$review_gpt_head_oid" ]]; then
      echo "Error: PR head changed while ReviewGPT context was being packaged; rerun the same round." >&2
      exit 1
    fi
    review_gpt_recorded_first_head="$(
      printf '%s\n' "$review_gpt_pr_body" \
        | sed -nE 's/^ReviewGPT first-reviewed head: ([0-9a-f]{40})$/\1/p'
    )"
    review_gpt_require_full_sha \
      "PR body ReviewGPT first-reviewed head" \
      "$review_gpt_recorded_first_head"

    if [[ "$review_gpt_round_number" == "1" ]]; then
      if [[ -n "$review_gpt_full_review_reason" ]]; then
        echo "Error: REVIEW_GPT_FULL_REVIEW_REASON is only valid for round 2 or later." >&2
        exit 1
      fi
      if [[ -n "$review_gpt_previous_reviewed_head" ]]; then
        echo "Error: REVIEW_GPT_PREVIOUS_REVIEWED_HEAD must be unset for round 1." >&2
        exit 1
      fi
      if [[ -n "$review_gpt_context_anchor_head" ]] \
        && [[ "$review_gpt_context_anchor_head" != "$review_gpt_head_oid" ]]; then
        echo "Error: round 1 context anchor must equal the current PR head." >&2
        exit 1
      fi
      if [[ -n "$review_gpt_first_reviewed_head" ]] \
        && [[ "$review_gpt_first_reviewed_head" != "$review_gpt_head_oid" ]]; then
        echo "Error: round 1 first-reviewed head must equal the current PR head." >&2
        exit 1
      fi
      if [[ "$review_gpt_recorded_first_head" != "$review_gpt_head_oid" ]]; then
        echo "Error: round 1 PR body first-reviewed head must equal the current PR head." >&2
        exit 1
      fi
      review_gpt_first_reviewed_head="$review_gpt_recorded_first_head"
      review_gpt_context_anchor_head="$review_gpt_head_oid"
    else
      if [[ -z "$review_gpt_first_reviewed_head" ]] \
        || [[ -z "$review_gpt_previous_reviewed_head" ]]; then
        echo "Error: later ReviewGPT rounds require REVIEW_GPT_FIRST_REVIEWED_HEAD and REVIEW_GPT_PREVIOUS_REVIEWED_HEAD." >&2
        exit 1
      fi
      review_gpt_require_full_sha "first-reviewed head" "$review_gpt_first_reviewed_head"
      if [[ "$review_gpt_first_reviewed_head" == "$review_gpt_head_oid" ]]; then
        echo "Error: later ReviewGPT rounds must preserve the original first-reviewed head." >&2
        exit 1
      fi
      if [[ "$review_gpt_first_reviewed_head" != "$review_gpt_recorded_first_head" ]]; then
        echo "Error: REVIEW_GPT_FIRST_REVIEWED_HEAD must match the immutable PR body baseline." >&2
        exit 1
      fi
      if [[ "$review_gpt_previous_reviewed_head" == "$review_gpt_head_oid" ]]; then
        echo "Error: later ReviewGPT rounds require a new PR head; tooling retries reuse the same round." >&2
        exit 1
      fi
      if [[ -z "$review_gpt_full_review_reason" ]]; then
        review_gpt_full_review_reason="$(review_gpt_default_full_review_reason)"
        if [[ -n "$review_gpt_full_review_reason" ]]; then
          export REVIEW_GPT_FULL_REVIEW_REASON="$review_gpt_full_review_reason"
        fi
      fi
      if [[ -z "$review_gpt_full_review_reason" ]]; then
        review_gpt_context_mode="same_thread_delta"
        review_gpt_context_anchor_head="${review_gpt_context_anchor_head:-$review_gpt_first_reviewed_head}"
      else
        if [[ -n "$review_gpt_context_anchor_head" ]] \
          && [[ "$review_gpt_context_anchor_head" != "$review_gpt_head_oid" ]]; then
          echo "Error: a full-snapshot context anchor must equal the current PR head." >&2
          exit 1
        fi
        review_gpt_context_anchor_head="$review_gpt_head_oid"
      fi
    fi
  fi

  if ! git cat-file -e "$review_gpt_base_oid^{commit}" >/dev/null 2>&1; then
    git fetch --quiet origin "$review_gpt_base_ref"
  fi
  if git cat-file -e "$review_gpt_base_oid^{commit}" >/dev/null 2>&1 \
    && git cat-file -e "$review_gpt_head_oid^{commit}" >/dev/null 2>&1; then
    git diff --patch "$review_gpt_base_oid...$review_gpt_head_oid" \
      > "$review_gpt_pr_context_dir/pr.diff"
    git diff --name-only "$review_gpt_base_oid...$review_gpt_head_oid" \
      > "$review_gpt_pr_context_dir/changed-files.txt"
    if git diff --quiet --no-renames \
      "$review_gpt_base_oid...$review_gpt_head_oid" -- packages/health-commons/; then
      :
    else
      review_gpt_health_commons_diff_status="$?"
      if [[ "$review_gpt_health_commons_diff_status" != "1" ]]; then
        echo "Error: could not determine whether the PR touches Health Commons." >&2
        exit "$review_gpt_health_commons_diff_status"
      fi
      review_gpt_pr_touches_health_commons=1
    fi
  else
    echo "Warning: local PR base/head commits are incomplete; falling back to gh pr diff." >&2
    gh pr diff "$review_gpt_pr_ref" --patch > "$review_gpt_pr_context_dir/pr.diff"
    gh pr diff "$review_gpt_pr_ref" --name-only > "$review_gpt_pr_context_dir/changed-files.txt"
    # Without both commits, rename detection cannot reliably expose both paths.
    # Retain the corpus rather than omit relevant context on an uncertain fallback.
    review_gpt_pr_touches_health_commons=1
  fi

  COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"$'\n'"$review_gpt_pr_context_dir/pr-body.md"$'\n'"$review_gpt_pr_context_dir/pr.diff"$'\n'"$review_gpt_pr_context_dir/changed-files.txt"
  if [[ "$review_gpt_review_phase" == "preliminary" ]]; then
    review_gpt_require_available_commit "current reviewed head" "$review_gpt_head_oid"
    {
      printf '{\n'
      printf '  "schemaVersion": 1,\n'
      printf '  "phase": "preliminary_specialists",\n'
      printf '  "currentBaseHead": "%s",\n' "$review_gpt_base_oid"
      printf '  "currentReviewedHead": "%s"\n' "$review_gpt_head_oid"
      printf '}\n'
    } > "$review_gpt_pr_context_dir/review-phase.json"
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/review-phase.json"$'\n'"agent-docs/FRONTEND.md"$'\n'"PRODUCT.md"$'\n'"DESIGN.md"$'\n'"agent-docs/prompts/product-experience-review.md"$'\n'"agent-docs/prompts/prompt-review.md"$'\n'"agent-docs/prompts/frontend-review.md"$'\n'"agent-docs/prompts/coverage-write.md"
  else
    review_gpt_require_available_commit "first-reviewed head" "$review_gpt_first_reviewed_head"
    review_gpt_require_available_commit "context anchor head" "$review_gpt_context_anchor_head"
    review_gpt_require_available_commit "current reviewed head" "$review_gpt_head_oid"
    review_gpt_first_head_is_ancestor="$(
      review_gpt_is_ancestor "$review_gpt_first_reviewed_head" "$review_gpt_head_oid"
    )"
    if [[ "$review_gpt_first_head_is_ancestor" != "true" ]]; then
      echo "Error: first-reviewed head must be an ancestor of the current reviewed head." >&2
      exit 1
    fi
    review_gpt_review_scope="full"
    review_gpt_previous_head_json="null"
    review_gpt_previous_head_is_ancestor_json="null"
    review_gpt_context_anchor_is_ancestor_of_previous_json="null"
    if [[ "$review_gpt_round_number" == "1" ]]; then
      : > "$review_gpt_pr_context_dir/since-first-reviewed-head.diff"
      : > "$review_gpt_pr_context_dir/since-previous-reviewed-head.diff"
    else
      review_gpt_require_available_commit "previous-reviewed head" "$review_gpt_previous_reviewed_head"
      git diff --no-ext-diff --no-textconv --patch \
        "$review_gpt_previous_reviewed_head" "$review_gpt_head_oid" -- \
        > "$review_gpt_pr_context_dir/since-previous-reviewed-head.diff"
      git diff --name-only \
        "$review_gpt_previous_reviewed_head" "$review_gpt_head_oid" -- \
        > "$review_gpt_pr_context_dir/changed-since-previous-reviewed-head.txt"
      if [[ "$review_gpt_context_mode" == "full_snapshot" ]]; then
        git diff --no-ext-diff --no-textconv --patch \
          "$review_gpt_first_reviewed_head" "$review_gpt_head_oid" -- \
          > "$review_gpt_pr_context_dir/since-first-reviewed-head.diff"
        printf '%s\n' "$review_gpt_full_review_reason" \
          > "$review_gpt_pr_context_dir/full-review-reason.txt"
      fi
      if [[ "$review_gpt_context_mode" == "full_snapshot" ]]; then
        review_gpt_review_scope="full"
      else
        review_gpt_review_scope="correction"
      fi
      review_gpt_previous_head_json="\"$review_gpt_previous_reviewed_head\""
      review_gpt_previous_head_is_ancestor_json="$(
        review_gpt_is_ancestor "$review_gpt_previous_reviewed_head" "$review_gpt_head_oid"
      )"
      if [[ "$review_gpt_context_mode" == "same_thread_delta" ]]; then
        review_gpt_context_anchor_is_ancestor_of_previous_json="$(
          review_gpt_is_ancestor "$review_gpt_context_anchor_head" "$review_gpt_previous_reviewed_head"
        )"
        if [[ "$review_gpt_context_anchor_is_ancestor_of_previous_json" != "true" ]]; then
          echo "Error: context anchor head must be an ancestor of the previous reviewed head." >&2
          exit 1
        fi
      fi
    fi

    {
      printf '{\n'
      printf '  "schemaVersion": 1,\n'
      printf '  "roundNumber": %s,\n' "$review_gpt_round_number"
      printf '  "reviewScope": "%s",\n' "$review_gpt_review_scope"
      printf '  "contextMode": "%s",\n' "$review_gpt_context_mode"
      printf '  "contextSensitivity": "%s",\n' "$review_gpt_context_sensitivity"
      printf '  "prChangedLines": %s,\n' "$review_gpt_pr_changed_lines"
      printf '  "prChangedFiles": %s,\n' "$review_gpt_pr_changed_files"
      printf '  "contextAnchorHead": "%s",\n' "$review_gpt_context_anchor_head"
      printf '  "currentBaseHead": "%s",\n' "$review_gpt_base_oid"
      printf '  "firstReviewedHead": "%s",\n' "$review_gpt_first_reviewed_head"
      printf '  "previousReviewedHead": %s,\n' "$review_gpt_previous_head_json"
      printf '  "currentReviewedHead": "%s",\n' "$review_gpt_head_oid"
      printf '  "firstReviewedHeadIsAncestorOfCurrent": %s,\n' "$review_gpt_first_head_is_ancestor"
      printf '  "previousReviewedHeadIsAncestorOfCurrent": %s,\n' \
        "$review_gpt_previous_head_is_ancestor_json"
      printf '  "contextAnchorHeadIsAncestorOfPrevious": %s\n' \
        "$review_gpt_context_anchor_is_ancestor_of_previous_json"
      printf '}\n'
    } > "$review_gpt_pr_context_dir/review-round.json"
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/review-round.json"$'\n'"$review_gpt_pr_context_dir/since-previous-reviewed-head.diff"
    if [[ "$review_gpt_round_number" == "1" ]]; then
      COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/since-first-reviewed-head.diff"
    elif [[ "$review_gpt_context_mode" == "full_snapshot" ]]; then
      COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/since-first-reviewed-head.diff"$'\n'"$review_gpt_pr_context_dir/changed-since-previous-reviewed-head.txt"$'\n'"$review_gpt_pr_context_dir/full-review-reason.txt"
    else
      COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/changed-since-previous-reviewed-head.txt"
    fi
  fi
  if [[ "$review_gpt_review_phase" == "preliminary" ]] \
    || [[ -n "$review_gpt_rendered_evidence_paths" ]]; then
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/rendered-evidence.txt"
    review_gpt_add_rendered_evidence
  fi
  if [[ -n "$review_gpt_supplemental_evidence_paths" ]]; then
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$review_gpt_pr_context_dir/supplemental-evidence.txt"
    review_gpt_add_supplemental_evidence
  fi

  if [[ "$review_gpt_context_mode" == "same_thread_delta" ]]; then
    review_gpt_correction_paths="$review_gpt_pr_context_dir/pr-body.md"$'\n'"$review_gpt_pr_context_dir/review-round.json"$'\n'"$review_gpt_pr_context_dir/since-previous-reviewed-head.diff"$'\n'"$review_gpt_pr_context_dir/changed-since-previous-reviewed-head.txt"
    while IFS= read -r review_gpt_correction_path; do
      [[ -z "$review_gpt_correction_path" ]] && continue
      if [[ -f "$review_gpt_correction_path" ]] && [[ ! -L "$review_gpt_correction_path" ]]; then
        review_gpt_correction_paths="$review_gpt_correction_paths"$'\n'"$review_gpt_correction_path"
      fi
    done < "$review_gpt_pr_context_dir/changed-since-previous-reviewed-head.txt"
    if [[ -f "$review_gpt_pr_context_dir/rendered-evidence.txt" ]]; then
      review_gpt_correction_paths="$review_gpt_correction_paths"$'\n'"$review_gpt_pr_context_dir/rendered-evidence.txt"
      while IFS= read -r review_gpt_correction_evidence_path; do
        [[ -z "$review_gpt_correction_evidence_path" ]] && continue
        review_gpt_correction_paths="$review_gpt_correction_paths"$'\n'"$review_gpt_correction_evidence_path"
      done < "$review_gpt_pr_context_dir/rendered-evidence.txt"
    fi
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$review_gpt_correction_paths"
  fi
  if [[ "$review_gpt_context_mode" != "same_thread_delta" ]]; then
    COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="$COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS"$'\n'"$(cat "$review_gpt_pr_context_dir/changed-files.txt")"
  fi
  export COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS
fi

# Root dotfiles are not discovered by the ordinary source scan, but Crabbox
# reviews depend on this provider/ref trust-root configuration even when the
# current patch changes only its consumers.
if [[ "$review_gpt_context_mode" != "same_thread_delta" ]]; then
  COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS="${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"$'\n'".crabbox.yaml"
fi
export COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS

if [[ "$review_gpt_context_mode" == "same_thread_delta" ]]; then
  export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'
  export COBUILD_AUDIT_CONTEXT_SCAN_SPECS='review-gpt-pr-context:__always_paths_only__'
  export COBUILD_AUDIT_CONTEXT_TEST_SCAN_SPECS='review-gpt-pr-context:__always_paths_only__'
  export COBUILD_AUDIT_CONTEXT_DOC_SCAN_SPECS='review-gpt-pr-context:__always_paths_only__'
  export COBUILD_AUDIT_CONTEXT_CI_SCAN_SPECS='review-gpt-pr-context:__always_paths_only__'
else
  export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
fi
export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="${COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS:-}"
if [[ "$review_gpt_context_mode" != "same_thread_delta" ]] \
  && [[ "$review_gpt_pr_touches_health_commons" != "1" ]]; then
  COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS+=$'\n'"packages/health-commons/content/sources/**"
  export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS
fi
if [[ "$review_gpt_context_mode" != "same_thread_delta" ]]; then
  repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
    "agent-docs/product-specs" \
    "config" \
    "packages" \
    "src" \
    "app" \
    "apps" \
    "contracts" \
    "scripts" \
    "docs"
fi
package_audit_context_bin="$(cobuild_repo_tool_bin cobuild-package-audit-context)"
if [[ "$review_gpt_cleanup_pr_context" == "1" ]]; then
  "$package_audit_context_bin" "$@"
else
  exec "$package_audit_context_bin" "$@"
fi
