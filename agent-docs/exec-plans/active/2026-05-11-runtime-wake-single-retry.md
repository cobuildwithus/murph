# Runtime Wake Single Retry

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Ensure one failed hosted runtime wake records exactly one retry attempt and schedules one retry alarm.

## Success criteria

- Runtime invocation failures after a write fence exists do not also flow into outer retry scheduling catchers.
- Focused coverage proves retry count increments once, wake work remains pending, and only one retry alarm is scheduled for the failed invocation.
- Failures before a write fence can still throw to the generic retry scheduler.
- No persisted schema, control-plane, or authority-boundary change is introduced.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts` runtime wake failure handling.
  - `apps/cloudflare/test/user-runner-alarm.test.ts` focused retry/alarm regression coverage.
  - `apps/cloudflare/test/sql-storage.ts` legacy in-memory schema alignment if needed to run focused coverage.
- Out of scope:
  - Runner-state schema changes.
  - New scheduler abstractions.
  - Hosted-local E2E expansion unless focused coverage exposes a broader issue.

## Constraints

- Preserve Cloudflare as execution/lifecycle coordinator only.
- Preserve existing retry cap semantics and wake-pending recovery.
- Preserve unrelated dirty worktree edits and active hosted runner rows.
- Do not expose secrets, raw payloads, identifiers, local usernames, or home paths in code, tests, docs, logs, or handoff.

## Tasks

1. Inspect the runtime wake, detached drive, alarm, and retry-state paths.
2. Patch the write-fenced runtime failure path to return the recorded scheduled state.
3. Add a focused failed runtime invocation regression.
4. Run focused verification plus required completion audits.
5. Commit through `scripts/finish-task` if the scoped commit is safe.

## Decisions

- Keep the behavior local to `runRuntimeWake`: after `clearWriteFenceAfterFailure` succeeds, sync the alarm from that returned record and return `status: "scheduled"` instead of rethrowing.
- Leave pre-write-fence failures throwing so the generic `scheduleRetryAfterFailure` path still covers failures that cannot be represented by an active invocation token.

## Verification

- Commands to run:
  - Focused Cloudflare Vitest for the new `user-runner-alarm.test.ts` regression.
  - `pnpm typecheck`.
  - `bash scripts/workspace-verify.sh test:diff ...` if feasible for touched files.

## Current evidence

- Initial inspection found `runRuntimeWake` already calls `clearWriteFenceAfterFailure`, but then rethrows into detached/alarm catchers that call `scheduleRetryAfterFailure`.
