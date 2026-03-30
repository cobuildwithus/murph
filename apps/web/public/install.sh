#!/usr/bin/env bash
set -euo pipefail

# Murph installer for macOS and Linux.
# Recommended usage:
#   curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash
# Examples:
#   curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash
#   curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- --no-onboard --vault ./vault
#   curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- --install-method git --git-dir ~/murph --vault ./vault

BOLD='\033[1m'
ACCENT='\033[38;5;111m'
INFO='\033[38;5;110m'
SUCCESS='\033[38;5;78m'
WARN='\033[38;5;214m'
ERROR='\033[38;5;203m'
MUTED='\033[38;5;245m'
NC='\033[0m'

MURPH_REQUIRED_NODE_VERSION="${MURPH_REQUIRED_NODE_VERSION:-22.16.0}"
MURPH_NODE_LINE="${MURPH_NODE_LINE:-22}"
MURPH_REPO_URL="${MURPH_REPO_URL:-https://github.com/cobuildwithus/murph.git}"
MURPH_INSTALL_METHOD="${MURPH_INSTALL_METHOD:-auto}"
MURPH_VERSION="${MURPH_VERSION:-latest}"
MURPH_BETA="${MURPH_BETA:-0}"
MURPH_GIT_DIR="${MURPH_GIT_DIR:-${HOME}/.local/share/murph/repo}"
MURPH_GIT_UPDATE="${MURPH_GIT_UPDATE:-1}"
MURPH_NO_ONBOARD="${MURPH_NO_ONBOARD:-0}"
MURPH_DRY_RUN="${MURPH_DRY_RUN:-0}"
MURPH_NO_PROMPT="${MURPH_NO_PROMPT:-0}"
MURPH_VERBOSE="${MURPH_VERBOSE:-0}"
MURPH_NPM_LOGLEVEL="${MURPH_NPM_LOGLEVEL:-error}"

OS="unknown"
DOWNLOADER=""
TMPFILES=()
FORWARD_ARGS=()
HELP=0
ORIGINAL_PATH="${PATH:-}"
BREW_BIN=""
SELECTED_METHOD=""
DETECTED_CHECKOUT=""

cleanup_tmpfiles() {
  local f
  for f in "${TMPFILES[@]:-}"; do
    rm -rf "$f" 2>/dev/null || true
  done
}
trap cleanup_tmpfiles EXIT

mktempfile() {
  local f
  f="$(mktemp)"
  TMPFILES+=("$f")
  echo "$f"
}

use_color() {
  [[ -t 1 && -z "${NO_COLOR:-}" ]]
}

print_banner() {
  if use_color; then
    echo -e "${ACCENT}${BOLD}Murph installer${NC}"
    echo -e "${MUTED}One command to install Murph and launch setup on macOS or Linux.${NC}"
  else
    echo "Murph installer"
    echo "One command to install Murph and launch setup on macOS or Linux."
  fi
  echo
}

