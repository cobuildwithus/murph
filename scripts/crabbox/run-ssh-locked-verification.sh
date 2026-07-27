#!/bin/sh

set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
worker_root=$(CDPATH= cd "$script_dir/../../../.." && pwd -P)
lock_path=$worker_root/verification.lock

# Native macOS lockf supports `lockf [-s] [-t seconds] fd`. The verifier
# inherits this open descriptor and therefore owns the remote capacity lock
# until it has reaped its exact child process groups.
exec 9>"$lock_path"
lock_status=0
/usr/bin/lockf -t 0 9 || lock_status=$?
if [ "$lock_status" -eq 0 ]; then
  exec node scripts/crabbox/run-ssh-verification.mjs \
    --cleanup-static-workspace \
    "$@"
fi

if node scripts/crabbox/run-ssh-verification.mjs \
  --cleanup-static-workspace-only
then
  exit "$lock_status"
fi
exit 1
