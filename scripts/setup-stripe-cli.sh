#!/usr/bin/env bash
set -euo pipefail

STRIPE_CLI_VERSION="1.45.1"

check_only=0
if [[ "${1:-}" == "--check" ]]; then
  check_only=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: pnpm stripe:cli:setup [--check]" >&2
  exit 2
fi

has_expected_version() {
  local candidate="$1"
  local version_output
  version_output="$("$candidate" version 2>/dev/null)"
  [[ "${version_output%%$'\n'*}" == "stripe version ${STRIPE_CLI_VERSION}" ]]
}

if command -v stripe >/dev/null 2>&1 && has_expected_version "$(command -v stripe)"; then
  stripe version
  exit 0
fi

if [[ "$check_only" -eq 1 ]]; then
  echo "Stripe CLI ${STRIPE_CLI_VERSION} is not installed or is not on PATH." >&2
  exit 127
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ -n "${STRIPE_CLI_INSTALL_DIR:-}" ]]; then
  install_dir="$STRIPE_CLI_INSTALL_DIR"
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
    stripe_os="mac-os"
    ;;
  Linux)
    stripe_os="linux"
    ;;
  *)
    echo "Unsupported OS for automatic Stripe CLI install: $(uname -s)" >&2
    exit 127
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64)
    stripe_arch="arm64"
    ;;
  x86_64 | amd64)
    stripe_arch="x86_64"
    ;;
  *)
    echo "Unsupported architecture for automatic Stripe CLI install: $(uname -m)" >&2
    exit 127
    ;;
esac

case "${stripe_os}_${stripe_arch}" in
  linux_arm64)
    expected_checksum="cfe4acf792251ef521683e686bfc48c12e2b6cca807d2088b308ccb287a1b02f"
    ;;
  linux_x86_64)
    expected_checksum="ae0b6e83f6b5edf8e0d61e5965b0ef6fffd94bb685ce063c030dba2ce221e332"
    ;;
  mac-os_arm64)
    expected_checksum="f23bf5a3b8a5472cf504a75d61b790139ce7d3e879686472f92dadd188d2e12d"
    ;;
  mac-os_x86_64)
    expected_checksum="a920a5670fe87db83051e89e9a43e9567039040b152d2641a895d86e01fbfc2f"
    ;;
  *)
    echo "No pinned Stripe CLI checksum for ${stripe_os}/${stripe_arch}." >&2
    exit 127
    ;;
esac

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Stripe CLI setup requires '$name'." >&2
    exit 127
  fi
}

require_command awk
require_command curl
require_command install
require_command tar

asset="stripe_${STRIPE_CLI_VERSION}_${stripe_os}_${stripe_arch}.tar.gz"
base_url="https://github.com/stripe/stripe-cli/releases/download/v${STRIPE_CLI_VERSION}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$base_url/$asset" -o "$tmp_dir/$asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$tmp_dir/$asset" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$tmp_dir/$asset" | awk '{ print $1 }')"
else
  echo "Stripe CLI setup requires sha256sum or shasum for checksum verification." >&2
  exit 127
fi
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "Stripe CLI checksum verification failed for $asset." >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
if [[ ! -f "$tmp_dir/stripe" ]]; then
  echo "Stripe CLI archive did not contain a stripe binary." >&2
  exit 1
fi
mkdir -p "$install_dir"
install -m 0755 "$tmp_dir/stripe" "$install_dir/stripe"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
fi
"$install_dir/stripe" version
