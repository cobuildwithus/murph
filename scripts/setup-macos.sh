#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'scripts/setup-macos.sh supports macOS only.\n' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_node="$(sed -nE 's/^[[:space:]]*"node":[[:space:]]*">=([^"]+)".*/\1/p' package.json | head -n 1)"
pnpm_version="$(sed -nE 's/^[[:space:]]*"packageManager":[[:space:]]*"pnpm@([^+\"]+).*/\1/p' package.json | head -n 1)"

if [ -z "$required_node" ] || [ -z "$pnpm_version" ]; then
  printf 'Unable to resolve Node/pnpm versions from package.json.\n' >&2
  exit 1
fi

log() {
  printf '[healthybob-setup] %s\n' "$*"
}

print_install_summary() {
  log 'Healthy Bob macOS setup will install or reuse:'
  printf '  - Homebrew, Node >= %s, and pnpm@%s via corepack\n' "$required_node" "$pnpm_version"
  printf '%s\n' '  - workspace dependencies and build output'
  printf '%s\n' '  - ffmpeg, poppler/pdftotext, whisper.cpp, and a local Whisper model'
  printf '%s\n' '  - PaddleX OCR on Apple Silicon unless you pass --skip-ocr'
  printf '%s\n' '  - the final Healthy Bob setup flow: vault bootstrap, default vault config, user-level healthybob/vault-cli shims, and assistant chat'
}

has_dry_run_flag() {
  for arg in "$@"; do
    case "$arg" in
      --dryRun|--dry-run|--dryRun=*|--dry-run=*)
        return 0
        ;;
    esac
  done

  return 1
}

render_command_args() {
  local rendered=()

  for arg in "$@"; do
    rendered+=("$(printf '%q' "$arg")")
  done

  printf '%s' "${rendered[*]}"
}

print_dry_run_plan() {
  local delegated_args

  delegated_args="$(render_command_args "$@")"

  log 'Dry run requested. This wrapper will not modify the machine or workspace.'
  print_install_summary
  printf '%s\n' 'Planned wrapper steps:'
  printf '1. Ensure Homebrew is available.\n'
  printf '2. Ensure Node >= %s is available.\n' "$required_node"
  printf '3. Activate pnpm@%s through corepack.\n' "$pnpm_version"
  printf '%s\n' '4. Install workspace dependencies with `corepack pnpm install`.'
  printf '%s\n' '5. Build the workspace with `corepack pnpm build`.'
  if [ -n "$delegated_args" ]; then
    printf '6. Delegate to `node packages/cli/dist/bin.js setup %s`.\n' "$delegated_args"
  else
    printf '%s\n' '6. Delegate to `node packages/cli/dist/bin.js setup`.'
  fi
  printf '%s\n' 'Run the built setup entrypoint directly with `--dry-run` after bootstrap if you want the inner setup-step preview.'
}

if has_dry_run_flag "$@"; then
  print_dry_run_plan "$@"
  exit 0
fi

print_install_summary

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

  REQUIRED_NODE_VERSION="$required_node" node - <<'NODE'
const required = (process.env.REQUIRED_NODE_VERSION ?? '')
  .split('.')
  .map((value) => Number.parseInt(value, 10))
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
