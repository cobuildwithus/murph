#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm no-js
source scripts/repo-tools.config.sh

append_audit_context_lines() {
  local variable_name="$1"
  shift
  local current_value
  local line
  local -a values=()

  current_value="$(printenv "$variable_name" 2>/dev/null || true)"
  if [[ -n "$current_value" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && values+=("$line")
    done <<<"$current_value"
  fi

  values+=("$@")
  repo_tools_join_lines "$variable_name" "${values[@]}"
}

remove_audit_context_lines() {
  local variable_name="$1"
  shift
  local current_value
  local line
  local -a values=()

  current_value="$(printenv "$variable_name" 2>/dev/null || true)"
  if [[ -n "$current_value" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      local should_drop=0
      local excluded
      for excluded in "$@"; do
        if [[ "$line" == "$excluded" ]]; then
          should_drop=1
          break
        fi
      done
      [[ "$should_drop" -eq 0 ]] && values+=("$line")
    done <<<"$current_value"
  fi

  repo_tools_join_lines "$variable_name" "${values[@]}"
}

if [[ "${MURPH_REVIEW_GPT_CONTEXT_FULL:-0}" =~ ^(1|true|yes|on)$ ]]; then
  export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
  export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="${COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS:-}"
  repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
    "config" \
    "packages" \
    "src" \
    "app" \
    "apps" \
    "contracts" \
    "scripts" \
    "docs"
fi

append_audit_context_lines COBUILD_AUDIT_CONTEXT_PRUNE_DIR_NAMES \
  "output-packages"

if [[ "${MURPH_REVIEW_GPT_INCLUDE_HEALTH_COMMONS:-0}" =~ ^(1|true|yes|on)$ ]]; then
  remove_audit_context_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
    "packages/health-commons/content/**" \
    "packages/health-commons/generated/**"
  remove_audit_context_lines COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS \
    "packages/health-commons/generated/**"
  append_audit_context_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
    "output-packages/**"
else
  append_audit_context_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
    "output-packages/**" \
    "packages/health-commons/content/**" \
    "packages/health-commons/generated/**"
fi

append_health_commons_generated_to_zip() {
  local zip_path="$1"
  [[ -f "$zip_path" ]] || return 0
  [[ -d "packages/health-commons/generated" ]] || return 0

  find "packages/health-commons/generated" -type f -print \
    | LC_ALL=C sort \
    | zip -q "$zip_path" -@
}

append_health_commons_generated_to_txt() {
  local txt_path="$1"
  local relative_path
  [[ -f "$txt_path" ]] || return 0
  [[ -d "packages/health-commons/generated" ]] || return 0

  while IFS= read -r relative_path; do
    {
      printf '\n===== FILE: %s =====\n' "$relative_path"
      cat "$relative_path"
    } >>"$txt_path"
  done < <(find "packages/health-commons/generated" -type f -print | LC_ALL=C sort)
}

stdout_log="$(mktemp "${TMPDIR:-/tmp}/review-gpt-context.XXXXXX")"
cleanup_stdout_log() {
  rm -f "$stdout_log"
}
trap cleanup_stdout_log EXIT

set +e
"$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@" \
  > >(tee "$stdout_log") \
  2> >(sed '/^Warning: excluding path from audit package: /d' >&2)
package_status=$?
set -e

if [[ "$package_status" -eq 0 && "${MURPH_REVIEW_GPT_INCLUDE_HEALTH_COMMONS:-0}" =~ ^(1|true|yes|on)$ ]]; then
  while IFS= read -r zip_path; do
    append_health_commons_generated_to_zip "$zip_path"
  done < <(sed -n 's/^ZIP: \(.*\) (.*/\1/p' "$stdout_log")

  while IFS= read -r txt_path; do
    append_health_commons_generated_to_txt "$txt_path"
  done < <(sed -n 's/^TXT: \(.*\) (.*/\1/p' "$stdout_log")
fi

exit "$package_status"
