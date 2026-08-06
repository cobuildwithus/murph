# first-contact-fast-welcome

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Reduce the first fresh onboarding turn's provider latency by turning the
  56-KB Murph onboarding skill into a compact progressive-disclosure router:
  keep the exact welcome, resume, immediate-need, and early-stage rules in the
  top-level skill, and load deeper stage references only when relevant. Preserve
  the skill as the single policy owner and keep reply/delivery behavior intact.

## Success criteria

- The top-level onboarding skill remains a complete router and is held to a
  bounded size target while retaining the exact welcome, minimal identity,
  resume check, immediate-need rule, relationship promise, and an explicit
  stage-to-reference routing table.
- Aspiration/foundation/delegation, return/launch/completion, and scheduled
  recovery/persistence policy move to directly referenced files without losing
  or duplicating any current invariant.
- A fresh greeting needs only the compact router plus the existing bounded
  resume snapshot; substantive health/safety requests and later/resumed stages
  load the owning reference and retain full behavior.
- Asset integrity and prompt/runtime regressions prove every reference ships,
  all former invariants remain present exactly once, and terminal Linq delivery
  remains one reply.
- Focused tests, package typecheck, prompt/product/coverage specialist review,
  and exact-head CI pass. The candidate remains unmerged and undeployed per the
  user's explicit instruction.

## Scope

- In scope:
  - the package-owned `murph-onboarding` skill and stage references;
  - skill packaging, invariant, prompt, and hosted-local direct proof;
  - matching onboarding product/protocol documentation.
- Out of scope:
  - deterministic delivery outside the assistant outbox;
  - changing the admission classifier schema or persisted admission records;
  - signup/enrollment/runtime wake ordering;
  - changing onboarding policy, copy, lifecycle, state, or canonical owners;
  - merge or deployment.

## Constraints

- Technical constraints:
  - preserve the existing top-level skill entrypoint and packaging contract;
    add no persisted onboarding step or parallel state owner;
  - references must be directly reachable from the top-level router and ship in
    the same assistant-engine skill asset;
  - preserve the ordinary provider request, assistant outbox, route, receipt,
    retry, and idempotency owners;
  - preserve every existing onboarding instruction with no semantic weakening.
- Product/process constraints:
  - preserve the exact onboarding welcome and its easy reply question;
  - immediate health/safety needs, resumed context, persistence, completion,
    and scheduled recovery must still route to their full owning policy;
  - follow iMessage deliverability guidance and keep the user-initiated reply
    conversational, link-free, and non-acquisitional;
  - prompt-primary work uses the worktree/PR lane, preliminary combined
    product/prompt/coverage review, and no shipping or deployment.

## Risks and mitigations

1. Risk: A moved rule becomes undiscoverable and a later onboarding stage
   silently skips an invariant.
   Mitigation: Put an explicit stage routing table in the top-level skill and
   add asset tests that require every former invariant and every referenced
   path exactly once.
2. Risk: The router becomes another policy summary that drifts from references.
   Mitigation: Keep only cross-stage routing and early-stage rules at the top;
   each detailed rule has one owning file, and tests reject duplicate ownership.
3. Risk: Model tool use does not improve because it reads every reference up
   front.
   Mitigation: Tell the model to read only the reference for the current stage,
   enforce a top-level byte ceiling, and use provider-shaped evals to verify the
   fresh greeting reads no later-stage reference.
4. Risk: Packaging omits nested reference files from hosted runners.
   Mitigation: extend the canonical assistant skill asset/packaging test and
   inspect the assembled package path before accepting the candidate.

## Tasks

1. Inventory every top-level onboarding rule and assign one owning router or
   stage-reference location without changing meaning.
2. Add red asset/size/routing tests for the compact top-level skill and nested
   references.
3. Split the skill into the smallest coherent stage references and add the
   explicit read-only-current-stage router.
4. Add production-shaped hosted-local proof when the existing harness exposes
   the required skill/action trace without new production state.
5. Measure skill/prompt byte impact, update durable onboarding documentation,
   run focused verification, and open the unmerged PR.
6. Run the combined preliminary product/prompt/coverage review and applicable
   final gate, resolve accepted findings, and leave the verified PR undeployed.

## Decisions

- Prefer progressive disclosure over a system-prompt exception or deterministic
  Web reply. Production traces prove the 56,295-byte full-skill read and
  re-inference own most of the 5.72-second median first-output-to-text gap;
  compact routing removes irrelevant context while preserving one policy and
  the ordinary assistant/outbox path.
- Keep deterministic or prompt-bypass welcome handling out of this candidate;
  either would duplicate policy or broaden accepted-input terminal semantics.

## Verification

- Commands to run:
  - focused assistant-engine turn-planning and model-behavior Vitest files;
  - focused hosted-local Linq first-contact scenario when locally runnable;
  - assistant-engine and affected package typechecks;
  - docs drift, `git diff --check`, exact-head CI, and required ReviewGPT passes.
- Expected outcomes:
  - fresh greeting reads the compact router and no later-stage reference;
  - substantive, resumed, and later-stage inputs load the required owner;
  - no delivery, provider, tool, schema, persisted-state, or channel regression.
