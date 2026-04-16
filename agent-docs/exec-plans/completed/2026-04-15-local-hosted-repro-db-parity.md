## Goal

Make root `pnpm dev` reproduce the hosted Murph texting path conclusively enough to diagnose and fix the production-adjacent Cloudflare delivery failure.

## Why

- The local harness now restores Cloudflare env parity and local DB parity for the hosted texting path.
- A clean production-shaped local activation now reproduces the real failure: the welcome outbox intent is created, but the first hosted assistant-delivery journal `GET` fails in the live `results.worker` bridge, so no Linq send leaves Cloudflare.
- That failure sits outside the current automated coverage; the existing hosted-local e2e lane stops before the first-contact Linq delivery seam.

## Scope

- `scripts/dev-hosted-local/**`
- `packages/cloudflare-hosted-control/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/cloudflare/src/runner-outbound/**`
- `apps/cloudflare/src/side-effect-journal.ts`
- `apps/cloudflare/test/**`
- Focused harness/control/runtime tests plus one hosted-local end-to-end repro proving first-contact Linq delivery leaves the worker

## Constraints

- Do not inspect or print raw production database URLs.
- Preserve unrelated worktree edits.
- Keep secrets/tokens out of logs, fixtures, and handoff text.
- Prefer the smallest production-safe runtime fix that removes bridge fragility rather than adding more local-only branching.

## Verification

- Focused tests for the local env normalization helper and hosted side-effect journal route behavior
- Focused Cloudflare verification for the touched runtime/tests
- Direct local `pnpm dev` repro evidence showing:
  - production-shaped `POST /internal/dispatch` activation completes
  - the restored bundle contains the first-contact outbox intent
  - the fake local Linq API receives the outbound welcome send after the fix
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
