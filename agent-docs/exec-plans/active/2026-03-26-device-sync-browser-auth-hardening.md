# Hosted Device-Sync Browser Auth Hardening

## Goal

Replace the replayable hosted browser auth header tuple in `apps/web` with a short-lived, request-bound signed assertion format, and add server-side nonce consumption for mutation routes so captured assertions cannot be replayed to sensitive hosted device-sync endpoints.

## Scope

- `apps/web/src/lib/device-sync/auth.ts`
- `apps/web/src/lib/device-sync/control-plane.ts`
- `apps/web/src/lib/device-sync/env.ts`
- `apps/web/src/lib/device-sync/prisma-store.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/test/**/*.test.ts` as needed for auth/store coverage
- Hosted auth docs/env contract in `ARCHITECTURE.md`, `docs/device-sync-hosted-control-plane.md`, `apps/web/README.md`, and `apps/web/.env.example`

## Invariants

- Browser routes must still support development fallback auth when no trusted assertion headers are present and the dev user env is configured.
- Browser mutation routes must still require allowed `Origin` values via `assertBrowserMutationOrigin()`.
- Hosted browser auth must remain independent from local-agent bearer auth.
- Raw provider tokens and bearer tokens must not be exposed in docs, logs, or tests.

## Planned Changes

1. Introduce a signed browser assertion header carrying user claims plus `iat`, `exp`, `nonce`, `aud`, `method`, `path`, and `origin`.
2. Verify freshness, request binding, and audience in `requireAuthenticatedHostedUser()`.
3. Add a nonce-consumption store path for mutation requests so a reused assertion fails closed.
4. Update tests to cover forged, stale, cross-route, and replayed assertions.
5. Update hosted control-plane docs/env examples to describe the new assertion contract.

## Verification

- `pnpm --dir apps/web test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow prompts: `simplify`, `test-coverage-audit`, `task-finish-review` (document clone limitations if any)
