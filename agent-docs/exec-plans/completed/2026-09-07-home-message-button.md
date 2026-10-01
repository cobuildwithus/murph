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
- [x] Run focused tests, typecheck, lint, and rendered proof.
- [x] Review the candidate and prepare changelog and PR evidence for the required CI gates.

## Validation

Product UX: Ready. Reviewed the completed state and shared picker at 390px and 1440px. Browser proof passes for Enter activation, connected-channel destinations, Escape dismissal, and focus return. Existing onboarding card layout proof passes across dashboard widths.

Focused Home, sidebar, contact action/dialog, and changelog suites pass (77 tests across seven suites). Web typecheck passes. Web lint has zero errors and 47 pre-existing warnings; changed-file lint is clean. The complexity guard passes; HomePage’s existing complexity remains 28.

The first browser test attempt left an inert ancestor in place; the second completed mobile interaction but attempted a redundant fragment navigation before desktop. Corrected the test setup without changing production behavior; final browser proof passes.

Candidate review confirmed the existing request-cached contact context, channel resolver, settings/sign-in fallback, consent requirement, sidebar appearance, and external-link semantics are preserved. No new messaging or auth policy is introduced. Final ReviewGPT is exempt for this frontend presentation/interaction extraction.

PR #3026 owns remaining exact-head CI, merge, and automated Web release verification. The public design study remains inert and uses synthetic contact data.
Status: completed
Updated: 2026-09-07
Completed: 2026-09-07
