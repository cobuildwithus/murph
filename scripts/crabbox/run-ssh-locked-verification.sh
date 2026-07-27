#!/bin/sh

set -eu

lock_path=/Users/Shared/murph-crabbox/verification.lock

# The verifier process inherits this descriptor and therefore owns the remote
# capacity lock until it has reaped its exact child process groups.
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
