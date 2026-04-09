#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

workspace_artifact_lock_label="workspace-verify"
if [[ "$#" -gt 0 ]]; then
  workspace_artifact_lock_label+=" $1"
fi

if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]]; then
  exec node "$repo_root/scripts/run-with-workspace-artifact-lock.mjs" "$workspace_artifact_lock_label" -- \
    bash "$repo_root/scripts/workspace-verify.sh" "$@"
fi

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
  "scripts/run-with-workspace-artifact-lock.mjs"
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
  "packages/cloudflare-hosted-control"
  "packages/operator-config"
  "packages/assistant-engine"
  "packages/assistant-cli"
  "packages/setup-cli"
  "packages/core"
  "packages/importers"
  "packages/device-syncd"
  "packages/query"
  "packages/inbox-services"
  "packages/inboxd"
  "packages/inboxd-imessage"
  "packages/parsers"
  "packages/messaging-ingress"
  "packages/gateway-core"
  "packages/gateway-local"
  "packages/cli"
  "packages/openclaw-plugin"
  "packages/assistantd"
  "packages/assistant-runtime"
  "packages/vault-usecases"
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

readonly app_verify_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly app_verify_parallel="${MURPH_APP_VERIFY_PARALLEL:-$app_verify_parallel_default}"
readonly test_lane_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly test_lane_parallel="${MURPH_TEST_LANES_PARALLEL:-$test_lane_parallel_default}"
readonly package_coverage_concurrency_default="$([[ -n "${CI:-}" ]] && echo 1 || echo 4)"
readonly package_coverage_concurrency_limit="$(normalize_positive_integer "${MURPH_PACKAGE_COVERAGE_CONCURRENCY:-$package_coverage_concurrency_default}" "$package_coverage_concurrency_default")"
readonly package_coverage_vitest_max_workers_default="$([[ -n "${CI:-}" ]] && echo 50% || echo 100%)"
readonly package_coverage_vitest_max_workers="${MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS:-$package_coverage_vitest_max_workers_default}"
readonly typecheck_workspace_concurrency_default="2"
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

load_diff_scope() {
  local scope_shell
  scope_shell="$(node "scripts/workspace-diff-scope.mjs" --format shell "$@")"
  eval "$scope_shell"
}

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

wait_for_background_jobs_allow_failures() {
  local failed=0
  local pid

  for pid in "$@"; do
    if ! wait "$pid"; then
      failed=1
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

  run_timed_step "Contracts package test" pnpm --dir "packages/contracts" test
  run_timed_step "OpenClaw plugin test" pnpm --dir "packages/openclaw-plugin" test
}

run_test_apps() {
  if [[ "$app_verify_parallel" == "1" ]]; then
    local pids=()

    # App verification should not emit V8 coverage into the repo coverage workspace.
    run_package_command_without_node_v8_coverage_with_retry "apps/web" verify &
    local hosted_web_verify_pid="$!"
    pids+=("$hosted_web_verify_pid")
    register_background_pid "$hosted_web_verify_pid"
    run_package_command_without_node_v8_coverage_with_retry "apps/cloudflare" verify &
    local cloudflare_verify_pid="$!"
    pids+=("$cloudflare_verify_pid")
    register_background_pid "$cloudflare_verify_pid"

    if ! wait_for_background_jobs "${pids[@]}"; then
      return 1
    fi

    return 0
  fi

  run_package_command_without_node_v8_coverage_with_retry "apps/web" verify
  run_package_command_without_node_v8_coverage_with_retry "apps/cloudflare" verify
}

prepare_repo_vitest_runtime_artifacts() {
  run_test_runtime_artifact_build_with_retry
  run_timed_step "CLI package shape verification" pnpm exec tsx "packages/cli/scripts/verify-package-shape.ts"
}

run_repo_acceptance_guards() {
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
}

run_fixture_smoke_verification() {
  pnpm exec tsx "e2e/smoke/verify-scenario-integrity.ts" "$@"
}

run_repo_vitest() {
  # Keep worker selection centralized in the Vitest configs so local runs use
  # the faster 75% default while CI stays at 50%, with the same env override
  # path (`MURPH_VITEST_MAX_WORKERS`) for both lanes.
  pnpm exec vitest run --config "vitest.config.ts" "$@"
}

