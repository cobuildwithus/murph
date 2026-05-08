# Browser-Vault Post-Reply Refresh

## Goal

Restore reply-driven browser-vault replica freshness without putting refresh work on the foreground reply path.

Success criteria:

- A successful non-idle foreground invocation schedules a pending browser-vault refresh.
- The foreground invocation does not start or await the browser-vault refresh container.
- Pending or active foreground nudges continue to preempt optional browser-vault refresh work.
- Focused tests cover scheduling and preemption behavior.

## Constraints

- Preserve existing runner nudge priority and invocation serialization.
- Do not introduce a second alarm owner; keep using the existing Durable Object pending-slot/alarm path.
- Do not add new persisted state beyond the existing pending browser-vault refresh slot.
- Preserve unrelated dirty work in `apps/cloudflare/src/user-runner.ts` and `apps/cloudflare/test/user-runner-alarm.test.ts`.

## Plan

1. Add a small best-effort helper that schedules browser-vault refresh after successful foreground completion.
2. Invoke it only after successful non-idle foreground invocations, after workspace alarm scheduling, without awaiting the refresh itself.
3. Update focused runner tests to assert pending refresh scheduling and no inline refresh execution.
4. Add/keep race coverage proving new nudges preempt active refresh work.
5. Run targeted Cloudflare runner verification and required completion audits.

## Verification

- `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed after the queued-nudge race fix: 1 file, 89 tests.
- Earlier, before the queued-nudge race fix, `pnpm --dir apps/cloudflare test -- user-runner-alarm` passed: 70 files, 914 tests.
- Earlier, before the queued-nudge race fix, `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed and selected `apps/cloudflare verify`.
- After the queued-nudge race fix, `pnpm --dir apps/cloudflare test -- user-runner-alarm` is blocked in app typecheck by unrelated dirty assistant-engine `executionContext` errors in `packages/assistant-engine/src/assistant/automation/reply.ts` and `packages/assistant-engine/src/assistant/automation/run-loop.ts`.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-09-browser-vault-post-reply-refresh.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.

## Review Outcomes

- `security-privacy-review` found one medium race: pending refresh scheduling could be dropped when a nudge queued during active invocation. Fixed by scheduling the pending slot whenever the post-invocation flag exists, even if a queued foreground drive already reacquired the invocation lock.
- `coverage-write` added the failed-foreground no-schedule regression.
- `task-finish-review` found no issues in the scoped browser-vault changes.

## Closeout

- Active plan archived and matching coordination-ledger row removed.
- Scoped commit blocked by overlapping dirty edits in `apps/cloudflare/src/user-runner.ts`, `apps/cloudflare/test/user-runner-alarm.test.ts`, and the coordination ledger from other active tasks. Committing by whole file would include unrelated work.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
