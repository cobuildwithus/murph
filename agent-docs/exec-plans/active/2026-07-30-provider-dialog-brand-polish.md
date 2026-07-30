# Polish the assistant provider dialog

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make the assistant provider choice easy to scan while keeping the compact
  settings summary and save-gated provider behavior unchanged.

## Success criteria

- Show approved OpenAI and Venice vector marks in a light, compact choice
  layout.
- Describe Venice as the privacy-first provider without implying a privacy mode
  or retention guarantee that the settings control does not own.
- Explain in smaller supporting copy that image generation, voice, search, and
  other specialized tools continue using their specialized providers.
- Keep selection, dismissal, read-only behavior, and deferred persistence
  unchanged.
- Keep the production component represented in the design catalog and pass the
  required focused frontend checks, rendered proof, reviews, exact-head CI, and
  PR gate.

## Scope

- In scope: provider-dialog presentation and copy, provider logo assets,
  focused component tests, and the existing design-catalog study.
- Out of scope: model cards, provider persistence or availability, runtime
  routing, billing upgrade behavior, and specialized-tool provider selection.

## Constraints

- Use provider-approved artwork without redrawing or modifying the marks.
- Preserve unrelated open work that touches the settings component.
- Add no new dependency, state owner, persistence path, or provider
  abstraction.

## Tasks

1. Add the approved light-surface provider vectors.
2. Refine the dialog hierarchy, choice rows, privacy-first description, and
   specialized-provider note.
3. Update focused tests and the existing design-catalog presentation.
4. Capture desktop and mobile rendered proof and run required local checks.
5. Resolve the required product/frontend/coverage reviews, then commit, push,
   open the PR, and complete exact-head review and CI.

## Verification

- Focused hosted assistant model settings tests.
- Web typecheck and lint for the changed component, catalog, and test.
- Frontend design-proof checks.
- Desktop and mobile dialog screenshots with interaction and keyboard checks.
- Required product-experience review, preliminary ReviewGPT specialist pass,
  parent final review, and exact-head PR CI/review gate.
