Goal (incl. success criteria):
- Fix Eragon round 25 PR 320 finding: delivered signup proof used for Linq first-contact retry admission must be scoped to the same Linq event id, not only member/day.

Constraints/Assumptions:
- Preserve stale fail-open recovery when the same event delivered the signup link and receipt consumption failed.
- Do not let same-contact event A borrow event B's signup delivery proof.
- Prefer existing durable state before adding schema/state.

Key decisions:
- Use the hosted invite row as the durable delivery proof owner because it is already the persisted signup-link artifact that is marked sent.
- Add nullable `HostedInvite.linqFirstContactEventId`; write it when issuing Linq first-contact invites, including reused pending invites.
- Require delivered signup proof reads to match the current Linq event id before admitting stale receipt retries or returning signup-link-already-sent.

State:
- Active.

Done:
- Round 25 finding received from Eragon.
- Added event-scoped invite proof column and migration.
- Added cross-event stale retry regression where event A has a stale processing receipt, event B has delivered signup proof, and event A classifier blocks.
- Verified focused Linq tests, app typecheck, app verify, and diff whitespace.

Now:
- Commit and push the scoped fix.

Next:
- Rerun Eragon and continue the loop if it reports another production-breaking issue.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/webhook-transport.ts
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- prisma/schema.prisma
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
