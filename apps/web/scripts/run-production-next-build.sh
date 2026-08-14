#!/usr/bin/env bash
set -euo pipefail

parent_old_space_mb=1024
typecheck_worker_old_space_mb=3072

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
printf '[apps/web build] Next memory policy: compiler=webpack parent_old_space_mb=%s typecheck_worker_old_space_mb=%s\n' \
  "$parent_old_space_mb" \
  "$typecheck_worker_old_space_mb"
exec node "--max-old-space-size=$parent_old_space_mb" "$next_bin" build --webpack
