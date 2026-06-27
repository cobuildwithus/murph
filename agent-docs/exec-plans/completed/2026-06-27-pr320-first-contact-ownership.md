Goal (incl. success criteria):
- Fix Eragon round 27 PR 320 findings: in-flight Linq signup invite proof must not be rebound across first-contact events, and processing first-contact receipts must not route active mailbox traffic even after allow/fail-open admission.

Constraints/Assumptions:
- Keep invite proof immutable once `linqFirstContactEventId` is assigned, not only after `sentAt`.
- A stale processing first-contact receipt remains first-contact-owned before active-member routing.
- Same-event delivered proof still consumes/ignores as signup already sent.

Key decisions:
- `linqFirstContactEventId` is immutable ownership proof once assigned; an unexpired invite owned by a different first-contact event is not reused.
- Already-sent invite rows with no matching event id are not claimed by a new first-contact event; new actual sends create fresh invites.
- Processing first-contact receipts only suppress active-member routing after the current invocation is admitted; terminal classifier blocks still win.
- Admitted active-member stale first-contact receipts without delivered proof consume/ignore as `stale-first-contact` before mailbox append/wake.

State:
- Active.

Done:
- Round 27 findings received from Eragon.
- Patched invite ownership checks and stale first-contact active-routing guard.
- Added regressions for in-flight invite rebinding and updated allow/fail-open/recorded-allow stale replay expectations.
- Verified focused Linq suite, app typecheck, app verify, diff whitespace, and root typecheck baseline.

Now:
- Commit and push the scoped fix.

Next:
- Rerun Eragon and continue the loop if it reports another production-breaking issue.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/invite-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
