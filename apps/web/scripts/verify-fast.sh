#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
sqlite_warning_filter_option="--require=$repo_root/config/sqlite-warning-filter.cjs"

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

verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-0}"
tracked_background_pids=()

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

  if [[ "$pid" -gt 0 && "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]]; then
    kill "-$pid" 2>/dev/null || true
  fi

  kill "$pid" 2>/dev/null || true
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

pnpm prisma:generate

if [[ "$verify_step_parallel" != "1" ]]; then
  pnpm test
  pnpm lint
  pnpm dev:smoke
  next_build_node_options="$(compose_node_options_with_sqlite_warning_filter)"
  NODE_OPTIONS="$next_build_node_options" next build
  exit 0
fi

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

pnpm test &
test_pid="$!"
register_background_pid "$test_pid"
pnpm lint &
lint_pid="$!"
register_background_pid "$lint_pid"
pnpm dev:smoke
next_build_node_options="$(compose_node_options_with_sqlite_warning_filter)"
NODE_OPTIONS="$next_build_node_options" next build
wait_for_background_jobs "$test_pid" "$lint_pid"
