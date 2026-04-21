#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

config_path="$ROOT_DIR/scripts/review-gpt.config.sh"
chat_url=""
declare -a forward_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chat-url)
      [[ $# -ge 2 ]] || {
        echo "Error: --chat-url requires a value." >&2
        exit 1
      }
      chat_url="$2"
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --chat-url=*)
      chat_url="${1#*=}"
      forward_args+=("$1")
      shift
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

tmp_log_path="$(mktemp "${TMPDIR:-/tmp}/review-gpt.XXXXXX")"
declare -a review_gpt_args=()

if [[ "${#forward_args[@]}" -gt 0 ]]; then
  case "${forward_args[0]}" in
    thread)
      review_gpt_args=("${forward_args[@]}")
      ;;
    delay)
      review_gpt_args=("${forward_args[0]}" --config "$config_path" "${forward_args[@]:1}")
      ;;
    *)
      review_gpt_args=(--config "$config_path" "${forward_args[@]}")
      ;;
  esac
else
  review_gpt_args=(--config "$config_path")
fi

set +e
bash scripts/review-gpt-cli.sh "${review_gpt_args[@]}" 2>&1 | tee "$tmp_log_path"
command_status="${PIPESTATUS[0]}"
set -e

if [[ "$command_status" -ne 0 && -n "$chat_url" ]]; then
  set +e
  diagnostics_dir="$(
    bash scripts/review-gpt-cli.sh thread diagnose \
      --chat-url "$chat_url" \
      --command-label review:gpt \
      --exit-code "$command_status" \
      --log-file "$tmp_log_path"
  )"
  diagnostics_status=$?
  set -e
  if [[ "$diagnostics_status" -eq 0 && -n "$diagnostics_dir" ]]; then
    echo "review:gpt diagnostics: ${diagnostics_dir}" >&2
  else
    echo "review:gpt diagnostics failed" >&2
  fi
fi

rm -f "$tmp_log_path"
exit "$command_status"
