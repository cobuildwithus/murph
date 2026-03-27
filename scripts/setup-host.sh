#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_node="$(sed -nE 's/^[[:space:]]*"node":[[:space:]]*">=([^"]+)".*/\1/p' package.json | head -n 1)"
pnpm_version="$(sed -nE 's/^[[:space:]]*"packageManager":[[:space:]]*"pnpm@([^+"]+).*/\1/p' package.json | head -n 1)"

if [ -z "$required_node" ] || [ -z "$pnpm_version" ]; then
  printf 'Unable to resolve Node/pnpm versions from package.json.\n' >&2
  exit 1
fi

log() {
  printf '[murph-setup] %s\n' "$*"
}

host_os="$(uname -s)"

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

has_required_node() {
  local node_bin="${1:-node}"

  if ! command -v "$node_bin" >/dev/null 2>&1 && [ ! -x "$node_bin" ]; then
    return 1
  fi

  REQUIRED_NODE_VERSION="$required_node" "$node_bin" - <<'NODE'
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

ensure_pnpm() {
  log "Activating pnpm@${pnpm_version} through corepack..."
  corepack enable
  corepack prepare "pnpm@${pnpm_version}" --activate
}

print_linux_install_summary() {
  log 'Murph Linux setup will install or reuse:'
  printf '  - Node >= %s (from PATH when available, otherwise an isolated download under ~/.murph/bootstrap)\n' "$required_node"
  printf '  - pnpm@%s via corepack\n' "$pnpm_version"
  printf '%s\n' '  - workspace dependencies and build output'
  printf '%s\n' '  - ffmpeg, poppler/pdftotext, whisper.cpp, and a local Whisper model through the Murph Linux toolchain setup'
  printf '%s\n' '  - PaddleX OCR on Linux x86_64 unless you pass --skip-ocr'
  printf '%s\n' '  - the final Murph setup flow: vault bootstrap, default vault config, user-level murph/vault-cli shims, onboarding channel selection, and assistant automation/chat handoff'
  printf '%s\n' '  - iMessage remains macOS-only; Linux setup keeps the rest of Murph available for server or VM deployments'
}

normalize_linux_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      printf 'x64'
      ;;
    aarch64|arm64)
      printf 'arm64'
      ;;
    *)
      return 1
      ;;
  esac
}

download_file() {
  local url="$1"
  local destination="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination" "$url"
    return
  fi

  printf 'Neither curl nor wget is available to download %s.\n' "$url" >&2
  exit 1
}

bootstrap_linux_node() {
  local home_dir="${HOME:-$repo_root}"
  local bootstrap_root="${home_dir}/.murph/bootstrap"
  local linux_arch
  linux_arch="$(normalize_linux_arch)" || {
    printf 'scripts/setup-host.sh currently supports Linux x64 and arm64 only.\n' >&2
    exit 1
  }

  if command -v node >/dev/null 2>&1 && has_required_node node; then
    log "Using Node $(node -p 'process.versions.node')"
    return
  fi

  local node_dir="${bootstrap_root}/node-v${required_node}-linux-${linux_arch}"
  local node_bin="${node_dir}/bin/node"
  if [ -x "$node_bin" ] && has_required_node "$node_bin"; then
    export PATH="${node_dir}/bin:${PATH}"
    log "Using cached Node $("$node_bin" -p 'process.versions.node')"
    return
  fi

  mkdir -p "$bootstrap_root"

  local archive_name="node-v${required_node}-linux-${linux_arch}.tar.xz"
  local archive_path="${bootstrap_root}/${archive_name}"
  local extract_root="${bootstrap_root}/.extract-node-v${required_node}-${linux_arch}-$$"

  rm -rf "$extract_root"
  mkdir -p "$extract_root"

  log "Downloading Node ${required_node} for Linux ${linux_arch} into ${bootstrap_root}..."
  download_file "https://nodejs.org/dist/v${required_node}/${archive_name}" "$archive_path"

  tar -xJf "$archive_path" -C "$extract_root"
  rm -f "$archive_path"
  rm -rf "$node_dir"
  mv "${extract_root}/node-v${required_node}-linux-${linux_arch}" "$node_dir"
  rm -rf "$extract_root"

  if [ ! -x "$node_bin" ]; then
    printf 'Node bootstrap finished, but %s is missing.\n' "$node_bin" >&2
    exit 1
  fi

  export PATH="${node_dir}/bin:${PATH}"
  log "Using Node $("$node_bin" -p 'process.versions.node')"
}

print_linux_dry_run_plan() {
  local delegated_args

  delegated_args="$(render_command_args "$@")"

  log 'Dry run requested. This wrapper will not modify the machine or workspace.'
  print_linux_install_summary
  printf '%s\n' 'Planned wrapper steps:'
  printf '1. Reuse Node >= %s from PATH when available, or download Node %s under ~/.murph/bootstrap.\n' "$required_node" "$required_node"
  printf '2. Activate pnpm@%s through corepack.\n' "$pnpm_version"
  printf '%s\n' '3. Install workspace dependencies with `corepack pnpm install`.'
  printf '%s\n' '4. Build the workspace with `corepack pnpm build`.'
  if [ -n "$delegated_args" ]; then
    printf '5. Delegate to `node packages/cli/dist/bin.js onboard %s`.\n' "$delegated_args"
  else
    printf '%s\n' '5. Delegate to `node packages/cli/dist/bin.js onboard`.'
  fi
  printf '%s\n' '6. Inside the CLI setup flow, provision or reuse Linux parser/runtime tools, skip unsupported iMessage setup, and complete vault bootstrap plus shims.'
  printf '%s\n' 'Run the built setup entrypoint directly with `--dry-run` after bootstrap if you want the inner setup-step preview.'
}

case "$host_os" in
  Darwin)
    exec bash "$repo_root/scripts/setup-macos.sh" "$@"
    ;;
  Linux)
    if has_dry_run_flag "$@"; then
      print_linux_dry_run_plan "$@"
      exit 0
    fi

    print_linux_install_summary
    bootstrap_linux_node
    ensure_pnpm

    log 'Installing workspace dependencies...'
    corepack pnpm install

    log 'Building Murph packages...'
    corepack pnpm build

    log 'Running Murph host setup...'
    node packages/cli/dist/bin.js onboard "$@"
    ;;
  *)
    printf 'scripts/setup-host.sh currently supports macOS and Linux only.\n' >&2
    exit 1
    ;;
esac
