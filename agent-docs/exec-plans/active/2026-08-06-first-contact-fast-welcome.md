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

- The current top-level skill is 11,246 bytes, down from 56,295 bytes: the
  fresh policy read is 45,049 bytes (80.0%) smaller and remains below the
  executable 12-KiB ceiling. The complete four-file asset is 61,255 bytes; its
  4,960-byte growth preserves explicit routing and every later-stage policy
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
- The actual-model journey proves that a fresh greeting reads only the root,
  parses one schema-valid bounded resume snapshot, and returns the exact
  welcome; the short post-welcome acceptance reads no stage owner; a
  minimal-identity answer reads aspiration plus persistence but not return;
  and a fully resolved contextual return reads root plus return but not
  aspiration. The exact-current fixture also distinguishes a fully populated
  ordinary snapshot with no onboarding referent from a resumed flow missing a
  progress signal. Every scenario rejects unrelated explicit asset reads and
  broad, wildcard, or recursive skill reads.
- Live evaluation exposed and corrected three real routing defects: continuing
  minimal-identity answers could omit persistence, resolved later stages could
  reread aspiration, and ordinary negative or none foundation answers could
  omit persistence. The router now requires the correct owner in each case
  without preloading every reference.
- The current fresh local trace took 11.863 seconds; an earlier conforming trace
  took 9.612 seconds. These are stochastic local routing traces, not a
  base/head comparison, production latency measurement, or SLO claim. In an
  earlier strict trace, eliminating the later-stage aspiration overread reduced
  that turn's input from 40,122 to 34,513 tokens (5,609 / 14.0%).
- The exact-current Terra/low retry reached the provider but hit its usage limit
  before the first model action, so it produced no new routing or latency
  sample. The two new resume-boundary scenarios therefore have deterministic
  fixture and policy proof but are not claimed as exact-current live-model
  evidence.
- The structural production estimate remains a one-to-three-second fresh-reply
  improvement. Realized production latency remains unmeasured because the
  branch is intentionally unmerged and undeployed.
- Subscription-backed proof is explicitly onboarding-scoped. The shared
  resolver requires both a consumer option and the environment gate, while all
  other real-Codex tests retain their prior provider selection. It derives a
  seed with no refresh token or API key, requires at least 30 minutes of
  access-token runway, writes credentials only to a mode-0600 temporary Codex
  home, never logs credential values, and awaits retrying cleanup while
  surfacing only sanitized failure.
- Final audit also restored injury history to the owning medical/safety
  checkpoint and its complete synthetic resume evidence so an unresolved
  safety fact cannot qualify a flow for contextual return.

## Verification

- Completed local proof:
  - assistant skill assets: 27 passed, 6 existing skips;
  - real App Server scripted fresh greeting: 1 passed;
  - provider-free subscription isolation and policy detectors: 3 passed, 36
    gated skips;
  - prior-head exact Terra/low full-tree routing: 1 passed, 37 skipped;
  - exact-current Terra/low retry: blocked by provider usage limit before the
    first action and therefore not counted as a routing or latency result;
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
- The behavior-bearing candidate is committed and pushed at
  `5b85a07198521b77ccd9ffd1c8b9261c284e9635`. Preliminary combined review and
  final ReviewGPT round 1 passed. Round 2 found an over-broad contextual-return
  predicate and an undisclosed file-wide subscription-auth switch; both are
  corrected, independent prompt/auth re-audits pass, and final ReviewGPT round
  3 remains pending. Exact-head CI is pending for the corrected candidate.
- Commands to run:
  - focused assistant-engine turn-planning and model-behavior Vitest files;
  - focused hosted-local Linq first-contact scenario when locally runnable;
  - assistant-engine and affected package typechecks;
  - docs drift, `git diff --check`, exact-head CI, and required ReviewGPT passes.
- Expected outcomes:
  - fresh greeting reads the compact router and no later-stage reference;
  - substantive, resumed, and later-stage inputs load the required owner;
  - no delivery, provider, tool, schema, persisted-state, or channel regression.
