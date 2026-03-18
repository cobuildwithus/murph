#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOT'
Usage: update-changelog.sh <version>
EOT
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

version="$1"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo 'Error: version must be semantic (for example 1.2.3 or 1.2.3-alpha.1).' >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

primary_package_name="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); process.stdout.write(manifest.primaryPackage);'
)"
changelog_path="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); process.stdout.write(manifest.releaseArtifacts.changelogPath);'
)"

header="# Changelog

All notable changes to \`${primary_package_name}\` will be documented in this file.
"

if [ -f "$changelog_path" ] && grep -qE "^## \[$version\] - " "$changelog_path"; then
  echo "Error: CHANGELOG already contains version $version." >&2
  exit 1
fi

prev_tag="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
if [ -n "$prev_tag" ]; then
  range="$prev_tag..HEAD"
else
  range='HEAD'
fi

added=()
fixed=()
changed=()

while IFS= read -r subject; do
  [ -z "$subject" ] && continue

  type=''
  text="$subject"
  if printf '%s\n' "$subject" | grep -Eq '^[A-Za-z0-9_-]+(\([^)]*\))?!?:[[:space:]]*'; then
    type="$(printf '%s\n' "$subject" | sed -E 's/^([A-Za-z0-9_-]+)(\([^)]*\))?!?:[[:space:]]*.*/\1/' | tr '[:upper:]' '[:lower:]')"
    text="$(printf '%s\n' "$subject" | sed -E 's/^[A-Za-z0-9_-]+(\([^)]*\))?!?:[[:space:]]*//')"
  fi

  case "$type" in
    feat)
      added+=("$text")
      ;;
    fix)
      fixed+=("$text")
      ;;
    release)
      ;;
    *)
      changed+=("$text")
      ;;
  esac
done <<EOF_SUBJECTS
$(git log --no-merges --pretty=format:'%s' $range)
EOF_SUBJECTS

if [ ${#added[@]} -eq 0 ] && [ ${#fixed[@]} -eq 0 ] && [ ${#changed[@]} -eq 0 ]; then
  changed+=('No user-facing changes recorded.')
fi

release_date="$(date -u +%Y-%m-%d)"
section_tmp="$(mktemp)"
{
  echo "## [$version] - $release_date"
  echo

  if [ ${#added[@]} -gt 0 ]; then
    echo '### Added'
    for line in "${added[@]}"; do
      echo "- $line"
    done
    echo
  fi

  if [ ${#fixed[@]} -gt 0 ]; then
    echo '### Fixed'
    for line in "${fixed[@]}"; do
      echo "- $line"
    done
    echo
  fi

  if [ ${#changed[@]} -gt 0 ]; then
    echo '### Changed'
    for line in "${changed[@]}"; do
      echo "- $line"
    done
    echo
  fi
} > "$section_tmp"

existing_sections=''
if [ -f "$changelog_path" ]; then
  existing_sections="$(awk '/^## /{flag=1} flag{print}' "$changelog_path")"
fi

updated_tmp="$(mktemp)"
{
  printf '%s\n' "$header"
  cat "$section_tmp"
  if [ -n "$existing_sections" ]; then
    printf '%s\n' "$existing_sections"
  fi
} > "$updated_tmp"

mv "$updated_tmp" "$changelog_path"
rm -f "$section_tmp"

echo "Updated ${changelog_path} for $version"
