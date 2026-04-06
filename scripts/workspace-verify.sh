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
  "apps/web/scripts/verify-fast.sh"
  "apps/cloudflare/scripts/verify-fast.sh"
)

readonly node_syntax_check_scripts=(
  "scripts/build-test-runtime-prepared.mjs"
  "scripts/check-workspace-package-cycles.mjs"
  "scripts/release-helpers.mjs"
  "scripts/verify-release-target.mjs"
  "scripts/pack-publishables.mjs"
  "scripts/publish-publishables.mjs"
  "scripts/verify-workspace-boundaries.mjs"
  "scripts/verify-dependency-policy.mjs"
  "scripts/rm-paths.mjs"
)

readonly typecheck_package_dirs=(
  "packages/contracts"
  "packages/hosted-execution"
  "packages/runtime-state"
  "packages/assistant-core"
  "packages/assistant-cli"
  "packages/setup-cli"
  "packages/core"
  "packages/importers"
  "packages/device-syncd"
  "packages/query"
  "packages/inboxd"
  "packages/parsers"
  "packages/gateway-core"
  "packages/gateway-local"
  "packages/cli"
  "packages/openclaw-plugin"
  "packages/assistantd"
  "packages/assistant-runtime"
  "apps/web"
  "apps/cloudflare"
)

normalize_positive_integer() {
  local value="${1:-}"
  local fallback="$2"

  if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' "$value"
    return
  fi

  printf '%s\n' "$fallback"
}

normalize_non_negative_integer() {
  local value="${1:-}"
  local fallback="$2"

  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
    return
  fi

  printf '%s\n' "$fallback"
}

readonly repo_vitest_max_workers="${MURPH_VITEST_MAX_WORKERS:-$([[ -n "${CI:-}" ]] && echo 50% || echo 50%)}"
readonly app_verify_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly app_verify_parallel="${MURPH_APP_VERIFY_PARALLEL:-$app_verify_parallel_default}"
readonly test_lane_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly test_lane_parallel="${MURPH_TEST_LANES_PARALLEL:-$test_lane_parallel_default}"
readonly typecheck_workspace_concurrency_default="$([[ -n "${CI:-}" ]] && echo 2 || echo 4)"
readonly typecheck_workspace_concurrency="$(normalize_positive_integer "${MURPH_TYPECHECK_WORKSPACE_CONCURRENCY:-$typecheck_workspace_concurrency_default}" "$typecheck_workspace_concurrency_default")"
readonly verify_retry_count="$(normalize_non_negative_integer "${MURPH_VERIFY_RETRY_COUNT:-0}" "0")"
readonly sqlite_warning_filter_option="--require=$repo_root/config/sqlite-warning-filter.cjs"
tracked_background_pids=("")

verify_log() {
  printf '[workspace-verify] %s\n' "$*" >&2
}

run_timed_step() {
  local label="$1"
  shift
  local started_at="$SECONDS"

  verify_log "start ${label}"
  "$@"
  verify_log "done ${label} (${SECONDS}s total, $((SECONDS - started_at))s step)"
}

register_background_pid() {
  tracked_background_pids+=("$1")
}

unregister_background_pid() {
  local target_pid="$1"
  local remaining_pids=("")
  local pid

  for pid in "${tracked_background_pids[@]}"; do
    if [[ -z "$pid" ]]; then
      continue
    fi
    if [[ "$pid" != "$target_pid" ]]; then
      remaining_pids+=("$pid")
    fi
  done

  tracked_background_pids=("${remaining_pids[@]}")
}

terminate_background_pid() {
  local pid="$1"

  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  if [[ "$pid" -gt 0 && "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]]; then
    kill "-$pid" 2>/dev/null || true
  fi

  kill "$pid" 2>/dev/null || true
}

cleanup_background_jobs() {
  local pid

  for pid in "${tracked_background_pids[@]}"; do
    if [[ -z "$pid" ]]; then
      continue
    fi
    terminate_background_pid "$pid"
  done
}

handle_termination_signal() {
  local signal="$1"

  cleanup_background_jobs

  case "$signal" in
    INT)
      exit 130
      ;;
    *)
      exit 143
      ;;
  esac
}

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

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

