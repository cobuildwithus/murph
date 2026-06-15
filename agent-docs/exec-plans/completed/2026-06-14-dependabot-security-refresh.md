# Dependabot Security Refresh

## Goal

Clear the open Dependabot alerts for vulnerable npm dependencies by refreshing
the smallest compatible dependency graph and preserving the repo dependency
supply-chain rules.

## Constraints

- Keep changes limited to workspace manifests, pnpm overrides, and the lockfile
  unless verification exposes a code compatibility issue.
- Do not bypass pnpm dependency verification or broaden install-script trust.
- Preserve existing package ownership and runtime boundaries.
- Treat hosted web, Cloudflare tooling, and Temporal dependency updates as
  security-sensitive until verified.

## Current Target Alerts

- `axios` patched at `>=1.16.0`
- `@grpc/grpc-js` patched at `>=1.14.4`
- `esbuild` patched at `>=0.28.1`
- `hono` patched at `>=4.12.21`
- `js-cookie` patched at `>=3.0.7`
- `postcss` patched at `>=8.5.10`
- `qs` patched at `>=6.15.2`
- `uuid` patched at `>=11.1.1`
- `ws` patched at `>=8.20.1`
- `ip-address` patched at `>=10.1.1`
- `brace-expansion` patched at `>=5.0.6` after local moderate audit found
  the dev review tooling path

## Planned Changes

- Prefer upstream package bumps where compatible.
- Use narrow `pnpm-workspace.yaml` overrides for vulnerable transitives whose
  upstream owners still pin old patched packages.
- Refresh `pnpm-lock.yaml`.
- Run dependency policy/audit checks and repo verification.

## Verification

- `pnpm install` passed
- `pnpm audit --audit-level=moderate` passed
- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm deps:ignored-builds`
- `pnpm typecheck`
- `pnpm build:test-runtime:prepared`
- `pnpm --dir apps/cloudflare verify`
- `pnpm --dir apps/web verify`
- `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=0 MURPH_PACKAGE_COVERAGE_CONCURRENCY=2 MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY=1 MURPH_APP_VERIFY_PARALLEL=0 pnpm verify:acceptance`

## Audit Plan

- `security-privacy-review`
- `coverage-write`
- `deep-review`

## Audit Outcome

- `security-privacy-review`: no medium-or-higher findings.
- `coverage-write`: no missing proof gap; no test changes needed.
- `deep-review`: no concrete production-breaking bugs found.
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
