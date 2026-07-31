# Flatten Habitat to one disclosure level

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Remove nested disclosure from expanded Habitat categories while keeping the
  targets-first hierarchy and compact default page.

## Success criteria

- One click opens all category detail; no nested `details` remain.
- Targets stay primary; setup/equipment and facts form a clearly secondary
  region.
- The clickable category summary has an intentional hover state.
- Desktop/mobile and keyboard behavior remain accessible.

## Scope

- Expanded category composition, summary hover treatment, and focused tests.

## Constraints

- No client state or dependency; preserve direct scoring and unrelated files.

## Verification

- Focused Habitat tests: 17/17 passed. DOM proof enforces eight closed outer
  disclosures and zero nested disclosures, with 3 scene and 5 equipment panels.
- Focused ESLint, Impeccable detector (`[]`), and `git diff --check`: passed.
- Browser QA: desktop and 390 px mobile expanded states verified without runtime
  errors; one Enter press exposed the full category and the browser confirmed
  zero descendant `details`.
- Required coverage-write and fresh frontend review found no issues; final
  frontend verdict was P0/P1/P2/P3 = 0.
- Full apps/web typecheck remains blocked by the unrelated existing
  `src/components/dashboard/sidebar.tsx:329` `string` to `never` error.
Completed: 2026-07-10
