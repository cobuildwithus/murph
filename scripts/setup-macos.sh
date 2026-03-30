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

BOLD='\033[1m'
ACCENT='\033[38;5;111m'
INFO='\033[38;5;110m'
SUCCESS='\033[38;5;78m'
WARN='\033[38;5;214m'
ERROR='\033[38;5;203m'
MUTED='\033[38;5;245m'
NC='\033[0m'

use_color() {
  [[ -t 1 && -z "${NO_COLOR:-}" ]]
}

print_banner() {
  if use_color; then
    echo -e "${ACCENT}${BOLD}Murph setup${NC}"
    echo -e "${MUTED}Repo-local bootstrap for the source checkout, with a cleaner handoff into onboarding.${NC}"
  else
    echo 'Murph setup'
    echo 'Repo-local bootstrap for the source checkout, with a cleaner handoff into onboarding.'
  fi
  echo
}

ui_section() {
  echo
  if use_color; then
    echo -e "${ACCENT}${BOLD}$*${NC}"
  else
    echo "$*"
  fi
}

ui_stage() {
  local index="$1"
  local total="$2"
  shift 2

  echo
  if use_color; then
    echo -e "${ACCENT}${BOLD}[${index}/${total}] $*${NC}"
  else
    echo "[${index}/${total}] $*"
  fi
}

ui_info() {
  if use_color; then
    echo -e "${INFO}·${NC} $*"
  else
    echo ". $*"
  fi
}

ui_success() {
  if use_color; then
    echo -e "${SUCCESS}✓${NC} $*"
  else
    echo "✓ $*"
  fi
}

ui_warn() {
  if use_color; then
    echo -e "${WARN}!${NC} $*"
  else
    echo "! $*"
  fi
}

ui_error() {
  if use_color; then
    echo -e "${ERROR}✗${NC} $*" >&2
  else
    echo "✗ $*" >&2
  fi
}

print_detected_os() {
  ui_success 'Detected: macos'
}

print_install_plan() {
  ui_section 'Install plan'
  printf 'OS: macos\n'
  printf 'Node requirement: >= %s\n' "$required_node"
  printf 'pnpm: %s via corepack\n' "$pnpm_version"
  printf '%s\n' 'Workspace flow: bootstrap tools -> install deps -> build workspace -> launch onboarding'
  printf '%s\n' 'Bootstrap scope:'
  printf '  - Homebrew, Node >= %s, and pnpm@%s via corepack\n' "$required_node" "$pnpm_version"
  printf '%s\n' '  - workspace dependencies and build output'
  printf '%s\n' '  - ffmpeg, poppler/pdftotext, whisper.cpp, and a local Whisper model'
  printf '%s\n' '  - PaddleX OCR on Apple Silicon unless you pass --skip-ocr'
  printf '%s\n' '  - vault bootstrap, default config, user-level murph/vault-cli shims, onboarding channel selection, wearables, and assistant automation/chat handoff'
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

  ui_warn 'Dry run requested. This wrapper will not modify the machine or workspace.'
  printf '%s\n' 'Planned wrapper steps:'
  printf '%s\n' '1. Ensure Homebrew is available.'
  printf '2. Ensure Node >= %s is available.\n' "$required_node"
  printf '3. Activate pnpm@%s through corepack.\n' "$pnpm_version"
  printf '%s\n' '4. Install workspace dependencies with `corepack pnpm install`.'
  printf '%s\n' '5. Build the workspace with `corepack pnpm build`.'
  if [ -n "$delegated_args" ]; then
    printf '6. Delegate to `node packages/cli/dist/bin.js onboard %s`.\n' "$delegated_args"
  else
    printf '%s\n' '6. Delegate to `node packages/cli/dist/bin.js onboard`.'
  fi
  printf '%s\n' 'Run the built setup entrypoint directly with `--dry-run` after bootstrap if you want the inner setup-step preview.'
}

active_node_version() {
  node -p 'process.versions.node'
}

active_pnpm_version() {
  pnpm --version 2>/dev/null || corepack pnpm --version 2>/dev/null || printf '%s\n' "$pnpm_version"
}

ensure_brew_shellenv() {
  if command -v brew >/dev/null 2>&1; then
    eval "$(brew shellenv)"
    ui_success 'Homebrew already installed'
    ui_info "Active brew: $(command -v brew)"
    return
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    ui_success 'Homebrew already installed'
    ui_info 'Active brew: /opt/homebrew/bin/brew'
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    ui_success 'Homebrew already installed'
    ui_info 'Active brew: /usr/local/bin/brew'
    return
  fi

  ui_info 'Installing Homebrew...'
  NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    ui_success 'Homebrew installed'
    ui_info 'Active brew: /opt/homebrew/bin/brew'
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    ui_success 'Homebrew installed'
    ui_info 'Active brew: /usr/local/bin/brew'
    return
  fi

  ui_error 'Homebrew install finished, but brew is still unavailable.'
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
    ui_success "Node.js v$(active_node_version) found"
    ui_info "Active Node.js: $(command -v node)"
    return
  fi

  ensure_brew_shellenv
  ui_info 'Installing node@22 so the repo can build Murph...'
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
  ui_success "Node.js v$(active_node_version) installed"
  ui_info "Active Node.js: $(command -v node)"
}

ensure_pnpm() {
  ui_info "Activating pnpm@${pnpm_version} through corepack..."
  corepack enable
  corepack prepare "pnpm@${pnpm_version}" --activate
  ui_success 'pnpm ready'
  ui_info "Active pnpm: $(active_pnpm_version)"
}

print_banner
print_detected_os
print_install_plan

if has_dry_run_flag "$@"; then
  print_dry_run_plan "$@"
  exit 0
fi

ui_stage 1 4 'Preparing environment'
ensure_brew_shellenv
ensure_node
ensure_pnpm

ui_stage 2 4 'Installing workspace dependencies'
ui_info 'Running corepack pnpm install'
corepack pnpm install
ui_success 'Workspace dependencies installed'

ui_stage 3 4 'Building Murph'
ui_info 'Running corepack pnpm build'
corepack pnpm build
ui_success 'Murph packages built'

ui_stage 4 4 'Starting onboarding'
ui_info 'Handing off to Murph onboarding'
node packages/cli/dist/bin.js onboard "$@"
