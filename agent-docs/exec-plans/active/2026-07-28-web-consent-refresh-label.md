# Web consent refresh label

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep the dashboard consent dialog's accepted handoff state readable inside its existing primary button at narrow and wide viewports.

## Success criteria

- The accepted handoff uses a concise loading label that fits the existing button constraint.
- The button remains disabled and exposes its existing busy state while the dashboard reload handoff is pending.
- Consent authority, persistence, retry, routing, and reload behavior remain unchanged.
- The production component, design-catalog study, focused regression, canonical verification, and required frontend reviews agree on the final state.

## Scope

- In scope: the dashboard consent gate's accepted pending label, its existing design-catalog study, and focused assertions.
- Out of scope: consent APIs, document versions, state ownership, retry behavior, dashboard reload timing, dialog layout, and shared button sizing.

## Constraints

- Reuse the existing `HostedLegalConsentCard` pending-label seam.
- Prefer a copy correction over layout or shared-component changes.
- Preserve unrelated working-tree work.

## Tasks

1. Prove the overflow cause from the production component and shared button constraint.
2. Replace the dashboard-specific pending label with concise existing-pattern copy.
3. Update the existing design-catalog study and focused regression.
4. Run focused and canonical verification plus desktop/mobile catalog proof.
5. Complete required product, Claude, and preliminary ReviewGPT reviews.
6. Commit, open the PR, verify CI and mergeability, then close the plan for handoff.

## Decisions

- Keep the current button width and state model; the dashboard-specific label is the only oversized element.
- Use `Refreshing...`, matching the component's existing `Saving...` and `Continuing...` pending-copy pattern.

## Verification

- Focused Vitest: 1 file passed, 8 tests passed.
- Canonical `pnpm test:diff` passed, including the full hosted-web suite,
  typecheck, lint, development smoke check, and production build.
- Frontend design-proof guard: 10 tests passed.
- Production-component catalog proof passed at 1440×1000 desktop and 390×844
  mobile viewports; the accepted handoff label was visible, disabled, and
  `aria-busy="true"` without overflow.
- Product-experience review: no findings and no evidence gaps.
- Claude Fable UI review: blocked by explicit usage-credit exhaustion.
- Preliminary ReviewGPT specialist pass: pending on the pushed PR head.