ui_info() {
  if use_color; then
    echo -e "${INFO}•${NC} $*"
  else
    echo "- $*"
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

ui_section() {
  echo
  if use_color; then
    echo -e "${ACCENT}${BOLD}$*${NC}"
  else
    echo "$*"
  fi
}

print_usage() {
  cat <<EOF_USAGE
Murph installer (macOS + Linux)

Usage:
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- [installer-options] [murph-setup-options]

Installer options:
  --install-method, --method auto|npm|git  Choose install strategy (default: auto)
  --npm                                    Shortcut for --install-method npm
  --git, --github                          Shortcut for --install-method git
  --version <version|dist-tag|git-ref>     npm version/dist-tag or git ref (default: latest)
  --beta                                   Prefer npm beta dist-tag when available
  --git-dir, --dir <path>                  Checkout directory for git installs (default: ~/.local/share/murph/repo)
  --repo <url>                             Override the git repository URL
  --no-git-update                          Skip git pull for existing checkouts
  --no-onboard                             Install Murph without interactive onboarding
  --dry-run                                Print the install plan without making changes
  --no-prompt                              Disable installer prompts
  --verbose                                Print command output while installing
  --help, -h                               Show this help text

Murph setup flags are forwarded automatically, including:
  --vault <path>
  --whisperModel <model>
  --assistantPreset <preset>
  --assistantModel <model>
  --assistantBaseUrl <url>
  --assistantApiKeyEnv <env_var>
  --assistantProviderName <label>
  --assistantCodexCommand <path>
  --assistantProfile <name>
  --assistantReasoningEffort <level>
  --rebuild
  --strict / --no-strict
  --requestId <id>
  --format <toon|json|yaml|md|jsonl>

Examples:
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- --no-onboard --vault ./vault
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- --install-method git --git-dir ~/murph --vault ./vault
  curl -fsSL --proto '=https' --tlsv1.2 https://YOUR_DOMAIN/install.sh | bash -s -- --version beta --vault ./vault

Environment variables:
  MURPH_INSTALL_METHOD=auto|npm|git
  MURPH_VERSION=latest|beta|<semver>|<git-ref>
  MURPH_BETA=0|1
  MURPH_GIT_DIR=/path/to/checkout
  MURPH_GIT_UPDATE=0|1
  MURPH_NO_ONBOARD=0|1
  MURPH_DRY_RUN=0|1
  MURPH_NO_PROMPT=0|1
  MURPH_VERBOSE=0|1
  MURPH_REPO_URL=https://github.com/cobuildwithus/murph.git
  MURPH_REQUIRED_NODE_VERSION=22.16.0
EOF_USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-method|--method)
        MURPH_INSTALL_METHOD="$2"
        shift 2
        ;;
      --npm)
        MURPH_INSTALL_METHOD="npm"
        shift
        ;;
      --git|--github)
        MURPH_INSTALL_METHOD="git"
        shift
        ;;
      --version)
        MURPH_VERSION="$2"
        shift 2
        ;;
      --beta)
        MURPH_BETA=1
        shift
        ;;
      --git-dir|--dir)
        MURPH_GIT_DIR="$2"
        shift 2
        ;;
      --repo)
        MURPH_REPO_URL="$2"
        shift 2
        ;;
      --no-git-update)
        MURPH_GIT_UPDATE=0
        shift
        ;;
      --no-onboard)
        MURPH_NO_ONBOARD=1
        shift
        ;;
      --dry-run)
        MURPH_DRY_RUN=1
        shift
        ;;
      --no-prompt)
        MURPH_NO_PROMPT=1
        shift
        ;;
      --verbose)
        MURPH_VERBOSE=1
        shift
        ;;
      --help|-h)
        HELP=1
        shift
        ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do
          FORWARD_ARGS+=("$1")
          shift
        done
        ;;
      *)
        FORWARD_ARGS+=("$1")
        if [[ "$1" != *=* && $# -gt 1 && "$2" != -* ]]; then
          FORWARD_ARGS+=("$2")
          shift 2
        else
          shift
        fi
        ;;
    esac
  done
}

configure_verbose() {
  if [[ "$MURPH_VERBOSE" == "1" ]]; then
    set -x
    if [[ "$MURPH_NPM_LOGLEVEL" == "error" ]]; then
      MURPH_NPM_LOGLEVEL="notice"
    fi
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

detect_downloader() {
  if command_exists curl; then
    DOWNLOADER="curl"
    return 0
  fi
  if command_exists wget; then
    DOWNLOADER="wget"
    return 0
  fi
  ui_error "Missing downloader (curl or wget required)."
  exit 1
}

download_file() {
  local url="$1"
  local output="$2"

  if [[ -z "$DOWNLOADER" ]]; then
    detect_downloader
  fi

  if [[ "$DOWNLOADER" == "curl" ]]; then
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 --retry-connrefused -o "$output" "$url"
    return
  fi

  wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 --timeout=20 -O "$output" "$url"
}

run_remote_bash() {
  local url="$1"
  local tmp
  tmp="$(mktempfile)"
  download_file "$url" "$tmp"
  /bin/bash "$tmp"
}

detect_os_or_die() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin)
      OS="macos"
      ;;
    Linux)
      OS="linux"
      ;;
    *)
      ui_error "Unsupported operating system."
      echo "Murph install.sh currently supports macOS and Linux only." >&2
      exit 1
      ;;
  esac

  if [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
    OS="linux"
  fi

  ui_success "Detected ${OS}"
}

