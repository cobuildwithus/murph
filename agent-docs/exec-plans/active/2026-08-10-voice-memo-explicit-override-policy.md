# Voice memo explicit override policy

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the configured running-turn voice authoritative for ordinary generated
  voice memos while preserving a named one-off voice only for an explicit
  current-user request to test or send that named voice.

## Success criteria

- The canonical prompt and model-facing tool contract state the same default
  and explicit-request exception without implying that Murph may choose a
  one-off voice on its own.
- The same-turn save-and-hear flow remains supported for an explicitly named
  roster voice.
- Focused tests cover ordinary defaulting and the explicit named exception.
- The product contract matches the implemented precedence rule.
- The exact pushed PR head passes focused local proof, required CI, and the
  routed ReviewGPT gates.

## Scope

- In scope: assistant system-prompt guidance, the generated voice-memo dynamic
  tool contract, focused tests, and the voice product contract.
- Out of scope: voice provider configuration, preference persistence,
  delivery transport, heuristic transcript parsing, and new durable state.

## Constraints

- Technical constraints: preserve the existing running-turn preferred voice
  resolution and the explicit roster override capability; use the smallest
  code-owned policy surface.
- Product/process constraints: do not reproduce private production evidence in
  repository artifacts; route this prompt-primary, product-visible change
  through a worktree PR and the preliminary product/prompt/coverage ReviewGPT
  lenses.

## Risks and mitigations

1. Risk: wording-only changes leave contradictory contract surfaces.
   Mitigation: update the system prompt, dynamic tool description/schema, tests,
   and durable product contract together.
2. Risk: tightening the default accidentally removes explicit voice previews.
   Mitigation: retain and test named current-user requests, including same-turn
   save-and-hear.

## Tasks

1. Obtain and inspect the requested ReviewGPT implementation patch.
2. Apply only the scoped, architecture-compatible changes and add any missing
   focused proof.
3. Run focused tests and typecheck for the changed package surfaces.
4. Commit and push the candidate, open the PR, and run the exact-head
   preliminary ReviewGPT pass concurrently with required CI.
5. Resolve findings, perform the parent final review, close this plan, and
   prove mergeability.

## Decisions

- Treat the production report as evidence for the existing override boundary,
  not as repository-ready fixture content.
- Do not add runtime request-text heuristics or new authorization state for a
  model-facing conversational policy.

## Verification

- Commands to run: focused assistant-engine voice-memo, prompt, and model
  behavior tests; the relevant package typecheck selected from the testing map;
  exact-head CI and preliminary ReviewGPT.
- Expected outcomes: ordinary calls omit a named voice and use the running-turn
  configuration; explicit named requests keep the one-off roster path; all
  contract assertions and type checks pass.
