#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

delay="50m"
chat=""
label=""
response_file=""
prompt=""
has_no_zip_override=0
has_send_override=0
has_wait_override=0
has_response_file_override=0
has_prompt_override=0
has_review_input=0
retry_attempts=3
retry_delay="90s"
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
    --label)
      [[ $# -ge 2 ]] || {
        echo "Error: --label requires a value." >&2
        exit 1
      }
      label="$2"
      shift 2
      ;;
    --label=*)
      label="${1#*=}"
      shift
      ;;
    --retry-attempts)
      [[ $# -ge 2 ]] || {
        echo "Error: --retry-attempts requires a value." >&2
        exit 1
      }
      retry_attempts="$2"
      shift 2
      ;;
    --retry-attempts=*)
      retry_attempts="${1#*=}"
      shift
      ;;
    --retry-delay)
      [[ $# -ge 2 ]] || {
        echo "Error: --retry-delay requires a value." >&2
        exit 1
      }
      retry_delay="$2"
      shift 2
      ;;
    --retry-delay=*)
      retry_delay="${1#*=}"
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
    --prompt-file)
      [[ $# -ge 2 ]] || {
        echo "Error: --prompt-file requires a value." >&2
        exit 1
      }
      has_review_input=1
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --prompt-file=*)
      has_review_input=1
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
      has_review_input=1
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --prompt=*)
      prompt="${1#*=}"
      has_prompt_override=1
      has_review_input=1
      forward_args+=("$1")
      shift
      ;;
    --preset)
      [[ $# -ge 2 ]] || {
        echo "Error: --preset requires a value." >&2
        exit 1
      }
      has_review_input=1
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --preset=*)
      has_review_input=1
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
      if [[ "$1" != -* && "$1" != "true" && "$1" != "false" ]]; then
        has_review_input=1
      fi
      forward_args+=("$1")
      shift
      ;;
  esac
done

if ! [[ "$retry_attempts" =~ ^[0-9]+$ ]] || (( retry_attempts <= 0 )); then
  echo "Error: --retry-attempts must be a positive integer." >&2
  exit 1
fi

delay_seconds="$(parse_delay_seconds "$delay")"
retry_delay_seconds="$(parse_delay_seconds "$retry_delay")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
slug_input="${label:-${chat:-scheduled-review-gpt}}"
slug="$(
  printf '%s' "$slug_input" |
    tr '[:upper:]' '[:lower:]' |
    tr -cs 'a-z0-9' '-' |
    sed -E 's/^-+|-+$//g'
)"
if [[ -z "$slug" ]]; then
  slug="scheduled-review-gpt"
fi
run_dir="output-packages/review-gpt-delay/${timestamp}-${slug}-$$"
status_file="${run_dir}/status.json"
log_file="${run_dir}/run.log"
mkdir -p "$run_dir"

if [[ -n "$chat" && "$has_response_file_override" == "0" ]]; then
  response_file="${run_dir}/response.md"
  forward_args+=(--response-file "$response_file")
fi

if [[ "$has_prompt_override" == "0" ]]; then
  if [[ -n "$chat" ]]; then
    prompt="Check whether the requested implementation or patch has been returned in this chat. If it has, restate the implementation clearly in markdown and include any available patch or diff text inline. If it has not arrived yet, say that it is still pending."
    forward_args+=(--prompt "$prompt")
  elif [[ "$has_review_input" == "0" ]]; then
    echo "Error: for a new delayed send, pass --prompt, --prompt-file, or a preset." >&2
    exit 1
  fi
fi

if [[ -n "$chat" && "$has_no_zip_override" == "0" ]]; then
  forward_args+=(--prompt-only true)
fi

if [[ "$has_send_override" == "0" ]]; then
  forward_args+=(--send)
fi

if [[ -n "$chat" && "$has_wait_override" == "0" ]]; then
  forward_args+=(--wait)
fi

write_status() {
  local state="$1"
  local attempt="$2"
  local thread_url="$3"
  local last_error="$4"
  local remaining_seconds="$5"

  STATE="$state" ATTEMPT="$attempt" THREAD_URL="$thread_url" LAST_ERROR="$last_error" REMAINING_SECONDS="$remaining_seconds" \
    STATUS_FILE="$status_file" RUN_DIR="$run_dir" LOG_FILE="$log_file" CHAT_TARGET="$chat" RESPONSE_FILE="$response_file" \
    DELAY_TEXT="$delay" RETRY_DELAY_TEXT="$retry_delay" RETRY_ATTEMPTS="$retry_attempts" node <<'NODE'
const fs = require('node:fs')
const payload = {
  state: process.env.STATE,
  attemptCount: Number(process.env.ATTEMPT || '0'),
  chatTarget: process.env.CHAT_TARGET || '',
  delayedBy: process.env.DELAY_TEXT,
  logFile: process.env.LOG_FILE,
  responseFile: process.env.RESPONSE_FILE || '',
  retryAttempts: Number(process.env.RETRY_ATTEMPTS || '0'),
  retryDelay: process.env.RETRY_DELAY_TEXT,
  runDir: process.env.RUN_DIR,
  scheduledAt: new Date().toISOString(),
  threadUrl: process.env.THREAD_URL || '',
  lastError: process.env.LAST_ERROR || '',
}
const remaining = Number(process.env.REMAINING_SECONDS || '')
if (Number.isFinite(remaining) && remaining >= 0) payload.remainingSeconds = remaining
fs.writeFileSync(process.env.STATUS_FILE, `${JSON.stringify(payload, null, 2)}\n`)
NODE
}

echo "Scheduling review:gpt run in ${delay} (${delay_seconds}s)." >&2
echo "Mode: $([[ -n "$chat" ]] && echo "delayed follow-up" || echo "delayed new send")" >&2
echo "Run dir: ${run_dir}" >&2
echo "Log file: ${log_file}" >&2
[[ -n "$response_file" ]] && echo "Response file: ${response_file}" >&2

target_epoch="$(( $(date +%s) + delay_seconds ))"
while true; do
  now_epoch="$(date +%s)"
  remaining_seconds="$(( target_epoch - now_epoch ))"
  if (( remaining_seconds <= 0 )); then
    break
  fi
  write_status "scheduled" "0" "" "" "$remaining_seconds"
  sleep "$(( remaining_seconds > 60 ? 60 : remaining_seconds ))"
done

attempt=1
while (( attempt <= retry_attempts )); do
  write_status "running" "$attempt" "" "" "0"
  {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting attempt ${attempt}/${retry_attempts}"
    pnpm review:gpt "${forward_args[@]}"
  } >>"$log_file" 2>&1 && break

  last_error="review:gpt exited non-zero on attempt ${attempt}"
  if (( attempt == retry_attempts )); then
    write_status "failed" "$attempt" "" "$last_error" "0"
    echo "Delayed review:gpt run failed after ${attempt} attempt(s). See ${log_file}." >&2
    exit 1
  fi
  write_status "retrying" "$attempt" "" "$last_error" "$retry_delay_seconds"
  sleep "$retry_delay_seconds"
  attempt="$(( attempt + 1 ))"
done

thread_url="$(rg -o 'https://chatgpt\\.com/c/[A-Za-z0-9-]+' "$log_file" | tail -n1 || true)"
write_status "succeeded" "$attempt" "$thread_url" "" "0"
echo "Delayed review:gpt run completed on attempt ${attempt}." >&2
if [[ -n "$thread_url" ]]; then
  echo "Thread URL: ${thread_url}" >&2
fi
