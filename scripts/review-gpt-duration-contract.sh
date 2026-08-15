#!/usr/bin/env bash

review_gpt_parse_positive_duration_ms() {
  local raw_value="$1"

  node - "$raw_value" <<'EOF'
const raw = process.argv[2].trim();
const normalized = raw.toLowerCase().replace(/\s+/g, '');

if (!normalized) {
  process.exit(1);
}

let durationMs;
if (/^\d+$/.test(normalized)) {
  durationMs = Number(normalized);
} else {
  let remainder = normalized;
  let total = 0;
  while (remainder.length > 0) {
    const match = remainder.match(/^(\d+)(ms|s|m|h)(.*)$/);
    if (!match) {
      process.exit(1);
    }
    const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
    total += Number(match[1]) * multipliers[match[2]];
    remainder = match[3];
  }
  durationMs = total;
}

if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
  process.exit(1);
}
process.stdout.write(String(durationMs));
EOF
}

review_gpt_require_pr_minimum_marked_response_time() {
  local duration_ms
  local label="$1"
  local raw_value="$2"

  if ! duration_ms="$(review_gpt_parse_positive_duration_ms "$raw_value")"; then
    echo "Error: $label must be a positive duration in milliseconds or units such as 5m or 1h2m." >&2
    return 64
  fi
  if (( duration_ms < 300000 )); then
    echo "Error: $label must be at least 5m for a PR ReviewGPT run." >&2
    return 64
  fi
}
