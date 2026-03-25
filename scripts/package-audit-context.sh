#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
node --import=tsx scripts/check-no-js.ts
source scripts/repo-tools.config.sh
exec "$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"
