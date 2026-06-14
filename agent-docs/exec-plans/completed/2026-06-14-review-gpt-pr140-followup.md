# PR 140 ReviewGPT Follow-Up

## Goal

Fix the ReviewGPT findings on PR #140 with the smallest durable architecture:

- explicit invalid delivery-context ordinals must not silently route to the first context
- same-token outbox retries must dedupe against persisted legacy media-sensitive identities
- delivery-field/context plumbing should use shared primitives where that reduces drift

Success means focused tests cover the fixes, required verification passes or has a scoped documented blocker, the PR branch is pushed, and ReviewGPT is run again with the Eragon browser profile.

## Scope

Expected files:

- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/test/**`

No product behavior changes outside assistant delivery/idempotency semantics.

## Constraints

- Preserve existing active-turn/final-reply semantics.
- Prefer explicit data flow over broader abstractions.
- Do not weaken delivery, target, or idempotency invariants for tests.
- Avoid exposing local personal identifiers in committed artifacts.

## Verification Plan

- Focused assistant-engine runtime/unit tests for delivery context and outbox idempotency.
- Assistant-engine coverage lane if touched tests fit that package.
- Repo typecheck.
- Required completion audits from the workflow router.
- `review:gpt` rerun after commit/push.

## Status

- Now: inspect affected seams and implement narrow fixes.
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
