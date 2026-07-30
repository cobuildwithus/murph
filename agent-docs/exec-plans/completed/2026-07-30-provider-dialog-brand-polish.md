# Polish the assistant provider dialog

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make the assistant provider choice easy to scan while keeping the compact
  settings summary and save-gated provider behavior unchanged.

## Success criteria

- Show approved OpenAI and Venice vector marks in a light, compact choice
  layout.
- Describe Venice as privacy-first through the bounded provider-layer fact that
  Venice stores no prompts or replies, without implying E2EE, TEE, or broader
  upstream retention or training behavior that the settings control does not
  own.
- Explain in smaller supporting copy that image generation, voice, search, and
  other specialized tools continue using their specialized providers.
- Keep selection, dismissal, read-only behavior, and deferred persistence
  unchanged.
- Keep the production component represented in the design catalog and pass the
  required focused frontend checks, rendered proof, reviews, exact-head CI, and
  PR gate.

## Scope

- In scope: provider-dialog presentation and copy, provider logo assets,
  focused component tests, the existing design-catalog study, and the bounded
  product/security disclosure that supports the privacy copy.
- Out of scope: model cards, provider persistence or availability, runtime
  routing, billing upgrade behavior, and specialized-tool provider selection.

## Constraints

- Use provider-approved artwork without redrawing or modifying the marks.
- Preserve unrelated open work that touches the settings component.
- Add no new dependency, state owner, persistence path, or provider
  abstraction.

## Tasks

1. Add the approved light-surface provider vectors.
2. Refine the dialog hierarchy, choice rows, bounded Venice privacy
   description, and specialized-provider note.
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

## Review notes

- The first preliminary specialist attempt was invalid because the guarded
  audit bundle omitted the applicable current product specification.
- The full audit packager now scans current product specifications, with
  focused package-level proof that the provider-choice specification is
  present.
- The corrected preliminary pass accepted the frontend and coverage proof but
  found that generic "privacy-first routing" copy was not bounded by the
  canonical product/security contract. The remediation replaces it with the
  exact Venice-layer no-storage disclosure documented by Venice, while
  explicitly excluding model-level E2EE, TEE, and broader upstream guarantees.
- Parent product-experience revalidation found no remaining finding. The
  irreducible purpose is to let a member recognize and choose the core reply
  provider with a truthful privacy distinction and a clear specialized-tool
  boundary; the summary, one `Change` action, two immediate draft choices, and
  existing `Save` boundary are the smallest complete experience. Refreshed
  desktop and mobile rendered proof covers both provider states, the corrected
  disclosure, dialog containment, close/reopen draft retention, and the
  specialized-provider note.
- Open pull requests touching the settings component, hosted-plan
  specification, or security guide were checked before remediation; their work
  is unrelated billing, group-model, or trust-boundary work rather than a
  duplicate provider-dialog change.

## Completion evidence

- The focused provider-settings suite passes all 18 tests.
- Web typecheck, scoped ESLint, all 10 frontend design-proof checks,
  `git diff --check`, and the audit-packager suite all pass; the latter has 40
  passing tests and one intentional skip.
- Playwright rendered the real catalog component at 1440×1000 and 390×844.
  OpenAI is selected on desktop; mobile selection closes the dialog and
  preserves Venice after reopening. The settled dialogs measure 432×352 and
  358×388 respectively, with no horizontal overflow.
- The refreshed screenshots were visually inspected and uploaded through the
  repository's design-proof path for the PR.
- The optional Claude/Fable UI double-check was attempted and stopped at
  explicit usage-credit exhaustion; no result is claimed.
- Final parent review of the rebased base-to-head diff found no remaining
  correctness, privacy, product-experience, frontend, coverage, or scope
  finding. The separate exact-head ReviewGPT gate and GitHub Actions remain the
  PR merge gates.
Completed: 2026-07-30
