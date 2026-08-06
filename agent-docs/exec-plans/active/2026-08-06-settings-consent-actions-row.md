# Keep connected-source and consent actions in one responsive row

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Keep the active health-data source-management and consent-withdrawal actions
  on one compact responsive row so the Settings surface no longer reads as two
  vertically stacked buttons.

## Success criteria

- The active state shows a concise source-management link and `Withdraw consent`
  in the same horizontal action group at phone and desktop widths.
- The withdrawal confirmation, pending, error, and revocation behavior are
  unchanged.
- Paused, not-enabled, and unavailable states retain their current actions and
  behavior.
- The real component remains represented in the `/design?tab=components`
  catalog and has legible desktop/mobile proof.
- Focused tests, Web typecheck/lint, required review gates, and exact-head CI
  pass.

## Scope

- In scope:
  - Active-state layout and concise source-action copy in
    `HostedHealthDataConsentControl`.
  - Focused component regression coverage.
  - A meaningful responsive update to the existing design-catalog study.
- Out of scope:
  - Consent API behavior, persistence, authorization, or confirmation copy.
  - Paused, not-enabled, and unavailable state redesigns.
  - New components, dependencies, menus, cards, or state owners.

## Constraints

- Technical constraints:
  - Reuse the existing Base UI-backed shadcn `Button` and semantic Tailwind
    tokens.
  - Preserve at least a 40px touch target without horizontal overflow at 320px.
- Product/process constraints:
  - Source management remains the normal action; consent withdrawal remains a
    quieter destructive account action.
  - Preserve the flat Settings list and the existing withdrawal confirmation.
  - Use the isolated frontend PR lane with catalog proof and specialist review.

## Risks and mitigations

1. Risk: The two labels overflow at narrow phone widths.
   Mitigation: Shorten only the source-action label to `Manage sources`, keep
   compact shared sizing, and verify at 320px and 390px.
2. Risk: Layout work accidentally changes consent behavior.
   Mitigation: Restrict production changes to rendered structure/classes/copy
   and retain the existing component interaction tests.

## Tasks

1. Refactor the active-state actions into one compact responsive row.
2. Update focused tests and the existing design-catalog study.
3. Run focused checks and desktop/mobile browser proof.
4. Commit, push, open the PR, and complete required ReviewGPT, Claude UI, CI,
   final-review, merge, and worktree-retirement gates.

## Decisions

- Use one inline action group rather than a menu, new card, or hidden danger
  control.
- Keep the active-state source action first in reading order and the withdrawal
  action visually quiet.

## Verification

- Commands to run:
  - Focused Vitest for `hosted-health-data-consent-settings.test.tsx`.
  - `pnpm --dir apps/web typecheck` and `pnpm --dir apps/web lint`.
  - `pnpm test:frontend-design-proof`.
  - Browser checks at 320px, 390px, and desktop catalog widths.
  - Required exact-head CI plus preliminary frontend/coverage ReviewGPT and
    Claude UI double-check.
- Expected outcomes:
  - The active action group stays horizontal without overflow and all existing
    consent behavior remains green.
