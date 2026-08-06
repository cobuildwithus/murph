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

## Implementation evidence

- The current top-level skill is 11,543 bytes, down from 56,295 bytes: the
  fresh policy read is 44,752 bytes (79.5%) smaller and remains below the
  executable 12-KiB ceiling. The complete four-file asset is 61,552 bytes; its
  5,257-byte growth preserves explicit routing and every later-stage policy
  rather than deleting behavior.
- The three directly referenced owners are
  `aspiration-foundation-delegation.md`,
  `persistence-recovery-follow-up.md`, and
  `return-launch-completion.md`. The latency win comes from not loading
  irrelevant later-stage policy on the fresh greeting, not from deleting that
  policy.
- The asset regression failed before the split on the missing reference
  inventory, then passed after the compact router and references landed. It
  also checks direct reachability, exact inventory, early-stage ownership, and
  representative single-owner safety/product invariants.
- The preliminary specialist's material finding was accepted: the scripted
  App Server scenario proves plumbing only because it preselects its actions.
  An opt-in actual-model App Server E2E now uses the production assistant target
  `gpt-5.6-terra` at low reasoning against the complete materialized production
  skill tree.
- A prior-behavior-head actual-model journey proved that a fresh greeting read
  only the root, parsed one schema-valid bounded resume snapshot, and returned
  the exact welcome; the short post-welcome acceptance read no stage owner; a
  minimal-identity answer reads aspiration plus persistence but not return;
  and a fully resolved contextual return reads root plus return but not
  aspiration. Exact-current fixtures also distinguish a fully populated
  ordinary snapshot with no onboarding referent from a resumed flow missing a
  progress signal and from a foundation-complete resume that still lacks
  minimal identity. Every scenario rejects unrelated explicit asset reads and
  broad, wildcard, or recursive skill reads. The newly added exact-current
  boundaries are deterministic/gated proof only because the current provider
  retry stopped before its first action.
- Live evaluation exposed and corrected three real routing defects: continuing
  minimal-identity answers could omit persistence, resolved later stages could
  reread aspiration, and ordinary negative or none foundation answers could
  omit persistence. The router now requires the correct owner in each case
  without preloading every reference.
- Earlier conforming fresh traces at a prior behavior head took 11.863 and
  9.612 seconds. These are stochastic local routing observations, not a
  base/head comparison, production latency measurement, or SLO claim. In an
  earlier prior-head strict trace, eliminating the later-stage aspiration
  overread reduced that turn's input from 40,122 to 34,513 tokens (5,609 /
  14.0%).
- The last Terra/low retry before the auth-harness simplification reached the
  provider but hit its usage limit before the first model action, so it
  produced no new routing or latency sample. The two new resume-boundary
  scenarios therefore have deterministic fixture and policy proof but are not
  claimed as exact-current live-model evidence.
- The structural production estimate remains a one-to-three-second fresh-reply
  improvement. Realized production latency remains unmeasured because the
  branch is intentionally unmerged and undeployed.
- The mandatory round-3 retrospective chose deletion over disclosure for the
  local subscription-auth adapter. The gated actual-model probe remains because
  static assets and a scripted provider cannot prove real model reference
  selection, but it now reuses the test file's pre-existing API-key or gateway
  resolver. Host auth-store reads, copied credentials, token-runway logic, the
  temporary credential home, and their dedicated test scaffold are removed.
- Final audit also restored injury history to the owning medical/safety
  checkpoint and its complete synthetic resume evidence so an unresolved
  safety fact cannot qualify a flow for contextual return.
- A post-round-3 independent audit found that the compact direct-return guard
  omitted two earlier prerequisites owned by the root. The root now requires
  the broad/private/context-compounding relationship promise to have been
  delivered and minimal identity to be known or explicitly skipped; otherwise
  it stays root-only and recovers the missing prerequisite. A schema-valid
  missing-identity fixture guards that route without adding a provider request
  to production.
- The same audit's proposed per-subfield medical gate was rejected after
  tracing the canonical spec and base monolith. Medical/safety is intentionally
  one optional open checkpoint; its medications, conditions, injury,
  allergy/intolerance, and pregnancy/nursing list defines facts to preserve
  when supplied, not five mandatory disclosures. Explicit deferrals remain
  unresolved under the root's existing rule.

## Verification

- Completed local proof:
  - assistant skill assets: 27 passed, 6 existing skips;
  - real App Server scripted fresh greeting: 1 passed;
  - real-Codex harness and policy-detector regressions: 6 passed, 32 gated
    skips;
  - prior-head exact Terra/low full-tree routing: 1 passed, 37 skipped;
  - final pre-shrink Terra/low retry: blocked by provider usage limit before
    the first action and therefore not counted as a routing or latency result;
  - scripted runtime, food-journal owner, and proactive-support regressions: 32
    passed;
  - onboarding route planning: 1 passed;
  - onboarding injection: 3 passed;
  - assistant-engine typecheck, docs drift, `git diff --check`, and focused
    privacy scan: passed.
- Exact-head assistant coverage exposed three proof-only portability/ownership
  regressions: Linux bubblewrap could not configure loopback for the scripted
  exec calls, and two legacy tests still read only the old monolithic root for
  rules now owned by references. The App Server proof now reuses the existing
  `danger-full-access` scripted-exec lane, and the two assertions read their
  explicit stage owners. All three focused files pass (five tests total).
- The preliminary specialist's attached coverage patch was inspected rather
  than applied blindly. Its two owner-boundary assertion corrections were
  accepted and retained; the parent separately made the scripted App Server
  sandbox correction and verified the focused files.
- The pre-final-audit behavior candidate is committed and pushed at
  `5b85a07198521b77ccd9ffd1c8b9261c284e9635`. Preliminary combined review and
  final ReviewGPT round 1 produced independent results: the preliminary pass
  returned model-routing and coverage findings whose accepted corrections are
  included, while final round 1 passed. Round 2 found an over-broad
  contextual-return predicate and an undisclosed file-wide subscription-auth
  switch. The routing predicate is corrected; the round-3 retrospective then
  removed the auth switch and its scaffold entirely. The same-thread round-3
  retry passed against `b20fcf7569507950a1bea9b583fbd68ebd33cc5d`, and all
  required CI was green on that exact head. The subsequent independent
  relationship/minimal-identity guard is locally proven; its new exact-head CI
  and final same-thread ReviewGPT remediation round remain pending.
- Commands to run:
  - focused assistant-engine turn-planning and model-behavior Vitest files;
  - focused hosted-local Linq first-contact scenario when locally runnable;
  - assistant-engine and affected package typechecks;
  - docs drift, `git diff --check`, exact-head CI, and required ReviewGPT passes.
- Expected outcomes:
  - fresh greeting reads the compact router and no later-stage reference;
  - substantive, resumed, and later-stage inputs load the required owner;
  - no delivery, provider, tool, schema, persisted-state, or channel regression.