run_workspace_package_coverage() {
  local package_dir="$1"
  local label="$2"

  if [[ "$package_dir" == "packages/cli" ]]; then
    run_timed_step \
      "$label" \
      env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" --coverage
    return 0
  fi

  run_timed_step \
    "$label" \
    env MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm --dir "$package_dir" test:coverage
}

run_all_package_coverage() {
  local package_coverage_dirs=(
    "packages/assistant-cli"
    "packages/assistant-engine"
    "packages/assistant-runtime"
    "packages/assistantd"
    # Keep CLI out of the same outer batch as contracts: contracts artifact
    # verification rebuilds shared dist outputs that the CLI built-runtime tests import.
    "packages/cloudflare-hosted-control"
    "packages/contracts"
    "packages/core"
    "packages/device-syncd"
    "packages/cli"
    "packages/gateway-core"
    "packages/gateway-local"
    "packages/hosted-execution"
    "packages/importers"
    "packages/inbox-services"
    "packages/inboxd"
    "packages/inboxd-imessage"
    "packages/messaging-ingress"
    "packages/openclaw-plugin"
    "packages/operator-config"
    "packages/parsers"
    "packages/query"
    "packages/runtime-state"
    "packages/setup-cli"
    "packages/vault-usecases"
  )
  local package_coverage_labels=(
    "Assistant CLI package coverage"
    "Assistant engine package coverage"
    "Assistant runtime package coverage"
    "Assistantd package coverage"
    "Cloudflare hosted control package coverage"
    "Contracts package coverage"
    "Core owner coverage"
    "Device syncd package coverage"
    "CLI package coverage"
    "Gateway core package coverage"
    "Gateway local package coverage"
    "Hosted execution owner coverage"
    "Importers owner coverage"
    "Inbox services package coverage"
    "Inboxd package coverage"
    "Inboxd iMessage package coverage"
    "Messaging ingress package coverage"
    "OpenClaw package coverage"
    "Operator config package coverage"
    "Parsers package coverage"
    "Query owner coverage"
    "Runtime state package coverage"
    "Setup CLI package coverage"
    "Vault usecases package coverage"
  )
  local package_count="${#package_coverage_dirs[@]}"
  local package_coverage_concurrency="$package_coverage_concurrency_limit"
  local package_index=0
  local failed_package_labels=()
  local saw_unreported_background_failure=0
  local failure_dir
  local failure_dir_quoted
  failure_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-package-coverage-failures.XXXXXX")"
  printf -v failure_dir_quoted '%q' "$failure_dir"

  record_failed_package_coverage() {
    local label="$1"
    failed_package_labels+=("$label")
  }

  collect_failed_package_coverage_labels() {
    local failure_file
    local label

    while IFS= read -r -d '' failure_file; do
      if ! IFS= read -r label <"$failure_file"; then
        continue
      fi
      [[ -n "$label" ]] || continue
      record_failed_package_coverage "$label"
    done < <(find "$failure_dir" -type f -print0 | sort -z)
  }

  trap "rm -rf -- $failure_dir_quoted" RETURN

  # Each package coverage command manages its own Vitest workers, so keep the
  # outer package fanout bounded to avoid oversubscribing local machines.
  if [[ "$package_coverage_concurrency" -gt "$package_count" ]]; then
    package_coverage_concurrency="$package_count"
  fi

  if [[ "$package_coverage_concurrency" -le 1 ]]; then
    while [[ "$package_index" -lt "$package_count" ]]; do
      if ! run_workspace_package_coverage \
        "${package_coverage_dirs[$package_index]}" \
        "${package_coverage_labels[$package_index]}"; then
        record_failed_package_coverage "${package_coverage_labels[$package_index]}"
      fi
      package_index=$((package_index + 1))
    done
    if [[ "${#failed_package_labels[@]}" -gt 0 ]]; then
      verify_log "package coverage failures: ${failed_package_labels[*]}"
      return 1
    fi
    return 0
  fi

  while [[ "$package_index" -lt "$package_count" ]]; do
    local batch_pids=()
    local batch_slots=0

    while [[ "$package_index" -lt "$package_count" && "$batch_slots" -lt "$package_coverage_concurrency" ]]; do
      local failure_file="$failure_dir/$package_index"
      (
        if ! run_workspace_package_coverage \
          "${package_coverage_dirs[$package_index]}" \
          "${package_coverage_labels[$package_index]}"; then
          printf '%s\n' "${package_coverage_labels[$package_index]}" >"$failure_file"
          exit 1
        fi
      ) &
      local coverage_pid="$!"
      batch_pids+=("$coverage_pid")
      register_background_pid "$coverage_pid"
      package_index=$((package_index + 1))
      batch_slots=$((batch_slots + 1))
    done

    if ! wait_for_background_jobs_allow_failures "${batch_pids[@]}"; then
      saw_unreported_background_failure=1
    fi
  done

  collect_failed_package_coverage_labels

  if [[ "${#failed_package_labels[@]}" -gt 0 ]]; then
    if [[ "$saw_unreported_background_failure" -ne 0 ]]; then
      verify_log "package coverage failures: ${failed_package_labels[*]} plus an unreported background package coverage failure"
      return 1
    fi
    verify_log "package coverage failures: ${failed_package_labels[*]}"
    return 1
  fi

  if [[ "$saw_unreported_background_failure" -ne 0 ]]; then
    verify_log "package coverage failures: unreported background package coverage failure"
    return 1
  fi

  return 0
}

