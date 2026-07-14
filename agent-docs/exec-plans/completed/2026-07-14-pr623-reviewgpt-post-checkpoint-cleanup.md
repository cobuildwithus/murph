# PR 623 ReviewGPT Post-Checkpoint Cleanup

## Goal

Prevent a preempted snapshot completion from deleting the prior workspace
snapshot after its awaited Web checkpoint, while preserving eventual cleanup
through the existing UserRunner alarm.

## Root Cause

The complete route validates the active attempt, generation, and user before
checkpointing, but performs direct replaced-object deletion after the
asynchronous checkpoint returns. A replacement foreground invocation can
select that prior object for restore during the wait, making the stale delete
break the accepted foreground reply.

## Constraints

- Perform no direct R2 or upload-session mutation after a successful awaited
  checkpoint.
- Keep the existing upload session as the cleanup obligation; its alarm already
  waits for the minimum age, rereads current Web state, and skips referenced
  objects.
- Add no state, token, service, dependency, or cleanup mechanism.
- Preserve checkpoint validation and fail-closed pre-checkpoint ownership.

## Working Set

- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`

## Verification Plan

- Focused snapshot completion and UserRunner alarm tests.
- Cloudflare typecheck and full verification.
- Fresh security/privacy and coverage review.
- ReviewGPT on the next exact pushed PR head.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
Completed: 2026-07-14
