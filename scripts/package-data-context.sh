#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Error: not inside a git repository." >&2
  exit 1
}

cd "$ROOT_DIR"

out_dir="$ROOT_DIR/output-packages"
prefix="murph-data-bundle"
vault_path=""

vault_file_count=0

usage() {
  local exit_code="${1:-0}"
  cat >&2 <<'USAGE'
Usage: package-data-context.sh [options]

Create a ZIP bundle containing the selected Murph vault.

Options:
  --vault <path>             Vault root to package. Defaults to VAULT
                             or the saved Murph default vault.
  --zip                      Create only a .zip archive (default)
  --out-dir <dir>            Output directory (default: output-packages)
  --name <prefix>            Output filename prefix (default: murph-data-bundle)
  --docs / --no-docs         Accepted as no-op compatibility flags
  --tests / --no-tests       Accepted as no-op compatibility flags
  -h, --help                 Show this help message
USAGE
  exit "$exit_code"
}

expand_tilde_path() {
  local candidate="$1"
  case "$candidate" in
    "~")
      printf '%s\n' "${HOME:-$candidate}"
      ;;
    "~/"*)
      if [[ -z "${HOME:-}" ]]; then
        printf '%s\n' "$candidate"
      else
        printf '%s/%s\n' "$HOME" "${candidate#\~/}"
      fi
      ;;
    *)
      printf '%s\n' "$candidate"
      ;;
  esac
}

resolve_saved_default_vault() {
  local home_dir config_path
  home_dir="${HOME:-}"
  [[ -n "$home_dir" ]] || return 1
  config_path="$home_dir/.murph/config.json"
  [[ -f "$config_path" ]] || return 1

  node --input-type=module - "$config_path" "$home_dir" <<'EOF'
import fs from 'node:fs'
import path from 'node:path'

const [configPath, homeDir] = process.argv.slice(2)

try {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const configured = typeof parsed.defaultVault === 'string'
    ? parsed.defaultVault.trim()
    : ''

  if (!configured) {
    process.exit(1)
  }

  if (configured === '~') {
    process.stdout.write(path.resolve(homeDir))
  } else if (configured.startsWith('~/')) {
    process.stdout.write(path.resolve(path.join(homeDir, configured.slice(2))))
  } else {
    process.stdout.write(path.resolve(configured))
  }
} catch {
  process.exit(1)
}
EOF
}

resolve_existing_directory() {
  local candidate="$1"
  local expanded
  expanded="$(expand_tilde_path "$candidate")"
  if [[ ! -d "$expanded" ]]; then
    echo "Error: directory does not exist: $candidate" >&2
    exit 1
  fi
  node --input-type=module - "$expanded" <<'EOF'
import path from 'node:path'

const [candidatePath] = process.argv.slice(2)
process.stdout.write(path.resolve(candidatePath))
EOF
}

