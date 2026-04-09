#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh
node --check scripts/release-helpers.mjs
node --check scripts/verify-release-target.mjs
node --check scripts/pack-publishables.mjs
node --check scripts/publish-publishables.mjs
node scripts/verify-release-target.mjs
corepack pnpm build:workspace:clean
corepack pnpm verify:acceptance
