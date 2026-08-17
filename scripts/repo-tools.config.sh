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
  "agent-docs/product-specs/repo.md"
  "agent-docs/references/README.md"
  "agent-docs/references/repo-scope.md"
  "agent-docs/references/testing-ci-map.md"
  "agent-docs/operations/verification-and-runtime.md"
  "agent-docs/operations/completion-workflow.md"
  "agent-docs/operations/product-ux.md"
  "agent-docs/prompts/coverage-write.md"
  "agent-docs/prompts/prompt-review.md"
  "agent-docs/generated/README.md"
  "agent-docs/generated/doc-gardening-report.md"
  "agent-docs/exec-plans/active/README.md"
  "agent-docs/exec-plans/completed/README.md"
  "agent-docs/exec-plans/tech-debt-tracker.md"
)
repo_tools_join_lines COBUILD_DRIFT_REQUIRED_FILES "${required_files[@]}"
export COBUILD_DRIFT_CODE_CHANGE_PATTERN='^(src/|app/|apps/|contracts/|scripts/|\.github/workflows/|package\.json$|README\.md$|ARCHITECTURE\.md$|AGENTS\.md$)'
export COBUILD_DRIFT_CODE_CHANGE_LABEL='Architecture-sensitive code/process'
export COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD='10'
export COBUILD_DRIFT_CHANGED_COUNT_EXCLUDE_PATTERN='^agent-docs/generated/|^agent-docs/exec-plans/(active|completed)/|^pnpm-lock\.yaml$'
export COBUILD_DRIFT_ALLOW_RELEASE_ARTIFACTS_ONLY='0'
export COBUILD_DOC_GARDENING_EXCLUDE_PATTERN='^agent-docs/exec-plans/completed/'
# Murph accepts ordinary descriptive commit messages in helper flows; do not require
# Conventional Commit syntax unless the caller opts back into it manually.
export COMMITTER_ALLOW_NON_CONVENTIONAL='1'
export COBUILD_COMMITTER_EXAMPLE='feat(repo): update canonical docs'
export COBUILD_DOC_GARDENING_EXTRA_TRACKED_PATHS=ARCHITECTURE.md$'\n'
export COBUILD_AUDIT_CONTEXT_PREFIX='murph-audit'
export COBUILD_AUDIT_CONTEXT_TITLE='Murph Audit Bundle'
export COBUILD_AUDIT_CONTEXT_REPO_LABEL='murph'
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'
audit_context_binary_exclude_globs=(
  "apps/*/public/design-assets/**"
  "apps/*/public/audio/**"
  "apps/*/public/legal/*.pdf"
  "apps/*/public/*.jpg"
  "apps/*/public/*.jpeg"
  "apps/*/public/*.png"
  "apps/*/public/*.webp"
  "docs/assets/*.jpg"
  "docs/assets/*.jpeg"
  "docs/assets/*.png"
  "docs/assets/*.webp"
  "packages/health-commons/generated/**"
)
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS \
  "${audit_context_binary_exclude_globs[@]}"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS \
  "${audit_context_binary_exclude_globs[@]}" \
  "agent-docs/generated/**" \
  "agent-docs/exec-plans/completed/**" \
  "agent-docs/prompts/**" \
  "apps/web/app/.well-known/workflow/**" \
  "**/.next-smoke*/**" \
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
  ".githooks/pre-commit" \
  "AGENTS.md" \
  "ARCHITECTURE.md" \
  "Dockerfile.cloudflare-hosted-runner" \
  "Dockerfile.cloudflare-hosted-runner-base" \
  "README.md" \
  "PRODUCT.md" \
  "DESIGN.md" \
  "agent-docs/ARCHITECTURE_GUIDANCE.md" \
  "docs/architecture.md" \
  "docs/contracts/00-invariants.md" \
  "agent-docs/FRONTEND.md" \
  "agent-docs/index.md" \
  "agent-docs/PLANS.md" \
  "agent-docs/PRODUCT_CONSTITUTION.md" \
  "agent-docs/PRODUCT_SENSE.md" \
  "agent-docs/RELIABILITY.md" \
  "agent-docs/SECURITY.md" \
  "agent-docs/references/hosted-runtime-protocol.md" \
  "agent-docs/references/repo-scope.md" \
  "agent-docs/references/testing-ci-map.md" \
  "agent-docs/operations/agent-workflow-routing.md" \
  "agent-docs/operations/verification-and-runtime.md" \
  "agent-docs/operations/completion-workflow.md" \
  "agent-docs/operations/product-ux.md" \
  "agent-docs/operations/imessage-deliverability.md" \
  "agent-docs/operations/pr-reviewgpt-loop.md" \
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