version_gte() {
  local left="$1"
  local right="$2"
  local IFS=.
  local -a left_parts right_parts
  read -r -a left_parts <<<"$left"
  read -r -a right_parts <<<"$right"
  local count="${#left_parts[@]}"
  if [[ "${#right_parts[@]}" -gt "$count" ]]; then
    count="${#right_parts[@]}"
  fi
  local i left_value right_value
  for ((i = 0; i < count; i += 1)); do
    left_value="${left_parts[i]:-0}"
    right_value="${right_parts[i]:-0}"
    if ((10#$left_value > 10#$right_value)); then
      return 0
    fi
    if ((10#$left_value < 10#$right_value)); then
      return 1
    fi
  done
  return 0
}

current_node_version() {
  if ! command_exists node; then
    return 1
  fi
  node -p 'process.versions.node' 2>/dev/null || true
}

has_required_node() {
  local version
  version="$(current_node_version || true)"
  if [[ -z "$version" ]]; then
    return 1
  fi
  version_gte "$version" "$MURPH_REQUIRED_NODE_VERSION"
}

print_active_node() {
  if command_exists node; then
    ui_info "Using Node $(node -p 'process.versions.node' 2>/dev/null || echo unknown) at $(command -v node)"
  fi
  if command_exists npm; then
    ui_info "Using npm $(npm -v 2>/dev/null || echo unknown) at $(command -v npm)"
  fi
}

resolve_brew_bin() {
  if command_exists brew; then
    command -v brew
    return 0
  fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    echo /opt/homebrew/bin/brew
    return 0
  fi
  if [[ -x /usr/local/bin/brew ]]; then
    echo /usr/local/bin/brew
    return 0
  fi
  return 1
}

activate_brew_for_session() {
  local brew_bin
  brew_bin="$(resolve_brew_bin || true)"
  if [[ -z "$brew_bin" ]]; then
    return 1
  fi
  eval "$($brew_bin shellenv)"
  BREW_BIN="$brew_bin"
  hash -r 2>/dev/null || true
  return 0
}

is_root() {
  [[ "$(id -u)" -eq 0 ]]
}

is_macos_admin_user() {
  if [[ "$OS" != "macos" ]]; then
    return 0
  fi
  if is_root; then
    return 0
  fi
  id -Gn "$(id -un)" 2>/dev/null | grep -qw admin
}

install_homebrew() {
  if [[ "$OS" != "macos" ]]; then
    return 0
  fi

  if activate_brew_for_session; then
    ui_success "Homebrew available"
    return 0
  fi

  if ! is_macos_admin_user; then
    ui_error "Homebrew installation requires a macOS Administrator account."
    echo "Use an admin account or ask an administrator to install Homebrew first, then rerun this installer." >&2
    exit 1
  fi

  ui_info "Installing Homebrew"
  NONINTERACTIVE=1 CI=1 run_remote_bash "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"

  if ! activate_brew_for_session; then
    ui_error "Homebrew install finished, but brew is still unavailable in this shell."
    exit 1
  fi

  ui_success "Homebrew installed"
}

ensure_macos_node() {
  if has_required_node; then
    print_active_node
    return 0
  fi

  install_homebrew
  ui_info "Installing node@${MURPH_NODE_LINE} with Homebrew"
  "$BREW_BIN" install "node@${MURPH_NODE_LINE}"

  local node_prefix
  node_prefix="$($BREW_BIN --prefix "node@${MURPH_NODE_LINE}" 2>/dev/null || true)"
  if [[ -n "$node_prefix" && -d "$node_prefix/bin" ]]; then
    PATH="$node_prefix/bin:$PATH"
    export PATH
    hash -r 2>/dev/null || true
  fi

  if ! has_required_node; then
    ui_error "Node ${MURPH_REQUIRED_NODE_VERSION}+ is required, but the active shell still does not see it."
    if [[ -n "$node_prefix" ]]; then
      echo "Add this to your shell profile and rerun the installer:" >&2
      echo "  export PATH=\"${node_prefix}/bin:\$PATH\"" >&2
    fi
    exit 1
  fi

  ui_success "Node ready"
  print_active_node
}

normalize_linux_arch() {
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64)
      echo x64
      ;;
    aarch64|arm64)
      echo arm64
      ;;
    *)
      return 1
      ;;
  esac
}

bootstrap_linux_node() {
  if has_required_node; then
    print_active_node
    return 0
  fi

  local linux_arch
  linux_arch="$(normalize_linux_arch)" || {
    ui_error "Unsupported Linux architecture. Murph currently supports x64 and arm64 bootstrap binaries."
    exit 1
  }

  local bootstrap_root="${HOME}/.murph/bootstrap"
  local node_dir="${bootstrap_root}/node-v${MURPH_REQUIRED_NODE_VERSION}-linux-${linux_arch}"
  local node_bin="${node_dir}/bin/node"
  if [[ -x "$node_bin" ]]; then
    PATH="${node_dir}/bin:$PATH"
    export PATH
    hash -r 2>/dev/null || true
    if has_required_node; then
      ui_success "Reusing cached Node bootstrap"
      print_active_node
      return 0
    fi
  fi

  mkdir -p "$bootstrap_root"

  local archive_name="node-v${MURPH_REQUIRED_NODE_VERSION}-linux-${linux_arch}.tar.xz"
  local archive_path="${bootstrap_root}/${archive_name}"
  local extract_root="${bootstrap_root}/.extract-node-v${MURPH_REQUIRED_NODE_VERSION}-${linux_arch}-$$"

  rm -rf "$extract_root"
  mkdir -p "$extract_root"

  ui_info "Downloading Node ${MURPH_REQUIRED_NODE_VERSION} for Linux ${linux_arch} into ${bootstrap_root}"
  download_file "https://nodejs.org/dist/v${MURPH_REQUIRED_NODE_VERSION}/${archive_name}" "$archive_path"

  tar -xJf "$archive_path" -C "$extract_root"
  rm -f "$archive_path"
  rm -rf "$node_dir"
  mv "${extract_root}/node-v${MURPH_REQUIRED_NODE_VERSION}-linux-${linux_arch}" "$node_dir"
  rm -rf "$extract_root"

  if [[ ! -x "$node_bin" ]]; then
    ui_error "Node bootstrap finished, but ${node_bin} is missing."
    exit 1
  fi

  PATH="${node_dir}/bin:$PATH"
  export PATH
  hash -r 2>/dev/null || true

  if ! has_required_node; then
    ui_error "Node ${MURPH_REQUIRED_NODE_VERSION}+ is required, but bootstrap activation failed."
    exit 1
  fi

  ui_success "Node ready"
  print_active_node
}

ensure_node() {
  if [[ "$OS" == "macos" ]]; then
    ensure_macos_node
  else
    bootstrap_linux_node
  fi
}

require_sudo() {
  if is_root; then
    return 0
  fi
  if ! command_exists sudo; then
    ui_error "sudo is required for this step on Linux."
    exit 1
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    ui_info "Administrator privileges are required; you may be prompted for your password"
    sudo -v
  fi
}

install_git_linux() {
  require_sudo
  if command_exists apt-get; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq git
    return 0
  fi
  if command_exists dnf; then
    sudo dnf install -y -q git
    return 0
  fi
  if command_exists yum; then
    sudo yum install -y -q git
    return 0
  fi
  if command_exists apk; then
    sudo apk add --no-cache git
    return 0
  fi
  if command_exists pacman; then
    sudo pacman -Sy --noconfirm git
    return 0
  fi
  ui_error "Could not detect a supported Linux package manager to install git."
  exit 1
}

ensure_git() {
  if command_exists git; then
    ui_success "Git available"
    return 0
  fi

  if [[ "$OS" == "macos" ]]; then
    install_homebrew
    ui_info "Installing Git with Homebrew"
    "$BREW_BIN" install git
  else
    ui_info "Installing Git"
    install_git_linux
  fi

  if ! command_exists git; then
    ui_error "Git installation failed."
    exit 1
  fi

  ui_success "Git ready"
}

npm_prefix_writable() {
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -z "$prefix" || "$prefix" == "undefined" || "$prefix" == "null" ]]; then
    return 1
  fi
  [[ -w "$prefix" || -w "${prefix}/lib" || -w "${prefix}/bin" ]]
}

