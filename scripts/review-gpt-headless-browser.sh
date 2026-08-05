#!/usr/bin/env bash
set -euo pipefail

review_gpt_headless_script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
review_gpt_headless_repo_root="$(CDPATH= cd -- "$review_gpt_headless_script_dir/.." && pwd -P)"
review_gpt_headless_profile_display=""

for review_gpt_headless_arg in "$@"; do
  case "$review_gpt_headless_arg" in
    --user-data-dir=*)
      review_gpt_headless_profile_display="$(basename "${review_gpt_headless_arg#--user-data-dir=}")"
      ;;
  esac
done

review_gpt_headless_browser_binary="${REVIEW_GPT_HEADLESS_BROWSER_BINARY:-}"
if [[ -z "$review_gpt_headless_browser_binary" ]]; then
  case "$review_gpt_headless_profile_display" in
    Eragon | Phlebas | Hercules | Mountain)
      review_gpt_headless_lane="$(printf '%s' "$review_gpt_headless_profile_display" | tr '[:upper:]' '[:lower:]')"
      review_gpt_headless_lane_binary="$review_gpt_headless_repo_root/output-packages/review-gpt-profiles/$review_gpt_headless_lane/$review_gpt_headless_profile_display.app/Contents/MacOS/Brave Browser"
      if [[ -x "$review_gpt_headless_lane_binary" ]]; then
        review_gpt_headless_browser_binary="$review_gpt_headless_lane_binary"
      fi
      ;;
  esac
fi

if [[ -z "$review_gpt_headless_browser_binary" ]] \
  && [[ -x "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" ]]; then
  review_gpt_headless_browser_binary="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
fi

if [[ -z "$review_gpt_headless_browser_binary" ]]; then
  for review_gpt_headless_candidate in brave-browser brave-browser-stable brave chromium chromium-browser google-chrome google-chrome-stable; do
    if review_gpt_headless_browser_binary="$(command -v "$review_gpt_headless_candidate" 2>/dev/null)" \
      && [[ -n "$review_gpt_headless_browser_binary" ]]; then
      break
    fi
  done
fi

if [[ -z "$review_gpt_headless_browser_binary" ]] \
  || [[ ! -x "$review_gpt_headless_browser_binary" ]]; then
  echo "Error: no Chromium-compatible browser is available for headless ReviewGPT." >&2
  exit 1
fi

exec "$review_gpt_headless_browser_binary" --headless=new "$@"
