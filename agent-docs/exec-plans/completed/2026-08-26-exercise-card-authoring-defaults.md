# Simplify exercise routine card authoring

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Let Murph author the existing Telegram exercise-routine card without spelling
  absent optional text as explicit `null`, while making the required safety
  instruction short and unambiguous.

## Success criteria

- Omitted `footer` and `subtitle` authoring fields normalize to canonical nulls.
- Explicit invalid values still fail with bounded repair details.
- Safety remains required, scenario-specific, and bounded; no generic safety
  content is invented by the runtime.
- Deterministic boundary tests and one focused real-Codex journey prove a
  complete card, one successful attachment, and no duplicate final response.
- Package tests/typechecks, exact-head CI, and required review gates pass.

## Scope

- In scope: the exercise-card authoring JSON schema, input normalization, field
  guidance, focused deterministic tests, and one synthetic live journey.
- Out of scope: persisted card shape changes, renderer changes, image lookup
  changes, new card versions, new delivery behavior, and fallback state.

## Constraints

- Technical constraints: canonical cards still contain explicit nullable
  fields; normalization happens only at the dynamic-tool authoring boundary.
- Product/process constraints: Product UX effort is Patch. Outcome: existing
  Telegram routine requests stop failing on redundant null syntax. Reaches:
  direct and group Telegram routine-card turns. Proof: production-derived
  schema regression plus a synthetic production-builder live journey.

## Risks and mitigations

1. Risk: relaxing the authoring schema could weaken the durable card contract.
   Mitigation: keep the canonical contract unchanged and normalize before its
   existing strict parser.
2. Risk: defaulting safety content could create generic or unsafe guidance.
   Mitigation: keep safety required and add only a concise field constraint.
3. Risk: tool success could produce duplicate prose.
   Mitigation: assert one attachment and no final text in the live journey.

## Tasks

1. [x] Make only nullable presentation fields optional in the authoring schema and
   normalize omission to canonical nulls.
2. [x] Add deterministic schema/parser regressions and extend the focused live
   journey.
3. [x] Complete the live journey and Product UX walkthrough, then finalize the
   exact candidate for routed PR review, CI, and draft PR evidence.

## Decisions

- Prefer deletion of redundant model-authored nulls over adding another retry,
  fallback, or prompt state machine.
- Preserve required safety authorship because the runtime cannot derive an
  honest scenario-specific stop condition.

## Verification

- Commands to run: focused operator-config and assistant-engine Vitest slices,
  package typechecks, the named `test:assistant:live` journey,
  `git diff --check`, and routed PR checks/reviews.
- Expected outcomes: omitted optional fields produce the same canonical card,
  invalid explicit values remain rejected, the live journey attaches exactly
  one complete card, and all checks pass.
- Current result: operator-config tests passed 15/15; assistant response-card
  and turn-planning tests passed 125/125; package typechecks and
  `git diff --check` passed. The focused subscription journey passed all five
  attended Telegram, scheduled Telegram, Linq, plain-text, and presentation
  repair turns after its assertions were aligned with runtime-owned card text,
  scheduled private decisions, and explicit presentation requests. Product UX
  verdict is Ready. The changelog archive test passed 9/9 and the hosted Web
  typecheck passed for the public reliability note. Routed ReviewGPT and exact-
  head CI remain PR completion gates after this plan is archived into the final
  candidate.
Completed: 2026-08-27
