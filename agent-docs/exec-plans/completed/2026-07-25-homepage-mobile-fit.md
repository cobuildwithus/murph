# Homepage iPhone Mini responsive fit

## Outcome

Make the homepage feature cards feel composed and readable at 320–390px widths,
especially the newsletter, bloodwork, errands, and recovery examples shown in
the reported iPhone Mini screenshots, without changing their copy, behavior, or
desktop layout.

## Evidence

- The shared `WideFeature` keeps desktop-scale corner radii, vertical reserves,
  padding, and copy sizing on the smallest viewport.
- `BloodworkArtifact` keeps three independently sized columns on one row, which
  forces its label, value, unit, and delta into awkward wraps.
- `RecoveryArtifact` keeps three stat cards in one row at phone width, leaving
  too little room for labels and multi-part values.
- The affected production sections are absent from the reviewable sections
  catalog, so their narrow responsive states cannot be judged in isolation.

## Implementation

1. Tighten the shared mobile card shell, copy rhythm, and artifact padding while
   retaining the existing `sm` and `lg` composition.
2. Give dense bloodwork and recovery artifacts phone-first row layouts that
   expand back to their current compact grids above the smallest breakpoint.
3. Add the real production homepage sections to `/design?tab=sections`.
4. Add focused static regressions for the responsive class contract.

## Invariants

- Preserve all existing homepage copy, artifacts, ordering, and links.
- Keep the warm paper palette and current desktop two-column compositions.
- Do not add dependencies, runtime state, client behavior, or a second
  presentation component for the catalog.
- Keep the page free of horizontal overflow at the 320px reflow floor.

## Proof

- Focused homepage component tests.
- `pnpm test:frontend-design-proof`.
- Browser screenshots at 375px mobile and desktop widths on the design catalog,
  plus a direct homepage check at iPhone Mini width.
- Canonical `pnpm test:diff` or the required hosted-web verification lane.
- Required product, frontend, coverage, and second-model review gates.
Status: completed
Updated: 2026-07-25
Completed: 2026-07-25
