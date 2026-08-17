#!/usr/bin/env bash
set -euo pipefail

parent_old_space_mb=1024
build_worker_old_space_mb=3072
typecheck_old_space_mb=3584
build_cache_epoch=webpack-next-16.3-v3-prepared-typecheck-cold-webpack
build_cache_stamp=.next/cache/murph-production-build-epoch
webpack_cache_dir=.next/cache/webpack
prepared_typecheck_env=MURPH_HOSTED_WEB_PREPARED_TYPECHECK

# Never trust an inherited bypass. This runner earns the build-only flag again
# after its own route-aware TypeScript check succeeds.
unset "$prepared_typecheck_env"

strip_inherited_old_space_flags() {
  printf '%s\n' "${NODE_OPTIONS:-}" \
    | sed -E 's/(^|[[:space:]])--max[-_]old[-_]space[-_]size(=|[[:space:]]+)[^[:space:]]+/\1/g'
}

inherited_node_options="$(strip_inherited_old_space_flags)"
inherited_node_options="${inherited_node_options#"${inherited_node_options%%[![:space:]]*}"}"
inherited_node_options="${inherited_node_options%"${inherited_node_options##*[![:space:]]}"}"

set_node_old_space() {
  local old_space_mb="$1"

  if [[ -n "$inherited_node_options" ]]; then
    export NODE_OPTIONS="$inherited_node_options --max-old-space-size=$old_space_mb"
  else
    export NODE_OPTIONS="--max-old-space-size=$old_space_mb"
  fi
}

next_bin="$(node -p 'require.resolve("next/dist/bin/next")')"
typescript_bin="$(node -p 'require.resolve("typescript/bin/tsc")')"
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

printf '[apps/web build] Next memory policy: compiler=webpack parent_old_space_mb=%s build_worker_old_space_mb=%s typecheck_old_space_mb=%s webpack_cache=cold\n' \
  "$parent_old_space_mb" \
  "$build_worker_old_space_mb" \
  "$typecheck_old_space_mb"

# Generate the route declarations before running Next's app-local TypeScript 5
# compatibility check. Keeping that check separate prevents the Webpack worker
# from inheriting the larger heap without replacing the route/page contract
# proof with the repository's TypeScript 7 source check.
set_node_old_space "$build_worker_old_space_mb"
node "--max-old-space-size=$parent_old_space_mb" "$next_bin" typegen

set_node_old_space "$typecheck_old_space_mb"
node "--max-old-space-size=$typecheck_old_space_mb" \
  "$typescript_bin" \
  -p tsconfig.next.json \
  --pretty false

export MURPH_HOSTED_WEB_PREPARED_TYPECHECK=complete
set_node_old_space "$build_worker_old_space_mb"
node "--max-old-space-size=$parent_old_space_mb" "$next_bin" build --webpack

if [[ "$cache_reset" == 1 ]]; then
  mkdir -p "$(dirname "$build_cache_stamp")"
  printf '%s\n' "$build_cache_epoch" > "$build_cache_stamp"
fi
