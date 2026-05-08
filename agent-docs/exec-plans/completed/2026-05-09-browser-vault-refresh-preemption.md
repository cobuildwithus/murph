# Browser vault refresh preemption

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Prevent optional dashboard/browser-vault refresh preemption from destroying the warm hosted runner container.

## Success criteria

- Foreground nudge/manual work aborts the optional refresh coordinator signal and logs the preemption.
- Foreground preemption does not call `destroyHostedExecutionContainer` through the browser-vault refresh coordinator.
- Existing explicit cleanup/destroy paths for failed, stale, or idle-shutdown lifecycle cases remain unchanged.
- Focused tests prove active refresh preemption does not destroy the runner container.

## Scope

- In scope:
- `apps/cloudflare/src/browser-vault-refresh/coordinator.ts`
- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/user-runner-alarm.test.ts` coverage
- Out of scope:
- broader hosted runner lifecycle, idle checkpoint cleanup, browser-vault publish authority, and unrelated dirty worktree edits.

## Constraints

- Preserve the current lifecycle lock behavior where foreground work may wait for an in-flight container request.
- Keep the fix small and architectural: cooperative abort and scheduling only, no new control plane or compatibility shim.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: overlapping active Cloudflare runner edits block a scoped commit.
   Mitigation: keep the diff narrow and report the exact blocker if commit automation cannot isolate this task safely.
2. Risk: optional refresh that ignores abort runs late.
   Mitigation: rely on existing lifecycle serialization and pending-refresh continuation instead of destroying live warm state.

## Tasks

1. Remove `destroyActiveRefreshContainer` from the browser-vault refresh coordinator.
2. Remove the `HostedUserRunner` wiring that maps refresh preemption to container destruction.
3. Update focused foreground-preemption tests to assert no destroy occurs.
4. Run focused Cloudflare verification and required audits.
5. Commit through `scripts/finish-task` or report scoped-commit blockers.

## Decisions

- Choose cooperative refresh preemption only. The optional refresh must not own authority to destroy the warm runner container.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/browser-vault-refresh-coordinator.test.ts apps/cloudflare/test/user-runner-alarm.test.ts --testNamePattern "browser-vault refresh|BrowserVaultRefreshCoordinator"` (2 files, 14 passed, 72 skipped).
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `git diff --check -- apps/cloudflare/src/browser-vault-refresh/coordinator.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/browser-vault-refresh-coordinator.test.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-09-browser-vault-refresh-preemption.md`.
- Earlier focused checks used the old dashboard-replica names before the active checkout moved the coordinator to `browser-vault-refresh`; the current proof above is the relevant one.
- Blocked: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/browser-vault-refresh/coordinator.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/browser-vault-refresh-coordinator.test.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-09-browser-vault-refresh-preemption.md` reaches `apps/cloudflare verify` but fails in unrelated active `apps/cloudflare/test/user-runner-alarm.test.ts` alarm/idle-checkpoint expectation work outside the browser-vault preemption cases.
Completed: 2026-05-09
