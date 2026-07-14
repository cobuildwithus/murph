# PR 559 ReviewGPT disconnect guard

## Goal

Prevent a queued companion HRV upload from recreating or reactivating a
Junction connection after the member explicitly disconnects it.

## Success criteria

- HRV data ingress reuses one existing active member-owned Junction connection.
- Missing, disconnected, reauthorization-required, and ambiguous connection
  state fails before dirty payload staging or connection establishment.
- The explicit companion sign-in-token flow remains the only establishment and
  reconnection path.
- Focused regression coverage, scoped verification, PR CI, and final review
  gates pass.

## Working set

- `apps/web/src/lib/device-sync/companion.ts`
- `apps/web/src/lib/device-sync/public-ingress-service.ts`
- `apps/web/test/device-sync-hosted-wake.test.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/test/public-ingress.test.ts`
- Durable companion/security docs when needed to keep the lifecycle contract
  explicit.

## Verification plan

- Focused hosted device-sync wake tests for active, disconnected,
  reauthorization-required, and ambiguous connection state.
- Focused public-ingress proof that the explicit sign-in flow still performs
  an intentional reconnect.
- `pnpm test:diff` for the touched web owner.
- Repository privacy/path guards and `git diff --check`.
- Required security/privacy completion audit and parent final review.
- Push the scoped correction, then require green PR CI and zero unresolved
  review threads.

## State

Complete.

- The final ReviewGPT pass identified the disconnect-reactivation path; the
  finding was validated and fixed without adding a second lifecycle owner.
- Focused hosted-wake and public-ingress suites pass, including retained and
  scrubbed disconnect state, reauthorization-required state, ambiguity, and
  intentional reconnect through the explicit sign-in flow.
- `pnpm test:diff` passed all affected guards, typechecks, package tests, web
  build/tests/lint, and Cloudflare verification.
- Documentation drift, diff integrity, and identifier/path privacy checks pass.
- The required security/privacy specialist review found no medium-or-higher
  issues after checking authentication, ownership, lifecycle races, payload
  minimization, replay, encrypted staging, and canonical import boundaries.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
