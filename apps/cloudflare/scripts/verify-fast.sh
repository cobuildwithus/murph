#!/usr/bin/env bash
set -euo pipefail

verify_step_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"
tracked_background_pids=("")

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

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
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

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

pnpm typecheck

if [[ "$verify_step_parallel" == "1" ]]; then
  pnpm test:node &
  node_pid="$!"
  register_background_pid "$node_pid"
  pnpm test:workers &
  workers_pid="$!"
  register_background_pid "$workers_pid"

  wait_for_background_jobs "$node_pid" "$workers_pid"
else
  pnpm test:node
  pnpm test:workers
fi
