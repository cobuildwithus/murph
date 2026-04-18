## Goal (incl. success criteria)

Inspect the active-member hosted onboarding ingress seam in `apps/web` and determine whether active Linq/Telegram message paths still depend on hosted webhook-receipt lifecycle before direct wake append.

Success criteria:
- Prove whether the stale audit finding is still true in the current `apps/web` hosted onboarding/webhook flow.
- If the finding is still real, land the smallest safe cleanup that removes receipt claim/state ownership from zero-side-effect active-member message paths without changing behavior.
- Keep scope inside `apps/web/src/lib/hosted-onboarding/**` plus directly related tests/docs.

## Constraints/Assumptions

- Preserve unrelated dirty worktree edits already present in `apps/web` and elsewhere.
- Do not widen into Cloudflare, shared hosted-execution contracts, pricing, or onboarding auth work unless a directly related test/doc reference forces a narrow update.
- Treat hosted webhook receipts as allowed receipt-local journals where they still gate real side effects or idempotency ownership.
- Keep edits ASCII-only unless a touched file already requires otherwise.

## Key decisions

- Audit the current code path first from webhook route entry through member lookup, wake append, and receipt persistence before deciding whether any cleanup is warranted.
- Only remove receipt lifecycle ownership where the message path is provably zero-side-effect aside from direct wake append.
- Prefer test updates that pin the intended ownership boundary over broader refactors.
- Keep Linq on receipt ownership because active-member Linq ingress still mutates daily-state and home-binding rows before wake append, so duplicate replay still needs a durable claim gate there.
- Remove Telegram from receipt ownership because the Telegram planner is wake-only-or-ignore and hosted wake dedupe already owns idempotency for that path.

## State

in_progress

## Done

- Read repo workflow, verification, architecture, security, and reliability docs required for repo code changes.
- Registered this task in the coordination ledger with a narrow hosted-onboarding scope.
- Traced the current hosted onboarding webhook flow and confirmed the stale finding was still partially real: Telegram active-member ingress still ran through webhook-receipt claim/complete state even though the planner only appended a wake or ignored the event.
- Confirmed Linq still has real receipt-worthy local writes on the active-member path (`hostedLinqDailyState` increments and Linq home-binding updates), so that seam was not safe to remove here.
- Updated the Telegram webhook service path to run the planner transaction directly, fail closed if receipt-local side effects ever appear, and rely on hosted wake dedupe plus the existing wake handoff path instead of receipt claim/state ownership.
- Updated Telegram dispatch tests to assert the active-member and suspended-member paths no longer create or update hosted webhook receipts.
- Ran targeted Telegram Vitest, `apps/web` typecheck, and `apps/web` lint.

## Now

- Preparing scoped handoff and commit with the Telegram-only cleanup plus the verified Linq-vs-Telegram finding split.

## Next

- Commit only the touched paths.

## Open questions (UNCONFIRMED if needed)

- UNCONFIRMED: the broader hosted hard-cut docs still contain overlapping stale wording about active-member message ingress and webhook receipts, but those docs are already owned by an active concurrent hosted-hard-cut lane, so this task leaves them untouched.

## Working set (files/ids/commands)

- Plan: `agent-docs/exec-plans/active/2026-04-18-active-member-ingress-seam.md`
- Candidate code: `apps/web/src/lib/hosted-onboarding/**`
- Candidate tests: `apps/web/test/hosted-onboarding*.test.ts`, related hosted webhook/wake tests
- Verification target: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding`
- Verification run:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts`
- Verification run:
  `pnpm --dir apps/web typecheck`
- Verification run:
  `pnpm --dir apps/web lint`
- Verification blocker:
  `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts` queued behind an existing unrelated `apps/web verify` workspace-artifact lock holder and never reached this task's verification body during this turn.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
