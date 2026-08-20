#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
review_gpt_completion_specialists_prompt_max_bytes=6500

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
  scripts/review-gpt-pr-head-preflight.sh --run [review-gpt arguments...]
EOF
  exit 64
}

review_gpt_validate_pr_base() {
  local base_ref="${1:-}"
  local base_oid="${2:-}"

  if [[ -z "$base_ref" ]] || [[ ! "$base_oid" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: ReviewGPT PR base preflight requires a branch and full base SHA." >&2
    return 64
  fi
}

review_gpt_fetch_pr_base_under_lock() {
  local base_ref="$1"
  local base_oid="$2"

  review_gpt_validate_pr_base "$base_ref" "$base_oid"
  if git cat-file -e "$base_oid^{commit}" >/dev/null 2>&1; then
    return 0
  fi
  if ! git fetch --quiet origin "$base_ref"; then
    echo "Error: could not fetch PR base branch '$base_ref' for ReviewGPT." >&2
    return 1
  fi
}

review_gpt_refresh_pr_base_if_missing() {
  local base_ref="${1:-}"
  local base_oid="${2:-}"
  local common_dir
  local lock_dir
  local lock_file
  local lock_status=0
  local lock_wait_seconds=120
  local script_path="$ROOT_DIR/scripts/review-gpt-pr-head-preflight.sh"

  review_gpt_validate_pr_base "$base_ref" "$base_oid"
  if git cat-file -e "$base_oid^{commit}" >/dev/null 2>&1; then
    return 0
  fi
  if ! common_dir="$(git rev-parse --path-format=absolute --git-common-dir)" \
    || [[ -z "$common_dir" ]]; then
    echo "Error: could not resolve the shared Git directory for ReviewGPT base preflight." >&2
    return 1
  fi

  lock_dir="$common_dir/murph-locks"
  lock_file="$lock_dir/review-gpt-base-fetch.lock"
  mkdir -p "$lock_dir"

  if command -v flock >/dev/null 2>&1; then
    flock -w "$lock_wait_seconds" "$lock_file" \
      bash "$script_path" --fetch-pr-base-under-lock "$base_ref" "$base_oid" \
      || lock_status=$?
  elif command -v lockf >/dev/null 2>&1; then
    lockf -t "$lock_wait_seconds" "$lock_file" \
      bash "$script_path" --fetch-pr-base-under-lock "$base_ref" "$base_oid" \
      || lock_status=$?
  else
    echo "Error: flock or lockf is required for ReviewGPT base-fetch serialization." >&2
    return 1
  fi

  if (( lock_status != 0 )); then
    echo "Error: serialized ReviewGPT PR-base fetch failed or timed out." >&2
    return "$lock_status"
  fi
}

review_gpt_require_pr_head() {
  local pr_ref="$1"
  local base_ref
  local base_oid
  local dirty_status
  local local_head
  local pr_head
  local pr_shape

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
  if ! pr_shape="$(
    gh pr view "$pr_ref" \
      --json baseRefName,baseRefOid,headRefOid \
      --jq '[.baseRefName, .baseRefOid, .headRefOid] | @tsv'
  )"; then
    echo "Error: could not resolve pushed PR base/head metadata for $pr_ref." >&2
    exit 1
  fi
  IFS=$'\t' read -r base_ref base_oid pr_head <<< "$pr_shape"

  if [[ -z "$base_ref" ]] \
    || [[ ! "$base_oid" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$pr_head" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: could not resolve pushed PR base/head metadata for $pr_ref." >&2
    exit 1
  fi

  if [[ "$local_head" != "$pr_head" ]]; then
    echo "Error: local HEAD does not match the pushed PR head." >&2
    echo "local HEAD: $local_head" >&2
    echo "PR head:    $pr_head" >&2
    exit 1
  fi

  review_gpt_refresh_pr_base_if_missing "$base_ref" "$base_oid"
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

review_gpt_option_requires_value() {
  # Incur accepts options before the positional preset and accepts both the
  # schema's camelCase names and their kebab-case aliases. Skip each option's
  # value so it cannot be mistaken for that positional preset.
  case "$1" in
    --config \
      | --preset \
      | --prompt \
      | --prompt-file \
      | --promptFile \
      | --model \
      | --thinking \
      | --app-connector \
      | --appConnector \
      | --connector \
      | --chat \
      | --chat-url \
      | --chatUrl \
      | --chat-id \
      | --chatId \
      | --wait-timeout \
      | --waitTimeout \
      | --timeout \
      | --idle-draft-timeout \
      | --idleDraftTimeout \
      | --response-file \
      | --responseFile \
      | --response-marker \
      | --responseMarker \
      | --browser-path \
      | --browserPath \
      | --filter-output \
      | --filterOutput \
      | --format \
      | --token-limit \
      | --tokenLimit \
      | --token-offset \
      | --tokenOffset \
      | --minimum-marked-response-time \
      | --minimumMarkedResponseTime)
      return 0
      ;;
  esac
  return 1
}

review_gpt_detect_pr_phase() {
  local argument
  local -a arguments=("$@")
  local detected_phase=""
  local index=0
  local phase
  local positional_preset_seen=0
  local preset_token
  local preset_token_count=0
  local preset_value

  while (( index < ${#arguments[@]} )); do
    argument="${arguments[$index]}"
    preset_value=""
    case "$argument" in
      --preset)
        index=$((index + 1))
        if (( index >= ${#arguments[@]} )); then
          echo "Error: --preset requires a value." >&2
          return 64
        fi
        preset_value="${arguments[$index]}"
        ;;
      --preset=*)
        preset_value="${argument#--preset=}"
        ;;
      --*=*)
        ;;
      --*)
        if review_gpt_option_requires_value "$argument"; then
          index=$((index + 1))
        fi
        ;;
      -*)
        ;;
      *)
        if [[ "$positional_preset_seen" == "0" ]]; then
          preset_value="$argument"
          positional_preset_seen=1
        fi
        ;;
    esac

    if [[ -n "$preset_value" ]]; then
      while IFS= read -r preset_token; do
        [[ -z "$preset_token" ]] && continue
        preset_token_count=$((preset_token_count + 1))
        phase="$(review_gpt_phase_for_preset "$preset_token")"
        [[ -z "$phase" ]] && continue
        if [[ -n "$detected_phase" && "$detected_phase" != "$phase" ]]; then
          echo "Error: preliminary and final PR ReviewGPT presets cannot run together." >&2
          return 64
        fi
        detected_phase="$phase"
      done < <(printf '%s\n' "$preset_value" | tr ',' '\n')
    fi
    index=$((index + 1))
  done

  if [[ "$detected_phase" == "preliminary" ]] \
    && [[ "$preset_token_count" != "1" ]]; then
    echo "Error: completion-specialists must run as the only preset so its assembled prompt budget is complete." >&2
    return 64
  fi

  printf '%s\n' "$detected_phase"
}

review_gpt_trimmed_prompt_file_bytes() {
  local prompt_file="$1"

  if [[ "$prompt_file" != /* ]]; then
    prompt_file="$ROOT_DIR/$prompt_file"
  fi
  if [[ ! -f "$prompt_file" ]]; then
    echo "Error: cannot measure missing completion-specialists prompt file: $1" >&2
    return 1
  fi
  node -e \
    'const fs = require("node:fs"); process.stdout.write(String(Buffer.byteLength(fs.readFileSync(process.argv[1], "utf8").trimEnd())));' \
    "$prompt_file"
}

review_gpt_require_completion_specialists_prompt_budget() {
  local argument
  local assembled_bytes=0
  local part_bytes
  local part_count=0
  local pending_prompt_part=""
  local prompt_file_value
  local -a prompt_part_bytes

  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is required to measure the assembled completion-specialists prompt." >&2
    return 127
  fi

  part_bytes="$(
    review_gpt_trimmed_prompt_file_bytes \
      "scripts/chatgpt-review-presets/completion-specialists.md"
  )" || return
  prompt_part_bytes=("$part_bytes")

  for argument in "$@"; do
    if [[ -n "$pending_prompt_part" ]]; then
      if [[ "$pending_prompt_part" == "file" ]]; then
        part_bytes="$(review_gpt_trimmed_prompt_file_bytes "$argument")" || return
      else
        part_bytes="$(printf '%s' "$argument" | LC_ALL=C wc -c | tr -d '[:space:]')"
      fi
      prompt_part_bytes+=("$part_bytes")
      pending_prompt_part=""
      continue
    fi

    case "$argument" in
      --prompt)
        pending_prompt_part="inline"
        ;;
      --prompt=*)
        part_bytes="$(
          printf '%s' "${argument#--prompt=}" | LC_ALL=C wc -c | tr -d '[:space:]'
        )"
        prompt_part_bytes+=("$part_bytes")
        ;;
      --prompt-file | --promptFile)
        pending_prompt_part="file"
        ;;
      --prompt-file=* | --promptFile=*)
        prompt_file_value="${argument#*=}"
        part_bytes="$(
          review_gpt_trimmed_prompt_file_bytes "$prompt_file_value"
        )" || return
        prompt_part_bytes+=("$part_bytes")
        ;;
    esac
  done

  if [[ -n "$pending_prompt_part" ]]; then
    echo "Error: --prompt and --prompt-file require a value." >&2
    return 64
  fi

  for part_bytes in "${prompt_part_bytes[@]}"; do
    if [[ "$part_bytes" == "0" ]]; then
      continue
    fi
    if (( part_count > 0 )); then
      assembled_bytes=$((assembled_bytes + 2))
    fi
    assembled_bytes=$((assembled_bytes + part_bytes))
    part_count=$((part_count + 1))
  done

  if (( assembled_bytes > review_gpt_completion_specialists_prompt_max_bytes )); then
    echo "Error: assembled completion-specialists prompt is ${assembled_bytes} bytes; the canonical/Frog budget is ${review_gpt_completion_specialists_prompt_max_bytes}. Keep --prompt to target/head metadata and remove duplicated PR or lens text." >&2
    return 1
  fi
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
    if [[ "$detected_phase" == "preliminary" ]]; then
      review_gpt_require_completion_specialists_prompt_budget "$@"
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

review_gpt_main() {
  case "${1:-}" in
    --run)
      shift
      review_gpt_run "$@"
      ;;
    --refresh-pr-base-if-missing)
      if [[ "$#" -ne 3 ]]; then
        echo "Error: --refresh-pr-base-if-missing requires a branch and full base SHA." >&2
        exit 64
      fi
      shift
      review_gpt_refresh_pr_base_if_missing "$@"
      return
      ;;
    --fetch-pr-base-under-lock)
      if [[ "$#" -ne 3 ]]; then
        echo "Error: --fetch-pr-base-under-lock requires a branch and full base SHA." >&2
        exit 64
      fi
      shift
      review_gpt_fetch_pr_base_under_lock "$@"
      return
      ;;
  esac

  if [[ "$#" -ne 1 ]]; then
    usage
  fi

  review_gpt_require_pr_head "$1"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  review_gpt_main "$@"
fi
