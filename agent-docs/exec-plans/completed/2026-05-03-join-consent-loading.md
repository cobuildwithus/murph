# Join Consent Loading State

## Goal

Keep the join page launch-consent section visually stable after the user accepts the required consent checkboxes and before checkout navigation starts.

Success criteria:
- The consent card does not collapse to a title-only state after `Continue`.
- The forward button stays visible with a loading/disabled state while consent acceptance and checkout handoff are in flight.
- The join flow still gates checkout on accepted launch consent.
- Focused tests cover the consent-to-checkout transition.

## Constraints

- Preserve the existing legal consent authority and server-side checkout gate.
- Do not change billing, Stripe, Privy, or app-session semantics.
- Preserve unrelated hosted onboarding dirty work in this checkout.
- Avoid exposing legal names, local usernames, home paths, secrets, or raw identifiers in docs, tests, logs, or commits.

## Plan

1. Trace the join consent state machine and the checkout refresh/navigation handoff.
2. Patch the smallest client-side state transition so the accepted consent UI remains stable while loading.
3. Add or update focused join/consent tests for the loading state.
4. Run focused verification plus required frontend/security/final audits.
5. Create a scoped commit if the working tree allows safe staging.

## Verification

Planned:
- Focused hosted join/consent Vitest tests.
- `pnpm test:diff` scoped to the touched apps/web files when truthful.
- Browser or direct scenario proof if the local hosted app can be started without unrelated blockers.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
