#!/bin/sh
set -eu

verification_command="${1:-}"
case "$verification_command" in
  test:diff|verify:acceptance) ;;
  *)
    echo "Trusted Crabbox entrypoint supports only test:diff and verify:acceptance." >&2
    exit 64
    ;;
esac
shift

repo_root="$(/bin/pwd -P)"
candidate_entrypoint="$repo_root/scripts/crabbox/run-verification.mjs"
if [ ! -f "$candidate_entrypoint" ]; then
  echo "Trusted Crabbox entrypoint could not resolve the candidate verifier." >&2
  exit 66
fi

trusted_home="$(/usr/bin/mktemp -d /tmp/murph-crabbox-home.XXXXXX)"
exec /usr/bin/env -i \
  HOME="$trusted_home" \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  LOGNAME=crabbox \
  MURPH_CRABBOX_TRUSTED_ENTRYPOINT=1 \
  PATH=/usr/local/bin:/usr/bin:/bin \
  SHELL=/bin/bash \
  TERM=dumb \
  TMPDIR=/tmp \
  USER=crabbox \
  /usr/local/bin/node \
  "$candidate_entrypoint" "$verification_command" "$@"
