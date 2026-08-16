#!/usr/bin/env bash
set -euo pipefail

parent_old_space_mb=1024
typecheck_worker_old_space_mb=3584
build_cache_epoch=webpack-next-16.3-v1
build_cache_stamp=.next/cache/murph-production-build-epoch

strip_inherited_old_space_flags() {
  printf '%s\n' "${NODE_OPTIONS:-}" \
    | sed -E 's/(^|[[:space:]])--max[-_]old[-_]space[-_]size(=|[[:space:]]+)[^[:space:]]+/\1/g'
}

inherited_node_options="$(strip_inherited_old_space_flags)"
inherited_node_options="${inherited_node_options#"${inherited_node_options%%[![:space:]]*}"}"
inherited_node_options="${inherited_node_options%"${inherited_node_options##*[![:space:]]}"}"

if [[ -n "$inherited_node_options" ]]; then
  export NODE_OPTIONS="$inherited_node_options --max-old-space-size=$typecheck_worker_old_space_mb"
else
  export NODE_OPTIONS="--max-old-space-size=$typecheck_worker_old_space_mb"
fi

next_bin="$(node -p 'require.resolve("next/dist/bin/next")')"
cache_reset=0
if [[ ! -f "$build_cache_stamp" ]] || [[ "$(< "$build_cache_stamp")" != "$build_cache_epoch" ]]; then
  printf '[apps/web build] Resetting incompatible Next build cache for epoch=%s\n' \
    "$build_cache_epoch"
  node ../../scripts/rm-paths.mjs .next/cache
  cache_reset=1
fi

printf '[apps/web build] Next memory policy: compiler=webpack parent_old_space_mb=%s typecheck_worker_old_space_mb=%s\n' \
  "$parent_old_space_mb" \
  "$typecheck_worker_old_space_mb"
node "--max-old-space-size=$parent_old_space_mb" "$next_bin" build --webpack

if [[ "$cache_reset" == 1 ]]; then
  mkdir -p "$(dirname "$build_cache_stamp")"
  printf '%s\n' "$build_cache_epoch" > "$build_cache_stamp"
fi
