# Appointment memory reuse and browser recovery

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Reuse relevant canonical member facts before asking the member to repeat them.
- Route appointment check-in and intake through the existing appointment workflow.
- Keep browser execution moving through bounded, state-aware recovery before
  asking the member to take over.

## Product UX Patch

- Outcome: a private member can delegate an appointment administrative task and
  have Murph complete every authorized step it can, without repeat questions or
  premature browser handoff.
- Reaches: private appointment check-in, intake, booking, rescheduling,
  cancellation, waitlist, and related browser forms.
- Proof: prompt-contract tests, appointment-skill tests, and focused real-Codex
  journeys for ordinary control recovery and a legitimate safety stop.

## Scope

- In scope: the base evidence-before-question rule, appointment skill routing
  and readiness language, browser blocker guidance, focused tests, and live
  model proof.
- Out of scope: a new member-data schema, storing sensitive identifiers in
  freeform memory, bypassing access controls, and changing browser runtime
  retry mechanics.

## Constraints

- Read only the relevant canonical source; do not preload the full memory file
  into every turn.
- Reusable evidence is not current permission to disclose it.
- Keep insurance identifiers, full addresses, credentials, and medical details
  out of freeform memory unless an existing structured owner explicitly owns
  them.
- A failed or unresponsive control is not yet a blocker. Re-inspect state before
  retrying, use a safe alternate path and OS fallback when appropriate, and
  refresh only when no side effect is unknown and user-entered state is safe.
- Never bypass CAPTCHA, access controls, sensitive-entry boundaries, or a real
  missing user choice.

## Tasks

1. Add the global evidence-before-question rule and align the browser blocker
   rule with the computer-use recovery contract.
2. Extend appointment scheduling semantics to check-in and intake while
   preserving disclosure and persistence boundaries.
3. Add deterministic prompt and skill coverage.
4. Add focused GPT-5.6 TERRA journeys for memory reuse plus ordinary-control
   recovery, and for the real safety-stop boundary.
5. Run focused verification and typecheck, inspect the privacy-sensitive diff,
   then push the exact candidate and run preliminary ReviewGPT concurrently
   with CI.

## Verification

- Focused Assistant Engine prompt and skill tests.
- Focused real-Codex TERRA journeys with inspected replies and tool traces.
- Assistant Engine typecheck and diff-selected verification.
- `git diff --check` plus direct-identifier scan and manual diff inspection.
- Exact-head CI and preliminary Product UX, prompt, and coverage ReviewGPT.

## Progress

- Implemented the evidence-before-question rule, appointment check-in and
  intake routing, bounded browser recovery, and canonical persistence boundary.
- Focused deterministic suite: 28 passed and 109 skipped.
- Assistant Engine typecheck: passed.
- Focused GPT-5.6 TERRA ordinary-control journey: passed after re-opening the
  current page and using a distinct recovery action without member handoff.
- Focused GPT-5.6 TERRA CAPTCHA journey: passed with one scoped pause, a fresh
  handoff URL, and no attempted bypass.
- Preliminary ReviewGPT at the first pushed candidate returned one high and two
  medium findings plus a SHA-identified direct-proof patch. The patch was
  downloaded through the authenticated artifact flow, verified, and applied.
- Review follow-up narrowed the global evidence rule, kept check-in identity
  fields destination-driven, permitted explicitly authorized one-time DOB use
  without storage, made appointment-skill routing explicit, and strengthened
  browser escalation proof.
- Additional focused GPT-5.6 TERRA journeys passed for a form that does not
  require DOB and for a DOB-required form where the member declines storage.
- Final direct/group first-request measurement against the base candidate: +132
  provider-visible tokens and +711 bytes in each representative initial
  request, with no tool-schema delta.
