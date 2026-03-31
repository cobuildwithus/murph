#!/usr/bin/env bash
set -euo pipefail

verify_step_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"

wait_for_background_jobs() {
  local failed=0
  local pid
  local other_pid

  for pid in "$@"; do
    if ! wait "$pid"; then
      failed=1
      for other_pid in "$@"; do
        if [[ "$other_pid" != "$pid" ]] && kill -0 "$other_pid" 2>/dev/null; then
          kill "$other_pid" 2>/dev/null || true
        fi
      done
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    return 1
  fi

  return 0
}

pnpm prisma:generate
pnpm typecheck:prepared

if [[ "$verify_step_parallel" == "1" ]]; then
  pnpm test &
  test_pid="$!"
  pnpm dev:smoke &
  smoke_pid="$!"
  next build &
  build_pid="$!"

  wait_for_background_jobs "$test_pid" "$smoke_pid" "$build_pid"
else
  pnpm test
  pnpm dev:smoke
  next build
fi
