#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

workspace_artifact_lock_label="workspace-verify"
if [[ "$#" -gt 0 ]]; then
  workspace_artifact_lock_label+=" $1"
fi

command_requires_workspace_artifact_lock() {
  case "${1:-}" in
    "typecheck" | "typecheck:packages" | "test:packages:coverage" | "test:coverage" | "verify:acceptance" | "verify:cli")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]] && command_requires_workspace_artifact_lock "${1:-}"; then
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
  "scripts/repo-tools.config.sh"
  "scripts/release.sh"
  "scripts/release-check.sh"
  "scripts/setup-host.sh"
  "scripts/setup-linux.sh"
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
  "scripts/check-hosted-crypto-hardcut.mjs"
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
  "packages/clinical-records"
  "packages/hosted-execution"
  "packages/hosted-orchestrator-temporal"
  "packages/runtime-state"
  "packages/cloudflare-hosted-control"
  "packages/operator-config"
  "packages/assistant-engine"
  "packages/assistant-cli"
  "packages/setup-cli"
  "packages/core"
  "packages/importers"
  "packages/device-syncd"
  "packages/exercise-library"
  "packages/health-metrics"
  "packages/query"
  "packages/inbox-services"
  "packages/inboxd"
  "packages/parsers"
  "packages/messaging-ingress"
  "packages/gateway-core"
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

detect_logical_cpu_count() {
  local cpu_count=""

  if command -v getconf >/dev/null 2>&1; then
    cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi

  if [[ ! "$cpu_count" =~ ^[1-9][0-9]*$ ]] && command -v sysctl >/dev/null 2>&1; then
    cpu_count="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi

  normalize_positive_integer "$cpu_count" "4"
}

local_concurrency_default() {
  local cap="$1"
  local fallback="$2"
  local cpu_count
  cpu_count="$(detect_logical_cpu_count)"

  if [[ "$cpu_count" -gt "$cap" ]]; then
    printf '%s\n' "$cap"
    return
  fi

  normalize_positive_integer "$cpu_count" "$fallback"
}

