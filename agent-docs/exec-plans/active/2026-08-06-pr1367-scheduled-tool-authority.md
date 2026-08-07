# PR 1367 Scheduled Tool Authority Corrections

## Outcome

Publish a corrected PR candidate in which an exact scheduled automation
occurrence can use only the existing capabilities that its route, audience, and
owner authorize, without fabricating an assistant-input identity or weakening
message-bound effects.

## Protected invariants

- Accepted-message identity and scheduled-occurrence authority remain distinct.
- Scheduled effects reuse existing owners, causal ordering, idempotency, and
  retry boundaries.
- Channel, audience, group, and verified-human restrictions remain authoritative.
- Scheduled turns cannot create ordinary product feedback or a delivery-linked
  feedback obligation.
- Scheduled Clinical Records delivery does not create or rotate an intent; the
  existing one-live, short-lived claim begins only after the member opens the
  authenticated launcher as current human action.
- No new durable state owner, queue, scheduler, migration, dependency, or
  compatibility layer is introduced.

## Evidence and implementation sequence

1. Compare the existing PR patch with current owner contracts and the supplied
   second-pass findings.
2. Replace synthetic assistant-input identity with a typed accepted-input or
   exact-occurrence invocation scope.
3. Correct personalization, Clinical Records, physical-note, support, and
   feedback behavior at their existing ownership boundaries.
4. Add focused regression coverage and align durable architecture, security,
   reliability, and product-owner documentation.
5. Run focused local proof and inspect the full base-to-head diff.
6. Push the corrected draft head, update the PR intent contract, and run the
   preliminary specialist and final ReviewGPT gates concurrently with CI.
7. Resolve accepted findings, complete parent final review, archive this plan,
   and leave the draft PR on a clean, mergeable, exact reviewed head.

## Verification

- Focused assistant-engine, hosted-execution, Cloudflare, and Web owner tests.
- Touched-owner typechecks or the narrowest truthful diff-aware lane.
- `git diff --check` and privacy/identifier review.
- Exact-head required GitHub Actions.
- Preliminary `completion-specialists` ReviewGPT pass with product-experience
  and coverage lenses.
- Final `pr-review` ReviewGPT loop through `ROUND_OUTCOME: PASS`.

## Review evidence

- The preliminary specialist pass required a production-faithful scheduled
  image-to-delivery scenario and clearer saved-instruction authority for
  response cards. Both are covered in the candidate; the proposed removal of
  scheduled cards was rejected because explicit private-direct scheduled card
  requests are intended product behavior.
- Final ReviewGPT round 1 found three correctness gaps: delayed scheduled
  preferences could overwrite newer state, queue-only feedback could be lost or
  accepted at the wrong boundary, and Clinical Records created a short-lived
  intent before scheduled delivery. The candidate corrected the Clinical Records
  launcher and added initial scheduled preference and feedback ordering.
- Final ReviewGPT round 2 showed that callback sequence still could outrank a
  logically later accepted input and that invocation-local feedback staging could
  not survive a later durable outbox retry. The required retrospective was posted
  on the PR. Its continue-with-redesign decision replaces the sequence watermark
  with one owner-shared `(occurredAt, source causal sequence)` order and deletes
  scheduled ordinary feedback eligibility instead of adding another durable state
  or delivery owner. Focused proof covers both preference callback orders,
  Settings/event ordering, and scheduled feedback unavailability.
- Final ReviewGPT round 3 found that Web's accepted source ordering could still
  be undone when runtime applied raw source sequences, that the Clinical Records
  launcher did not survive sign-in or transient intent-creation failure safely,
  and that feedback authority retained an unnecessary wrapper. The candidate now
  appends only Web-approved sparse preference fields and applies them in approved
  event order, propagates exact provider tool-call identity for distinct same-turn
  commands and replay dedupe, makes the exact launcher resumable and retryable while
  staging the claim in the existing private browser-history owner, and restores the
  accepted-input id list as the feedback boundary.
- Focused owner suites pass, including 278 assistant-runtime phase tests and a
  Strict Mode launcher replay test. The full-stack scheduled-image scenario
  observed the expected image upload, attachment, and Linq delivery, then timed
  out waiting for global runtime quiescence during repeated local database-pool
  pressure after the asserted send.
- The provider-visible request remains within the measured input budget. Exact
  deterministic rerendering of the three amended descriptions on the captured
  requests yields 133,078 bytes for individual scheduled Murph (+0.3590%) and
  105,212 bytes for group scheduled Murph (+0.1828%) versus base. Exact model
  token totals remain unavailable because the pinned local provider does not
  expose tokenizer usage for the selected model.
