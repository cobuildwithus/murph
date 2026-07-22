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

## Verification

- Commands to run: focused Vitest files for Family, voice player, style picker, contact-card picker, and personality picker; `pnpm test:diff`; responsive in-app browser checks; applicable completion review commands; PR CI and merge-tree proof.
- Expected outcomes: mobile controls fit the viewport without horizontal scrolling or duration overflow; desktop presentation and all settings mutations remain unchanged; all required checks and reviews pass.
- Current evidence gaps: no browser backend is attached to this session, so required design-page screenshots remain blocked; the Fable UI review was attempted and reported exhausted usage credits.
