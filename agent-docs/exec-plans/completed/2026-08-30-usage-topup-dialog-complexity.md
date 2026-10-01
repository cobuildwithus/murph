# Hosted usage top-up dialog complexity refactor

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce the cyclomatic complexity and review surface of the hosted usage top-up
  dialog without changing its billing authority, checkout contract, visible
  copy, supported states, or interaction behavior.

## Protected invariants

- The existing server routes remain authoritative for top-up options, amount
  validation, checkout creation, purchase status, and recovery.
- Existing loading, ready, submitting, success, recovery, and error behavior
  stays intact, including button disablement, focus/accessibility semantics,
  analytics behavior, and phone/desktop presentation.
- The refactor introduces no billing policy, dependency, generic framework,
  external effect, durable state, or new state owner.

## Evidence

- `HostedUsageTopUpDialog` currently owns request effects, derived readiness,
  event handlers, and every visual state in one large component with a measured
  baseline cyclomatic complexity of 198.
- Existing product-spec tests and the design catalog already own the user-facing
  top-up contract and reviewer-openable representation.

## Scope

- In scope: the hosted usage top-up dialog, direct presentational helpers, and
  focused tests needed to preserve its current contract.
- Out of scope: API routes, Stripe policy, price or credit values, checkout
  semantics, copy/design changes, analytics changes, and deployment changes.

## Product UX

- Effort: Patch.
- Outcome: members keep the same clear, recoverable credit-purchase experience
  while the implementation becomes easier to review and maintain.
- Reaches: the existing Settings top-up dialog on narrow phone and desktop,
  covering loading, loaded options, checkout submission, recovery, success,
  unavailable, and error states.
- Proof: focused contract/component tests plus a direct phone/desktop walkthrough
  of the repository-owned design representation show unchanged states and
  actions.

## Risks and mitigations

1. Risk: helper extraction changes request sequencing or stale-response fences.
   Mitigation: retain the component as the state/effect owner and extract only
   pure presentation or narrowly explicit event helpers.
2. Risk: the refactor duplicates authoritative amounts or purchase policy.
   Mitigation: continue deriving options and active purchase facts exclusively
   from the existing API responses.
3. Risk: conditional rendering changes accessibility or responsive layout.
   Mitigation: preserve DOM order, controls, labels, classes, and copy; inspect
   phone and desktop states through the existing design representation.

## Tasks

1. Read the current dialog, direct tests, design representation, billing owner,
   and required workflow/security guidance; record the baseline complexity.
2. Run the requested ReviewGPT implementation handoff, inspect its complete
   artifact as untrusted input, and accept only minimal behavior-preserving
   decomposition intent.
3. Refactor the dialog into small local sections/helpers while preserving one
   state/effect owner; add or adjust only focused characterization coverage.
4. Run focused billing/component tests, design proof, phone/desktop walkthrough,
   lint/typecheck, complexity measurement, and final diff/privacy review.
5. Finish the plan with a scoped commit, push the exact head, and open a draft
   PR with complete Murph evidence; leave completion review gates to the parent.

## Verification

- Commands to run: focused hosted usage top-up and billing settings tests; Web
  typecheck and focused lint; frontend design-proof checker; direct design-state
  walkthrough at phone and desktop viewports; source complexity measurement;
  `git diff --check` and privacy/reference inspection.
- Expected outcomes: all existing states and actions remain unchanged, checks
  pass, the target component's complexity decreases materially, and the draft
  PR contains no deployment or billing-policy change.

## Outcome

- `HostedUsageTopUpDialog` remains the only state, ref, and effect owner. Local
  pure derivation helpers and hook-free presentation sections now own the
  purchase, selection, recovery, and responsive render branches.
- The exact source counter reduced the component from cyclomatic complexity 198
  to 17; the largest extracted helper measures 26.
- Billing authority, offers, selected offer codes, request identity, stale
  response fences, checkout recovery, purchase status, analytics, copy, DOM
  order, accessibility semantics, and responsive classes remain with their
  existing owners and contracts.
- The requested managed review passes were intentionally omitted at the user's
  direction; the implementation was instead validated directly against the
  existing 101-case component contract and repository-owned design state.

## Completed evidence

- Passed: focused component ESLint.
- Passed: Web typecheck.
- Passed: hosted usage top-up component test, 101 tests.
- Passed: frontend design-proof checker, 12 tests.
- Passed: repository-owned group sponsorship dialog walkthrough in Chromium at
  desktop and phone viewports.
- Passed: exact complexity counter and `git diff --check`.
- Partial: `test:diff` passed workspace guards and reached the Web verifier; its
  Web lane was stopped after waiting behind another checkout's exclusive shared
  host slot. The scoped Web checks above remain the direct verification record.
Completed: 2026-08-30