display_path() {
  local candidate="$1"
  case "$candidate" in
    "$ROOT_DIR"/*)
      printf '%s\n' "${candidate#"$ROOT_DIR"/}"
      ;;
    *)
      printf '%s\n' "$candidate"
      ;;
  esac
}

collect_tree_files() {
  local source_root="$1"
  local tree_kind="$2"
  local -a find_args

  find_args=(.)

  if [[ "$tree_kind" == "vault" ]]; then
    find_args+=(
      \( -path './.git' -o -path './.git/*' \
         -o -path './.runtime' -o -path './.runtime/*' \
         -o -path './exports/packs' -o -path './exports/packs/*' \)
      -prune
      -o
    )
  else
    find_args+=(
      \( -path './.git' -o -path './.git/*' \)
      -prune
      -o
    )
  fi

  find_args+=(
    -type f
    ! -name '.env'
    ! -name '.env.*'
    ! -name '.DS_Store'
    ! -name '*.zip'
    ! -name '*.tar'
    ! -name '*.tgz'
    ! -name '*.gz'
    ! -name '*.bz2'
    ! -name '*.xz'
    ! -name '*.7z'
    -print0
  )

  (
    cd "$source_root"
    find "${find_args[@]}"
  )
}

copy_tree_into_stage() {
  local source_root="$1"
  local target_root="$2"
  local tree_kind="$3"
  local relative_path source_path target_path
  local copied_count=0

  mkdir -p "$target_root"

  while IFS= read -r -d '' relative_path; do
    relative_path="${relative_path#./}"
    source_path="$source_root/$relative_path"
    target_path="$target_root/$relative_path"
    mkdir -p "$(dirname "$target_path")"
    cp -p "$source_path" "$target_path"
    copied_count=$((copied_count + 1))
  done < <(collect_tree_files "$source_root" "$tree_kind")

  if [[ "$tree_kind" == "vault" ]]; then
    vault_file_count=$copied_count
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      [[ $# -ge 2 ]] || {
        echo "Error: --vault requires a value." >&2
        exit 1
      }
      vault_path="$2"
      shift 2
      ;;
    --vault=*)
      vault_path="${1#*=}"
      shift
      ;;
    --zip)
      shift
      ;;
    --out-dir)
      [[ $# -ge 2 ]] || {
        echo "Error: --out-dir requires a value." >&2
        exit 1
      }
      out_dir="$2"
      shift 2
      ;;
    --name)
      [[ $# -ge 2 ]] || {
        echo "Error: --name requires a value." >&2
        exit 1
      }
      prefix="$2"
      shift 2
      ;;
    --docs|--no-docs|--with-docs|--no-tests|--tests|--with-tests)
      # review-gpt forwards docs/tests packaging toggles; data bundles do not use them.
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    --txt|--both)
      echo "Error: only ZIP output is supported for data bundles." >&2
      exit 1
      ;;
    *)
      echo "Error: unknown option '$1'." >&2
      usage 2
      ;;
  esac
done

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: zip is required to package a data bundle." >&2
  exit 1
fi

if [[ -z "$vault_path" ]]; then
  if [[ -n "${VAULT:-}" ]]; then
    vault_path="$VAULT"
  else
    vault_path="$(resolve_saved_default_vault || true)"
  fi
fi

if [[ -z "$vault_path" ]]; then
  echo "Error: missing vault path. Pass --vault, set VAULT, or save a default Murph vault first." >&2
  exit 1
fi

absolute_vault_root="$(resolve_existing_directory "$vault_path")"
mkdir -p "$out_dir"
absolute_out_dir="$(
  cd "$out_dir"
  pwd -P
)"

timestamp="$(date -u '+%Y%m%d-%H%M%SZ')"
base_name="${prefix}-${timestamp}"
stage_dir="$(mktemp -d)"
bundle_root="$stage_dir/$base_name"
trap 'rm -rf "$stage_dir"' EXIT

mkdir -p "$bundle_root"
copy_tree_into_stage "$absolute_vault_root" "$bundle_root/vault" "vault"

total_file_count=$((vault_file_count + 1))

cat > "$bundle_root/bundle-manifest.json" <<EOF
{
  "format": "murph.data-bundle.v1",
  "generatedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "includes": {
    "vault": true
  },
  "excludes": [
    ".env*",
    ".runtime/**",
    "exports/packs/**",
    "*.zip",
    "*.tar",
    "*.tgz",
    "*.gz",
    "*.bz2",
    "*.xz",
    "*.7z"
  ],
  "counts": {
    "vaultFiles": $vault_file_count,
    "totalFiles": $total_file_count
  }
}
EOF

zip_path="$absolute_out_dir/$base_name.zip"
(
  cd "$stage_dir"
  zip -qr "$zip_path" "$base_name"
)

zip_display_path="$(display_path "$zip_path")"

echo "Data package created."
echo "Vault files: $vault_file_count"
echo "ZIP: $zip_display_path ($(du -h "$zip_path" | awk '{print $1}'))"
