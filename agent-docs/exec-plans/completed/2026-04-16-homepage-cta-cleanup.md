## Goal

Clean up the homepage footer CTA so it uses less copy, has stronger spacing/margins, and briefly signals that Murph can also run locally.

## Scope

- `apps/web/app/lp/page.tsx`
- focused `apps/web/test/{page,lp-page}.test.ts`

## Constraints

- Preserve the existing landing-page visual language and auth wiring.
- Keep the change narrow to homepage CTA polish plus the local-run note.
- Avoid unrelated onboarding, footer, or auth-flow behavior changes.

## Verification

- Focused `apps/web` tests covering landing-page rendering
- App-level verification for touched `apps/web` files per repo policy
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
