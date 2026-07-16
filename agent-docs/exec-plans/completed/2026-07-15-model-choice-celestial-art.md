# Model choice celestial art

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Reduce the model-card copy and make Luna, Terra, and Sol feel distinct through
  a simple moon, earth, and sun visual progression.
- Present the models as an increasing health-intelligence ladder and carry each
  celestial identity color consistently through hover and selection.
- Keep the artwork reusable in the production settings control and the live
  design-system example without changing model behavior.

## Success criteria

- Luna, Terra, and Sol use increasingly large gray, blue/green, and yellow
  inline SVG circles that remain quiet enough for readable controls.
- Card copy is reduced to one short purpose line plus the usage cue.
- Hover and selected states use accessible gray, blue-green, and gold accents
  that match the corresponding artwork.
- Selection, locked, current, focus, and accessible radio descriptions remain
  intact on desktop and mobile.
- Focused tests, scoped verification, frontend review, and coverage review pass.

## Scope

- In scope: choice-card artwork support, one assistant-model SVG component,
  shorter settings/design example copy, tests, and matching design guidance.
- Out of scope: model eligibility, persistence, API contracts, billing, or
  runtime model behavior.

## Verification

- Focused assistant-model settings tests.
- `pnpm test:diff` for the changed web surfaces.
- Live `/design?tab=components` inspection and required completion audits.
Completed: 2026-07-15
