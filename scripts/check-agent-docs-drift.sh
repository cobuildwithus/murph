#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

release_notes_pattern='^packages/cli/release-notes/v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?\.md$'
release_package_jsons="$(
  node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("scripts/release-manifest.json","utf8")); for (const entry of manifest.packages) console.log(`${entry.path}/package.json`);'
)"
escaped_release_package_jsons="$(printf '%s\n' "$release_package_jsons" | sed 's/[.[\*^$()+?{}|]/\\&/g' | paste -sd'|' -)"
release_artifacts_pattern="^(${escaped_release_package_jsons}|packages/cli/CHANGELOG.md|${release_notes_pattern#^})$"

changed_files=""
compare_source=""
compare_range=""

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    git fetch --quiet origin "${GITHUB_BASE_REF}" --depth=1 || true
    compare_source="range"
    compare_range="origin/${GITHUB_BASE_REF}...HEAD"
    changed_files="$(git diff --name-only "$compare_range" || true)"
  else
    staged_changes="$(git diff --name-only --cached | sed '/^[[:space:]]*$/d' | sort -u)"
    working_tree_changes="$({
      git diff --name-only
      git diff --name-only --cached
      git ls-files --others --exclude-standard
    } | sed '/^[[:space:]]*$/d' | sort -u)"

    if [[ -n "$staged_changes" ]]; then
      compare_source="staged"
      changed_files="$staged_changes"
    elif [[ -n "$working_tree_changes" ]]; then
      compare_source="working-tree"
      changed_files="$working_tree_changes"
    elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      compare_source="range"
      compare_range="HEAD~1...HEAD"
      changed_files="$(git diff --name-only "$compare_range" || true)"
    fi
  fi
fi

package_jsons_version_only() {
  local path=''
  while IFS= read -r path; do
    [ -z "$path" ] && continue

    local diff_lines=''
    local relevant=''

    case "$compare_source" in
      staged)
        diff_lines="$(git diff --cached --unified=0 --no-color -- "$path" 2>/dev/null || true)"
        ;;
      working-tree)
        diff_lines="$(git diff --unified=0 --no-color -- "$path" 2>/dev/null || true)"
        ;;
      range)
        diff_lines="$(git diff --unified=0 --no-color "$compare_range" -- "$path" 2>/dev/null || true)"
        ;;
      *)
        return 1
        ;;
    esac

    relevant="$(printf '%s\n' "$diff_lines" | grep -E '^[+-]' | grep -Ev '^\+\+\+|^---' || true)"
    if [[ -z "$relevant" ]]; then
      return 1
    fi

    while IFS= read -r line; do
      line="${line:1}"
      line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')"
      if [[ ! "$line" =~ ^\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"[[:space:]]*,?[[:space:]]*$ ]]; then
        return 1
      fi
    done <<< "$relevant"
  done <<< "$release_package_jsons"

  return 0
}

if [[ -n "$changed_files" ]] \
  && printf '%s\n' "$changed_files" | grep -Eq "$escaped_release_package_jsons" \
  && printf '%s\n' "$changed_files" | grep -Eq '^packages/cli/CHANGELOG.md$' \
  && printf '%s\n' "$changed_files" | grep -Eq "$release_notes_pattern"
then
  non_release_changes="$(printf '%s\n' "$changed_files" | grep -Ev "$release_artifacts_pattern" || true)"
  release_package_json_count="$(printf '%s\n' "$changed_files" | grep -Ec "$escaped_release_package_jsons" || true)"
  manifest_package_json_count="$(printf '%s\n' "$release_package_jsons" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [[ -z "$non_release_changes" ]] \
    && [[ "$release_package_json_count" -eq "$manifest_package_json_count" ]] \
    && package_jsons_version_only
  then
    echo 'Agent docs drift checks passed for release artifacts only.'
    exit 0
  fi
fi

source scripts/repo-tools.config.sh
exec "$(cobuild_repo_tool_bin cobuild-check-agent-docs-drift)" "$@"
