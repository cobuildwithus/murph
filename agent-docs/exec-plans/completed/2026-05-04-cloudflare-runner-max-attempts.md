# Bound Cloudflare hosted runner retry attempts

Status: completed
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Stop hosted Cloudflare runner wake/alarm loops from retrying indefinitely when a persistent runtime setup failure occurs, such as web-side hosted crypto callback authorization returning 403.

## Success criteria

- `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` limits consecutive failed hosted runner invocations.
- Once the cap is reached, the Durable Object does not schedule another retry alarm without fresh nudge/manual input.
- Successful invocations and fresh nudges clear the consecutive failure counter.
- Focused tests cover the capped failure loop and retry reset behavior.

## Scope

- In scope:
  - `apps/cloudflare` hosted runner Durable Object state, alarm scheduling, and tests.
  - Metadata-only structured logs for retry suspension.
- Out of scope:
  - Changing web/control-plane auth semantics.
  - Broad runner queue architecture changes.
  - Logging raw payloads, secrets, callback headers, or user content.

## Constraints

- Preserve Cloudflare as execution-only; web remains canonical for mailbox/workspace facts.
- Keep the guard replay-safe and metadata-only.
- Preserve unrelated active worktree changes.

## Tasks

1. Add a persisted consecutive runner failure counter to Durable Object state.
2. Gate retry alarm scheduling on `maxEventAttempts`.
3. Reset the counter on successful completion and fresh nudges.
4. Add focused Cloudflare runner tests.
5. Run focused verification and close with a scoped commit if possible.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test -- user-runner-alarm`
  - `pnpm --dir apps/cloudflare typecheck`
- Expected outcomes:
  - Tests prove repeated 403-like crypto-context failures stop after the configured cap.
  - TypeScript accepts the touched runner state/schema changes.
Completed: 2026-05-04
