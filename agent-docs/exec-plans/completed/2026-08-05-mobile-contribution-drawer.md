# mobile-contribution-drawer

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make the group one-time contribution flow feel native on phones by using the existing bottom drawer, while retaining the existing desktop dialog and replacing internal accounting language with plain “usage” copy.

## Success criteria

- One-time group contributions open in the existing bottom drawer on mobile.
- The same flow remains a centered dialog on larger viewports.
- The contribution amount choices and explanation say “usage,” not “cost-weighted usage credit.”
- The real production component remains represented in the design catalog.
- Focused tests, mobile and desktop render proof, required ReviewGPT review, and exact-head CI pass.

## Scope

- In scope: responsive overlay selection, contribution copy, focused component coverage, catalog study, PR review, and deployment.
- Out of scope: payment processing, Stripe price configuration, sponsorship accounting, purchase state, or other usage/referral copy.

## Constraints

- Reuse the existing dialog, drawer, state machine, and production component.
- Do not add a second flow, state owner, dependency, breakpoint source, or payment path.
- Preserve keyboard focus, close behavior, scrolling, recovery states, and safe-area handling.

## Tasks

1. Confirm the existing overlay owner and responsive breakpoint.
2. Route every mobile group contribution mode through the existing drawer.
3. Simplify the one-time contribution copy to “usage” and add focused regression coverage.
4. Update the design catalog study and capture desktop/mobile proof.
5. Run focused tests and typecheck, inspect the diff, commit, push, and open the PR.
6. Run preliminary specialist ReviewGPT concurrently with exact-head CI, resolve findings, then merge and verify deployment.

## Decisions

- Expand the existing group mobile drawer predicate instead of building a new responsive overlay abstraction.
- Keep internal cost-weighted accounting terminology unchanged because the request concerns customer-facing purchase copy.
- Apply the existing mobile full-height group-selection rule to ordinary one-time contributions so the existing sticky action reaches the safe-area edge even when customization is unavailable or notes are collapsed.
- Reject a second browser-like test harness for the inert catalog hash controller: the exact target is already exercised by hosted rendered proof, while focused component tests own production behavior.

## Verification

- Focused Vitest: 104 tests passed across the top-up dialog and design-study suites.
- Prepared hosted-web typecheck passed; scoped ESLint passed with zero errors.
- Desktop render at 1440×1000 retained the centered dialog and plain usage copy.
- Mobile render at 390×844 used the drawer; with notes collapsed, the selection and action both ended at the drawer bottom with a measured 0px gap.
- Preliminary specialist ReviewGPT found the short-drawer layout edge case; the accepted correction reused the existing full-height rule. The catalog-only duplicate-test suggestion was rejected with rationale recorded in the PR.
- Final ReviewGPT round 1 passed with no findings. Correction round 2 passed with no findings on `12412d0fe6625fa5b733e24fd8835895868848e9`.
- Exact-head GitHub Actions passed, including frontend design proof, viewport overflow, build/typecheck, app verification, package coverage, CLI host matrices, fixtures, and artifact hygiene.

## Outcome

- Group one-time contributions now use the existing drawer on phones and the existing dialog on larger viewports.
- Customer-facing amount choices say “usage”; internal cost-weighted accounting and the Stripe purchase path remain unchanged.
- The existing sticky safe-area action stays bottom-pinned in both long and short ordinary mobile selections without adding another component, state owner, endpoint, or dependency.
Completed: 2026-08-05