ensure_npm_user_prefix() {
  if npm_prefix_writable; then
    return 0
  fi

  local prefix="${HOME}/.npm-global"
  mkdir -p "$prefix"
  npm config set prefix "$prefix" >/dev/null 2>&1
  export PATH="${prefix}/bin:$PATH"
  hash -r 2>/dev/null || true
  ui_info "Configured npm to use ${prefix} for global installs"
}

npm_global_bin_dir() {
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "$prefix" && "$prefix" != "undefined" && "$prefix" != "null" ]]; then
    echo "${prefix%/}/bin"
    return 0
  fi
  return 1
}

resolve_murph_bin() {
  if command_exists murph; then
    command -v murph
    return 0
  fi

  local npm_bin
  npm_bin="$(npm_global_bin_dir || true)"
  if [[ -n "$npm_bin" && -x "${npm_bin}/murph" ]]; then
    echo "${npm_bin}/murph"
    return 0
  fi

  if [[ -x "${HOME}/.local/bin/murph" ]]; then
    echo "${HOME}/.local/bin/murph"
    return 0
  fi

  return 1
}

detect_murph_checkout() {
  local dir="$1"
  if [[ ! -f "$dir/package.json" ]]; then
    return 1
  fi
  if [[ ! -f "$dir/scripts/setup-host.sh" ]]; then
    return 1
  fi
  if [[ ! -f "$dir/packages/cli/package.json" ]]; then
    return 1
  fi
  if ! grep -q '"name"[[:space:]]*:[[:space:]]*"murph-workspace"' "$dir/package.json" 2>/dev/null; then
    return 1
  fi
  if ! grep -q '"name"[[:space:]]*:[[:space:]]*"murph"' "$dir/packages/cli/package.json" 2>/dev/null; then
    return 1
  fi
  echo "$dir"
  return 0
}

