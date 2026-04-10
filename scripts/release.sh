#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOT'
Usage:
  release.sh check
  release.sh <patch|minor|major|prepatch|preminor|premajor|prerelease|x.y.z[-channel.n]> [--preid <alpha|beta|rc>] [--dry-run] [--no-push] [--allow-non-main]
EOT
}

ACTION="${1:-}"
if [ -z "$ACTION" ]; then
  usage >&2
  exit 1
fi
shift || true

PREID=''
DRY_RUN=false
PUSH_TAGS=true
ALLOW_NON_MAIN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preid)
      if [ "$#" -lt 2 ]; then
        echo 'Error: missing value for --preid.' >&2
        exit 2
      fi
      PREID="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      PUSH_TAGS=false
      shift
      ;;
    --no-push)
      PUSH_TAGS=false
      shift
      ;;
    --allow-non-main)
      ALLOW_NON_MAIN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'." >&2
      usage >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
unset npm_config_store_dir NPM_CONFIG_STORE_DIR || true

COMMIT_CMD='scripts/committer'
COMMIT_TEMPLATE='chore(release): v%s'
TAG_MESSAGE_TEMPLATE='chore(release): v%s'

PRIMARY_PACKAGE_NAME="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); process.stdout.write(manifest.primaryPackage);'
)"
PRIMARY_PACKAGE_DIR="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); const entry=manifest.packages.find((candidate) => candidate.name === manifest.primaryPackage); if (!entry) throw new Error("Primary package missing from manifest."); process.stdout.write(entry.path);'
)"
CHANGELOG_PATH="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); process.stdout.write(manifest.releaseArtifacts.changelogPath);'
)"
NOTES_DIR="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); process.stdout.write(manifest.releaseArtifacts.releaseNotesDir);'
)"
PACKAGE_JSON_PATHS=()
while IFS= read -r package_json_path; do
  PACKAGE_JSON_PATHS+=("$package_json_path")
done < <(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); for (const entry of manifest.packages) console.log(`${entry.path}/package.json`);'
)

assert_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo 'Error: git working tree must be clean before release.' >&2
    exit 1
  fi
}

assert_main_branch() {
  if [ "$ALLOW_NON_MAIN" = true ]; then
    return
  fi

  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != 'main' ]; then
    echo "Error: releases must run from main (current: $branch)." >&2
    exit 1
  fi
}

assert_origin_remote() {
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Error: git remote 'origin' is not configured." >&2
    exit 1
  fi
}

run_release_checks() {
  echo 'Running release checks...'
  corepack pnpm release:check
}

is_exact_version() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]
}

resolve_npm_tag() {
  local version="$1"
  node -e '
const version = process.argv[1];
const stable = /^\d+\.\d+\.\d+$/u;
const prerelease = /^\d+\.\d+\.\d+-(alpha|beta|rc)\.\d+$/u;
if (stable.test(version)) {
  process.exit(0);
}
const match = version.match(prerelease);
if (!match) {
  console.error(`Unsupported release version format: ${version}`);
  process.exit(1);
}
process.stdout.write(match[1]);
' "$version"
}

snapshot_targets=()
snapshot_files=()

snapshot_file() {
  local target="$1"
  local snapshot=''
  if [ -f "$target" ]; then
    snapshot="$(mktemp)"
    cat "$target" > "$snapshot"
  fi

  snapshot_targets+=("$target")
  snapshot_files+=("$snapshot")
}

restore_file() {
  local target="$1"
  local snapshot="$2"
  if [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
    cat "$snapshot" > "$target"
  else
    rm -f "$target"
  fi
}

restore_snapshots() {
  local index=0
  for target in "${snapshot_targets[@]}"; do
    restore_file "$target" "${snapshot_files[$index]}"
    index=$((index + 1))
  done
}

cleanup_snapshots() {
  for snapshot in "${snapshot_files[@]}"; do
    if [ -n "$snapshot" ]; then
      rm -f "$snapshot"
    fi
  done
}

set_release_versions() {
  local version="$1"
  node - "$version" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
const repoRoot = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'scripts', 'release-manifest.json'), 'utf8'),
);

for (const entry of manifest.packages) {
  const packageJsonPath = path.join(repoRoot, entry.path, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = version;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
NODE
}

current_release_version() {
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'scripts', 'release-manifest.json'), 'utf8'),
);

