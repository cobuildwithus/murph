Goal (incl. success criteria):
- Fix Eragon round 24 PR 320 findings: stale fail-open signup delivery must not later classify into a terminal block after durable signup send proof, and fail-open logs must not include raw provider/cause messages.

Constraints/Assumptions:
- Preserve classifier-unavailable fail-open behavior without synthetic admission decisions.
- Keep terminal explicit blocks effective when no durable delivered signup proof exists.
- Do not log raw provider response bodies, prompt text, or raw cause messages.

Key decisions:
- Reclaim existing processing receipts before the initial admission-state provider plan, without creating receipts when none exists.
- Treat durable delivered signup proof (`onboardingLinkSentAt` plus delivered Linq invite) as admission for retry routing, so stale fail-open retries do not reclassify into terminal blocks after signup delivery.
- Strip `errorCauseMessage` only from classifier fail-open warning logs; leave generic hosted error logging unchanged.

State:
- Fix implemented and locally verified; preparing commit/push and next Eragon round.

Done:
- Round 24 findings received from Eragon.
- Added stale fail-open delivered-signup replay regression.
- Added fail-open warning regression that excludes raw cause/body text.
- `apps/web` focused tests, typecheck, and verify passed.
- Root `pnpm typecheck` attempted; still fails in unrelated assistant/operator-config packages.

Now:
- Commit and push the round 24 fix.

Next:
- Run next Eragon review round on pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/webhook-transport.ts
- apps/web/src/lib/hosted-onboarding/http.ts
- apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