run_typecheck() {
  run_timed_step "Shell syntax" check_shell_syntax
  run_timed_step "Node syntax" check_node_syntax
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  run_timed_step "Repo TS tools typecheck" pnpm exec tsc -p "tsconfig.tools.json" --pretty false
  run_timed_step "Contracts build" pnpm --dir "packages/contracts" build
  run_timed_step "Workspace package/app typecheck" run_typecheck_packages
}

run_test() {
  run_timed_step "Package behavior prerequisites" run_test_packages_common

  if [[ "$test_lane_parallel" == "1" ]]; then
    local test_packages_pid
    local smoke_pid

    run_timed_step "Repo Vitest" run_repo_vitest --no-coverage &
    test_packages_pid="$!"
    register_background_pid "$test_packages_pid"
    run_timed_step "Fixture smoke verification" run_fixture_smoke_verification &
    smoke_pid="$!"
    register_background_pid "$smoke_pid"

    wait_for_background_jobs "$test_packages_pid" "$smoke_pid"
  else
    run_timed_step "Repo Vitest" run_repo_vitest --no-coverage
    run_timed_step "Fixture smoke verification" run_fixture_smoke_verification
  fi
}

run_test_packages() {
  run_timed_step "Package behavior prerequisites" run_test_packages_common
  run_timed_step "Repo Vitest" run_repo_vitest --no-coverage
}

run_test_packages_coverage() {
  local artifacts_prepared="${1:-0}"

  run_timed_step \
    "Coverage cleanup" \
    node "scripts/rm-paths.mjs" "coverage" "packages/*/coverage"
  run_timed_step "Tracked artifact hygiene" pnpm no-js
  if [[ "$artifacts_prepared" != "1" ]]; then
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
  fi
  run_timed_step "All package coverage" run_all_package_coverage
}

run_test_coverage() {
  run_repo_acceptance_guards
  run_timed_step "Doc gardening" bash "scripts/doc-gardening.sh" --fail-on-issues

  if [[ "$test_lane_parallel" == "1" ]]; then
    local coverage_pid
    local smoke_pid

    # Coverage and app verify both depend on the prepared runtime artifacts.
    # Keep package coverage and fixture smoke parallel, but wait to start app
    # verify until the package-coverage suite has released shared app-test
    # resources such as Prisma/client generation.
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
    run_timed_step "Package coverage suite" run_test_packages_coverage 1 &
    coverage_pid="$!"
    register_background_pid "$coverage_pid"
    run_timed_step "Fixture smoke coverage" run_fixture_smoke_verification --coverage &
    smoke_pid="$!"
    register_background_pid "$smoke_pid"

    wait_for_background_jobs "$coverage_pid" "$smoke_pid"
    run_timed_step "App verification" run_test_apps
  else
    run_timed_step "Package coverage suite" run_test_packages_coverage
    run_timed_step "App verification" run_test_apps
    run_timed_step "Fixture smoke coverage" run_fixture_smoke_verification --coverage
  fi
}

