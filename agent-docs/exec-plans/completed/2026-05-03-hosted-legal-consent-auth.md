## Goal

Restore production hosted invite legal-consent loading by keeping invite and consent authorization app-session-only. A verified Privy session may complete signup and mint the Murph app-session cookie, but it must not independently advance invite/legal gates.

## Scope

- `apps/web/src/components/hosted-onboarding/join-invite-page-model.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/app/api/hosted-onboarding/invites/[inviteCode]/status/route.ts`
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- focused hosted onboarding/legal consent tests

## Constraints

- Keep the production `__Host-murph-session` cookie host-only for the canonical `www` origin.
- Do not widen cookie scope to the apex domain.
- Use the Murph app-session member as the only invite/legal gate authority.
- Keep Privy as the identity proof for the app-session completion flow only.
- If the app-session cookie is absent, invite status must remain in verification/session-completion state instead of reaching legal consent.
- Keep legal-consent API routes app-session-scoped.

## Verification

- Focused hosted onboarding tests for app-session-only invite gating and Privy completion.
- Apps/web typecheck or the routed equivalent required by repo policy.
- Required security/privacy, coverage, and finish reviews for high-risk hosted auth work.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
