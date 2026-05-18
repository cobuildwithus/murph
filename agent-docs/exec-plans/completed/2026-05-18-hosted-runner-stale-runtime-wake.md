# Hosted Runner Stale Runtime Wake

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

- Stop stale or past runtime-result `nextWakeAt` values from scheduling a short runner recheck after mailbox catch-up.

## Success criteria

- Runtime-result wakes are scheduled only when they normalize to a future timestamp.
- Stale assistant wake timestamps returned by the runtime clear runner `wake_at` after mailbox catch-up.
- Existing mailbox-lag and status-read failure recheck behavior is preserved, including a short `wake_at` that is earlier than an active write-fence expiry.
- Focused Cloudflare runner regression coverage passes.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts` runtime completion wake reconciliation.
  - `apps/cloudflare/test/user-runner-alarm.test.ts` regression coverage.
- Out of scope:
  - New runtime-result contract fields.
  - Web workspace schema or mailbox lag ownership changes.
  - Broad hosted runner lifecycle refactors.

## Constraints

- Preserve Cloudflare as execution/lifecycle coordinator only.
- Treat past `nextWakeAt` as stale scheduling metadata, not an implicit immediate-work signal.
- Preserve unrelated dirty worktree edits and active hosted runner rows.
- Do not expose secrets, raw payloads, identifiers, local usernames, home paths, prompts, transcripts, or mailbox content in code, tests, docs, logs, or handoff.

## Tasks

1. Remove the past-timestamp immediate runtime wake branch.
2. Replace the existing immediate-wake test with stale runtime-result coverage.
3. Preserve active-fence status-read failure alarms by using an operational alarm due time that honors an earlier `wake_at`.
4. Run focused Cloudflare runner verification plus required repo checks as feasible.
5. Run completion audits required by the routed task class.
6. Commit through `scripts/finish-task` if the scoped commit is safe.

## Decisions

- Do not encode immediate follow-up work as a past timestamp. Future explicit runtime-result fields can model that separately if needed.

## Verification

- Commands to run:
  - Focused Vitest for `apps/cloudflare/test/user-runner-alarm.test.ts`.
  - Scoped `bash scripts/workspace-verify.sh test:diff ...` for touched files.
  - `pnpm typecheck` unless blocked by unrelated worktree state.

## Current evidence

- Initial inspection confirmed the stale wake can pass through `isImmediateRuntimeWakeRequest` after `normalizeFutureWakeAt` drops it.
- Removed the immediate runtime wake branch so only normalized future runtime-result wakes can schedule runner `wake_at`.
- Added focused alarm regression coverage for a stale runtime-result assistant wake after mailbox catch-up.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts -t "drops stale runtime-result assistant wakes" --no-coverage` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-18-hosted-runner-stale-runtime-wake.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed.
- Active-fence status-read failures were still syncing the lease expiry even when a short backlog recheck already existed in `wake_at`.
- Added `readRunnerOperationalAlarmAt` so alarm synchronization can preserve `wake_at` when it is earlier than `writeFence.expiresAt`, while `readRunnerStateAlarmAt` still reports the write-fence expiry as the lease timeout.
- Completion security/review caught a transient drift back to filtering stale active-fence `wake_at` values before alarm selection.
- Restored `readRunnerOperationalAlarmAt` to compare raw `record.wakeAt` with `writeFence.expiresAt`, preserving the already-fired 1s recheck described by the active-fence failure sequence.
- Added active-fence status-read failure regressions for both future backlog recheck alarms and already-fired stale recheck alarms.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed with 45 tests.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-18-hosted-runner-stale-runtime-wake.md` passed.
- `git diff --check` passed for the touched runner files and active plan.
- Relevant diff privacy scan found no direct identifier, home path, authorization header, bearer-token, or secret-key matches.
- Coverage audit added `runnerStatus()` coverage proving an earlier Cloudflare `wake_at` wins over both a later web workspace wake and the active write-fence expiry.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts -t "status reads fail"` passed with 3 matching tests.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed with 47 tests.
- `pnpm --dir apps/cloudflare typecheck` passed after the final stale active-fence fix.
- `pnpm typecheck` passed after waiting for unrelated concurrent workspace verifiers to clear.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-18-hosted-runner-stale-runtime-wake.md` passed after the final stale active-fence fix with 74 Cloudflare test files and 973 tests.
- After plan archival, `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed with 47 tests.
- After plan archival, `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/completed/2026-05-18-hosted-runner-stale-runtime-wake.md` passed with 74 Cloudflare test files and 973 tests.
- Final inspection found the immediate-runtime wake branch had reappeared in the overlapping working tree; removed it again and restored the stale runtime-result drop regression.
- Final live-state check confirmed `readRunnerOperationalAlarmAt` ignores stale `record.wakeAt` values before comparing with the active write-fence expiry.
- After the final branch removal, `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed with 47 tests.
- After the final branch removal, `pnpm typecheck` passed.
- After one unrelated/concurrent Contracts tarball packaging failure in `runner-bundle-workspace-artifacts.test.ts`, retrying `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/completed/2026-05-18-hosted-runner-stale-runtime-wake.md` passed with 74 Cloudflare test files and 973 tests.
- Final focused regression check `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts -t "drops stale runtime-result|ignores a stale recheck" --no-coverage` passed with 2 matching tests.
- A later broad `bash scripts/workspace-verify.sh test:diff ...` rerun was blocked by unrelated `packages/contracts` export/build failures inside `runner-bundle-workspace-artifacts.test.ts`.
- Final `git diff --check` passed for the touched runner files, ledger, and completed plan.
- Final relevant diff privacy scan found no direct identifier, home path, authorization header, bearer-token, or secret-key matches.
- Scoped commit is blocked by overlapping dirty edits in the same runner/test files and the shared coordination ledger.
Completed: 2026-05-18
