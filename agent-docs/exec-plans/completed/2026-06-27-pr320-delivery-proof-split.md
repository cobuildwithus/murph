Goal (incl. success criteria):
- Fix Eragon round 26 PR 320 finding: same-event delivered signup proof can recover stale receipt retries, but must not admit old first-contact text as active-member traffic, and member/day signup dedupe must still use any delivered signup proof.

Constraints/Assumptions:
- Preserve event-scoped proof for the event receipt recovery path.
- Preserve member/day signup-link dedupe across distinct Linq events from the same pending member.
- Delivered invite proof must remain immutable once sent.

Key decisions:
- Split signup delivery proof by responsibility: same-event proof recovers stale first-contact receipts; member/day proof dedupes pending signup sends across events.
- Same-event stale delivery recovery consumes the first-contact event and returns `signup-link-already-sent` before active-member routing.
- Daily dedupe reads any delivered Linq invite for the member after the onboarding-link claim time; only missing delivered proof can release a stale claim.
- `issueHostedInviteTx` creates a fresh invite instead of rewriting `linqFirstContactEventId` on an already-sent invite row.

State:
- Active.

Done:
- Round 26 finding received from Eragon.
- Patched provider proof split and sent-invite immutability.
- Added/updated regressions for same-event stale retry, cross-event daily dedupe, and fresh invite creation when a sent invite exists.
- Verified focused Linq suite, app typecheck, app verify, diff whitespace, and root typecheck baseline.

Now:
- Commit and push the scoped fix.

Next:
- Rerun Eragon and continue the loop if it reports another production-breaking issue.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/invite-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-transport.ts
- apps/web/src/lib/hosted-onboarding/linq-daily-state.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
