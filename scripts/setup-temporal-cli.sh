#!/usr/bin/env bash
set -euo pipefail

check_only=0
if [[ "${1:-}" == "--check" ]]; then
  check_only=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: pnpm temporal:cli:setup [--check]" >&2
  exit 2
fi

if command -v temporal >/dev/null 2>&1; then
  temporal --version
  exit 0
fi

if [[ "$check_only" -eq 1 ]]; then
  echo "Temporal CLI is not installed or is not on PATH." >&2
  exit 127
fi

if command -v brew >/dev/null 2>&1; then
  brew install temporal
  temporal --version
  exit 0
fi

cat >&2 <<'EOF'
Temporal CLI is required for local Temporal development.

Install it with Homebrew:
  brew install temporal

Or download the official binary for your OS and architecture:
  https://temporal.io/setup/install-temporal-cli
EOF
exit 127
