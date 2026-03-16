#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_node="22.16.0"
pnpm_version="9.15.9"

log() {
  printf '[healthybob-setup] %s\n' "$*"
}

ensure_brew_shellenv() {
  if command -v brew >/dev/null 2>&1; then
    eval "$(brew shellenv)"
    return
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    return
  fi

  log 'Installing Homebrew...'
  NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    return
  fi

  printf 'Homebrew install finished, but brew is still unavailable.\n' >&2
  exit 1
}

has_required_node() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  node - <<'NODE'
const required = [22, 16, 0]
const current = process.versions.node.split('.').map((value) => Number.parseInt(value, 10))
for (let index = 0; index < required.length; index += 1) {
  const left = current[index] ?? 0
  const right = required[index] ?? 0
  if (left > right) {
    process.exit(0)
  }
  if (left < right) {
    process.exit(1)
  }
}
process.exit(0)
NODE
}

ensure_node() {
  if has_required_node; then
    log "Using Node $(node -p 'process.versions.node')"
    return
  fi

  ensure_brew_shellenv
  log "Installing node@22 so the repo can build Healthy Bob..."
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
  log "Using Node $(node -p 'process.versions.node')"
}

ensure_pnpm() {
  log "Activating pnpm@${pnpm_version} through corepack..."
  corepack enable
  corepack prepare "pnpm@${pnpm_version}" --activate
}

ensure_brew_shellenv
ensure_node
ensure_pnpm

log 'Installing workspace dependencies...'
corepack pnpm install

log 'Building Healthy Bob packages...'
corepack pnpm build

log 'Running Healthy Bob macOS setup...'
node packages/cli/dist/bin.js setup "$@"
