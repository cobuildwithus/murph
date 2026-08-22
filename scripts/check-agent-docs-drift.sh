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
exact_base_sha=""

read_pull_request_event_sha() {
  local field="$1"

  if [[ -z "${GITHUB_EVENT_PATH:-}" || ! -f "${GITHUB_EVENT_PATH}" ]]; then
    return 0
  fi

  node - "${GITHUB_EVENT_PATH}" "$field" <<'NODE'
const fs = require("node:fs");
const [eventPath, field] = process.argv.slice(2);
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const pullRequest = event.pull_request;
const value = field === "base" ? pullRequest?.base?.sha : pullRequest?.head?.sha;
if (typeof value === "string") process.stdout.write(value);
NODE
}

require_exact_commit_sha() {
  local label="$1"
  local sha="$2"

  if [[ ! "$sha" =~ ^([0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$ ]]; then
    echo "::error::Docs drift CI mode requires a valid exact ${label} commit SHA." >&2
    return 1
  fi
}

prepare_exact_ci_comparison() {
  local event_base_sha=""
  local event_head_sha=""
  local exact_candidate_sha=""
  local current_head_sha=""

  event_base_sha="$(read_pull_request_event_sha base)"
  event_head_sha="$(read_pull_request_event_sha head)"
  exact_base_sha="${MURPH_DOCS_DRIFT_BASE_SHA:-${MURPH_PR_BASE_SHA:-$event_base_sha}}"
  exact_candidate_sha="${MURPH_DOCS_DRIFT_CANDIDATE_SHA:-${GITHUB_SHA:-${MURPH_PR_HEAD_SHA:-$event_head_sha}}}"

  if [[ -z "$exact_base_sha" ]]; then
    echo "::error::Docs drift CI mode requires an exact base SHA from MURPH_DOCS_DRIFT_BASE_SHA, MURPH_PR_BASE_SHA, or GITHUB_EVENT_PATH." >&2
    return 1
  fi
  if [[ -z "$exact_candidate_sha" ]]; then
    exact_candidate_sha="$(git rev-parse HEAD)"
  fi

  require_exact_commit_sha "base" "$exact_base_sha"
  require_exact_commit_sha "candidate" "$exact_candidate_sha"

  current_head_sha="$(git rev-parse HEAD)"
  if [[ "$current_head_sha" != "$exact_candidate_sha" ]]; then
    echo "::error::Docs drift CI candidate ${exact_candidate_sha} does not match checked-out HEAD ${current_head_sha}." >&2
    return 1
  fi

  if ! git cat-file -e "${exact_candidate_sha}^{commit}" 2>/dev/null; then
    echo "::error::Docs drift CI candidate ${exact_candidate_sha} is not available as a commit." >&2
    return 1
  fi

  if ! git cat-file -e "${exact_base_sha}^{commit}" 2>/dev/null; then
    # Fetch only the immutable event commit when a depth-one checkout omitted it.
    # Never rewrite the mutable origin/<base> ref or shorten existing shallow proof.
    if ! git fetch --quiet --no-tags --no-write-fetch-head --depth=1 origin "$exact_base_sha"; then
      echo "::error::Unable to fetch exact docs drift base ${exact_base_sha}." >&2
      return 1
    fi
  fi
  if ! git cat-file -e "${exact_base_sha}^{commit}" 2>/dev/null; then
    echo "::error::Docs drift CI base ${exact_base_sha} is not available as a commit." >&2
    return 1
  fi

  compare_source="ci-exact"
  compare_range="${exact_base_sha}..${exact_candidate_sha}"
  changed_files="$(git diff --name-only "$compare_range")"
}

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    prepare_exact_ci_comparison
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

if [[ "$compare_source" == "working-tree" ]] && [[ -z "${COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD:-}" ]]; then
  # Parallel local agents can leave a broad dirty tree; keep the large-change-set
  # plan guard strict for staged/CI comparisons, but do not block plain local runs
  # solely because unrelated working-tree files exceed the threshold.
  export COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD="${MURPH_WORKTREE_DRIFT_LARGE_CHANGE_THRESHOLD:-999999}"
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
      range|ci-exact)
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
docs_drift_tool="$(cobuild_repo_tool_bin cobuild-check-agent-docs-drift)"

if [[ "$compare_source" == "ci-exact" ]]; then
  exact_index_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-docs-drift-index.XXXXXX")"
  exact_index="$exact_index_dir/index"
  trap 'rm -rf -- "$exact_index_dir"' EXIT

  # The upstream policy's staged comparison is path-equivalent to base..candidate.
  # An alternate index lets it evaluate the exact candidate without fetching or
  # rewriting a mutable base ref and without changing the caller's real index.
  GIT_INDEX_FILE="$exact_index" git read-tree "$exact_base_sha"
  if GITHUB_BASE_REF= GIT_INDEX_FILE="$exact_index" "$docs_drift_tool" "$@"; then
    docs_drift_status=0
  else
    docs_drift_status=$?
  fi

  rm -rf -- "$exact_index_dir"
  trap - EXIT
  exit "$docs_drift_status"
fi

exec "$docs_drift_tool" "$@"
