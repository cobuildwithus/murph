# Enable explicit group-room model selection

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let an authenticated Murph group room read and explicitly change the
  synthetic room assistant's model for the next accepted turn without exposing
  or mutating any participant's private assistant configuration.

## Success criteria

- Accepted user-sourced group turns receive the room-scoped
  `murph.assistant_configuration` tool.
- The room may choose Luna, Terra, or Sol while provider and reasoning remain
  fixed to OpenAI and `low`.
- The synthetic thread-container member remains the sole durable room owner:
  null keeps the relation-derived Sol default and Luna/Terra are explicit
  overrides.
- Private-chat eligibility and preference behavior remain unchanged.
- Focused tests, affected-owner typechecks, required product review,
  preliminary specialist review, exact-head CI, and final ReviewGPT all pass.

## Scope

- In scope: assistant-engine tool exposure/execution, hosted-web preference
  resolution/write behavior, focused regression coverage, and the owning
  hosted-configuration product specification.
- Out of scope: group provider or reasoning controls, participant preference
  reads, new persistence, schema changes, UI settings, automatic model changes,
  and runtime thread replacement.

## Constraints

- Technical constraints: reuse the existing synthetic `HostedMember` and
  accepted-input-bound callback; keep the current turn immutable and apply the
  saved target only at the next invocation boundary.
- Product/process constraints: preserve group privacy and authority invariants;
  use the guarded worktree/PR lane; apply the prompt and coverage specialist
  lenses, product-experience review, final ReviewGPT, exact-head CI, and
  merge-ready preflight.

## Risks and mitigations

1. Risk: a group turn could mutate a participant's private settings or weaker
   group routing could authorize a room write.
   Mitigation: advertise only the room schema on authenticated accepted group
   input, bind updates to the current accepted assistant input, and keep the web
   callback owner on the synthetic thread-container member.
2. Risk: default-value persistence could collapse the personal Terra default
   and group Sol default into one meaning.
   Mitigation: derive the clearing default from member kind and prove both
   storage outcomes.
3. Risk: the provider-visible tool schema could disclose or accept personal
   provider/reasoning fields in a group.
   Mitigation: use a distinct room schema and retain execution- and web-layer
   rejection coverage.

## Tasks

1. [x] Inspect and apply the supplied patch against current `origin/main`.
2. [x] Review the complete authority, persistence, and next-turn data path; adapt
   only where current code or invariants require it.
3. [x] Run focused tests, affected-owner typechecks, and direct prompt/tool proof.
4. [ ] Run the product-experience lens and resolve accepted findings.
5. [ ] Commit, push, open the PR, and run the preliminary
   product-experience/prompt/coverage
   specialist pass concurrently with exact-head CI.
6. [ ] Complete parent review and verification, close this plan, then run final
   ReviewGPT and the exact-head merge-ready preflight.
7. [ ] Merge the green PR and retire the clean inactive task worktree.

## Decisions

- Use the existing nullable model preference on the synthetic thread-container
  member; do not add a group-settings owner or migration.
- Keep group provider and reasoning fixed rather than broadening the personal
  configuration contract.

## Verification

- Commands to run: focused Vitest files for assistant-engine and hosted web;
  affected package/app typechecks; provider-input impact measurement; PR
  exact-head preflight; required GitHub Actions; preliminary specialist
  ReviewGPT; final ReviewGPT.
- Expected outcomes: group-only schema and accepted-input gating are proven;
  Luna/Terra/Sol persistence and Sol-default clearing are proven; personal
  behavior is unchanged; all required exact-head gates are green.
- Focused results:
  - Hosted-web preference tests: 23 passed.
  - Assistant configuration tests: 13 passed.
  - Assistant planning tests: 71 passed.
  - Pinned Codex group model-switch scenario: 1 passed.
  - Assistant-engine and hosted-web typechecks: passed.
  - Complete provider input capture using pinned Terra code mode and
    `gpt-tokenizer` 3.4.0 `o200k_base`: personal 58,365 bytes / 13,418 tokens
    at base and head; group 56,669 bytes / 13,022 tokens at base and 57,791
    bytes / 13,294 tokens at head. The +1,122-byte / +272-token group delta is
    entirely the generated `additional_tools` item.
