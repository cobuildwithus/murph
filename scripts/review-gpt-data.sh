#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

vault_override=""
has_send_override=0
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

exec pnpm exec cobuild-review-gpt --config scripts/review-gpt.data.config.sh "${forward_args[@]}"
