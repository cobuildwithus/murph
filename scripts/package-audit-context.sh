#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
node --import=tsx scripts/clean-generated-source-artifacts.ts
node --import=tsx scripts/check-no-js.ts
source scripts/repo-tools.config.sh
node --import=tsx scripts/package-audit-context.ts "$@"
