# detailed-product-feedback

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make assistant-captured product feedback specific enough for later triage to
  understand the requested behavior without reopening the private conversation.

## Success criteria

- Feedback guidance requires concrete product actors, workflow/context,
  expected behavior, observed/requested outcome, and uncertainty when relevant.
- Guidance forbids vague inferred labels and invented interpretation while
  preserving the existing product-only privacy boundary.
- Focused prompt tests prove the new summary-quality contract.
- Required prompt/product/coverage review and exact-head CI complete.

## Scope

- In scope: assistant feedback tool description, feedback-capture prompt
  guidance, managed feedback automation guidance, and focused tests.
- Out of scope: database schema changes, longer summaries, raw conversation
  retention, feedback-table mutation, or a feedback-management UI.

## Constraints

- Technical constraints: retain the existing bounded summary contract and
  best-effort asynchronous persistence behavior.
- Product/process constraints: never store raw wording, health details,
  identifiers, contact details, secrets, or provider payloads.

## Risks and mitigations

1. Risk: Greater detail could cause raw or sensitive conversation content to
   leak into stored summaries.
   Mitigation: require product-only abstractions and explicitly preserve every
   existing privacy exclusion.
2. Risk: The model could invent specificity when the source is ambiguous.
   Mitigation: require uncertainty to remain explicit and forbid replacing
   missing details with inferred labels.

## Tasks

1. Inspect every feedback-capture instruction surface and existing tests.
2. Add one consistent summary-quality rule at the smallest ownership points.
3. Add focused regression assertions and run prompt/package verification.
4. Commit, push, open a PR, and complete required specialist review and CI.

## Decisions

- Keep the 500-character storage limit; the defect is lossy summarization, not
  insufficient storage.
- Do not add persisted fields or a new feedback taxonomy.

## Verification

- Commands to run: focused assistant-engine feedback/model-behavior tests,
  package typecheck if routed, prompt readback, and `git diff --check`.
- Expected outcomes: all checks pass and the assembled instructions preserve
  specificity without weakening privacy.
