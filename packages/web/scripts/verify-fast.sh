#!/usr/bin/env bash
set -euo pipefail

verify_step_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"

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

pnpm typecheck

if [[ "$verify_step_parallel" == "1" ]]; then
  pnpm test &
  test_pid="$!"
  pnpm build:app &
  build_pid="$!"

  wait_for_background_jobs "$test_pid" "$build_pid"
  exit $?
fi

pnpm test
pnpm build:app