is_promptable() {
  if [[ "$MURPH_NO_PROMPT" == "1" ]]; then
    return 1
  fi
  [[ -r /dev/tty && -w /dev/tty ]]
}

prompt_choice() {
  local prompt="$1"
  local answer=""
  if ! is_promptable; then
    return 1
  fi
  printf '%b' "$prompt" > /dev/tty
  read -r answer < /dev/tty || true
  echo "$answer"
}

choose_install_method_for_checkout() {
  if ! is_promptable; then
    echo git
    return 0
  fi

  local answer
  answer="$(prompt_choice "Detected a Murph source checkout in ${DETECTED_CHECKOUT}.\nChoose install method:\n  1) use this checkout (git)\n  2) install the published npm package\nEnter 1 or 2: ")"
  case "$answer" in
    1) echo git ;;
    2) echo npm ;;
    *) echo git ;;
  esac
}

version_looks_like_raw_npm_spec() {
  local value="$1"
  [[ "$value" == github:* || "$value" == git+* || "$value" == file:* || "$value" == http:* || "$value" == https:* || "$value" == npm:* || "$value" == ./* || "$value" == ../* || "$value" == /* ]]
}

resolve_beta_version() {
  npm view murph dist-tags.beta 2>/dev/null || true
}

resolve_npm_install_spec() {
  local version="$MURPH_VERSION"

  if [[ "$MURPH_BETA" == "1" && "$version" == "latest" ]]; then
    local beta
    beta="$(resolve_beta_version)"
    if [[ -n "$beta" && "$beta" != "undefined" && "$beta" != "null" ]]; then
      version="$beta"
      ui_info "Using Murph beta tag ${beta}"
    else
      ui_warn "No npm beta dist-tag found for murph; falling back to latest"
      version="latest"
    fi
  fi

  if version_looks_like_raw_npm_spec "$version"; then
    echo "$version"
    return 0
  fi

  echo "murph@${version}"
}

npm_package_available() {
  local spec
  spec="$(resolve_npm_install_spec)"
  npm view "$spec" version >/dev/null 2>&1
}

select_install_method() {
  DETECTED_CHECKOUT="$(detect_murph_checkout "$PWD" || true)"

  case "$MURPH_INSTALL_METHOD" in
    auto)
      if [[ -n "$DETECTED_CHECKOUT" ]]; then
        SELECTED_METHOD="$(choose_install_method_for_checkout)"
        return 0
      fi

      ensure_node
      if npm_package_available; then
        SELECTED_METHOD="npm"
      else
        ui_warn "Published npm package is unavailable for ${MURPH_VERSION}; falling back to git checkout install"
        SELECTED_METHOD="git"
      fi
      ;;
    npm|git)
      SELECTED_METHOD="$MURPH_INSTALL_METHOD"
      ;;
    *)
      ui_error "Invalid --install-method: ${MURPH_INSTALL_METHOD}"
      echo "Use auto, npm, or git." >&2
      exit 2
      ;;
  esac
}

select_install_method_for_dry_run() {
  DETECTED_CHECKOUT="$(detect_murph_checkout "$PWD" || true)"

  case "$MURPH_INSTALL_METHOD" in
    auto)
      if [[ -n "$DETECTED_CHECKOUT" ]]; then
        SELECTED_METHOD="git"
      else
        SELECTED_METHOD="auto (npm first, git fallback)"
      fi
      ;;
    npm|git)
      SELECTED_METHOD="$MURPH_INSTALL_METHOD"
      ;;
    *)
      ui_error "Invalid --install-method: ${MURPH_INSTALL_METHOD}"
      echo "Use auto, npm, or git." >&2
      exit 2
      ;;
  esac
}

forward_args_contain_format() {
  local arg
  for arg in "${FORWARD_ARGS[@]}"; do
    case "$arg" in
      --format|--format=*)
        return 0
        ;;
    esac
  done
  return 1
}

build_setup_args() {
  local -n out_ref=$1
  out_ref=("${FORWARD_ARGS[@]}")
  if [[ "$MURPH_NO_ONBOARD" == "1" ]] && ! forward_args_contain_format; then
    out_ref+=("--format" "md")
  fi
}

can_attach_tty_for_onboarding() {
  if [[ "$MURPH_NO_ONBOARD" == "1" ]]; then
    return 1
  fi
  if ! is_promptable; then
    return 1
  fi
  if forward_args_contain_format; then
    return 1
  fi
  return 0
}

run_cmd() {
  if [[ "$MURPH_VERBOSE" == "1" ]]; then
    "$@"
    return
  fi

  local log
  log="$(mktempfile)"
  if "$@" >"$log" 2>&1; then
    return 0
  fi

  local status=$?
  cat "$log" >&2 || true
  return "$status"
}

install_from_npm() {
  ui_section "Installing Murph via npm"
  ensure_node
  ensure_npm_user_prefix

  local spec
  spec="$(resolve_npm_install_spec)"
  ui_info "Installing ${spec}"
  if ! run_cmd npm --loglevel "$MURPH_NPM_LOGLEVEL" --no-fund --no-audit install -g "$spec"; then
    return 1
  fi

  local murph_bin
  murph_bin="$(resolve_murph_bin || true)"
  if [[ -z "$murph_bin" ]]; then
    ui_error "Murph installed, but the murph executable could not be resolved."
    return 1
  fi

  ui_success "Murph package installed"
  ui_info "Resolved murph executable at ${murph_bin}"

  local setup_args=()
  build_setup_args setup_args

  ui_section "Running Murph setup"
  ui_info "Murph will provision or reuse ffmpeg, poppler/pdftotext, whisper.cpp, a local Whisper model, optional OCR support, your vault bootstrap, and user-level murph/vault-cli shims."

  if can_attach_tty_for_onboarding; then
    "$murph_bin" onboard "${setup_args[@]}" < /dev/tty
  else
    "$murph_bin" onboard "${setup_args[@]}"
  fi
}

checkout_is_clean() {
  local repo_dir="$1"
  [[ -z "$(git -C "$repo_dir" status --porcelain 2>/dev/null || true)" ]]
}

prepare_git_checkout() {
  local repo_dir="$1"

  if [[ -d "$repo_dir/.git" ]]; then
    ui_info "Using existing git checkout at ${repo_dir}"
  elif detect_murph_checkout "$repo_dir" >/dev/null 2>&1; then
    ui_info "Using existing Murph source tree at ${repo_dir}"
    if [[ "$MURPH_VERSION" != "latest" ]]; then
      ui_warn "Skipping version checkout for ${repo_dir} because it is not a git clone"
    fi
    if [[ "$MURPH_GIT_UPDATE" == "1" ]]; then
      ui_warn "Skipping git update for ${repo_dir} because it is not a git clone"
    fi
    return 0
  else
    ensure_git
    mkdir -p "$(dirname "$repo_dir")"
    ui_info "Cloning ${MURPH_REPO_URL} into ${repo_dir}"
    run_cmd git clone "$MURPH_REPO_URL" "$repo_dir"
  fi

  if [[ "$MURPH_VERSION" != "latest" ]]; then
    ui_info "Checking out ${MURPH_VERSION}"
    run_cmd git -C "$repo_dir" fetch --tags origin
    if ! checkout_is_clean "$repo_dir"; then
      ui_warn "Checkout has local changes; skipping git checkout ${MURPH_VERSION}"
    else
      run_cmd git -C "$repo_dir" checkout "$MURPH_VERSION"
    fi
    return 0
  fi

  if [[ "$MURPH_GIT_UPDATE" != "1" ]]; then
    return 0
  fi

  if ! checkout_is_clean "$repo_dir"; then
    ui_warn "Checkout has local changes; skipping git pull"
    return 0
  fi

  run_cmd git -C "$repo_dir" pull --rebase || ui_warn "git pull failed; continuing with the existing checkout"
}

install_from_git() {
  ui_section "Installing Murph from git"
  local repo_dir="$MURPH_GIT_DIR"
  if [[ -n "$DETECTED_CHECKOUT" ]]; then
    repo_dir="$DETECTED_CHECKOUT"
  fi

  prepare_git_checkout "$repo_dir"

  local setup_args=()
  build_setup_args setup_args

  ui_info "Delegating to ${repo_dir}/scripts/setup-host.sh"
  ui_info "That wrapper bootstraps Node/pnpm/build for source installs, then runs Murph onboarding from the checkout."

  if can_attach_tty_for_onboarding; then
    bash "$repo_dir/scripts/setup-host.sh" "${setup_args[@]}" < /dev/tty
  else
    bash "$repo_dir/scripts/setup-host.sh" "${setup_args[@]}"
  fi
}

print_plan() {
  ui_section "Install plan"
  echo "OS:             ${OS}"
  echo "Install method: ${SELECTED_METHOD:-$MURPH_INSTALL_METHOD}"
  echo "Version:        ${MURPH_VERSION}"
  echo "Repo URL:       ${MURPH_REPO_URL}"
  if [[ "${SELECTED_METHOD:-$MURPH_INSTALL_METHOD}" == "git" || "$MURPH_INSTALL_METHOD" == "git" ]]; then
    echo "Git dir:        ${MURPH_GIT_DIR}"
    echo "Git update:     ${MURPH_GIT_UPDATE}"
  fi
  if [[ -n "$DETECTED_CHECKOUT" ]]; then
    echo "Checkout:       ${DETECTED_CHECKOUT}"
  fi
  echo "Onboarding:     $([[ "$MURPH_NO_ONBOARD" == "1" ]] && echo skipped || echo interactive)"
  if [[ ${#FORWARD_ARGS[@]} -gt 0 ]]; then
    local rendered_args
    printf -v rendered_args '%q ' "${FORWARD_ARGS[@]}"
    echo "Murph args:     ${rendered_args% }"
  fi
  echo
  echo "Murph setup itself will provision or reuse ffmpeg, poppler/pdftotext, whisper.cpp, a local Whisper model, your vault bootstrap, and user-level murph/vault-cli shims."
}

main() {
  parse_args "$@"

  if [[ "$HELP" == "1" ]]; then
    print_usage
    exit 0
  fi

  configure_verbose
  print_banner
  detect_os_or_die
  if [[ "$MURPH_DRY_RUN" == "1" ]]; then
    select_install_method_for_dry_run
    print_plan
    ui_success "Dry run complete."
    exit 0
  fi

  select_install_method

  case "$SELECTED_METHOD" in
    npm)
      if ! install_from_npm; then
        if [[ "$MURPH_INSTALL_METHOD" == "auto" ]]; then
          ui_warn "npm install path failed; retrying from git checkout"
          SELECTED_METHOD="git"
          install_from_git
        else
          ui_error "Murph npm installation failed."
          ui_info "You can retry with: --install-method git"
          exit 1
        fi
      fi
      ;;
    git)
      install_from_git
      ;;
    *)
      ui_error "No install method was selected."
      exit 1
      ;;
  esac

  echo
  ui_success "Murph install complete"
  echo
  echo "Next useful commands:"
  echo "  murph assistant chat"
  echo "  murph assistant run"
  echo "  vault-cli inbox doctor"
}

main "$@"
