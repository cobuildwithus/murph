#!/usr/bin/env bash
set -euo pipefail

TEMPORAL_CLI_VERSION="${TEMPORAL_CLI_VERSION:-1.7.0}"

check_only=0
if [[ "${1:-}" == "--check" ]]; then
  check_only=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: pnpm temporal:cli:setup [--check]" >&2
  exit 2
fi

if command -v temporal >/dev/null 2>&1; then
  temporal --version
  exit 0
fi

if [[ "$check_only" -eq 1 ]]; then
  echo "Temporal CLI is not installed or is not on PATH." >&2
  exit 127
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ -n "${TEMPORAL_CLI_INSTALL_DIR:-}" ]]; then
  install_dir="$TEMPORAL_CLI_INSTALL_DIR"
elif [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  install_dir="$repo_root/.tmp/bin"
elif [[ -n "${HOME:-}" ]]; then
  install_dir="$HOME/.local/bin"
else
  install_dir="$repo_root/.tmp/bin"
fi

if [[ "$install_dir" != /* ]]; then
  install_dir="$PWD/$install_dir"
fi

case "$(uname -s)" in
  Darwin)
    temporal_os="darwin"
    ;;
  Linux)
    temporal_os="linux"
    ;;
  *)
    echo "Unsupported OS for automatic Temporal CLI install: $(uname -s)" >&2
    exit 127
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64)
    temporal_arch="arm64"
    ;;
  x86_64 | amd64)
    temporal_arch="amd64"
    ;;
  *)
    echo "Unsupported architecture for automatic Temporal CLI install: $(uname -m)" >&2
    exit 127
    ;;
esac

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Temporal CLI setup requires '$name'." >&2
    exit 127
  fi
}

display_path() {
  local path="$1"
  if [[ "$path" == "$repo_root" ]]; then
    printf '.'
    return
  fi
  if [[ "$path" == "$repo_root"/* ]]; then
    printf '%s' "${path#"$repo_root"/}"
    return
  fi
  if [[ -n "${HOME:-}" && "$path" == "$HOME" ]]; then
    printf '<HOME_DIR>'
    return
  fi
  if [[ -n "${HOME:-}" && "$path" == "$HOME"/* ]]; then
    printf '<HOME_DIR>/%s' "${path#"$HOME"/}"
    return
  fi
  printf '<custom-install-dir>'
}

require_command awk
require_command curl
require_command install
require_command tar

asset="temporal_cli_${TEMPORAL_CLI_VERSION}_${temporal_os}_${temporal_arch}.tar.gz"
base_url="https://github.com/temporalio/cli/releases/download/v${TEMPORAL_CLI_VERSION}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$base_url/checksums.txt" -o "$tmp_dir/checksums.txt"
curl -fsSL "$base_url/$asset" -o "$tmp_dir/$asset"

expected_checksum="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$tmp_dir/checksums.txt")"
if [[ -z "$expected_checksum" ]]; then
  echo "Checksum entry not found for $asset." >&2
  exit 1
fi

actual_checksum=""
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$tmp_dir/$asset" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$tmp_dir/$asset" | awk '{ print $1 }')"
else
  echo "Temporal CLI setup requires sha256sum or shasum for checksum verification." >&2
  exit 127
fi

if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "Temporal CLI checksum verification failed for $asset." >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
temporal_bin="$(find "$tmp_dir" -type f -name temporal | head -n 1)"
if [[ -z "$temporal_bin" ]]; then
  echo "Temporal CLI archive did not contain a temporal binary." >&2
  exit 1
fi

mkdir -p "$install_dir"
install -m 0755 "$temporal_bin" "$install_dir/temporal"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
fi

"$install_dir/temporal" --version

if [[ ":$PATH:" != *":$install_dir:"* ]]; then
  echo "Temporal CLI installed into $(display_path "$install_dir"); add that directory to PATH before running pnpm dev." >&2
fi
