#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ $# -gt 0 && -e "agent-docs/exec-plans/completed/$(basename "$1")" ]]; then
  echo "Completed plan already exists; choose a distinct plan filename." >&2
  exit 1
fi
source scripts/repo-tools.config.sh
exec "$(cobuild_repo_tool_bin cobuild-close-exec-plan)" "$@"
