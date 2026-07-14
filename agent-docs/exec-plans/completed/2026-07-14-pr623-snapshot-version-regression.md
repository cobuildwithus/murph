# PR 623 Snapshot Version Regression

## Goal

Fix the hosted E2E regression on PR 623 where an active runtime's direct-R2
snapshot start is rejected after its in-container workspace version advances
beyond the invocation-start version stored on the UserRunner write fence.

## Root Cause

The owner-conditional upload-session RPC correctly revalidates attempt,
generation, and user after asynchronous work, but incorrectly treats the
write fence's invocation-start workspace version as current side-effect
authority. The hosted runtime protocol reserves workspace version for
checkpoint compare-and-swap integrity; it can advance locally during the same
active invocation.

## Constraints

- Keep attempt, generation, and user as the UserRunner mutation authority.
- Keep request/session workspace-version equality checks on the snapshot and
  checkpoint paths.
- Preserve exact canonical-session matching for replaced-ref updates.
- Preserve S1-to-S2 refusal and cleanup protection without adding state,
  tokens, dependencies, or compatibility paths.

## Working Set

- `apps/cloudflare/src/user-runner/workspace-snapshot-sessions.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`

## Verification Plan

- Focused snapshot authority tests and Cloudflare typecheck.
- The failing hosted-local retryable-outbox restart scenario or its exact CI
  rerun.
- Fresh security/privacy and coverage review.
- Full Cloudflare verification before the next pushed head.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
