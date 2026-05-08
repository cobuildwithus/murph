# Hosted Device Connect Review Fixes

## Goal

Apply review fixes for the hosted device connect intent flow: prevent one-time claim burn on provider-start failures, ensure account deletion covers intent rows, harden redirect headers, and remove unused persisted intent fields.

## Scope

- `apps/web` device connect intent schema/service/route/tests
- hosted account deletion/privacy service tests
- docs for intent state shape
- Prisma migration follow-up for unused fields

## Constraints

- Preserve the member-bound OAuth callback invariant.
- Keep internal hosted connect-link response dual-compatible (`connectUrl` plus `authorizationUrl`).
- Do not touch unrelated dirty worktree changes.
- Prefer the simplest durable state model.

## Verification

- Focused hosted-web intent/internal/privacy tests.
- Prisma generate.
- Direct hosted-web TS check if full typecheck is blocked by unrelated Health Commons generation.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
