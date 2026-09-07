# Message Murph from completed Home setup

## Objective

Replace Home’s completed-onboarding text heading with a Message Murph button that shares the sidebar contact action.

## Scope and journeys

- Preserve remaining onboarding cards, absence of experiments, and load/error states.
- Reuse the sidebar’s connected-channel routing and picker, settings fallback, and sign-in dialog.
- Preserve sidebar presentation and wording; use the page’s existing primary button style on Home.
- Inspect the real completed state at phone and desktop widths and exercise the picker and keyboard focus.

## Progress

- [x] Trace the existing text-only empty state and sidebar contact owners.
- [x] Share contact action and wire Home’s empty-state action slot.
- [ ] Run focused tests, typecheck, lint, and rendered proof.
- [ ] Review the candidate, prepare changelog and PR evidence, and ship through required checks.

## Validation

Pending focused verification. Product UX: Hold until interaction and rendering checks pass.
