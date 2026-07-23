# Mobile settings and onboarding layout polish

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the mobile Family manager and Murph customization drawers fit naturally on a phone without horizontal clipping, short sheets, or redundant voice metadata.

## Success criteria

- Family members and pending invites render as readable, actionable cards on mobile while preserving the desktop table layout.
- The contact-card and personality pickers use the full mobile viewport height, matching the existing voice picker.
- The voice picker keeps its current left-aligned subtitle but no longer renders a voice count or elapsed/duration label.
- Focused component tests, canonical diff verification, responsive browser proof, and required frontend completion reviews pass.

## Scope

- In scope: responsive presentation for hosted Family rows; mobile contact-card and personality drawer height; voice-picker count and duration presentation; focused regressions.
- Out of scope: Family billing or invitation behavior, voice playback behavior, saved customization semantics, desktop redesign, and shared drawer defaults.

## Constraints

- Technical constraints: preserve one explicit data/action path for mobile and desktop; keep the shared voice player duration-visible by default; avoid shared primitive changes when a local class is sufficient.
- Product/process constraints: preserve Murph's existing warm product register, accessibility semantics, safe-area footer spacing, and exact settings behavior.

## Risks and mitigations

1. Risk: responsive table styling could harm native table layout on larger screens.
   Mitigation: scope card display utilities below the `md` breakpoint and retain table display utilities at `md` and above.
2. Risk: hiding voice duration could also hide playback errors.
   Mitigation: hide time metadata only and continue rendering the unavailable label when playback fails.
3. Risk: full-height sheets could place actions behind mobile browser chrome.
   Mitigation: use `dvh`, remove bottom-sheet top spacing/rounding, and retain safe-area-aware footer padding.
4. Risk: long unbroken invite identifiers could recreate horizontal overflow in the card or desktop table.
   Mitigation: allow the secondary identifier to break at arbitrary points and use fixed desktop table layout; prove containment at 320px, 390px, and the 768px breakpoint.

## Tasks

1. Add responsive Family card presentation without duplicating member or invite behavior.
2. Make contact-card and personality drawers full-height on mobile.
3. Remove count and time metadata from the voice picker while preserving player errors.
4. Add focused regressions and run canonical verification.
5. Capture responsive browser evidence and complete required product, Claude, and ReviewGPT reviews.
6. Commit, open the PR, verify CI and mergeability, then close this plan for handoff.

## Decisions

- Reuse the semantic table rows as CSS grid cards below `md` instead of adding a duplicate mobile renderer.
- Keep the voice player's existing default everywhere else and add a narrow opt-out for this picker.
- Preserve the already-landed left-alignment in both voice and personality headers without adding redundant layout code.
- Add read-only Family and non-persisting Personality fixtures to the existing design component catalog, as required by the frontend design-proof gate.
- Resolve the preliminary frontend finding with local content containment rather than restoring a page-level horizontal scroller.

## Verification

- Focused Vitest: 5 files and 62 tests passed; the Family remediation file passes 20 tests. Scoped lint and web typecheck pass.
- Canonical `pnpm test:diff`: passed workspace guards, typecheck, 490 test files with 6,142 tests, lint with zero errors, dev smoke, and production build.
- Playwright: desktop and mobile design states passed; long Family label/email containment passed at 320px, 390px, and 768px with document and surface `scrollWidth <= clientWidth` and contained, enabled actions.
- Product experience review: passed with no findings. Preliminary specialists returned one valid Family overflow finding; it is fixed and directly proven. Fable UI review was attempted and reported exhausted usage credits.
- Current evidence gap: the GitHub design-proof check still needs hosted attachment URLs for the completed Playwright screenshots.
