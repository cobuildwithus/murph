#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

readonly shell_syntax_check_scripts=(
  "scripts/check-agent-docs-drift.sh"
  "scripts/doc-gardening.sh"
  "scripts/open-exec-plan.sh"
  "scripts/close-exec-plan.sh"
  "scripts/finish-task"
  "scripts/committer"
  "scripts/package-audit-context.sh"
  "scripts/package-data-context.sh"
  "scripts/review-gpt.data.config.sh"
  "scripts/review-gpt-data.sh"
  "scripts/repo-tools.config.sh"
  "scripts/release.sh"
  "scripts/release-check.sh"
  "scripts/setup-host.sh"
  "scripts/setup-linux.sh"
  "scripts/setup-inbox-local.sh"
  "scripts/setup-macos.sh"
  "scripts/update-changelog.sh"
  "scripts/generate-release-notes.sh"
  "scripts/workspace-verify.sh"
)

readonly node_syntax_check_scripts=(
  "scripts/release-helpers.mjs"
  "scripts/verify-release-target.mjs"
  "scripts/pack-publishables.mjs"
  "scripts/publish-publishables.mjs"
  "scripts/verify-workspace-boundaries.mjs"
)

readonly typecheck_package_dirs=(
  "packages/contracts"
  "packages/hosted-execution"
  "packages/runtime-state"
  "packages/core"
  "packages/importers"
  "packages/device-syncd"
  "packages/query"
  "packages/inboxd"
  "packages/parsers"
  "packages/cli"
  "packages/assistant-runtime"
  "packages/web"
  "apps/web"
  "apps/cloudflare"
)

readonly cli_verify_test_files=(
  "packages/cli/test/runtime.test.ts"
  "packages/cli/test/device-daemon.test.ts"
  "packages/cli/test/health-tail.test.ts"
  "packages/cli/test/canonical-write-source-audit.test.ts"
  "packages/cli/test/assistant-harness.test.ts"
  "packages/cli/test/assistant-cron.test.ts"
  "packages/cli/test/assistant-observability.test.ts"
  "packages/cli/test/assistant-robustness.test.ts"
  "packages/cli/test/incur-smoke.test.ts"
  "packages/cli/test/inbox-cli.test.ts"
  "packages/cli/test/inbox-incur-smoke.test.ts"
  "packages/cli/test/inbox-model-harness.test.ts"
  "packages/cli/test/inbox-model-route.test.ts"
  "packages/cli/test/search-runtime.test.ts"
  "packages/cli/test/cli-expansion-workout.test.ts"
  "packages/cli/test/setup-cli.test.ts"
  "packages/cli/test/release-script-coverage-audit.test.ts"
  "packages/cli/test/release-workflow-guards.test.ts"
)

check_shell_syntax() {
  bash -n "${shell_syntax_check_scripts[@]}"
}

check_node_syntax() {
  for script_path in "${node_syntax_check_scripts[@]}"; do
    node --check "$script_path"
  done
}

run_workspace_boundary_check() {
  node "scripts/verify-workspace-boundaries.mjs"
}

run_typecheck_packages() {
  for package_dir in "${typecheck_package_dirs[@]}"; do
    run_package_command_with_retry "$package_dir" typecheck
  done
}

run_repo_build_with_retry() {
  local attempt=1

  while true; do
    if pnpm build; then
      return 0
    fi

    if [[ "$attempt" -ge 2 ]]; then
      return 1
    fi

    attempt=$((attempt + 1))
    echo "Workspace build failed; retrying once..." >&2
    sleep 1
  done
}

run_package_command_with_retry() {
  local package_dir="$1"
  local command="$2"
  local attempt=1

  while true; do
    if pnpm --dir "$package_dir" "$command"; then
      return 0
    fi

    if [[ "$attempt" -ge 2 ]]; then
      return 1
    fi

    attempt=$((attempt + 1))
    echo "Package command failed for ${package_dir} (${command}); retrying once..." >&2
    sleep 1
  done
}

run_test_packages_common() {
  pnpm no-js
  pnpm --dir "packages/contracts" test
  run_repo_build_with_retry
  tsx "packages/cli/scripts/verify-package-shape.ts"
  pnpm --dir "packages/web" test
  pnpm --dir "apps/web" test
  pnpm --dir "apps/cloudflare" verify
}

refresh_repo_vitest_runtime_artifacts() {
  run_repo_build_with_retry
  tsx "packages/cli/scripts/verify-package-shape.ts"
}

run_typecheck() {
  check_shell_syntax
  check_node_syntax
  run_workspace_boundary_check
  tsc -p "tsconfig.tools.json" --pretty false
  pnpm --dir "packages/contracts" build
  run_repo_build_with_retry
  run_typecheck_packages
}

run_test() {
  bash "scripts/check-agent-docs-drift.sh"
  run_workspace_boundary_check
  run_test_packages
  tsx "e2e/smoke/verify-fixtures.ts"
}

run_test_packages() {
  run_test_packages_common
  refresh_repo_vitest_runtime_artifacts
  vitest run --no-coverage --maxWorkers 1
}

run_test_packages_coverage() {
  pnpm no-js
  rimraf "coverage"
  pnpm --dir "packages/contracts" test
  run_repo_build_with_retry
  tsx "packages/cli/scripts/verify-package-shape.ts"
  pnpm --dir "packages/web" test
  pnpm --dir "apps/web" test
  pnpm --dir "apps/cloudflare" verify
  refresh_repo_vitest_runtime_artifacts
  vitest run --coverage --maxWorkers 1
}

run_test_coverage() {
  bash "scripts/doc-gardening.sh" --fail-on-issues
  run_test_packages_coverage
  tsx "e2e/smoke/verify-fixtures.ts" --coverage
}

run_verify_cli() {
  pnpm --dir "packages/contracts" build
  pnpm --dir "packages/device-syncd" build
  pnpm --dir "packages/inboxd" build
  pnpm --dir "packages/cli" typecheck
  run_repo_build_with_retry
  tsx "packages/cli/scripts/verify-package-shape.ts"
  vitest run "${cli_verify_test_files[@]}" --no-coverage --maxWorkers 1
}

main() {
  local command="${1:-}"

  case "$command" in
    "typecheck")
      run_typecheck
      ;;
    "typecheck:packages")
      run_typecheck_packages
      ;;
    "test")
      run_test
      ;;
    "test:packages")
      run_test_packages
      ;;
    "test:packages:coverage")
      run_test_packages_coverage
      ;;
    "test:coverage")
      run_test_coverage
      ;;
    "verify:cli")
      run_verify_cli
      ;;
    *)
      echo "Usage: bash scripts/workspace-verify.sh {typecheck|typecheck:packages|test|test:packages|test:packages:coverage|test:coverage|verify:cli}" >&2
      exit 1
      ;;
  esac
}

main "${1:-}"
