#!/usr/bin/env bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
profile_helper="${repo_root}/scripts/review-gpt-browser-profile.sh"
review_gpt_profile_slug="${MURPH_REVIEW_GPT_PROFILE_SLUG:-phlebas}"

if [[ -r "${profile_helper}" ]]; then
  # shellcheck source=/dev/null
  . "${profile_helper}"
  murph_review_gpt_profile_apply_browser_defaults "${review_gpt_profile_slug}" || true
fi

browser_binary_path="${browser_binary_path:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
managed_browser_user_data_dir="${managed_browser_user_data_dir:-$HOME/Library/Application Support/${MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME:-MurphReviewGPT/Phlebas}}"
managed_browser_profile="${managed_browser_profile:-${MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE:-Default}}"
managed_browser_port="${managed_browser_port:-${MURPH_REVIEW_GPT_PROFILE_PORT:-9442}}"

name_prefix="murph-chatgpt-data"
include_tests=0
include_docs=0
repomix_attachment_format="none"
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-data-context.sh"

review_gpt_register_dir_preset "data-model-composability" "data-model-composability-review.md" \
  "Review Murph's data structures and data model for simpler, more composable, and more scalable shapes." \
  "data-structures" \
  "data-model-review" \
  "composable-data-model" \
  "scalable-data-model"
