#!/usr/bin/env bash
set -euo pipefail

COBUILD_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

consumer_shell_path=""
for candidate in \
  "$COBUILD_REPO_ROOT/node_modules/@cobuild/repo-tools/src/consumer-shell.sh" \
  "$COBUILD_REPO_ROOT/../repo-tools/src/consumer-shell.sh"
do
  if [ -f "$candidate" ]; then
    consumer_shell_path="$candidate"
    break
  fi
done

if [ -z "$consumer_shell_path" ]; then
  echo "Error: missing repo-tools consumer shell helper. Install dependencies first." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$consumer_shell_path"

required_files=(
  "AGENTS.md"
  "ARCHITECTURE.md"
  "README.md"
  "package.json"
  "agent-docs/index.md"
  "agent-docs/PLANS.md"
  "agent-docs/PRODUCT_SENSE.md"
  "agent-docs/QUALITY_SCORE.md"
  "agent-docs/RELIABILITY.md"
  "agent-docs/SECURITY.md"
  "agent-docs/product-specs/index.md"
  "agent-docs/product-specs/repo-bootstrap.md"
  "agent-docs/references/README.md"
  "agent-docs/references/repo-scope.md"
  "agent-docs/references/testing-ci-map.md"
  "agent-docs/operations/verification-and-runtime.md"
  "agent-docs/operations/completion-workflow.md"
  "agent-docs/prompts/simplify.md"
  "agent-docs/prompts/task-finish-review.md"
  "agent-docs/generated/README.md"
  "agent-docs/generated/doc-gardening-report.md"
  "agent-docs/exec-plans/active/README.md"
  "agent-docs/exec-plans/active/COORDINATION_LEDGER.md"
  "agent-docs/exec-plans/completed/README.md"
  "agent-docs/exec-plans/tech-debt-tracker.md"
)
repo_tools_join_lines COBUILD_DRIFT_REQUIRED_FILES "${required_files[@]}"
export COBUILD_DRIFT_CODE_CHANGE_PATTERN='^(src/|app/|apps/|contracts/|scripts/|\.github/workflows/|package\.json$|README\.md$|ARCHITECTURE\.md$|AGENTS\.md$)'
export COBUILD_DRIFT_CODE_CHANGE_LABEL='Architecture-sensitive code/process'
export COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD='10'
export COBUILD_DRIFT_CHANGED_COUNT_EXCLUDE_PATTERN='^agent-docs/generated/|^agent-docs/exec-plans/(active|completed)/|^pnpm-lock\.yaml$'
export COBUILD_DRIFT_ALLOW_RELEASE_ARTIFACTS_ONLY='0'
export COBUILD_COMMITTER_EXAMPLE='feat(bootstrap): add repo harness'
export COBUILD_DOC_GARDENING_EXTRA_TRACKED_PATHS=ARCHITECTURE.md$'\n'
export COBUILD_AUDIT_CONTEXT_PREFIX='murph-audit'
export COBUILD_AUDIT_CONTEXT_TITLE='Murph Audit Bundle'
export COBUILD_AUDIT_CONTEXT_REPO_LABEL='murph'
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
  "agent-docs/generated/**" \
  "agent-docs/exec-plans/completed/**" \
  "agent-docs/prompts/**" \
  "packages/*/test/**" \
  "packages/*/tests/**" \
  "packages/*/**/__tests__/**" \
  "packages/*/**/*.test.*" \
  "packages/*/**/*.spec.*" \
  "apps/*/test/**" \
  "apps/*/tests/**" \
  "apps/*/**/__tests__/**" \
  "apps/*/**/*.test.*" \
  "apps/*/**/*.spec.*"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS \
  ".dockerignore" \
  "AGENTS.md" \
  "ARCHITECTURE.md" \
  "Dockerfile.cloudflare-hosted-runner" \
  "README.md" \
  "docs/architecture.md" \
  "agent-docs/index.md" \
  "agent-docs/PLANS.md" \
  "agent-docs/RELIABILITY.md" \
  "agent-docs/SECURITY.md" \
  "agent-docs/references/repo-scope.md" \
  "agent-docs/references/testing-ci-map.md" \
  "agent-docs/operations/agent-workflow-routing.md" \
  "agent-docs/operations/verification-and-runtime.md" \
  "agent-docs/operations/completion-workflow.md" \
  "agent-docs/exec-plans/active/COORDINATION_LEDGER.md" \
  "package.json" \
  "pnpm-workspace.yaml" \
  "tsconfig.test-runtime.json" \
  "tsconfig.json" \
  "tsconfig.base.json" \
  "tsconfig.tools.json" \
  "vitest.config.ts" \
  ".gitignore"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "agent-docs" \
  "config" \
  "packages" \
  "src" \
  "app" \
  "apps" \
  "contracts" \
  "scripts"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_TEST_SCAN_SPECS \
  "e2e" \
  "fixtures" \
  "tests" \
  "test"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_DOC_SCAN_SPECS \
  "agent-docs:*.md"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_CI_SCAN_SPECS \
  ".github/workflows"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_PRUNE_DIR_NAMES \
  "node_modules" \
  ".git" \
  "dist" \
  ".next" \
  ".next-dev" \
  ".next-smoke" \
  ".test-dist" \
  ".turbo" \
  ".vercel" \
  "out" \
  "cache" \
  "coverage" \
  "audit-packages"