readonly app_verify_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly app_verify_parallel="${MURPH_APP_VERIFY_PARALLEL:-$app_verify_parallel_default}"
readonly acceptance_app_verify_with_coverage_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly acceptance_app_verify_with_coverage="${MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE:-$acceptance_app_verify_with_coverage_default}"
readonly acceptance_app_verify_delay_seconds_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 45)"
readonly acceptance_app_verify_delay_seconds="$(normalize_non_negative_integer "${MURPH_ACCEPTANCE_APP_VERIFY_DELAY_SECONDS:-$acceptance_app_verify_delay_seconds_default}" "$acceptance_app_verify_delay_seconds_default")"
# Package coverage and app verification share generated setup. Keep the legacy
# Cloudflare-only overlap as an explicit escape hatch when full app overlap is
# disabled.
readonly acceptance_early_cloudflare_verify="${MURPH_ACCEPTANCE_EARLY_CLOUDFLARE_VERIFY:-0}"
readonly test_lane_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
readonly test_lane_parallel="${MURPH_TEST_LANES_PARALLEL:-$test_lane_parallel_default}"
readonly package_coverage_concurrency_default="$([[ -n "${CI:-}" ]] && echo 1 || echo 6)"
readonly package_coverage_concurrency_limit="$(normalize_positive_integer "${MURPH_PACKAGE_COVERAGE_CONCURRENCY:-$package_coverage_concurrency_default}" "$package_coverage_concurrency_default")"
readonly package_coverage_cli_active_concurrency_default="$([[ -n "${CI:-}" ]] && echo 1 || echo 4)"
readonly package_coverage_cli_active_concurrency_limit="$(normalize_positive_integer "${MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY:-$package_coverage_cli_active_concurrency_default}" "$package_coverage_cli_active_concurrency_default")"
readonly package_coverage_vitest_max_workers_default="$([[ -n "${CI:-}" ]] && echo 50% || echo 75%)"
readonly package_coverage_vitest_max_workers="${MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS:-$package_coverage_vitest_max_workers_default}"
readonly typecheck_workspace_concurrency_default="$([[ -n "${CI:-}" ]] && echo 2 || local_concurrency_default 8 4)"
readonly typecheck_preflight_parallel_default="1"
readonly typecheck_preflight_parallel="${MURPH_TYPECHECK_PREFLIGHT_PARALLEL:-$typecheck_preflight_parallel_default}"
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
  local step_status=0

  verify_log "start ${label}"
  if "$@"; then
    verify_log "done ${label} ($((SECONDS - started_at))s step, ${SECONDS}s since command start)"
    return 0
  else
    step_status=$?
    return "$step_status"
  fi
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
  "packages/cli/test/cli-expansion-intervention.test.ts"
  "packages/cli/test/cli-expansion-provider-event-samples.test.ts"
  "packages/cli/test/cli-expansion-samples-audit.test.ts"
  "packages/cli/test/cli-expansion-workout.test.ts"
  "packages/cli/test/device-cli.test.ts"
  "packages/cli/test/device-daemon.test.ts"
  "packages/cli/test/health-tail.test.ts"
  "packages/cli/test/canonical-write-source-audit.test.ts"
  "packages/cli/test/assistant-cron.test.ts"
  "packages/cli/test/incur-smoke.test.ts"
  "packages/cli/test/inbox-service-boundaries.test.ts"
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

  # The package/app typecheck scripts are no-emit: they read sibling sources or
  # already-built dist and produce nothing another package's typecheck consumes.
  # The one real prerequisite (the contracts build) is sequenced explicitly
  # before this fanout, so topological ordering would only serialize the lane.
  run_command_with_retry \
    "Workspace package typecheck" \
    pnpm -r --no-sort --workspace-concurrency="$typecheck_workspace_concurrency" "${filter_args[@]}" typecheck
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
      verify_log "done ${label} (${step_elapsed}s step, $((SECONDS - total_started_at))s across attempts)"
      return 0
    fi

    step_elapsed=$((SECONDS - started_at))
    verify_log "failed ${label} (${step_elapsed}s step, $((SECONDS - total_started_at))s across attempts)"

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

