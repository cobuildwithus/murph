#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
sqlite_warning_filter_option="--require=$repo_root/config/sqlite-warning-filter.cjs"
hosted_web_default_database_url="postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync"
hosted_web_default_hosted_key="BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"
hosted_web_default_hosted_key_version="v1"
hosted_web_build_default_privy_app_id="cm_app_build_placeholder1"

if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]]; then
  exec node "$repo_root/scripts/run-with-workspace-artifact-lock.mjs" "apps/web verify" -- \
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

compose_hosted_contact_privacy_current_key_version_for_build() {
  printf '%s\n' "${HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION:-$hosted_web_default_hosted_key_version}"
}

compose_hosted_mailbox_fingerprint_key_for_build() {
  printf '%s\n' "${HOSTED_MAILBOX_FINGERPRINT_KEY:-$hosted_web_default_hosted_key}"
}

verify_step_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"
tracked_background_pids=()

verify_log() {
  printf '[apps/web verify] %s\n' "$*" >&2
}

run_timed_step() {
  local label="$1"
  shift
  local started_at="$SECONDS"

  verify_log "start ${label}"
  "$@"
  verify_log "done ${label} ($((SECONDS - started_at))s step)"
}

register_background_pid() {
  tracked_background_pids+=("$1")
}

unregister_background_pid() {
  local target_pid="$1"
  local remaining_pids=()
  local pid

  if [[ ${#tracked_background_pids[@]} -eq 0 ]]; then
    return
  fi

  for pid in "${tracked_background_pids[@]}"; do
    if [[ "$pid" != "$target_pid" ]]; then
      remaining_pids+=("$pid")
    fi
  done

  if [[ ${#remaining_pids[@]} -eq 0 ]]; then
    tracked_background_pids=()
  else
    tracked_background_pids=("${remaining_pids[@]}")
  fi
}

terminate_background_pid() {
  local pid="$1"

  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  terminate_pid_tree_with_signal "$pid" TERM
  sleep 1
  terminate_pid_tree_with_signal "$pid" KILL
}

terminate_pid_tree_with_signal() {
  local pid="$1"
  local signal="$2"
  local descendant_pid

  for descendant_pid in $(list_descendant_pids "$pid"); do
    kill "-$signal" "$descendant_pid" 2>/dev/null || true
  done

  if [[ "$pid" -gt 0 && "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]]; then
    kill "-$signal" "-$pid" 2>/dev/null || true
  fi

  kill "-$signal" "$pid" 2>/dev/null || true
}

list_descendant_pids() {
  local root_pid="$1"

  ps -axo pid=,ppid= | awk -v root_pid="$root_pid" '
    {
      pid = $1
      ppid = $2
      children[ppid] = children[ppid] " " pid
    }
    END {
      queue[1] = root_pid
      head = 1
      tail = 1
      while (head <= tail) {
        parent = queue[head]
        head++
        child_count = split(children[parent], child_pids, " ")
        for (child_index = 1; child_index <= child_count; child_index++) {
          child_pid = child_pids[child_index]
          if (child_pid == "") {
            continue
          }
          print child_pid
          tail++
          queue[tail] = child_pid
        }
      }
    }
  '
}

cleanup_background_jobs() {
  local pid

  if [[ ${#tracked_background_pids[@]} -eq 0 ]]; then
    return
  fi

  for pid in "${tracked_background_pids[@]}"; do
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

run_dev_smoke() {
  MURPH_HOSTED_WEB_SMOKE_USE_LOCAL_ENV=1 MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV=1 pnpm dev:smoke
}

run_next_build() {
  local next_build_node_options
  local build_database_url
  local build_contact_privacy_current_key_version
  local build_contact_privacy_keys
  local build_hosted_mailbox_fingerprint_key
  local build_privy_app_id

  next_build_node_options="$(compose_node_options_with_sqlite_warning_filter)"
  build_database_url="$(compose_database_url_for_build)"
  build_contact_privacy_current_key_version="$(compose_hosted_contact_privacy_current_key_version_for_build)"
  build_contact_privacy_keys="$(compose_hosted_contact_privacy_keys_for_build)"
  build_hosted_mailbox_fingerprint_key="$(compose_hosted_mailbox_fingerprint_key_for_build)"
  build_privy_app_id="$(compose_privy_app_id_for_build)"

  DATABASE_URL="$build_database_url" \
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION="$build_contact_privacy_current_key_version" \
    HOSTED_CONTACT_PRIVACY_KEYS="$build_contact_privacy_keys" \
    HOSTED_MAILBOX_FINGERPRINT_KEY="$build_hosted_mailbox_fingerprint_key" \
    NEXT_PUBLIC_PRIVY_APP_ID="$build_privy_app_id" \
    NODE_OPTIONS="$next_build_node_options" \
    next build
}

run_timed_step "legal pdf" pnpm legal:pdf

run_prisma_generate() {
  if [[ "${MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED:-0}" == "1" ]]; then
    verify_log "skip prisma generate; root acceptance typecheck already prepared it"
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

run_timed_step "health commons generated artifacts" run_health_commons_generate

if [[ "$verify_step_parallel" != "1" ]]; then
  run_timed_step "test" run_web_tests
  run_timed_step "lint" pnpm lint
  run_timed_step "dev smoke" run_dev_smoke
  run_timed_step "next build" run_next_build
  exit 0
fi

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

run_timed_step "next build" run_next_build &
build_pid="$!"
register_background_pid "$build_pid"
run_timed_step "dev smoke" run_dev_smoke &
smoke_pid="$!"
register_background_pid "$smoke_pid"
run_timed_step "test" run_web_tests &
test_pid="$!"
register_background_pid "$test_pid"
run_timed_step "lint" pnpm lint &
lint_pid="$!"
register_background_pid "$lint_pid"
wait_for_background_jobs "$build_pid" "$smoke_pid" "$test_pid" "$lint_pid"
