#!/usr/bin/env bash

review_gpt_config_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
review_gpt_repo_root="$(CDPATH= cd -- "$review_gpt_config_dir/.." && pwd -P)"
review_gpt_local_config="${XDG_CONFIG_HOME:-$HOME/.config}/murph/review-gpt.conf"

if [[ -r "$review_gpt_local_config" ]]; then
  # This optional user-owned file contains local workflow preferences only.
  # shellcheck source=/dev/null
  source "$review_gpt_local_config"
fi

review_gpt_invalid_browser_lane() {
  echo "Error: unsupported ReviewGPT browser lane '$1'. Use main, random, eragon, phlebas, hercules, or mountain." >&2
}

review_gpt_browser_lane_display_name() {
  case "$1" in
    main) printf '%s\n' "Main" ;;
    eragon) printf '%s\n' "Eragon" ;;
    phlebas) printf '%s\n' "Phlebas" ;;
    hercules) printf '%s\n' "Hercules" ;;
    mountain) printf '%s\n' "Mountain" ;;
    *)
      review_gpt_invalid_browser_lane "$1"
      return 1
      ;;
  esac
}

review_gpt_browser_lane_port() {
  case "$1" in
    main) printf '%s\n' "9452" ;;
    eragon) printf '%s\n' "9448" ;;
    phlebas) printf '%s\n' "9442" ;;
    hercules) printf '%s\n' "9444" ;;
    mountain) printf '%s\n' "9450" ;;
    *)
      review_gpt_invalid_browser_lane "$1"
      return 1
      ;;
  esac
}

review_gpt_browser_lane_data_dir() {
  local review_gpt_lane_display

  if [[ "$1" == "main" ]]; then
    printf '%s\n' "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
    return 0
  fi

  review_gpt_lane_display="$(review_gpt_browser_lane_display_name "$1")" || return 1
  printf '%s\n' "$HOME/Library/Application Support/MurphReviewGPT/$review_gpt_lane_display"
}

review_gpt_browser_lane_has_cdp() {
  local review_gpt_lane_port

  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi

  review_gpt_lane_port="$(review_gpt_browser_lane_port "$1")" || return 1
  curl --silent --show-error --fail --max-time 1 \
    "http://127.0.0.1:$review_gpt_lane_port/json/version" >/dev/null 2>&1
}

review_gpt_browser_lane_is_usable() {
  local review_gpt_lane_data_dir
  local review_gpt_lane_lock

  review_gpt_lane_data_dir="$(review_gpt_browser_lane_data_dir "$1")" || return 1
  review_gpt_lane_lock="$review_gpt_lane_data_dir/SingletonLock"

  if review_gpt_browser_lane_has_cdp "$1"; then
    return 0
  fi

  [[ ! -e "$review_gpt_lane_lock" && ! -L "$review_gpt_lane_lock" ]]
}

review_gpt_requested_browser_lane="${REVIEW_GPT_BROWSER_LANE:-${MURPH_REVIEW_GPT_BROWSER_LANE:-${MURPH_REVIEW_GPT_PROFILE_SLUG:-auto}}}"
review_gpt_requested_browser_lane="$(printf '%s' "$review_gpt_requested_browser_lane" | tr '[:upper:]' '[:lower:]')"
review_gpt_browser_lane_count="${REVIEW_GPT_BROWSER_LANE_COUNT:-${MURPH_REVIEW_GPT_BROWSER_LANE_COUNT:-4}}"

if [[ ! "$review_gpt_browser_lane_count" =~ ^[1-4]$ ]]; then
  echo "Error: REVIEW_GPT_BROWSER_LANE_COUNT must be an integer from 1 to 4." >&2
  return 1 2>/dev/null || exit 1
fi

case "$review_gpt_requested_browser_lane" in
  main)
    review_gpt_selected_browser_lane="main"
    ;;
  "" | auto | random)
    review_gpt_all_browser_lanes=(eragon phlebas hercules mountain)
    review_gpt_browser_lanes=("${review_gpt_all_browser_lanes[@]:0:review_gpt_browser_lane_count}")
    review_gpt_usable_browser_lanes=()

    for review_gpt_candidate_browser_lane in "${review_gpt_browser_lanes[@]}"; do
      if review_gpt_browser_lane_is_usable "$review_gpt_candidate_browser_lane"; then
        review_gpt_usable_browser_lanes+=("$review_gpt_candidate_browser_lane")
      fi
    done

    if [[ "${#review_gpt_usable_browser_lanes[@]}" -gt 0 ]]; then
      review_gpt_selected_browser_lane="${review_gpt_usable_browser_lanes[$((RANDOM % ${#review_gpt_usable_browser_lanes[@]}))]}"
    else
      echo "Warning: no unlocked ReviewGPT browser lanes found; falling back to random lane." >&2
      review_gpt_selected_browser_lane="${review_gpt_browser_lanes[$((RANDOM % ${#review_gpt_browser_lanes[@]}))]}"
    fi
    ;;
  aragon | eragon)
    review_gpt_selected_browser_lane="eragon"
    ;;
  phlebas | hercules | mountain)
    review_gpt_selected_browser_lane="$review_gpt_requested_browser_lane"
    ;;
  *)
    review_gpt_invalid_browser_lane "$review_gpt_requested_browser_lane"
    return 1 2>/dev/null || exit 1
    ;;
