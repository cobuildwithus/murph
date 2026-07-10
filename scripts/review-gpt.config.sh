#!/usr/bin/env bash

review_gpt_config_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
review_gpt_repo_root="$(CDPATH= cd -- "$review_gpt_config_dir/.." && pwd -P)"

review_gpt_invalid_browser_lane() {
  echo "Error: unsupported ReviewGPT browser lane '$1'. Use random, eragon, phlebas, or mountain." >&2
}

review_gpt_browser_lane_display_name() {
  case "$1" in
    eragon) printf '%s\n' "Eragon" ;;
    phlebas) printf '%s\n' "Phlebas" ;;
    mountain) printf '%s\n' "Mountain" ;;
    *)
      review_gpt_invalid_browser_lane "$1"
      return 1
      ;;
  esac
}

review_gpt_browser_lane_port() {
  case "$1" in
    eragon) printf '%s\n' "9448" ;;
    phlebas) printf '%s\n' "9442" ;;
    mountain) printf '%s\n' "9450" ;;
    *)
      review_gpt_invalid_browser_lane "$1"
      return 1
      ;;
  esac
}

review_gpt_browser_lane_data_dir() {
  local review_gpt_lane_display
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

review_gpt_requested_browser_lane="${REVIEW_GPT_BROWSER_LANE:-${MURPH_REVIEW_GPT_BROWSER_LANE:-${MURPH_REVIEW_GPT_PROFILE_SLUG:-random}}}"
review_gpt_requested_browser_lane="$(printf '%s' "$review_gpt_requested_browser_lane" | tr '[:upper:]' '[:lower:]')"

case "$review_gpt_requested_browser_lane" in
  "" | auto | random)
    review_gpt_browser_lanes=(eragon phlebas mountain)
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
  phlebas | mountain)
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
review_gpt_selected_browser_app="$review_gpt_repo_root/output-packages/review-gpt-profiles/$review_gpt_selected_browser_lane/$review_gpt_selected_browser_display.app"

if [[ ! -d "$review_gpt_selected_browser_app" ]] && command -v mdfind >/dev/null 2>&1; then
  review_gpt_found_browser_app="$(
    mdfind "kMDItemDisplayName == '$review_gpt_selected_browser_display.app' || kMDItemFSName == '$review_gpt_selected_browser_display.app'" | head -n 1
  )"
  if [[ -n "$review_gpt_found_browser_app" ]]; then
    review_gpt_selected_browser_app="$review_gpt_found_browser_app"
  fi
fi

review_gpt_selected_browser_binary="$review_gpt_selected_browser_app/Contents/MacOS/Brave Browser"
if [[ -x "$review_gpt_selected_browser_binary" ]]; then
  browser_binary_path="${browser_binary_path:-$review_gpt_selected_browser_binary}"
else
  browser_binary_path="${browser_binary_path:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
fi
managed_browser_user_data_dir="${managed_browser_user_data_dir:-$(review_gpt_browser_lane_data_dir "$review_gpt_selected_browser_lane")}"
managed_browser_profile="${managed_browser_profile:-Default}"
managed_browser_port="${managed_browser_port:-$review_gpt_selected_browser_port}"
export REVIEW_GPT_SELECTED_BROWSER_LANE="$review_gpt_selected_browser_lane"

name_prefix="murph-$review_gpt_selected_browser_lane-chatgpt-audit"
repo_context_url=""
attach_artifacts=1
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
# PR review runs pass REVIEW_GPT_PR_URL so this package wrapper can add
# review-gpt-pr-context/pr.diff and changed-files.txt to repo.snapshot.zip.
package_script="scripts/package-audit-context-full.sh"
# `current` skips connector selection. The PR loop requires the selected
# composer to have no app connector selected before auto-send because review
# context must come from the guarded ZIP and repomix attachments.
app_connector="current"
model="gpt-5.6-sol"
thinking="current"
snapshot_attachment_name="repo.snapshot.zip"
repomix_attachment_format="zip"

repomix_ignore_patterns=(
  ".git/**"
  ".env"
  ".env.*"
  "**/.env"
  "**/.env.*"
  "node_modules/**"
  "**/node_modules/**"
  ".next/**"
  "**/.next/**"
  "dist/**"
  "**/dist/**"
  "build/**"
  "**/build/**"
  "coverage/**"
  "**/coverage/**"
  "*.tsbuildinfo"
  "**/*.tsbuildinfo"
  "audit-packages/**"
  "output-packages/**"
  "packages/health-commons/content/**"
  "packages/health-commons/generated/**"
)

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
  "Greenfield hard-cut audit for removable legacy compatibility, migrations, and fallback paths." \
  "remove-legacy" \
  "legacy-cleanup" \
  "hard-cut" \
  "greenfield-hard-cut"
review_gpt_register_dir_preset "pr-review" "pr-deep-review.md" \
  "Deep PR review for bugs, edge cases, and minimal-complexity architecture via guarded ZIP PR diff plus repomix attachments." \
  "pr-deep-review" \
  "deep-pr-review" \
  "pr-bugs-and-architecture"
review_gpt_register_dir_preset "package-boundaries" "package-boundaries.md" \
  "Package-boundary, circular-dependency, and mixed-concern audit focused on workspace ownership seams." \
  "package-boundary" \
  "package-ownership" \
  "dependency-boundaries" \
  "circular-deps" \
  "circular-dependencies" \
  "mixed-package-concerns"
