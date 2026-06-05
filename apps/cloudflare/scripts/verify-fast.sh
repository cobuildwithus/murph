#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"

if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]]; then
  exec node "$repo_root/scripts/run-with-workspace-artifact-lock.mjs" "apps/cloudflare verify" -- \
    bash "$script_dir/verify-fast.sh" "$@"
fi

verify_step_parallel_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 1)"
verify_step_parallel="${MURPH_VERIFY_STEP_PARALLEL:-$verify_step_parallel_default}"
skip_typecheck="${MURPH_CLOUDFLARE_VERIFY_SKIP_TYPECHECK:-0}"
tracked_background_pids=()

prepare_hosted_web_prisma_client() {
  if [[ "${MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED:-0}" == "1" ]]; then
    echo "[apps/cloudflare verify] skipping hosted web Prisma client generation; already prepared." >&2
    return 0
  fi

  pnpm --dir "$repo_root/apps/web" prisma:generate
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

  [[ "$failed" -eq 0 ]]
}

if [[ "${MURPH_HEALTH_COMMONS_GENERATED_PREPARED:-0}" == "1" ]]; then
  echo "[apps/cloudflare verify] skipping health commons generated protocol artifacts; already prepared." >&2
else
  pnpm --dir "$repo_root" health-commons:generate
fi

prepare_hosted_web_prisma_client

if [[ "$skip_typecheck" == "1" ]]; then
  echo "[apps/cloudflare verify] skipping typecheck; root acceptance typecheck already covered this app." >&2
else
  pnpm typecheck
fi

if [[ "$verify_step_parallel" != "1" ]]; then
  pnpm test:node
  pnpm test:workers
  exit 0
fi

trap cleanup_background_jobs EXIT
trap 'handle_termination_signal INT' INT
trap 'handle_termination_signal TERM' TERM
trap 'handle_termination_signal HUP' HUP

pnpm --dir "$repo_root" exec vitest run \
  --config apps/cloudflare/vitest.node.workspace.ts \
  --no-coverage \
  --cache=false &
node_pid="$!"
register_background_pid "$node_pid"
pnpm --dir "$repo_root" exec vitest run \
  --config apps/cloudflare/vitest.workers.config.ts \
  --no-coverage \
  --passWithNoTests \
  --cache=false &
workers_pid="$!"
register_background_pid "$workers_pid"

wait_for_background_jobs "$node_pid" "$workers_pid"