const versions = new Set();
for (const entry of manifest.packages) {
  const packageJsonPath = path.join(repoRoot, entry.path, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  versions.add(packageJson.version);
}

if (versions.size !== 1) {
  throw new Error(`Expected one shared release version, found ${Array.from(versions).join(', ')}`);
}

process.stdout.write(Array.from(versions)[0]);
NODE
}

run_commit() {
  local message="$1"
  shift
  "$COMMIT_CMD" "$message" "$@"
}

if [ "$ACTION" = 'check' ]; then
  node scripts/verify-release-target.mjs
  run_release_checks
  echo 'Release checks passed.'
  exit 0
fi

case "$ACTION" in
  patch|minor|major|prepatch|preminor|premajor|prerelease)
    ;;
  *)
    if ! is_exact_version "$ACTION"; then
      echo "Error: unsupported release action or version '$ACTION'." >&2
      usage >&2
      exit 2
    fi
    ;;
esac

if [ -n "$PREID" ] && ! [[ "$PREID" =~ ^(alpha|beta|rc)$ ]]; then
  echo 'Error: --preid must be one of alpha|beta|rc.' >&2
  exit 2
fi

case "$ACTION" in
  prepatch|preminor|premajor|prerelease)
    if [ -z "$PREID" ]; then
      echo "Error: --preid is required with $ACTION." >&2
      exit 2
    fi
    ;;
  *)
    if [ -n "$PREID" ]; then
      echo "Error: --preid is only valid with prepatch/preminor/premajor/prerelease." >&2
      exit 2
    fi
    ;;
esac

assert_clean_worktree
assert_main_branch
assert_origin_remote
node scripts/verify-release-target.mjs
run_release_checks

current_version="$(current_release_version)"
echo "Current version: $current_version"

cleanup_required=true
notes_rel=''
cleanup() {
  local status=$?
  if [ "$cleanup_required" = true ]; then
    restore_snapshots
  fi
  cleanup_snapshots
  exit "$status"
}
trap cleanup EXIT

for package_json_path in "${PACKAGE_JSON_PATHS[@]}"; do
  snapshot_file "$package_json_path"
done
snapshot_file "$CHANGELOG_PATH"

version_cmd=(npm --prefix "$PRIMARY_PACKAGE_DIR" version "$ACTION" --no-git-tag-version)
if [ -n "$PREID" ]; then
  version_cmd+=(--preid "$PREID")
fi

next_tag="$("${version_cmd[@]}" | tail -n1 | tr -d '\r')"
next_version="${next_tag#v}"
npm_dist_tag="$(resolve_npm_tag "$next_version")"
if [ -n "$npm_dist_tag" ]; then
  echo "Release channel: $npm_dist_tag"
else
  echo 'Release channel: latest'
fi

if git rev-parse -q --verify "refs/tags/v$next_version" >/dev/null 2>&1; then
  echo "Error: tag v$next_version already exists." >&2
  exit 1
fi

set_release_versions "$next_version"
node scripts/verify-release-target.mjs --expect-version "$next_version" >/dev/null

bash scripts/update-changelog.sh "$next_version"

previous_tag="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
notes_rel="$NOTES_DIR/v${next_version}.md"
snapshot_file "$notes_rel"
echo "Generating release notes at $notes_rel"
if [ -n "$previous_tag" ]; then
  bash scripts/generate-release-notes.sh "$next_version" "$notes_rel" --from-tag "$previous_tag" --to-ref HEAD
else
  bash scripts/generate-release-notes.sh "$next_version" "$notes_rel" --to-ref HEAD
fi

files_to_commit=("${PACKAGE_JSON_PATHS[@]}" "$CHANGELOG_PATH" "$notes_rel")

if [ "$DRY_RUN" = true ]; then
  echo 'Dry run only.'
  echo "Would prepare release: $PRIMARY_PACKAGE_NAME@$next_version"
  echo "Would create tag: v$next_version"
  exit 0
fi

commit_message="$(printf "$COMMIT_TEMPLATE" "$next_version")"
tag_message="$(printf "$TAG_MESSAGE_TEMPLATE" "$next_version")"
run_commit "$commit_message" "${files_to_commit[@]}"
git tag -a "v$next_version" -m "$tag_message"
cleanup_required=false

if [ "$PUSH_TAGS" = true ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "Pushing $branch + tags to origin..."
  git push origin "$branch" --follow-tags
else
  echo 'Release prepared locally. Skipping push.'
fi

trap - EXIT
cleanup_snapshots

echo "Release prepared: $PRIMARY_PACKAGE_NAME@$next_version"
echo "GitHub Actions will publish tag v$next_version to npm via the monorepo release workflow."
