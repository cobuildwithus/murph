# Hosted Runner Retry-Cap Probe

## Goal

Prevent the hosted Cloudflare runner retry cap from permanently parking a user
before durable work is checked.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- hosted runner docs if behavior text needs to change

## Constraints

- Keep the retry cap as a runaway guard.
- Do not add a new product control plane or persisted canonical state.
- Preserve Durable Object one-alarm behavior.
- Keep logs metadata-only.
- Preserve unrelated active hosted-runner and Murph Age worktree edits.

## Plan

1. Change retry-cap parking from alarm deletion to a slow recovery probe.
2. Let a due capped probe read mailbox/runtime status before deciding whether to run.
3. Avoid tight loops when capped demand is still absent or status still fails.
4. Update focused runner alarm tests and any durable docs that describe the cap.
5. Run focused verification, required audits, and the scoped commit path if the worktree allows it.

## Verification

- `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts`
- Additional focused app-local test command if `test:diff` is blocked or insufficient.

## State

- Implemented slow capped recovery probe over existing `wake_at`/`backoff_until`.
- Due capped probes may read web-owned demand; absent durable demand clears capped retry state.
- Updated focused alarm tests and hosted runner docs.
- Completion review found stale active-fence `wake_at` could reschedule an immediate alarm; fixed operational alarm selection to ignore non-future `wake_at` while a write fence is active.
- Security/privacy review: no findings.
- Coverage-write pass: added test-only assertion for clearing stale retry errors after successful capped backlog recovery.
- Focused alarm test passed after final fix:
  `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts` (47 tests).
- Diff-aware verification passed after final fix:
  `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/README.md ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md`.
- Commit blocked: task changes are mixed in `apps/cloudflare/src/user-runner.ts` and `apps/cloudflare/test/user-runner-alarm.test.ts` with adjacent active hosted-runner changes, so a safe scoped file-level commit would include unrelated work.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
