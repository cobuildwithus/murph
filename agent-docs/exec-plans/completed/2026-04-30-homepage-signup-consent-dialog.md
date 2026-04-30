Goal (incl. success criteria):
- Move launch-required legal consent out of pricing/join inline checkboxes and into the homepage/signup auth dialog after successful authentication.
- Consent checkboxes must stay visible after being checked and must only record consent when the user presses Continue.
- Keep authenticated app/API gates as backstops; do not weaken server consent checks.

Constraints/Assumptions:
- Hosted consent state remains in apps/web Postgres via existing legal consent APIs.
- Existing dirty hosted onboarding/auth files may contain unrelated edits; preserve them.
- No global root-layout consent gate in this task.

Key decisions:
- Reuse HostedLegalConsentCard for the post-auth dialog step.
- Remove InlineCheckoutConsent from pricing/join checkout surfaces instead of adding another consent implementation.

State:
- Completed; scoped commit blocked by overlapping pre-existing dirty edits in the same hosted onboarding files.

Done:
- Product decision: primary gate belongs inside signup dialog after auth.
- Removed pricing/checkout inline consent and checkbox-click consent recording.
- Added homepage signup-dialog launch consent after hosted auth completion.
- Fixed phone auth completion ordering and made post-consent completion one-shot.
- Focused consent/auth tests and apps/web typecheck passed.
- Required security/privacy, frontend, coverage-write, and task-finish reviews completed; review findings addressed.

Now:
- Closing plan without commit due overlapping dirty work.

Next:
- Handoff with verification status and unrelated app-wide baseline blockers.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx
- apps/web/src/components/hosted-onboarding/hosted-email-auth-button.tsx
- apps/web/src/components/hosted-onboarding/hosted-telegram-auth-button.tsx
- apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts
- apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx
- apps/web/src/components/legal/hosted-legal-consent-card.tsx
- directly coupled apps/web tests
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
