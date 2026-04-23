#!/usr/bin/env bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
profile_helper="${repo_root}/scripts/review-gpt-browser-profile.sh"
default_browser_binary="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
default_browser_user_data_dir="$HOME/Library/Application Support/MurphReviewGPT/Phlebas"

if [[ -x "${profile_helper}" ]]; then
  phlebas_browser_binary="$("${profile_helper}" browser-binary phlebas 2>/dev/null || true)"
  phlebas_user_data_dir="$("${profile_helper}" user-data-dir phlebas 2>/dev/null || true)"
  if [[ -n "${phlebas_browser_binary}" ]]; then
    default_browser_binary="${phlebas_browser_binary}"
  fi
  if [[ -n "${phlebas_user_data_dir}" ]]; then
    default_browser_user_data_dir="${phlebas_user_data_dir}"
  fi
fi

browser_binary_path="${browser_binary_path:-${default_browser_binary}}"
managed_browser_user_data_dir="${managed_browser_user_data_dir:-${default_browser_user_data_dir}}"
managed_browser_profile="${managed_browser_profile:-Default}"
managed_browser_port="${managed_browser_port:-9442}"

name_prefix="murph-chatgpt-data"
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-data-context.sh"

review_gpt_register_dir_preset "data-model-composability" "data-model-composability-review.md" \
  "Review Murph's data structures and data model for simpler, more composable, and more scalable shapes." \
  "data-structures" \
  "data-model-review" \
  "composable-data-model" \
  "scalable-data-model"
