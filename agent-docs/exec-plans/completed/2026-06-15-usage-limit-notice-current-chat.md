Goal (incl. success criteria):
- Fix hosted AI usage-limit notice silence where post-accounting proactive notices can claim the once-per-period notice before the user's inbound Linq thread receives a quota reply.
- Success means usage accounting still blocks exhausted members, and the user-visible usage-limit text is sent by inbound gate-denied Linq handling to the current chat rather than by member-scoped post-accounting or pending-nudge callbacks.

Constraints/Assumptions:
- Keep the fix simple; do not add new queues, persisted state, schedulers, or route-repair abstractions.
- Preserve existing inbound webhook quota reply behavior and existing release-on-delivery-failure semantics.
- Current checkout has unrelated assistant-runtime edits; do not touch or commit them.
- Active PR 144 ledger row overlaps these files but appears stale in this checkout after the PR landed; this task is a narrow follow-up on that behavior.

Key decisions:
- Remove post-usage-recording proactive limit notice delivery instead of trying to infer the active Linq chat from usage rows.
- Remove the stored-route pending-nudge usage-limit sender and its candidate reader.
- Check the AI usage gate before daily Linq text quota returns so an exhausted user still gets the current-chat usage-limit notice.
- Keep `limit_notice_sent_at` as the inbound/current-thread once-per-period claim.

State:
- Verification passed; final audits running.

Done:
- Diagnosed root cause from code paths and production row timestamps.
- Removed proactive/stored-route usage-limit notice claim/send paths.
- Added current-chat, stale-route, delivery-failure release, and over-daily-quota regressions.
- Passed focused hosted tests, typecheck, and scoped `test:diff`.

Now:
- Run final audit reruns and commit scoped changes.

Next:
- Commit scoped changes with `scripts/finish-task`.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: production Linq home route for the affected member may have been stale or provider-accepted-but-undelivered.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/app/api/internal/hosted-execution/usage/gate/route.ts`
- `apps/web/test/hosted-execution-usage.test.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-execution-usage-gate-route.test.ts`
- `apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `agent-docs/exec-plans/active/2026-06-15-usage-limit-notice-current-chat.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
