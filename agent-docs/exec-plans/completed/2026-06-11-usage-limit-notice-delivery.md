Goal (incl. success criteria):
- Make the once-per-period hosted AI usage limit notice actually reach the member.
- Fix 1: a failed Linq send must release the `limitNoticeSentAt` claim so a later gate denial retries the notice instead of silently suppressing it for the rest of the period.
- Fix 2: send the limit notice proactively when recorded spend first crosses the period limit (accounting time), instead of waiting for the member's next inbound message or pending nudge.
- Success means: claim-then-send-failure leaves the claim released; crossing the limit during usage accounting triggers exactly one best-effort notice per period; existing webhook-reply and pending-nudge notice paths keep working as the retry surface.

Constraints/Assumptions:
- The AI usage gate notice is an allowed hard-coded automatic send (docs/contracts/00-invariants.md, User-Facing Message Sends).
- `limitNoticeSentAt` stays the single once-per-period dedupe; duplicate crossing signals are harmless because the claim is atomic.
- The notice send is best-effort and must never fail usage recording; it runs after the per-record accounting transaction resolves.
- The Linq webhook quota-reply path keeps its durable side-effect queue behavior; it is not rewritten here.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Detect the first crossing atomically inside the existing `incrementHostedAiUsageAllowancePeriodSpendTx` raw UPDATE via `RETURNING` on the `blocked_at IS NULL` transition, rather than adding a separate read or a new state column.
- One shared `sendHostedAiUsageLimitNotice` (route -> claim -> send -> release-on-failure) in `usage-gate-notice.ts`; the pending-nudge wrapper keeps its existing name and signature.
- Release uses an exact `limitNoticeSentAt` timestamp match so it can never clobber a competing claim.

State:
- Implementation, tests, verification, and completion audits done; ready for final commit and PR.

Done:
- Root cause proven in production data: notice claimed 2026-06-05 with no inbound message, later denials silently suppressed.
- Crossing signal via RETURNING on the existing blocked_at guard; claim release on failed send; accounting-time best-effort notice.
- 68 focused tests green; `pnpm test:diff` (full apps/web verify) green.
- Audits: security-privacy-review (no actionable findings), coverage-write (2 tests added), deep-review (no correctness bugs; two consciously-accepted bounded residuals: claim-then-crash suppression window, rare duplicate text on calendar-to-billing period realignment), task-finish-review (clean pass).

Now:
- Final scoped commit via scripts/finish-task, push, PR.

Next:
- Post-CI `pnpm review:gpt pr-review` loop; post-deploy prod check that the first real crossing produces one claim and one Linq notice.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- apps/web/src/lib/hosted-execution/usage-gate-notice.ts
- apps/web/src/lib/hosted-execution/usage.ts
- apps/web/test/hosted-execution-usage-allowance.test.ts
- apps/web/test/hosted-execution-usage-gate-notice.test.ts
- apps/web/test/hosted-execution-usage.test.ts
- pnpm test:diff apps/web/src/lib/hosted-execution
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
