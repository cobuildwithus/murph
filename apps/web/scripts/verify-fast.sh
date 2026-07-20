#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
if [[ -n "${MURPH_VERIFY_SHARED_HOST+x}" ]]; then
  shared_host_mode="$MURPH_VERIFY_SHARED_HOST"
elif [[ -z "${CI:-}" && -n "${CODEX_THREAD_ID:-}" ]]; then
  shared_host_mode="1"
else
  shared_host_mode="0"
fi
if [[ "$shared_host_mode" != "0" && "$shared_host_mode" != "1" ]]; then
  printf '[apps/web verify] ERROR: MURPH_VERIFY_SHARED_HOST must be 0 or 1.\n' >&2
  exit 1
fi
readonly shared_host_mode
export MURPH_VERIFY_SHARED_HOST="$shared_host_mode"
sqlite_warning_filter_option="--require=$repo_root/config/sqlite-warning-filter.cjs"
hosted_web_default_database_url="postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync"
hosted_web_default_hosted_key="BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"
hosted_web_default_app_session_hmac_key="CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
hosted_web_default_hosted_key_version="v1"
hosted_web_build_default_privy_app_id="cm_app_build_placeholder1"
hosted_web_build_memory_guard_default=0
hosted_web_verify_skip_typecheck="${MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK:-0}"

if [[ -n "${CI:-}" && "$(uname -s)" == "Linux" ]]; then
  hosted_web_build_memory_guard_default=1
fi

hosted_web_build_memory_guard="${MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD:-$hosted_web_build_memory_guard_default}"

if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]]; then
  exec node "$repo_root/scripts/run-with-workspace-artifact-lock.mjs" "apps/web verify" -- \
    bash "$script_dir/verify-fast.sh" "$@"
fi

if [[ "$shared_host_mode" == "1" && "${MURPH_VERIFY_HOST_SLOT_HELD:-0}" != "1" ]]; then
  exec node "$repo_root/scripts/run-with-host-verification-slot.mjs" "apps/web verify" -- \
    bash "$script_dir/verify-fast.sh" "$@"
fi

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

compose_database_url_for_build() {
  printf '%s\n' "${DATABASE_URL:-$hosted_web_default_database_url}"
}

compose_privy_app_id_for_build() {
  printf '%s\n' "${NEXT_PUBLIC_PRIVY_APP_ID:-$hosted_web_build_default_privy_app_id}"
}

compose_hosted_contact_privacy_keys_for_build() {
  printf '%s\n' "${HOSTED_CONTACT_PRIVACY_KEYS:-v1:$hosted_web_default_hosted_key}"
}

compose_hosted_app_session_hmac_key_for_build() {
  printf '%s\n' "${HOSTED_APP_SESSION_HMAC_KEY:-$hosted_web_default_app_session_hmac_key}"
}

compose_hosted_contact_privacy_current_key_version_for_build() {
  printf '%s\n' "${HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION:-$hosted_web_default_hosted_key_version}"
}

compose_hosted_mailbox_fingerprint_key_for_build() {
  printf '%s\n' "${HOSTED_MAILBOX_FINGERPRINT_KEY:-$hosted_web_default_hosted_key}"
}

verify_step_parallel_default="$([[ -n "${CI:-}" || "$shared_host_mode" == "1" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"
owned_background_job_pids=()

verify_log() {
  printf '[apps/web verify] %s\n' "$*" >&2
}

verify_fail() {
  verify_log "ERROR: $*"
  exit 1
}

if [[ "$hosted_web_build_memory_guard" != "0" && "$hosted_web_build_memory_guard" != "1" ]]; then
  verify_fail "MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD must be 0 or 1."
fi

if [[ "$hosted_web_verify_skip_typecheck" != "0" && "$hosted_web_verify_skip_typecheck" != "1" ]]; then
  verify_fail "MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK must be 0 or 1."
fi