generate_health_commons_artifacts_with_retry() {
  run_command_with_retry "health-commons generated artifacts" pnpm health-commons:generate
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

run_app_verify_command_with_retry() {
  local app_dir="$1"
  local skip_cloudflare_typecheck="${2:-0}"
  local health_commons_generated_prepared="${3:-0}"
  local env_args=(env -u NODE_V8_COVERAGE)

  if [[ "$app_dir" == "apps/cloudflare" && "$skip_cloudflare_typecheck" == "1" ]]; then
    env_args+=(MURPH_CLOUDFLARE_VERIFY_SKIP_TYPECHECK=1)
  fi
  if [[ "$health_commons_generated_prepared" == "1" ]]; then
    env_args+=(MURPH_HEALTH_COMMONS_GENERATED_PREPARED=1)
  fi
  if [[ "$app_dir" == "apps/web" && "$skip_cloudflare_typecheck" == "1" ]]; then
    env_args+=(MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED=1)
  fi

  run_command_with_retry \
    "Package command for ${app_dir} (verify)" \
    "${env_args[@]}" pnpm --dir "$app_dir" verify
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
  # The contracts and OpenClaw Vitest suites already run inside the root
  # multi-project Vitest lane, so the only prerequisite here is the contracts
  # artifact verification, which rebuilds the shared contracts dist that
  # built-runtime consumers import and must finish before that lane starts.
  run_timed_step "Contracts artifact verification" pnpm --dir "packages/contracts" test:artifacts
}

run_test_apps() {
  local skip_cloudflare_typecheck="${1:-0}"
  local health_commons_generated_prepared="${2:-0}"

  if [[ "$app_verify_parallel" == "1" ]]; then
    local pids=()

    # App verification should not emit V8 coverage into the repo coverage workspace.
    run_app_verify_command_with_retry "apps/web" "$skip_cloudflare_typecheck" "$health_commons_generated_prepared" &
    local hosted_web_verify_pid="$!"
    pids+=("$hosted_web_verify_pid")
    register_background_pid "$hosted_web_verify_pid"
    run_app_verify_command_with_retry "apps/cloudflare" "$skip_cloudflare_typecheck" "$health_commons_generated_prepared" &
    local cloudflare_verify_pid="$!"
    pids+=("$cloudflare_verify_pid")
    register_background_pid "$cloudflare_verify_pid"

    if ! wait_for_background_jobs "${pids[@]}"; then
      return 1
    fi

    return 0
  fi

  run_app_verify_command_with_retry "apps/web" "$skip_cloudflare_typecheck" "$health_commons_generated_prepared"
  run_app_verify_command_with_retry "apps/cloudflare" "$skip_cloudflare_typecheck" "$health_commons_generated_prepared"
}

prepare_repo_vitest_runtime_artifacts() {
  local health_commons_generated_prepared="${1:-0}"

  run_test_runtime_artifact_build_with_retry
  if [[ "$health_commons_generated_prepared" == "1" ]]; then
    verify_log "skip Health Commons generated artifacts; root acceptance typecheck already prepared them"
  else
    run_timed_step "Health Commons generated artifacts" generate_health_commons_artifacts_with_retry
  fi
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
  local contracts_artifacts_prepared="${3:-0}"

  if [[ "$package_dir" == "packages/cli" ]]; then
    run_timed_step \
      "$label" \
      env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" --coverage
    return $?
  fi

  if [[ "$package_dir" == "packages/contracts" && "$contracts_artifacts_prepared" == "1" ]]; then
    run_timed_step \
      "$label" \
      env MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" \
        pnpm --dir packages/contracts test:coverage:prepared
    return $?
  fi

  run_timed_step \
    "$label" \
    env MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm --dir "$package_dir" test:coverage
}

run_all_package_coverage() {
  local contracts_artifacts_prepared="${1:-0}"
  local package_coverage_dirs=(
    "packages/cli"
    "packages/assistant-engine"
    "packages/core"
    "packages/assistant-runtime"
    "packages/setup-cli"
    "packages/assistant-cli"
    "packages/assistantd"
    "packages/cloudflare-hosted-control"
    # In non-prepared coverage, the launch guard below keeps contracts out of
    # the active CLI window because contracts artifact verification rebuilds
    # shared dist outputs that CLI built-runtime tests import.
    "packages/contracts"
    "packages/clinical-records"
    "packages/device-syncd"
    "packages/exercise-library"
    "packages/gateway-core"
    "packages/health-metrics"
    "packages/hosted-execution"
    "packages/hosted-orchestrator-temporal"
    "packages/importers"
    "packages/inbox-services"
    "packages/inboxd"
    "packages/messaging-ingress"
    "packages/openclaw-plugin"
    "packages/operator-config"
    "packages/parsers"
    "packages/query"
    "packages/runtime-state"
    "packages/vault-usecases"
  )
  local package_coverage_labels=(
    "CLI package coverage"
    "Assistant engine package coverage"
    "Core owner coverage"
    "Assistant runtime package coverage"
    "Setup CLI package coverage"
    "Assistant CLI package coverage"
    "Assistantd package coverage"
    "Cloudflare hosted control package coverage"
    "Contracts package coverage"
    "Clinical records package coverage"
    "Device syncd package coverage"
    "Exercise library package coverage"
    "Gateway core package coverage"
    "Health metrics package coverage"
    "Hosted execution owner coverage"
    "Hosted Temporal orchestrator package coverage"
    "Importers owner coverage"
    "Inbox services package coverage"
    "Inboxd package coverage"
    "Messaging ingress package coverage"
    "OpenClaw package coverage"
    "Operator config package coverage"
    "Parsers package coverage"
    "Query owner coverage"
    "Runtime state package coverage"
    "Vault usecases package coverage"
  )
  local package_count="${#package_coverage_dirs[@]}"
  local package_coverage_concurrency="$package_coverage_concurrency_limit"
  local package_coverage_cli_active_concurrency="$package_coverage_cli_active_concurrency_limit"
  local package_index=0
  local cli_coverage_active=0
  local cli_coverage_pid=""
  local failed_package_labels=()
  local saw_unreported_background_failure=0
  local failure_dir
  local failure_labels_dir
  local status_dir
  local failure_dir_quoted
  failure_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-package-coverage-failures.XXXXXX")"
  failure_labels_dir="$failure_dir/failures"
  status_dir="$failure_dir/status"
  mkdir -p "$failure_labels_dir" "$status_dir"
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
    done < <(find "$failure_labels_dir" -type f -print0 | sort -z)
  }

  trap "rm -rf -- $failure_dir_quoted" RETURN

  # Each package coverage command manages its own Vitest workers, so keep the
  # outer package fanout bounded to avoid oversubscribing local machines.
  if [[ "$package_coverage_concurrency" -gt "$package_count" ]]; then
    package_coverage_concurrency="$package_count"
  fi
  if [[ "$package_coverage_cli_active_concurrency" -gt "$package_coverage_concurrency" ]]; then
    package_coverage_cli_active_concurrency="$package_coverage_concurrency"
  fi

  if [[ "$package_coverage_concurrency" -le 1 ]]; then
    while [[ "$package_index" -lt "$package_count" ]]; do
      if ! run_workspace_package_coverage \
        "${package_coverage_dirs[$package_index]}" \
        "${package_coverage_labels[$package_index]}" \
        "$contracts_artifacts_prepared"; then
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
    local active_pids=()
    local active_failure_files=()
    local active_labels=()
    local active_status_files=()

    current_package_coverage_concurrency() {
      if [[ "$cli_coverage_active" == "1" ]]; then
        printf '%s\n' "$package_coverage_cli_active_concurrency"
        return
      fi

      printf '%s\n' "$package_coverage_concurrency"
    }

    can_launch_next_package_coverage() {
      if [[ "$package_index" -ge "$package_count" ]]; then
        return 1
      fi

      # In standalone package coverage, contracts artifact verification still
      # owns a rebuild. Do not let dynamic refill start it while CLI
      # built-runtime coverage may be importing prepared dist outputs.
      if [[
        "$cli_coverage_active" == "1"
        && "${package_coverage_dirs[$package_index]}" == "packages/contracts"
        && "$contracts_artifacts_prepared" != "1"
      ]]; then
        return 1
      fi

      return 0
    }

    package_coverage_pid_finished_without_status() {
      local active_pid="$1"
      local process_status

      if ! kill -0 "$active_pid" 2>/dev/null; then
        return 0
      fi

      process_status="$(ps -p "$active_pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
      [[ "$process_status" == Z* ]]
    }

    launch_package_coverage() {
      local failure_file="$failure_labels_dir/$package_index"
      local status_file="$status_dir/$package_index"
      local package_dir="${package_coverage_dirs[$package_index]}"
      local package_label="${package_coverage_labels[$package_index]}"
      (
        local status=0
        write_package_coverage_status() {
          printf '%s\n' "$status" >"$status_file"
        }
        trap write_package_coverage_status EXIT

        if ! run_workspace_package_coverage \
          "$package_dir" \
          "$package_label" \
          "$contracts_artifacts_prepared"; then
          printf '%s\n' "$package_label" >"$failure_file"
          status=1
        fi

        exit "$status"
      ) &
      local coverage_pid="$!"
      active_pids+=("$coverage_pid")
      active_failure_files+=("$failure_file")
      active_labels+=("$package_label")
      active_status_files+=("$status_file")
      register_background_pid "$coverage_pid"
      if [[ "$package_dir" == "packages/cli" ]]; then
        cli_coverage_active=1
        cli_coverage_pid="$coverage_pid"
      fi
      package_index=$((package_index + 1))
    }

    reap_finished_package_coverage() {
      local remaining_pids=()
      local remaining_failure_files=()
      local remaining_labels=()
      local remaining_status_files=()
      local reaped_any=0
      local active_index

      for active_index in "${!active_pids[@]}"; do
        local active_pid="${active_pids[$active_index]}"
        local failure_file="${active_failure_files[$active_index]}"
        local active_label="${active_labels[$active_index]}"
        local status_file="${active_status_files[$active_index]}"

        if [[ ! -f "$status_file" ]]; then
          if package_coverage_pid_finished_without_status "$active_pid"; then
            wait "$active_pid" 2>/dev/null || true
            unregister_background_pid "$active_pid"
            if [[ "$active_pid" == "$cli_coverage_pid" ]]; then
              cli_coverage_active=0
            fi
            if [[ -n "$active_label" ]]; then
              record_failed_package_coverage "$active_label"
            else
              saw_unreported_background_failure=1
            fi
            reaped_any=1
            continue
          fi
          remaining_pids+=("$active_pid")
          remaining_failure_files+=("$failure_file")
          remaining_labels+=("$active_label")
          remaining_status_files+=("$status_file")
          continue
        fi

        if ! wait "$active_pid"; then
          if [[ ! -f "$failure_file" ]]; then
            if [[ -n "$active_label" ]]; then
              record_failed_package_coverage "$active_label"
            else
              saw_unreported_background_failure=1
            fi
          fi
        fi
        unregister_background_pid "$active_pid"
        if [[ "$active_pid" == "$cli_coverage_pid" ]]; then
          cli_coverage_active=0
        fi
        reaped_any=1
      done

      active_pids=()
      active_failure_files=()
      active_labels=()
      active_status_files=()

      if [[ "${#remaining_pids[@]}" -gt 0 ]]; then
        active_pids=("${remaining_pids[@]}")
        active_failure_files=("${remaining_failure_files[@]}")
        active_labels=("${remaining_labels[@]}")
        active_status_files=("${remaining_status_files[@]}")
      fi

      [[ "$reaped_any" -eq 1 ]]
    }

    while [[ "$package_index" -lt "$package_count" || "${#active_pids[@]}" -gt 0 ]]; do
      while [[
        "$package_index" -lt "$package_count"
        && "${#active_pids[@]}" -lt "$(current_package_coverage_concurrency)"
      ]]; do
        if ! can_launch_next_package_coverage; then
          break
        fi
        launch_package_coverage
      done

      if [[ "${#active_pids[@]}" -eq 0 ]]; then
        continue
      fi

      if ! reap_finished_package_coverage; then
        sleep 0.2
      fi
    done
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

run_package_boundary_verification() {
  local artifacts_prepared="${1:-0}"

  if [[ "$artifacts_prepared" == "1" ]]; then
    run_timed_step "Messaging ingress built package boundary" pnpm --dir "packages/messaging-ingress" verify:package-boundary:prepared
    run_timed_step "Inboxd built package boundary" pnpm --dir "packages/inboxd" verify:package-boundary:prepared
    run_timed_step "Hosted local harness package boundary" pnpm --dir "packages/hosted-local-harness" verify:package-boundary
    return
  fi

  run_timed_step "Messaging ingress built package boundary" pnpm --dir "packages/messaging-ingress" verify:package-boundary
  run_timed_step "Inboxd built package boundary" pnpm --dir "packages/inboxd" verify:package-boundary
  run_timed_step "Hosted local harness package boundary" pnpm --dir "packages/hosted-local-harness" verify:package-boundary
}

run_diff_package_boundary_verification() {
  local package_dir="$1"

  case "$package_dir" in
    "packages/messaging-ingress")
      run_timed_step "packages/messaging-ingress built package boundary" pnpm --dir "packages/messaging-ingress" verify:package-boundary
      ;;
    "packages/inboxd")
      run_timed_step "packages/inboxd built package boundary" pnpm --dir "packages/inboxd" verify:package-boundary
      ;;
    "packages/hosted-local-harness")
      run_timed_step "packages/hosted-local-harness package boundary" pnpm --dir "packages/hosted-local-harness" verify:package-boundary
      ;;
  esac
}

