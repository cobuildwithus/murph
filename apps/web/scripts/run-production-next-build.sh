#!/usr/bin/env bash
set -euo pipefail

parent_old_space_mb=1024
next_child_old_space_mb=3072
next_build_timeout=15m
active_next_build_timeout=disabled
if [[ "${VERCEL:-}" == "1" && "${VERCEL_ENV:-}" == "production" ]]; then
  active_next_build_timeout="$next_build_timeout"
fi
build_cache_epoch=webpack-next-16.3-v2-cold-webpack
build_cache_stamp=.next/cache/murph-production-build-epoch
webpack_cache_dir=.next/cache/webpack

strip_inherited_old_space_flags() {
  printf '%s\n' "${NODE_OPTIONS:-}" \
    | sed -E 's/(^|[[:space:]])--max[-_]old[-_]space[-_]size(=|[[:space:]]+)[^[:space:]]+/\1/g'
}

inherited_node_options="$(strip_inherited_old_space_flags)"
inherited_node_options="${inherited_node_options#"${inherited_node_options%%[![:space:]]*}"}"
inherited_node_options="${inherited_node_options%"${inherited_node_options##*[![:space:]]}"}"

if [[ -n "$inherited_node_options" ]]; then
  export NODE_OPTIONS="$inherited_node_options --max-old-space-size=$next_child_old_space_mb"
else
  export NODE_OPTIONS="--max-old-space-size=$next_child_old_space_mb"
fi

next_bin="$(node -p 'require.resolve("next/dist/bin/next")')"
cache_reset=0
if [[ ! -f "$build_cache_stamp" ]] || [[ "$(< "$build_cache_stamp")" != "$build_cache_epoch" ]]; then
  printf '[apps/web build] Resetting incompatible Next build cache for epoch=%s\n' \
    "$build_cache_epoch"
  node ../../scripts/rm-paths.mjs .next/cache
  cache_reset=1
else
  printf '[apps/web build] Resetting restored Webpack cache before production compile\n'
  node ../../scripts/rm-paths.mjs "$webpack_cache_dir"
fi

printf '[apps/web build] Next memory policy: compiler=webpack parent_old_space_mb=%s next_child_old_space_mb=%s webpack_cache=cold vercel_timeout=%s\n' \
  "$parent_old_space_mb" \
  "$next_child_old_space_mb" \
  "$active_next_build_timeout"
next_build_command=(
  node
  "--max-old-space-size=$parent_old_space_mb"
  "$next_bin"
  build
  --webpack
)

next_build_status=0
if [[ "$active_next_build_timeout" != disabled ]]; then
  timeout --verbose --signal=TERM --kill-after=30s "$active_next_build_timeout" \
    "${next_build_command[@]}" || next_build_status=$?
else
  "${next_build_command[@]}" || next_build_status=$?
fi
if [[ "$next_build_status" != 0 ]]; then
  if [[ "$next_build_status" == 124 ]]; then
    printf "[apps/web build] ERROR: Next build exceeded %s and was terminated before Vercel's maximum build duration.\n" \
      "$next_build_timeout" >&2
  fi
  exit "$next_build_status"
fi

printf '[apps/web build] Discarding Webpack cache after successful production compile\n'
node ../../scripts/rm-paths.mjs "$webpack_cache_dir"

if [[ "$cache_reset" == 1 ]]; then
  mkdir -p "$(dirname "$build_cache_stamp")"
  printf '%s\n' "$build_cache_epoch" > "$build_cache_stamp"
fi
