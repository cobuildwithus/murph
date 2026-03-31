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
  "packages/assistantd"
  "packages/assistant-runtime"
  "packages/web"
  "apps/web"
  "apps/cloudflare"
)

readonly repo_vitest_max_workers="${MURPH_VITEST_MAX_WORKERS:-$([[ -n "${CI:-}" ]] && echo 50% || echo 75%)}"
readonly app_verify_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly app_verify_parallel="${MURPH_APP_VERIFY_PARALLEL:-$app_verify_parallel_default}"
readonly test_lane_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly test_lane_parallel="${MURPH_TEST_LANES_PARALLEL:-$test_lane_parallel_default}"

readonly cli_verify_test_files=(
  "packages/cli/test/runtime.test.ts"
  "packages/cli/test/cli-expansion-document-meal.test.ts"
  "packages/cli/test/cli-expansion-experiment-journal-vault.test.ts"
  "packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts"
  "packages/cli/test/cli-expansion-inbox-attachments.test.ts"
  "packages/cli/test/cli-expansion-intervention.test.ts"
  "packages/cli/test/cli-expansion-provider-event-samples.test.ts"
  "packages/cli/test/cli-expansion-samples-audit.test.ts"
  "packages/cli/test/cli-expansion-workout.test.ts"
  "packages/cli/test/device-cli.test.ts"
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

run_command_with_retry() {
  local label="$1"
  shift
  local attempt=1

  while true; do
    if "$@"; then
      return 0
    fi

    if [[ "$attempt" -ge 2 ]]; then
      return 1
    fi

    attempt=$((attempt + 1))
    echo "${label} failed; retrying once..." >&2
    sleep 1
  done
}

run_repo_build_with_retry() {
  run_command_with_retry "Workspace build" pnpm build:workspace:incremental
}

run_test_runtime_artifact_build_with_retry() {
  run_command_with_retry "build:test-runtime" pnpm build:test-runtime
}

run_package_command_with_retry() {
  local package_dir="$1"
  local command="$2"

  run_command_with_retry \
    "Package command for ${package_dir} (${command})" \
    pnpm --dir "$package_dir" "$command"
}

wait_for_background_jobs() {
  local failed=0
  local pid

  for pid in "$@"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    return 1
  fi

  return 0
}

run_test_packages_common() {
  pnpm no-js
  pnpm --dir "packages/contracts" test
}

run_test_apps() {
  if [[ "$app_verify_parallel" == "1" ]]; then
    local pids=()

    run_package_command_with_retry "packages/web" verify &
    pids+=("$!")
    run_package_command_with_retry "apps/web" verify &
    pids+=("$!")
    run_package_command_with_retry "apps/cloudflare" verify &
    pids+=("$!")

    if ! wait_for_background_jobs "${pids[@]}"; then
      return 1
    fi

    return 0
  fi

  run_package_command_with_retry "packages/web" verify
  run_package_command_with_retry "apps/web" verify
  run_package_command_with_retry "apps/cloudflare" verify
}

prepare_repo_vitest_runtime_artifacts() {
  run_test_runtime_artifact_build_with_retry
  pnpm exec tsx "packages/cli/scripts/verify-package-shape.ts"
}

run_repo_vitest() {
  MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config "vitest.config.ts" --maxWorkers "$repo_vitest_max_workers" "$@"
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
  run_test_packages_common
  prepare_repo_vitest_runtime_artifacts

  if [[ "$test_lane_parallel" == "1" ]]; then
    local test_packages_pid
    local test_apps_pid

    run_repo_vitest --no-coverage &
    test_packages_pid="$!"
    run_test_apps &
    test_apps_pid="$!"

    wait_for_background_jobs "$test_packages_pid" "$test_apps_pid"
  else
    run_repo_vitest --no-coverage
    run_test_apps
  fi

  pnpm exec tsx "e2e/smoke/verify-fixtures.ts"
}

run_test_packages() {
  run_test_packages_common
  prepare_repo_vitest_runtime_artifacts
  run_repo_vitest --no-coverage
}

run_test_packages_coverage() {
  rimraf "coverage"
  run_test_packages_common
  prepare_repo_vitest_runtime_artifacts
  run_repo_vitest --coverage
}

run_test_coverage() {
  bash "scripts/doc-gardening.sh" --fail-on-issues
  run_test_packages_coverage
  run_test_apps
  pnpm exec tsx "e2e/smoke/verify-fixtures.ts" --coverage
}

run_verify_cli() {
  pnpm --dir "packages/cli" typecheck
  run_test_runtime_artifact_build_with_retry
  pnpm exec tsx "packages/cli/scripts/verify-package-shape.ts"
  MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" "${cli_verify_test_files[@]}" --no-coverage --maxWorkers "$repo_vitest_max_workers"
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
    "test:apps")
      run_test_apps
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
      echo "Usage: bash scripts/workspace-verify.sh {typecheck|typecheck:packages|test|test:packages|test:apps|test:packages:coverage|test:coverage|verify:cli}" >&2
      exit 1
      ;;
  esac
}

main "${1:-}"
