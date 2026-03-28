#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-release-check.XXXXXX")"
cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

pnpm install --frozen-lockfile
pnpm build
pnpm verify:repo

bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh
node --check scripts/release-helpers.mjs
node --check scripts/verify-release-target.mjs
node --check scripts/pack-publishables.mjs
node --check scripts/publish-publishables.mjs
node scripts/verify-release-target.mjs
node scripts/pack-publishables.mjs \
  --clean \
  --out-dir "$temp_dir/tarballs" \
  --pack-output "$temp_dir/pack-output.json"
