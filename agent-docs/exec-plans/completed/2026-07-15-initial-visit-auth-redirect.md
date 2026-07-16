# Preserve first-visit auth redirect

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Ensure a newly created hosted member who completes sign-up through the shared
  auth dialog reaches the existing `/home?initialVisit=true` handoff so the
  first-visit onboarding dialogs appear.

## Success criteria

- The shared auth provider preserves `initialVisitEligible` for accessible
  onboarding stages.
- Existing-member sign-in still redirects to `/home`.
- Protected action, device-connect, computer-handoff, integration-connect, and
  data-privacy resume URLs keep their current precedence.
- Focused regression coverage and the required web verification/review gates
  pass.

## Scope

- In scope: the shared hosted auth completion redirect and its focused component
  tests.
- Out of scope: member-creation eligibility, Privy authentication, home-dialog
  rendering, onboarding state, and unrelated auth or navigation refactors.

## Constraints

- Keep the server-derived eligibility flag authoritative.
- Reuse the canonical hosted app route constants.
- Do not weaken authenticated re-verification or protected-URL resume behavior.

## Tasks

1. Add a focused failing regression for a new member completing shared-dialog
   sign-up.
2. Route eligible accessible-stage completions through the canonical first-visit
   home path while retaining all existing branches.
3. Run focused and diff-aware verification plus the required coverage and
   frontend review passes.
4. Complete the scoped commit and PR review path.

## Decisions

- Fix the shared provider branch rather than changing server eligibility or home
  dialog behavior because the completion payload already carries the correct
  eligibility bit and only this caller discards it.
- Keep protected resume URLs ahead of the first-visit handoff so authentication
  does not strand device-connect or other user-critical continuation flows.

## Verification

- Regression-first focused component test failed on the old `/home` behavior,
  then passed after the redirect fix.
- Focused auth-provider suite passed: 8 tests.
- Hosted Web TypeScript 7 typecheck passed.
- Truthful diff verification passed: dependency/workspace/hosted guards, 5,222
  Web tests with 140 skips, lint with zero errors, development smoke, and the
  production Next.js build.
- The required coverage-write pass strengthened device-connect precedence for
  an eligible first-visit payload; its focused rerun passed all 8 tests.
- The required frontend review found no evidence-backed UX, accessibility,
  responsive, or design-system issues. The change has no visual/layout surface.
- Parent scope, call-path, diff, and invariant review found no unresolved issue.
- A live provider-backed Telegram signup replay remains a manual verification
  gap; the component boundary and full Web verification cover the changed code.
Completed: 2026-07-15
