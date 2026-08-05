# mobile-contribution-drawer

Status: active
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

## Verification

- Commands to run: focused top-up dialog and design-study Vitest suites, prepared web typecheck, scoped lint, local desktop/mobile render proof, exact-head GitHub Actions, and preliminary specialist ReviewGPT.
- Expected outcomes: a mobile one-time contribution renders `drawer-content` and no `dialog-content`; desktop renders `dialog-content`; visible contribution copy contains “usage” and omits “cost-weighted.”