esac

review_gpt_selected_browser_display="$(review_gpt_browser_lane_display_name "$review_gpt_selected_browser_lane")" || {
  return 1 2>/dev/null || exit 1
}
review_gpt_selected_browser_port="$(review_gpt_browser_lane_port "$review_gpt_selected_browser_lane")" || {
  return 1 2>/dev/null || exit 1
}
review_gpt_installed_browser_binary="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
if [[ "$review_gpt_selected_browser_lane" == "main" ]]; then
  review_gpt_selected_browser_app="/Applications/Brave Browser.app"
else
  review_gpt_selected_browser_app="$review_gpt_repo_root/output-packages/review-gpt-profiles/$review_gpt_selected_browser_lane/$review_gpt_selected_browser_display.app"
fi

if [[ ! -d "$review_gpt_selected_browser_app" ]] && command -v mdfind >/dev/null 2>&1; then
  review_gpt_found_browser_app="$(
    mdfind "kMDItemDisplayName == '$review_gpt_selected_browser_display.app' || kMDItemFSName == '$review_gpt_selected_browser_display.app'" | head -n 1
  )"
  if [[ -n "$review_gpt_found_browser_app" ]]; then
    review_gpt_selected_browser_app="$review_gpt_found_browser_app"
  fi
fi

review_gpt_selected_browser_binary="$review_gpt_selected_browser_app/Contents/MacOS/Brave Browser"
if [[ -x "$review_gpt_installed_browser_binary" ]]; then
  # The lane's user-data directory and CDP port provide isolation. Prefer the
  # installed browser so ignored copied app bundles cannot pin an old Brave
  # release or its launch behavior indefinitely.
  browser_binary_path="${browser_binary_path:-$review_gpt_installed_browser_binary}"
elif [[ -x "$review_gpt_selected_browser_binary" ]]; then
  browser_binary_path="${browser_binary_path:-$review_gpt_selected_browser_binary}"
else
  browser_binary_path="${browser_binary_path:-$review_gpt_installed_browser_binary}"
fi
managed_browser_user_data_dir="${managed_browser_user_data_dir:-$(review_gpt_browser_lane_data_dir "$review_gpt_selected_browser_lane")}"
managed_browser_profile="${managed_browser_profile:-Default}"
managed_browser_port="${managed_browser_port:-$review_gpt_selected_browser_port}"
# Keep response-polling timers reliable without forcing every renderer and
# occluded lane window to run at foreground priority. Set this to unthrottled
# only when a specific browser version has a proven background-capture stall.
managed_browser_background_mode="${managed_browser_background_mode:-balanced}"
export REVIEW_GPT_SELECTED_BROWSER_LANE="$review_gpt_selected_browser_lane"

name_prefix="murph-$review_gpt_selected_browser_lane-chatgpt-audit"
repo_context_url=""
attach_artifacts=1
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
# PR review runs pass REVIEW_GPT_PR_URL plus round metadata so this wrapper can
# add the PR body, full PR diff, exact reviewed heads, and remediation delta to
# codebase.zip.
package_script="scripts/package-audit-context-full.sh"
# `current` skips connector selection. The PR loop requires the selected
# composer to have no app connector selected before auto-send because review
# context must come from the guarded codebase ZIP.
app_connector="current"
model="gpt-5.6-sol"
thinking="current"
response_timeout_ms="${response_timeout_ms:-$((180 * 60 * 1000))}"

review_gpt_review_phase="${REVIEW_GPT_REVIEW_PHASE:-final}"
review_gpt_round_number="${REVIEW_GPT_ROUND_NUMBER:-}"
review_gpt_full_review_reason="${REVIEW_GPT_FULL_REVIEW_REASON:-}"
review_gpt_pr_review_prompt_file="pr-deep-review.md"
if [[ -n "$review_gpt_full_review_reason" ]] \
  && [[ -z "${review_gpt_full_review_reason//[[:space:]]/}" ]]; then
  echo "Error: REVIEW_GPT_FULL_REVIEW_REASON must contain a concrete reason." >&2
  return 1 2>/dev/null || exit 1
