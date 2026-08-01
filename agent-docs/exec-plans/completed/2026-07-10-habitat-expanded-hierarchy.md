# Simplify expanded Habitat category hierarchy

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make an expanded Habitat category reveal one clear primary layer instead of
  showing targets, a large visual, and the full fact inventory at once.

## Success criteria

- Opening a category reveals targets first.
- The setup/equipment visual and secondary fact inventory each require an
  explicit nested disclosure.
- Target rows have a clear label/current/goal hierarchy without bullet styling.
- Keyboard and mobile behavior remain accessible and readable.

## Scope

- Expanded-state hierarchy in `environment-components.tsx` and focused Habitat
  tests.

## Constraints

- Keep native disclosure, direct-only scoring, current data model, and existing
  visuals; add no dependency or client state; preserve unrelated worktree data.

## Verification

- Focused Habitat tests: 17/17 passed; DOM proof covers eight outer, eight setup,
  and eight facts disclosures, all closed by default, including the 3 scene / 5
  equipment mapping.
- Focused ESLint, Impeccable detector (`[]`), and `git diff --check`: passed.
- Runtime QA: desktop and 390 px mobile states verified without runtime errors;
  outer, setup, and facts disclosures opened independently with Enter/Space.
- Full apps/web typecheck reached TypeScript and remains blocked by the unrelated
  existing `src/components/dashboard/sidebar.tsx:329` `string` to `never` error.
- Frontend-review findings were accepted: mobile target values now have visible
  Current/Goal labels and assistive labels; fact counts include the `items` unit.
- Fresh release review found no remaining P0, P1, or P2 issues.
Completed: 2026-07-10