run_typecheck_preflight() {
  run_timed_step "Shell syntax" check_shell_syntax
  run_timed_step "Node syntax" check_node_syntax
  run_timed_step "Dependency policy" run_dependency_policy_check
  run_timed_step "Workspace boundary checks" run_workspace_boundary_check
  run_timed_step "Hosted run stale-name guard" pnpm exec tsx "scripts/check-hosted-run-stale-residue.ts"
  run_timed_step "Hosted Temporal orchestration guard" pnpm hosted-temporal:guard
  run_timed_step "Hosted crypto hard-cut guard" pnpm hosted-crypto:guard
  run_timed_step "Raw health log payload guard" pnpm logs:guard
  run_timed_step "Repo TS tools typecheck" pnpm exec tsc -p "tsconfig.tools.json" --pretty false
  run_timed_step "Contracts build" pnpm --dir "packages/contracts" build
}

run_typecheck_overlapped() {
  local pids=()

  run_timed_step "Shell syntax" check_shell_syntax &
  local shell_syntax_pid="$!"
  pids+=("$shell_syntax_pid")
  register_background_pid "$shell_syntax_pid"

  run_timed_step "Node syntax" check_node_syntax &
  local node_syntax_pid="$!"
  pids+=("$node_syntax_pid")
  register_background_pid "$node_syntax_pid"

  run_timed_step "Dependency policy" run_dependency_policy_check &
  local dependency_policy_pid="$!"
  pids+=("$dependency_policy_pid")
  register_background_pid "$dependency_policy_pid"

  run_timed_step "Workspace boundary checks" run_workspace_boundary_check &
  local workspace_boundary_pid="$!"
  pids+=("$workspace_boundary_pid")
  register_background_pid "$workspace_boundary_pid"

  run_timed_step "Hosted run stale-name guard" pnpm exec tsx "scripts/check-hosted-run-stale-residue.ts" &
  local hosted_run_guard_pid="$!"
  pids+=("$hosted_run_guard_pid")
  register_background_pid "$hosted_run_guard_pid"

  run_timed_step "Hosted Temporal orchestration guard" pnpm hosted-temporal:guard &
  local hosted_temporal_guard_pid="$!"
  pids+=("$hosted_temporal_guard_pid")
  register_background_pid "$hosted_temporal_guard_pid"

  run_timed_step "Hosted crypto hard-cut guard" pnpm hosted-crypto:guard &
  local hosted_crypto_guard_pid="$!"
  pids+=("$hosted_crypto_guard_pid")
  register_background_pid "$hosted_crypto_guard_pid"

  run_timed_step "Raw health log payload guard" pnpm logs:guard &
  local raw_health_log_guard_pid="$!"
  pids+=("$raw_health_log_guard_pid")
  register_background_pid "$raw_health_log_guard_pid"

  run_timed_step "Repo TS tools typecheck" pnpm exec tsc -p "tsconfig.tools.json" --pretty false &
  local repo_tools_typecheck_pid="$!"
  pids+=("$repo_tools_typecheck_pid")
  register_background_pid "$repo_tools_typecheck_pid"

  run_timed_step "Contracts build" pnpm --dir "packages/contracts" build

  # The contracts build is the only preflight prerequisite for the package/app
  # typecheck fanout. Keep the remaining independent guards running while that
  # fanout starts.
  run_timed_step "Workspace package/app typecheck" run_typecheck_packages &
  local package_typecheck_pid="$!"
  pids+=("$package_typecheck_pid")
  register_background_pid "$package_typecheck_pid"

  wait_for_background_jobs "${pids[@]}"
}

