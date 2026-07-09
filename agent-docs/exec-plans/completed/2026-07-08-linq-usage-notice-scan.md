Goal (incl. success criteria):
- Fix Linq usage-denial notice selection so rate-limited inputs stay preserved and the notice targets a real unconsumed Linq/Telegram pending message.
- Success means consumed Linq rows cannot spend the notice claim, and older unsupported rows cannot permanently mask a later Linq notice.

Constraints/Assumptions:
- Keep the fix small and owned by existing mailbox/runtime primitives.
- No new persisted state, queues, cursors, or compatibility shims.
- Preserve unrelated active ledger rows and dirty work.

Key decisions:
- Make the pending-conversation mailbox helper select the latest unconsumed row.
- Use one current pending row for notice selection instead of adding a new stateful cursor or walking a backlog.

State:
- Active.

Done:
- Deep review verified two actionable findings: consumed rows can be selected, and 10 unsupported rows can mask a later Linq notice.
- Patched pending conversation selection to choose the latest unconsumed row.
- Simplified runtime usage-notice selection to one current pending row.
- Added focused store/runtime regressions.
- Verification passed: focused Vitest, `git diff --check`, `pnpm --dir apps/web typecheck`, and path-scoped `test:diff`.
- Security review found no verified findings.
- Coverage review added a Telegram trial-denial silence test.
- Final deep review flagged latest-only unsupported-row suppression as a tradeoff; rejected as intentional to preserve inputs without unbounded backlog decoding.

Now:
- Final local review and commit.

Next:
- Close plan and commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/web/test/hosted-mailbox-store.test.ts`
- `apps/web/test/hosted-orchestration-reconciliation-facts.test.ts`
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
