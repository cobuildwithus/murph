# Idle Checkpoint Cleanup Hardening

## Goal

Prevent best-effort cleanup failures after a committed idle-shutdown checkpoint
from being treated as checkpoint invocation failures.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`

## Constraints

- Preserve retry behavior for real pre-commit idle checkpoint failures.
- Keep warm-container cleanup and Durable Object alarm cleanup best-effort after
  the full/base checkpoint has committed.
- Do not widen runner authority, persisted state, or logging payloads.
- Preserve unrelated dirty work in the shared checkout.

## Verification

- Focused Cloudflare runner alarm test for post-commit cleanup failure.
- Cloudflare scoped verification per the repo verification map.

## State

- Done: committed idle-shutdown checkpoint results now enter a best-effort
  cleanup wrapper before any post-commit runner-state read or alarm operation.
- Done: focused regression coverage proves an alarm deletion failure after the
  committed checkpoint does not mark or retry the invocation.
- Done: committed with explicit index staging to avoid unrelated overlapping
  dirty edits in the shared checkout.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
