#!/bin/sh
set -eu

pnpm release:production:migrate
MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build
