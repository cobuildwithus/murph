# Align Habitat category summary columns

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Keep category name, target score, coverage, and status on identical desktop
  column tracks regardless of badge content.

## Scope

- Desktop grid template in `environment-components.tsx` and focused proof.

## Verification

- Runtime geometry at 1440 px: all eight category rows resolve to identical
  column starts `[337, 699, 879, 1099]`.
- Runtime geometry at 1024 px: sampled rows resolve to identical starts
  `[337, 563, 689, 835]`; `scrollWidth` equals the 1024 px viewport.
- Focused tests: 17/17 passed. Focused ESLint, Impeccable detector (`[]`), and
  `git diff --check`: passed.
- Required frontend review found P0/P1/P2/P3 = 0. Coverage review correctly
  retained browser geometry as the proof instead of adding a brittle class
  assertion.
Completed: 2026-07-10
