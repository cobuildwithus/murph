#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/review-gpt-protocol.sh <slug-or-family/protocol-slug> [review-gpt args...]

Example:
  pnpm review:gpt:protocol finnish-sauna --dry-run
  pnpm review:gpt:protocol dry-sauna/murph-finnish-standard-3x-week --dry-run
EOF
}

normalize_protocol_alias() {
  printf '%s\n' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-(protocol|experiment|routine|page)$//'
}

resolve_protocol_slug() {
  local input="$1"
  local normalized_input path relative matches

  if [[ "$input" =~ ^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$ ]]; then
    path="packages/health-commons/content/protocols/${input}.md"
    if [[ -f "$path" ]]; then
      printf '%s\n' "$input"
      return 0
    fi
  fi

  normalized_input="$(normalize_protocol_alias "$input")"
  matches="$(
    find packages/health-commons/content/protocols -mindepth 2 -maxdepth 2 -type f -name '*.md' | sort | while IFS= read -r path; do
      relative="${path#packages/health-commons/content/protocols/}"
      relative="${relative%.md}"
      {
        printf '%s\n' "$relative"
        basename "$relative"
        sed -n -E 's/^[[:space:]]*slug:[[:space:]]*"protocols\/([^"]+)".*/\1/p; s/^[[:space:]]*title:[[:space:]]*"([^"]+)".*/\1/p; s/^[[:space:]]*-[[:space:]]*"([^"]+)".*/\1/p' "$path"
      } | while IFS= read -r candidate; do
        [[ -n "$candidate" ]] || continue
        if [[ "$(normalize_protocol_alias "$candidate")" == "$normalized_input" ]]; then
          printf '%s\n' "$relative"
          break
        fi
      done
    done | sort -u
  )"

  if [[ -z "$matches" ]]; then
    return 1
  fi
  if [[ "$(printf '%s\n' "$matches" | wc -l | tr -d ' ')" != "1" ]]; then
    echo "Ambiguous protocol slug '$input'; matching Health Commons protocol slugs:" >&2
    printf '%s\n' "$matches" >&2
    return 2
  fi
  printf '%s\n' "$matches"
}

input_slug="${1:-}"
if [[ -z "$input_slug" || "$input_slug" == "-h" || "$input_slug" == "--help" ]]; then
  usage
  exit 1
fi
shift

if ! resolved_protocol_slug="$(resolve_protocol_slug "$input_slug")"; then
  echo "Could not map '$input_slug' to a Health Commons protocol slug." >&2
  echo "Try a canonical slug like dry-sauna/murph-finnish-standard-3x-week." >&2
  exit 1
fi
protocol_slug="$resolved_protocol_slug"

export MURPH_REVIEW_GPT_PROTOCOL_SLUG="$protocol_slug"

exec bash scripts/review-gpt-browser-profile.sh \
  review-gpt \
  phlebas \
  --config-path scripts/review-gpt-protocol-target.config.sh \
  "$@"