if [[ "$hosted_web_build_memory_guard_default" == "1" && "$hosted_web_build_memory_guard" == "0" ]]; then
  verify_log "WARNING: hosted-web build memory guard DISABLED via MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0 on Linux CI; the Vercel Standard-machine memory budget is NOT being measured for this build"
fi

run_timed_step() {
  local label="$1"
  shift
  local started_at="$SECONDS"

  verify_log "start ${label}"
  "$@"
  verify_log "done ${label} ($((SECONDS - started_at))s step)"
}

register_owned_background_job() {
  owned_background_job_pids+=("$1")
}

unregister_owned_background_job() {
  local target_pid="$1"
  local remaining_pids=()
  local pid

  if [[ ${#owned_background_job_pids[@]} -eq 0 ]]; then
    return
  fi

  for pid in "${owned_background_job_pids[@]}"; do
    if [[ "$pid" != "$target_pid" ]]; then
      remaining_pids+=("$pid")
    fi
  done

  if [[ ${#remaining_pids[@]} -eq 0 ]]; then
    owned_background_job_pids=()
  else
    owned_background_job_pids=("${remaining_pids[@]}")
  fi
}

start_owned_background_job() {
  local output_variable="$1"
  shift
  local monitor_was_enabled=0
  local pid

  if [[ "$-" == *m* ]]; then
    monitor_was_enabled=1
  else
    set -m
  fi

  "$@" &
  pid="$!"

  if [[ "$monitor_was_enabled" -eq 0 ]]; then
    set +m
  fi

  register_owned_background_job "$pid"
  printf -v "$output_variable" '%s' "$pid"
}

owned_background_job_is_running() {
  local target_pid="$1"
  local running_pid

  while IFS= read -r running_pid; do
    if [[ "$running_pid" == "$target_pid" ]]; then
      return 0
    fi
  done < <(jobs -pr)

  return 1
}

signal_owned_background_job() {
  local pid="$1"
  local signal="$2"

  if ! owned_background_job_is_running "$pid"; then
    return 1
  fi

  if [[ "$pid" -gt 0 && "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]]; then
    if kill "-$signal" "-$pid" 2>/dev/null; then
      return 0
    fi
  fi

  if owned_background_job_is_running "$pid"; then
    kill "-$signal" "$pid" 2>/dev/null || true
  fi
}

wait_for_owned_background_job_exit() {
  local pid="$1"
  local attempts="$2"
  local attempt

  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if ! owned_background_job_is_running "$pid"; then
      return 0
    fi
    sleep 0.1
  done

  ! owned_background_job_is_running "$pid"
}

terminate_owned_background_job() {
  local pid="$1"

  if ! owned_background_job_is_running "$pid"; then
    wait "$pid" 2>/dev/null || true
    return
  fi

  signal_owned_background_job "$pid" TERM || true
  if wait_for_owned_background_job_exit "$pid" 10; then
    wait "$pid" 2>/dev/null || true
    return
  fi

  signal_owned_background_job "$pid" KILL || true
  if wait_for_owned_background_job_exit "$pid" 10; then
    wait "$pid" 2>/dev/null || true
    return
  fi

  verify_log "WARNING: owned background job ${pid} did not exit after SIGKILL"
}

cleanup_background_jobs() {
  local background_pids=("${owned_background_job_pids[@]}")
  local pid

  if [[ ${#background_pids[@]} -eq 0 ]]; then
    return
  fi

  owned_background_job_pids=()
  for pid in "${background_pids[@]}"; do
    terminate_owned_background_job "$pid"
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

wait_for_background_jobs() {
  local pid

  for pid in "$@"; do
    if ! wait "$pid"; then
      unregister_owned_background_job "$pid"
      cleanup_background_jobs
      return 1
    fi

    unregister_owned_background_job "$pid"
  done

  return 0
}

run_dev_smoke() {
  MURPH_HOSTED_WEB_SMOKE_USE_LOCAL_ENV=1 MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV=1 pnpm dev:smoke
}

run_next_build() {
  local next_build_node_options
  local build_database_url
  local build_app_session_hmac_key
  local build_contact_privacy_current_key_version
  local build_contact_privacy_keys
  local build_hosted_mailbox_fingerprint_key
  local build_privy_app_id
  local next_build_command=(next build)

  next_build_node_options="$(compose_node_options_with_sqlite_warning_filter)"
  build_database_url="$(compose_database_url_for_build)"
  build_app_session_hmac_key="$(compose_hosted_app_session_hmac_key_for_build)"
  build_contact_privacy_current_key_version="$(compose_hosted_contact_privacy_current_key_version_for_build)"
  build_contact_privacy_keys="$(compose_hosted_contact_privacy_keys_for_build)"
  build_hosted_mailbox_fingerprint_key="$(compose_hosted_mailbox_fingerprint_key_for_build)"
  build_privy_app_id="$(compose_privy_app_id_for_build)"

  if [[ "$hosted_web_build_memory_guard" == "1" ]]; then
    next_build_command=(bash "$script_dir/build-memory-guard.sh" -- "${next_build_command[@]}")
  fi

  DATABASE_URL="$build_database_url" \
    HOSTED_APP_SESSION_HMAC_KEY="$build_app_session_hmac_key" \
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION="$build_contact_privacy_current_key_version" \
    HOSTED_CONTACT_PRIVACY_KEYS="$build_contact_privacy_keys" \
    HOSTED_MAILBOX_FINGERPRINT_KEY="$build_hosted_mailbox_fingerprint_key" \
    NEXT_PUBLIC_PRIVY_APP_ID="$build_privy_app_id" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="$next_build_node_options" \
    VERCEL=1 \
    VERCEL_ENV=preview \
    "${next_build_command[@]}"
}

run_timed_step "legal pdf" pnpm legal:pdf

run_prisma_generate() {
  if [[ "${MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED:-0}" == "1" ]]; then
    verify_log "skip prisma generate; already prepared"
    return 0
  fi

  pnpm prisma:generate
}

run_timed_step "prisma generate" run_prisma_generate

run_health_commons_generate() {
  if [[ "${MURPH_HEALTH_COMMONS_GENERATED_PREPARED:-0}" == "1" ]]; then
    verify_log "skip health commons generated artifacts; already prepared"
    return 0
  fi

  pnpm health-commons:generate
}

run_web_tests() {
  pnpm test:prepared
}

run_typescript_typecheck() {
  if [[ "$hosted_web_verify_skip_typecheck" == "1" ]]; then
    verify_log "skip TypeScript 7 typecheck; already prepared by parent verification"
    return 0
  fi

  pnpm typecheck:prepared
}

run_timed_step "health commons generated artifacts" run_health_commons_generate

run_timed_step "TypeScript 7 typecheck" run_typescript_typecheck

if [[ "$verify_step_parallel" != "1" ]]; then
  run_timed_step "test" run_web_tests
  run_timed_step "lint" pnpm lint
  run_timed_step "dev smoke" run_dev_smoke
  run_timed_step "next build" run_next_build
  exit 0
fi

if [[ "$hosted_web_build_memory_guard" == "1" ]]; then
  verify_log "run next build serially because the memory guard owns the measured cgroup scope"
  run_timed_step "next build" run_next_build
fi

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

if [[ "$hosted_web_build_memory_guard" != "1" ]]; then
  start_owned_background_job build_pid run_timed_step "next build" run_next_build
fi

start_owned_background_job smoke_pid run_timed_step "dev smoke" run_dev_smoke
start_owned_background_job test_pid run_timed_step "test" run_web_tests
start_owned_background_job lint_pid run_timed_step "lint" pnpm lint
if [[ "$hosted_web_build_memory_guard" == "1" ]]; then
  wait_for_background_jobs "$smoke_pid" "$test_pid" "$lint_pid"
else
  wait_for_background_jobs "$build_pid" "$smoke_pid" "$test_pid" "$lint_pid"
fi
