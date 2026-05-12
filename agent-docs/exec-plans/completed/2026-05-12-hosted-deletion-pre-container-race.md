# Hosted deletion pre-container race

## Goal

Add a regression test proving hosted user-data deletion during the narrow window after a runtime write fence is acquired but before the runner container is invoked does not recreate Durable Object state, schedule a retry alarm, or invoke the container after deletion.

## Constraints

- Keep the change test-only unless the regression exposes a real production bug.
- Preserve active overlapping hosted-runner rows and unrelated dirty worktree edits.
- Do not expose local usernames, home paths, secrets, R2 object keys, or user-identifying data.
- Treat this as high-sensitivity hosted deletion coverage; run focused Cloudflare verification and required completion audits.

## Context

- Cloudflare Durable Objects have one alarm per object; cleanup must leave no pending alarm.
- Cloudflare Durable Object storage cleanup guidance says emptied storage plus cleared alarm is the removal boundary for DO state.
- Existing tests cover deletion of idle state, active write-fence preemption, R2 cleanup ordering, and teardown failure.

## Plan

1. Inspect the existing `HostedUserRunner` drain/delete harness.
2. Add a deterministic pre-container pause around the workspace read/write-fence window.
3. Delete hosted user data while paused, release the drain, and assert no state, no retry alarm, and no container invoke.
4. Run focused Cloudflare tests/typecheck or truthful diff verification.
5. Run required security/privacy, coverage, and final review passes before commit/handoff.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed after the awaited and detached pre-container deletion regressions were added: 11 tests.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-12-hosted-deletion-pre-container-race.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` was attempted and failed before Cloudflare verification on unrelated repo TS tools errors in `scripts/murph-age/r399-midus2-biomarker-increment.ts`.
- `pnpm --dir apps/cloudflare verify` passed after the final test changes: 72 files, 829 tests.
- Security/privacy review found no leakage or authority regression; it noted the detached `waitUntil` retry path as a residual gap, which is now covered by the second regression.
- Coverage-write review made no edits and agreed the initial awaited drain regression directly covered the requested race; the final diff adds the detached-path regression as additional coverage.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