run_dependency_policy_check() {
  node "scripts/verify-dependency-policy.mjs"
}

run_workspace_boundary_check() {
  node "scripts/verify-workspace-boundaries.mjs"
  node "scripts/check-workspace-package-cycles.mjs"
}

run_typecheck_packages() {
  local package_dir

  if [[ "$typecheck_workspace_concurrency" -le 1 ]]; then
    for package_dir in "${typecheck_package_dirs[@]}"; do
      run_package_command_with_retry "$package_dir" typecheck
    done
    return 0
  fi

  local filter_args=()

  for package_dir in "${typecheck_package_dirs[@]}"; do
    filter_args+=("--filter" "./${package_dir}")
  done

  run_command_with_retry \
    "Workspace package typecheck" \
    pnpm -r --sort --workspace-concurrency="$typecheck_workspace_concurrency" "${filter_args[@]}" typecheck
}

run_command_with_retry() {
  local label="$1"
  shift
  local attempt=1
  local max_attempts=$((verify_retry_count + 1))
  local started_at
  local step_elapsed
  local total_started_at="$SECONDS"

  while true; do
    started_at="$SECONDS"
    verify_log "start ${label} (attempt ${attempt}/${max_attempts})"

    if "$@"; then
      step_elapsed=$((SECONDS - started_at))
      verify_log "done ${label} (${step_elapsed}s step, $((SECONDS - total_started_at))s total)"
      return 0
    fi

    step_elapsed=$((SECONDS - started_at))
    verify_log "failed ${label} (${step_elapsed}s step, $((SECONDS - total_started_at))s total)"

    if [[ "$attempt" -ge "$max_attempts" ]]; then
      return 1
    fi

    attempt=$((attempt + 1))
    echo "${label} failed; retrying (${attempt}/${max_attempts})..." >&2
    sleep 1
  done
}

compose_node_options_with_sqlite_warning_filter() {
  local node_options="${NODE_OPTIONS:-}"

  if [[ "$node_options" == *"$sqlite_warning_filter_option"* ]]; then
    printf '%s\n' "$node_options"
    return
  fi

  if [[ -n "$node_options" ]]; then
    printf '%s %s\n' "$node_options" "$sqlite_warning_filter_option"
    return
  fi

  printf '%s\n' "$sqlite_warning_filter_option"
}

run_repo_build_with_retry() {
  run_command_with_retry "Workspace build" pnpm build:workspace:incremental
}

run_test_runtime_artifact_build_with_retry() {
  local filtered_node_options
  filtered_node_options="$(compose_node_options_with_sqlite_warning_filter)"
  run_command_with_retry "build:test-runtime:prepared" env NODE_OPTIONS="$filtered_node_options" pnpm build:test-runtime:prepared
}

run_package_command_with_retry() {
  local package_dir="$1"
  local command="$2"

  run_command_with_retry \
    "Package command for ${package_dir} (${command})" \
    pnpm --dir "$package_dir" "$command"
}

run_package_command_without_node_v8_coverage_with_retry() {
  local package_dir="$1"
  local command="$2"

  run_command_with_retry \
    "Package command for ${package_dir} (${command})" \
    env -u NODE_V8_COVERAGE pnpm --dir "$package_dir" "$command"
}

