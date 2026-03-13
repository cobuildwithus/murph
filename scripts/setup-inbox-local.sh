#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

pnpm install
pnpm build
node packages/cli/dist/bin.js inbox bootstrap "$@"