run_diff_repo_internal_fast_path() {
  run_timed_step "Shell syntax" check_shell_syntax
  run_timed_step "Node syntax" check_node_syntax
  run_timed_step "Repo TS tools typecheck" pnpm exec tsc -p "tsconfig.tools.json" --pretty false
}

run_test_diff() {
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi

  load_diff_scope "$@"
  local typecheck_dirs=("${diff_typecheck_dirs[@]-}")
  local test_dirs=("${diff_test_dirs[@]-}")
  local affected_app_dirs=("${diff_affected_app_dirs[@]-}")

  verify_log "diff scope: ${diff_summary}"

  if [[ "$diff_no_changes" == "1" ]]; then
    verify_log "no changed files detected; falling back to workspace typecheck"
    run_typecheck
    return 0
  fi

  if [[ "$diff_repo_internal_fast_path" == "1" ]]; then
    verify_log "diff-aware verification selected the repo-internal fast path"
    run_diff_repo_internal_fast_path
    run_timed_step "Dependency policy" run_dependency_policy_check
    return 0
  fi

  if [[ "$diff_has_non_workspace_files" == "1" || "$diff_global_root_change" == "1" ]]; then
    run_diff_repo_internal_fast_path
  fi

  if [[ "$diff_has_non_workspace_files" == "1" || "$diff_global_root_change" == "1" || "$diff_run_verify_cli" == "1" || "${#typecheck_dirs[@]}" -gt 0 || "${#test_dirs[@]}" -gt 0 || "${#affected_app_dirs[@]}" -gt 0 ]]; then
    run_timed_step "Dependency policy" run_dependency_policy_check
  fi

  if [[ "$diff_global_root_change" == "1" || "$diff_run_verify_cli" == "1" || "${#typecheck_dirs[@]}" -gt 0 || "${#test_dirs[@]}" -gt 0 || "${#affected_app_dirs[@]}" -gt 0 ]]; then
    run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  fi

  if [[ "$diff_run_verify_cli" == "1" ]]; then
    run_timed_step "CLI targeted verification" run_verify_cli
  fi

  local package_dir

  for package_dir in "${typecheck_dirs[@]}"; do
    if [[ -z "$package_dir" ]]; then
      continue
    fi
    run_timed_step "${package_dir} typecheck" run_package_command_with_retry "$package_dir" typecheck
  done

  for package_dir in "${test_dirs[@]}"; do
    if [[ -z "$package_dir" ]]; then
      continue
    fi
    run_timed_step "${package_dir} test" run_package_command_with_retry "$package_dir" test
  done

  local app_dir

  for app_dir in "${affected_app_dirs[@]}"; do
    if [[ -z "$app_dir" ]]; then
      continue
    fi
    run_timed_step "${app_dir} verify" run_package_command_without_node_v8_coverage_with_retry "$app_dir" verify
  done
}

run_verify_cli() {
  run_timed_step "Assistant CLI typecheck" pnpm --dir "packages/assistant-cli" typecheck
  run_timed_step "Setup CLI typecheck" pnpm --dir "packages/setup-cli" typecheck
  run_timed_step "CLI package typecheck" pnpm --dir "packages/cli" typecheck
  run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts
  run_timed_step \
    "CLI workspace Vitest" \
    env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" "${cli_verify_test_files[@]}" --no-coverage
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
    "test:diff")
      shift
      run_test_diff "$@"
      ;;
    "verify:cli")
      run_verify_cli
      ;;
    *)
      echo "Usage: bash scripts/workspace-verify.sh {typecheck|typecheck:packages|test|test:packages|test:apps|test:packages:coverage|test:coverage|test:diff [path ...]|verify:cli}" >&2
      exit 1
      ;;
  esac
}

main "$@"
exit $?
