#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

corepack pnpm install --frozen-lockfile
corepack pnpm build
node packages/cli/dist/bin.js inbox bootstrap "$@"