run_typecheck() {
  if [[ "$typecheck_preflight_parallel" == "1" ]]; then
    run_typecheck_overlapped
    return 0
  fi

  run_typecheck_preflight
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

run_package_coverage_cleanup_and_hygiene() {
  run_timed_step \
    "Coverage cleanup" \
    node "scripts/rm-paths.mjs" "coverage" "packages/*/coverage"
  run_timed_step "Tracked artifact hygiene" pnpm no-js
}

run_test_packages_coverage_after_hygiene() {
  local artifacts_prepared="${1:-0}"
  local contracts_artifacts_prepared="${2:-0}"
  local health_commons_generated_prepared="${3:-0}"

  if [[ "$artifacts_prepared" != "1" ]]; then
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts "$health_commons_generated_prepared"
    artifacts_prepared="1"
  else
    verify_log "skip Health Commons generated artifacts; prepared runtime artifacts already covered them"
  fi
  run_timed_step "All package coverage" run_all_package_coverage "$contracts_artifacts_prepared" || return $?
  run_package_boundary_verification "$artifacts_prepared"
}

run_test_packages_coverage() {
  run_package_coverage_cleanup_and_hygiene
  run_test_packages_coverage_after_hygiene "$@"
}

run_acceptance_app_verification_after_delay() {
  local acceptance_typechecked="${1:-0}"
  local health_commons_generated_prepared="${2:-0}"

  if [[ "$acceptance_app_verify_delay_seconds" -gt 0 ]]; then
    verify_log "delay App verification ${acceptance_app_verify_delay_seconds}s to preserve package coverage throughput"
    sleep "$acceptance_app_verify_delay_seconds"
  fi

  run_timed_step "App verification" run_test_apps "$acceptance_typechecked" "$health_commons_generated_prepared"
}

run_test_coverage() {
  local acceptance_typechecked="${1:-0}"

  if [[ "$acceptance_typechecked" == "1" ]]; then
    verify_log "skip repo acceptance guards already covered by typecheck"
  else
    run_repo_acceptance_guards
  fi
  run_timed_step "Doc gardening" bash "scripts/doc-gardening.sh" --fail-on-issues

  if [[ "$test_lane_parallel" == "1" ]]; then
    local coverage_pid
    local smoke_pid

    # Coverage and app verify both depend on the prepared runtime artifacts.
    # After the cleanup/hygiene pass, local acceptance can overlap the long
    # package and app verification branches without mutating their shared setup.
    run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts "$acceptance_typechecked"

    if [[ "$acceptance_app_verify_with_coverage" == "1" ]]; then
      run_timed_step "Package coverage hygiene" run_package_coverage_cleanup_and_hygiene

      run_timed_step "Package coverage suite" run_test_packages_coverage_after_hygiene 1 "$acceptance_typechecked" &
      coverage_pid="$!"
      register_background_pid "$coverage_pid"
      run_timed_step "Fixture smoke coverage" run_fixture_smoke_verification --coverage &
      smoke_pid="$!"
      register_background_pid "$smoke_pid"
      run_acceptance_app_verification_after_delay "$acceptance_typechecked" 1 &
      local app_verify_pid="$!"
      register_background_pid "$app_verify_pid"

      wait_for_background_jobs "$coverage_pid" "$smoke_pid" "$app_verify_pid"
    else
      run_timed_step "Package coverage suite" run_test_packages_coverage 1 "$acceptance_typechecked" &
      coverage_pid="$!"
      register_background_pid "$coverage_pid"
      run_timed_step "Fixture smoke coverage" run_fixture_smoke_verification --coverage &
      smoke_pid="$!"
      register_background_pid "$smoke_pid"

      if [[ "$acceptance_early_cloudflare_verify" == "1" ]]; then
        run_app_verify_command_with_retry "apps/cloudflare" "$acceptance_typechecked" 1 &
        local cloudflare_verify_pid="$!"
        register_background_pid "$cloudflare_verify_pid"

        wait_for_background_jobs "$coverage_pid" "$smoke_pid" "$cloudflare_verify_pid"
        run_app_verify_command_with_retry "apps/web" "$acceptance_typechecked" 1
      else
        wait_for_background_jobs "$coverage_pid" "$smoke_pid"
        run_timed_step "App verification" run_test_apps "$acceptance_typechecked" 1
      fi
    fi
  else
    run_timed_step "Package coverage suite" run_test_packages_coverage 0 "$acceptance_typechecked" "$acceptance_typechecked"
    run_timed_step "App verification" run_test_apps "$acceptance_typechecked" 1
    run_timed_step "Fixture smoke coverage" run_fixture_smoke_verification --coverage
  fi
}

run_verify_acceptance() {
  run_typecheck
  run_test_coverage 1
}

run_diff_repo_internal_fast_path() {
  run_timed_step "Shell syntax" check_shell_syntax
  run_timed_step "Node syntax" check_node_syntax
  run_timed_step "Hosted run stale-name guard" pnpm exec tsx "scripts/check-hosted-run-stale-residue.ts"
  run_timed_step "Hosted Temporal orchestration guard" pnpm hosted-temporal:guard
  run_timed_step "Raw health log payload guard" pnpm logs:guard
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
  local run_repo_tools_tests="${diff_run_repo_tools_tests:-0}"

  verify_log "diff scope: ${diff_summary}"

  if [[ "$diff_no_changes" == "1" ]]; then
    verify_log "no changed files detected; falling back to workspace typecheck"
    run_typecheck
    return 0
  fi

  if [[ "$diff_repo_internal_fast_path" == "1" ]]; then
    verify_log "diff-aware verification selected the repo-internal fast path"
    run_diff_repo_internal_fast_path
    if [[ "$run_repo_tools_tests" == "1" ]]; then
      run_timed_step "Repo tools tests" pnpm test:repo-tools
    fi
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
    run_timed_step "Hosted run stale-name guard" pnpm exec tsx "scripts/check-hosted-run-stale-residue.ts"
    run_timed_step "Hosted Temporal orchestration guard" pnpm hosted-temporal:guard
    run_timed_step "Raw health log payload guard" pnpm logs:guard
  fi

  if [[ "$diff_run_verify_cli" == "1" ]]; then
    run_timed_step "CLI targeted verification" run_verify_cli_with_workspace_artifact_lock
  fi

  if [[ "$run_repo_tools_tests" == "1" ]]; then
    run_timed_step "Repo tools tests" pnpm test:repo-tools
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
    run_diff_package_boundary_verification "$package_dir"
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

run_verify_cli_with_workspace_artifact_lock() {
  if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" == "1" ]]; then
    run_verify_cli
    return 0
  fi

  bash "$repo_root/scripts/workspace-verify.sh" verify:cli
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
    "verify:acceptance")
      run_verify_acceptance
      ;;
    "test:diff")
      shift
      run_test_diff "$@"
      ;;
    "verify:cli")
      run_verify_cli
      ;;
    *)
      echo "Usage: bash scripts/workspace-verify.sh {typecheck|typecheck:packages|test|test:packages|test:apps|test:packages:coverage|test:coverage|verify:acceptance|test:diff [path ...]|verify:cli}" >&2
      exit 1
      ;;
  esac
}

main "$@"
exit $?
