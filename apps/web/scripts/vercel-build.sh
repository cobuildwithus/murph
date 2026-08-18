#!/bin/sh
set -eu

if [ "${VERCEL_TARGET_ENV:-}" = "native-ios-e2e" ]; then
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    echo "native-ios-e2e must not use Vercel production" >&2
    exit 1
  fi
  MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS=1 pnpm prisma:migrate:deploy
fi

# Production and native iOS E2E builds arm the package-build process owner's
# whole-group deadline so a wedged compile (including a Webpack compiler worker
# descendant) fails the build in minutes instead of holding the deploy queue
# until Vercel's 45-minute ceiling. Ordinary preview and local builds stay
# unbounded.
if [ "${VERCEL:-}" = "1" ] && {
  [ "${VERCEL_ENV:-}" = "production" ] ||
    [ "${VERCEL_TARGET_ENV:-}" = "native-ios-e2e" ]
}; then
  MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS="${MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS:-900000}"
  export MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS
fi

pnpm release:production:migrate
MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build
