#!/bin/sh

set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
workspace_root=$(CDPATH= cd "$script_dir/../.." && pwd -P)
static_root=$(dirname "$workspace_root")
run_directory=$(dirname "$static_root")
runs_root=$(dirname "$run_directory")
worker_root=$(dirname "$runs_root")

run_name=${run_directory##*/}
static_name=${static_root##*/}
run_digest=${run_name%%-*}
run_token=${run_name#*-}
static_digest=${static_name#static_murph_}
case "$run_digest$run_token$static_digest" in
  *[!0-9a-f]*)
    echo "[ssh-verification] Static SSH lock requires one opaque Crabbox run path." >&2
    exit 1
    ;;
esac
if [ "${workspace_root##*/}" != "murph" ] ||
  [ "${runs_root##*/}" != "runs" ] ||
  [ "${worker_root##*/}" != "murph-crabbox" ] ||
  [ "${#run_digest}" -ne 16 ] ||
  [ "${#run_token}" -ne 16 ] ||
  [ "$static_name" != "static_murph_$run_digest" ] ||
  [ "$static_digest" != "$run_digest" ]
then
  echo "[ssh-verification] Static SSH lock requires Crabbox's exact opaque nested run path." >&2
  exit 1
fi
lock_path=$worker_root/verification.lock

# Native macOS lockf supports `lockf [-s] [-t seconds] fd`. The verifier
# inherits this open descriptor and therefore owns the remote capacity lock
# until it has reaped its exact child process groups.
exec 9>"$lock_path"
lock_status=0
/usr/bin/lockf -t 0 9 || lock_status=$?
if [ "$lock_status" -eq 0 ]; then
  # Keep the dedicated Mac awake only while this finite verifier owns its
  # capacity lock. This changes no persistent power setting.
  exec /usr/bin/caffeinate -i node scripts/crabbox/run-ssh-verification.mjs \
    --cleanup-static-workspace \
    "$@"
fi

if node scripts/crabbox/run-ssh-verification.mjs \
  --cleanup-static-workspace-only
then
  exit "$lock_status"
fi
exit 1