fi
if [[ "$review_gpt_review_phase" == "final" ]] \
  && [[ "$review_gpt_round_number" =~ ^([2-9]|[1-9][0-9]+)$ ]]; then
  if [[ -n "$review_gpt_full_review_reason" ]]; then
    : # A full-patch audit starts a new ChatGPT conversation.
  else
    review_gpt_thread_url="${REVIEW_GPT_THREAD_URL:-}"
    case "$review_gpt_thread_url" in
      https://chatgpt.com/c/*)
        chatgpt_url="$review_gpt_thread_url"
        review_gpt_pr_review_prompt_file="pr-followup-review.md"
        ;;
      *)
        echo "Error: later ReviewGPT rounds require REVIEW_GPT_THREAD_URL for the current context conversation." >&2
        return 1 2>/dev/null || exit 1
        ;;
    esac
  fi
elif [[ -n "$review_gpt_full_review_reason" ]]; then
  echo "Error: REVIEW_GPT_FULL_REVIEW_REASON is only valid for round 2 or later." >&2
  return 1 2>/dev/null || exit 1
fi

review_gpt_register_dir_preset "security" "security-audit.md" \
  "General correctness and security audit focused on trust boundaries." \
  "security-audit" \
  "audit-security"
review_gpt_register_dir_preset "privacy" "privacy.md" \
  "Privacy and data-minimization audit focused on storing as little user data as possible." \
  "data-minimization" \
  "privacy-minimization" \
  "minimal-retention" \
  "data-retention"
review_gpt_register_dir_preset "architecture" "architecture-review.md" \
  "Architecture and data-model review focused on simplification, composability, and long-term maintainability." \
  "architecture-review" \
  "data-model" \
  "refactor-architecture"
review_gpt_register_dir_preset "giant-file-composability" "giant-file-composability.md" \
  "Review giant files for multi-responsibility seams that should be split into smaller composable units." \
  "large-files" \
  "split-files" \
  "file-composability" \
  "large-file-composability"
review_gpt_register_dir_preset "data-model-composability" "data-model-composability-review.md" \
  "Review data structures and data models for simpler, more composable, and more scalable shapes." \
  "data-structures" \
  "data-model-review" \
  "composable-data-model" \
  "scalable-data-model"
review_gpt_register_dir_preset "simplify" "complexity-simplification.md" \
  "Behavior-preserving simplification pass." \
  "complexity" \
  "complexity-simplification"
review_gpt_register_dir_preset "bad-code" "bad-code-quality.md" \
  "Code quality and anti-pattern review." \
  "anti-patterns" \
  "antipatterns" \
  "bad-practices" \
  "anti-patterns-and-bad-practices" \
  "code-quality" \
  "bad-code-quality"
review_gpt_register_dir_preset "bug-hunt" "bug-hunt-high-value-seams.md" \
  "Bug-finding review focused on high-value seams, invariants, and failure modes." \
  "bugs" \
  "bug-hunt" \
  "high-value-seams" \
  "failure-modes" \
  "invariant-violations"
review_gpt_register_dir_preset "legacy-removal" "legacy-removal.md" \
  "Evidence-gated hard-cut audit for obsolete compatibility, migrations, and fallback paths." \
  "remove-legacy" \
  "legacy-cleanup" \
  "hard-cut" \
  "greenfield-hard-cut"
review_gpt_register_dir_preset "pr-review" "$review_gpt_pr_review_prompt_file" \
  "Deep PR review for serious bugs, invariant drift, and material simplification using the guarded codebase ZIP." \
  "pr-deep-review" \
  "deep-pr-review" \
  "pr-bugs-and-architecture"
review_gpt_register_dir_preset "completion-specialists" "completion-specialists.md" \
  "Preliminary combined product-experience, prompt, frontend, and coverage review for an exact pushed PR head." \
  "completion-review" \
  "specialist-review" \
  "prompt-frontend-coverage"
review_gpt_register_dir_preset "package-boundaries" "package-boundaries.md" \
  "Package-boundary, circular-dependency, and mixed-concern audit focused on workspace ownership seams." \
  "package-boundary" \
  "package-ownership" \
  "dependency-boundaries" \
  "circular-deps" \
  "circular-dependencies" \
  "mixed-package-concerns"

# Keep the PR-only evidence and REVIEW_COMPLETE contract out of aggregate
# exploratory reviews. The dedicated `completion-specialists` and `pr-review`
# presets are invoked only by their pushed-head completion workflows.
review_gpt_register_preset_group "all" \
  "Run every non-PR ReviewGPT audit preset." \
  "security" \
  "privacy" \
  "architecture" \
  "giant-file-composability" \
  "data-model-composability" \
  "simplify" \
  "bad-code" \
  "bug-hunt" \
  "legacy-removal" \
  "package-boundaries"
