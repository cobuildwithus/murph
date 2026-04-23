#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

thread_browser_endpoint="${MURPH_REVIEW_GPT_BROWSER_ENDPOINT:-http://127.0.0.1:${managed_browser_port:-9442}}"

vault_override=""
has_send_override=0
chat_url=""
declare -a forward_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      [[ $# -ge 2 ]] || {
        echo "Error: --vault requires a value." >&2
        exit 1
      }
      vault_override="$2"
      shift 2
      ;;
    --vault=*)
      vault_override="${1#*=}"
      shift
      ;;
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
    --send|--submit|--no-send)
      has_send_override=1
      forward_args+=("$1")
      shift
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$vault_override" ]]; then
  export VAULT="$vault_override"
fi

if [[ "$has_send_override" == "0" ]]; then
  forward_args=(--send "${forward_args[@]}")
fi

tmp_log_path="$(mktemp "${TMPDIR:-/tmp}/review-gpt-data.XXXXXX")"
declare -a review_gpt_command=(pnpm exec cobuild-review-gpt)

set +e
"${review_gpt_command[@]}" --config scripts/review-gpt.data.config.sh "${forward_args[@]}" 2>&1 | tee "$tmp_log_path"
command_status="${PIPESTATUS[0]}"
set -e

if [[ "$command_status" -ne 0 && -n "$chat_url" ]]; then
  set +e
  diagnostics_dir="$(
    "${review_gpt_command[@]}" thread diagnose \
      --browser-endpoint "$thread_browser_endpoint" \
      --chat-url "$chat_url" \
      --command-label review:gpt:data \
      --exit-code "$command_status" \
      --log-file "$tmp_log_path"
  )"
  diagnostics_status=$?
  set -e
  if [[ "$diagnostics_status" -eq 0 && -n "$diagnostics_dir" ]]; then
    echo "review:gpt:data diagnostics: ${diagnostics_dir}" >&2
  else
    echo "review:gpt:data diagnostics failed" >&2
  fi
fi

rm -f "$tmp_log_path"
exit "$command_status"
