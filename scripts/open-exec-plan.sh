#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == '--' ]]; then
  shift
fi

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
  echo "Usage: scripts/open-exec-plan.sh <slug> [title]"
  exit 0
fi

source scripts/repo-tools.config.sh
exec "$(cobuild_repo_tool_bin cobuild-open-exec-plan)" "$@"
