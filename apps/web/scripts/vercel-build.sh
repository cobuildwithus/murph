#!/bin/sh
set -eu

if [ "${VERCEL_TARGET_ENV:-}" = "native-ios-e2e" ]; then
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    echo "native-ios-e2e must not use Vercel production" >&2
    exit 1
  fi
  MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS=1 pnpm prisma:migrate:deploy
fi

pnpm release:production:migrate
MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build