is_repo_internal_fast_path_file() {
  local file_path="$1"

  case "$file_path" in
    agent-docs/*|config/*|docs/*|scripts/*)
      return 0
      ;;
    AGENTS.md|ARCHITECTURE.md|README.md|vitest.config.ts|tsconfig.json|tsconfig.*.json)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

should_skip_app_verification() {
  local changed_file
  local saw_changed_file=0

  while IFS= read -r changed_file; do
    if [[ -z "$changed_file" ]]; then
      continue
    fi

    saw_changed_file=1

    if ! is_repo_internal_fast_path_file "$changed_file"; then
      return 1
    fi
  done < <(
    git diff --name-only --relative HEAD -- 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  )

  if [[ "$saw_changed_file" -eq 0 ]]; then
    return 1
  fi

  return 0
}

wait_for_background_jobs() {
  local failed=0
  local pid
  local other_pid

  for pid in "$@"; do
    if ! wait "$pid"; then
      failed=1
      for other_pid in "$@"; do
        if [[ "$other_pid" != "$pid" ]]; then
          terminate_background_pid "$other_pid"
          wait "$other_pid" 2>/dev/null || true
        fi
      done
    fi

    unregister_background_pid "$pid"
  done

  if [[ "$failed" -ne 0 ]]; then
    return 1
  fi

  return 0
}

run_test_packages_common() {
  if [[ "$test_lane_parallel" == "1" ]]; then
    local pids=()

    run_timed_step "Tracked artifact hygiene" pnpm no-js &
    local no_js_pid="$!"
    pids+=("$no_js_pid")
    register_background_pid "$no_js_pid"
    run_timed_step "Contracts package test" pnpm --dir "packages/contracts" test &
    local contracts_test_pid="$!"
    pids+=("$contracts_test_pid")
    register_background_pid "$contracts_test_pid"
    run_timed_step "OpenClaw plugin test" pnpm --dir "packages/openclaw-plugin" test &
    local openclaw_test_pid="$!"
    pids+=("$openclaw_test_pid")
    register_background_pid "$openclaw_test_pid"

    if ! wait_for_background_jobs "${pids[@]}"; then
      return 1
    fi

    return 0
  fi

  run_timed_step "Tracked artifact hygiene" pnpm no-js
  run_timed_step "Contracts package test" pnpm --dir "packages/contracts" test
  run_timed_step "OpenClaw plugin test" pnpm --dir "packages/openclaw-plugin" test
}

run_test_apps() {
  local mode="${1:-auto}"

  if [[ "$mode" != "force" ]] && should_skip_app_verification; then
    verify_log "skip app verification (repo-internal fast path: changed files are limited to docs/process/verification tooling)"
    return 0
  fi

  if [[ "$app_verify_parallel" == "1" ]]; then
    local pids=()

    # App verification should not emit V8 coverage into the repo coverage workspace.
    # The repo Vitest lane already covers Cloudflare node/workers tests, so keep
    # only the app-local typecheck here to avoid duplicating that matrix under a
    # second process tree that can linger after the root lane is already green.
    run_package_command_without_node_v8_coverage_with_retry "apps/web" verify &
    local hosted_web_verify_pid="$!"
    pids+=("$hosted_web_verify_pid")
    register_background_pid "$hosted_web_verify_pid"
    run_package_command_without_node_v8_coverage_with_retry "apps/cloudflare" typecheck &
    local cloudflare_typecheck_pid="$!"
    pids+=("$cloudflare_typecheck_pid")
    register_background_pid "$cloudflare_typecheck_pid"

    if ! wait_for_background_jobs "${pids[@]}"; then
      return 1
    fi

    return 0
  fi

  run_package_command_without_node_v8_coverage_with_retry "apps/web" verify
  run_package_command_without_node_v8_coverage_with_retry "apps/cloudflare" typecheck
}

prepare_repo_vitest_runtime_artifacts() {
  run_test_runtime_artifact_build_with_retry
  run_timed_step "CLI package shape verification" pnpm exec tsx "packages/cli/scripts/verify-package-shape.ts"
}

run_repo_vitest() {
  MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config "vitest.config.ts" --maxWorkers "$repo_vitest_max_workers" "$@"
}

run_typecheck() {
  run_timed_step "Shell syntax" check_shell_syntax
  run_timed_step "Node syntax" check_node_syntax
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  run_timed_step "Repo TS tools typecheck" tsc -p "tsconfig.tools.json" --pretty false
  run_timed_step "Contracts build" pnpm --dir "packages/contracts" build
  run_timed_step "Workspace build" run_repo_build_with_retry
  run_timed_step "Workspace package/app typecheck" run_typecheck_packages
}

run_test() {
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  run_timed_step "Package smoke prerequisites" run_test_packages_common

  if [[ "$test_lane_parallel" == "1" ]]; then
    local test_packages_pid
    local smoke_pid

    # The app verify lane imports built workspace artifacts, so a clean run must
    # finish the shared prepared-artifact build before any app checks start.
    # Keep repo Vitest and fixture smoke parallel, but do not overlap them with
    # app verify because hosted-web verify also runs Vitest and Prisma generation.
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
    run_timed_step "Repo Vitest" run_repo_vitest --no-coverage &
    test_packages_pid="$!"
    register_background_pid "$test_packages_pid"
    run_timed_step "Fixture smoke verification" pnpm exec tsx "e2e/smoke/verify-fixtures.ts" &
    smoke_pid="$!"
    register_background_pid "$smoke_pid"

    wait_for_background_jobs "$test_packages_pid" "$smoke_pid"
    run_timed_step "App verification" run_test_apps
  else
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
    run_timed_step "Repo Vitest" run_repo_vitest --no-coverage
    run_timed_step "App verification" run_test_apps
    run_timed_step "Fixture smoke verification" pnpm exec tsx "e2e/smoke/verify-fixtures.ts"
  fi
}

run_test_packages() {
  run_timed_step "Package smoke prerequisites" run_test_packages_common
  run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
  run_timed_step "Repo Vitest" run_repo_vitest --no-coverage
}

run_test_packages_coverage() {
  local artifacts_prepared="${1:-0}"

  run_timed_step "Coverage cleanup" node "scripts/rm-paths.mjs" "coverage"
  run_timed_step "Package smoke prerequisites" run_test_packages_common
  if [[ "$artifacts_prepared" != "1" ]]; then
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
  fi
  run_timed_step "Repo Vitest coverage" run_repo_vitest --coverage
}

run_test_coverage() {
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  run_timed_step "Doc gardening" bash "scripts/doc-gardening.sh" --fail-on-issues

  if [[ "$test_lane_parallel" == "1" ]]; then
    local coverage_pid
    local smoke_pid

    # Coverage and app verify both depend on the prepared runtime artifacts.
    # Keep coverage and fixture smoke parallel, but wait to start app verify
    # until the repo Vitest lane has released Prisma/client and app-test resources.
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
    run_timed_step "Package coverage suite" run_test_packages_coverage 1 &
    coverage_pid="$!"
    register_background_pid "$coverage_pid"
    run_timed_step "Fixture smoke coverage" pnpm exec tsx "e2e/smoke/verify-fixtures.ts" --coverage &
    smoke_pid="$!"
    register_background_pid "$smoke_pid"

    wait_for_background_jobs "$coverage_pid" "$smoke_pid"
    run_timed_step "App verification" run_test_apps
  else
    run_timed_step "Package coverage suite" run_test_packages_coverage
    run_timed_step "App verification" run_test_apps
    run_timed_step "Fixture smoke coverage" pnpm exec tsx "e2e/smoke/verify-fixtures.ts" --coverage
  fi
}

run_verify_cli() {
  run_timed_step "Assistant CLI typecheck" pnpm --dir "packages/assistant-cli" typecheck
  run_timed_step "Setup CLI typecheck" pnpm --dir "packages/setup-cli" typecheck
  run_timed_step "CLI package typecheck" pnpm --dir "packages/cli" typecheck
  run_timed_step "Prepared runtime artifacts" run_test_runtime_artifact_build_with_retry
  run_timed_step "CLI package shape verification" pnpm exec tsx "packages/cli/scripts/verify-package-shape.ts"
  run_timed_step \
    "CLI workspace Vitest" \
    env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" "${cli_verify_test_files[@]}" --no-coverage --maxWorkers "$repo_vitest_max_workers"
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
      run_test_apps "force"
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
exit $?
