#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$#" -gt 1 ]]; then
  echo "Usage: bash scripts/release-check.sh [--preflight]" >&2
  exit 1
fi

readonly release_check_mode="${1:-}"
case "$release_check_mode" in
  "" | "--preflight")
    ;;
  *)
    echo "Usage: bash scripts/release-check.sh [--preflight]" >&2
    exit 1
    ;;
esac

bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh
node --check scripts/release-helpers.mjs
node --check scripts/release-artifact-secret-guard.mjs
node --check scripts/release-verification-plan.mjs
node --check scripts/verify-release-target.mjs
node --check scripts/pack-publishables.mjs
node --check scripts/publish-publishables.mjs
node --test scripts/release-artifact-secret-guard.test.mjs
node scripts/release-verification-plan.mjs --check
node scripts/verify-release-target.mjs
corepack pnpm build:workspace:clean

if [[ "$release_check_mode" == "--preflight" ]]; then
  corepack pnpm typecheck
  bash scripts/doc-gardening.sh --fail-on-issues
  exit 0
fi

corepack pnpm verify:acceptance
