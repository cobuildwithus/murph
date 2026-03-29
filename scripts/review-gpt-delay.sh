#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

delay="50m"
chat=""
response_file=""
prompt=""
has_no_zip_override=0
has_send_override=0
has_wait_override=0
has_response_file_override=0
has_prompt_override=0
declare -a forward_args=()

parse_delay_seconds() {
  local raw="$1"

  DELAY_INPUT="$raw" node <<'NODE'
const raw = (process.env.DELAY_INPUT ?? '').trim()
if (!raw) {
  console.error('Error: delay must not be empty.')
  process.exit(1)
}

const matches = [...raw.matchAll(/(\d+)\s*([smhd])/giu)]
if (matches.length === 0 || matches.map((match) => match[0]).join('') !== raw.replace(/\s+/gu, '')) {
  console.error(
    'Error: unsupported delay format. Use values like 300s, 50m, 1h, or 1h30m.',
  )
  process.exit(1)
}

const unitSeconds = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
}

const totalSeconds = matches.reduce((sum, match) => {
  const value = Number.parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  return sum + value * unitSeconds[unit]
}, 0)

if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
  console.error('Error: delay must resolve to a positive duration.')
  process.exit(1)
}

process.stdout.write(String(totalSeconds))
NODE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delay)
      [[ $# -ge 2 ]] || {
        echo "Error: --delay requires a value." >&2
        exit 1
      }
      delay="$2"
      shift 2
      ;;
    --delay=*)
      delay="${1#*=}"
      shift
      ;;
    --chat|--chat-url)
      [[ $# -ge 2 ]] || {
        echo "Error: $1 requires a value." >&2
        exit 1
      }
      chat="$2"
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --chat=*|--chat-url=*)
      chat="${1#*=}"
      forward_args+=("$1")
      shift
      ;;
    --response-file|--responseFile)
      [[ $# -ge 2 ]] || {
        echo "Error: $1 requires a value." >&2
        exit 1
      }
      response_file="$2"
      has_response_file_override=1
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --response-file=*|--responseFile=*)
      response_file="${1#*=}"
      has_response_file_override=1
      forward_args+=("$1")
      shift
      ;;
    --prompt)
      [[ $# -ge 2 ]] || {
        echo "Error: --prompt requires a value." >&2
        exit 1
      }
      prompt="$2"
      has_prompt_override=1
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --prompt=*)
      prompt="${1#*=}"
      has_prompt_override=1
      forward_args+=("$1")
      shift
      ;;
    --no-zip|--noZip|--zip)
      has_no_zip_override=1
      forward_args+=("$1")
      shift
      ;;
    --send|--submit|--no-send)
      has_send_override=1
      forward_args+=("$1")
      shift
      ;;
    --wait|--no-wait)
      has_wait_override=1
      forward_args+=("$1")
      shift
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$chat" ]]; then
  echo "Error: --chat-url or --chat is required." >&2
  exit 1
fi

if [[ "$has_response_file_override" == "0" ]]; then
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  response_file="output-packages/review-gpt-delay/${timestamp}.md"
  forward_args+=(--response-file "$response_file")
fi

mkdir -p "$(dirname "$response_file")"

if [[ "$has_prompt_override" == "0" ]]; then
  prompt="Check whether the requested implementation or patch has been returned in this chat. If it has, restate the implementation clearly in markdown and include any available patch or diff text inline. If it has not arrived yet, say that it is still pending."
  forward_args+=(--prompt "$prompt")
fi

if [[ "$has_no_zip_override" == "0" ]]; then
  forward_args+=(--noZip)
fi

if [[ "$has_send_override" == "0" ]]; then
  forward_args+=(--send)
fi

if [[ "$has_wait_override" == "0" ]]; then
  forward_args+=(--wait)
fi

delay_seconds="$(parse_delay_seconds "$delay")"
echo "Scheduling review:gpt check in ${delay} (${delay_seconds}s)." >&2
echo "Chat target: ${chat}" >&2
echo "Response file: ${response_file}" >&2

sleep "$delay_seconds"

exec pnpm review:gpt "${forward_args[@]}"
