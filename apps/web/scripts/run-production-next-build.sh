#!/usr/bin/env bash
set -euo pipefail

parent_old_space_mb=1024
build_worker_old_space_mb=3072
esbuild_go_memlimit=1GiB
build_cache_epoch=webpack-next-16.3-v6-isolated-worker-no-webpack-cache
build_cache_stamp=.next/cache/murph-production-build-epoch
prepared_typecheck_env=MURPH_HOSTED_WEB_PREPARED_TYPECHECK
webpack_cache_policy=disabled
if [[ "${MURPH_HOSTED_WEB_WEBPACK_CACHE:-}" == "1" ]]; then
  webpack_cache_policy=persistent
fi

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
cache_reset=0
if [[ ! -f "$build_cache_stamp" ]] || [[ "$(< "$build_cache_stamp")" != "$build_cache_epoch" ]]; then
  printf '[apps/web build] Resetting incompatible Next build cache for epoch=%s\n' \
    "$build_cache_epoch"
  node ../../scripts/rm-paths.mjs .next/cache
  cache_reset=1
fi

printf '[apps/web build] Next memory policy: compiler=webpack parent_old_space_mb=%s build_worker_old_space_mb=%s webpack_cache=%s webpack_build_worker=on esbuild_go_memlimit=%s\n' \
  "$parent_old_space_mb" \
  "$build_worker_old_space_mb" \
  "$webpack_cache_policy" \
  "$esbuild_go_memlimit"

# Generate route declarations before the native CLI check. This is a separate
# contract from the source-only check; only its success earns the build flag.
set_node_old_space "$build_worker_old_space_mb"
node "--max-old-space-size=$parent_old_space_mb" "$next_bin" typegen

set_node_old_space "$parent_old_space_mb"
node "--max-old-space-size=$parent_old_space_mb" \
  ../../scripts/run-typescript.mjs web \
  -p tsconfig.next.json \
  --pretty false

export MURPH_HOSTED_WEB_PREPARED_TYPECHECK=complete
set_node_old_space "$build_worker_old_space_mb"
# Workflow's Go-based esbuild services coexist with the Webpack worker. V8
# limits do not cover them. Scope their soft target to this compilation, never
# to the separate native TypeScript source check in the package build.
GOMEMLIMIT="$esbuild_go_memlimit" \
  node "--max-old-space-size=$parent_old_space_mb" "$next_bin" build --webpack

if [[ "$cache_reset" == 1 ]]; then
  mkdir -p "$(dirname "$build_cache_stamp")"
  printf '%s\n' "$build_cache_epoch" > "$build_cache_stamp"
fi
