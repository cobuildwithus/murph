## Goal

Restore production hosted invite legal-consent loading for signed-in members when the Murph app-session cookie is absent or stale but the request still has a verified Privy member session.

## Scope

- `apps/web/src/lib/hosted-onboarding/request-auth.ts`
- `apps/web/src/components/hosted-onboarding/join-invite-page-model.ts`
- `apps/web/app/api/legal/consent/{status,accept,revoke}/route.ts`
- focused hosted onboarding/legal consent tests

## Constraints

- Keep the production `__Host-murph-session` cookie host-only for the canonical `www` origin.
- Do not widen cookie scope to the apex domain.
- Preserve existing app-session behavior when the app-session cookie is valid.
- Accept only Privy sessions that resolve to an existing hosted member.
- Keep legal-consent reads and mutations member-scoped.

## Verification

- Focused hosted onboarding/legal-consent tests for app-session and Privy fallback paths.
- Apps/web typecheck or the routed equivalent required by repo policy.
- Required security/privacy, coverage, and finish reviews for high-risk hosted auth work.
