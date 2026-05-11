# Runtime Wake Single Retry

Status: completed
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
- If `clearWriteFenceAfterFailure` reports `failed: false`, rethrow so post-completion scheduling failures still use the generic retry scheduler instead of being swallowed as write-fence-owned failures.
- If retry state is recorded but alarm sync throws, rethrow an internal already-recorded error so outer retry handling retries alarm sync without incrementing retry counters again.

## Verification

- Commands to run:
  - Focused Cloudflare Vitest for the new `user-runner-alarm.test.ts` regression.
  - `pnpm typecheck`.
  - `bash scripts/workspace-verify.sh test:diff ...` if feasible for touched files.

## Current evidence

- Initial inspection found `runRuntimeWake` already calls `clearWriteFenceAfterFailure`, but then rethrows into detached/alarm catchers that call `scheduleRetryAfterFailure`.
- Security/privacy audit found the first patch swallowed post-completion scheduling failures where the write fence had already been cleared; the patch now gates the scheduled return on `failed.failed === true`.
- Second security/privacy audit found alarm-sync failure after recording a runtime failure could still double-count through outer retry handling; the patch now retries alarm sync without another `scheduleRetry` mutation.
- Final completion review found the alarm-sync-failure fallback skipped the original runtime failure log; the patch now emits the metadata-only runtime failure log before alarm sync.
- Focused regression passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts -t "failed runtime invocation increments retry_count once|does not increment retry twice when alarm sync fails|logs runtime failure before retry alarm sync fallback|rethrows post-completion scheduling failures" --no-coverage`.
- `pnpm --dir apps/cloudflare typecheck` passed before unrelated browser-vault container-side dirty edits appeared; a later rerun failed on unrelated `apps/cloudflare/test/runner-container.test.ts` references to `refreshHostedExecutionContainerBrowserVaultReplica`.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-11-runtime-wake-single-retry.md` passed.
- Root `pnpm typecheck` was attempted but did not run because another active `apps/cloudflare verify` process held the workspace artifact lock for 12+ minutes; the queued typecheck process was stopped.
- Final security/privacy review found no issues.
- Final coverage-write pass made no edits and judged coverage adequate.
Completed: 2026-05-11
