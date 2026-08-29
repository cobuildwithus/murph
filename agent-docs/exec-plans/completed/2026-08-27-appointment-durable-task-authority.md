# Durable task authority and portal readiness

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make explicit end-to-end delegation the durable authority for Murph to use
  reliable relevant saved facts at the intended destination, without repeated
  questions or per-field takeover.
- Make ordinary tool friction a durable continue-working condition, with the
  exact browser recovery sequence owned once by `computer-use`.
- Resolve final ReviewGPT's remaining prompt conflict and authenticated-portal
  readiness deadlock without adding state or a new policy owner.

## Product UX Plan

- Effort: Product change. The user explicitly expands the existing delegation
  promise across tasks and saved facts; no new audience, storage, or surface is
  introduced.
- Outcome: when a member asks Murph to complete a task, Murph uses reliable
  relevant known facts and carries ordinary safe steps through completion at
  the intended destination.
- Entry and promise: an explicit end-to-end request authorizes ordinary
  task-necessary use and disclosure of current canonical facts; Murph asks only
  for a genuinely missing choice, fact, or protected private step.
- Affected people: members with complete saved facts, members with partial or
  stale facts, and members whose official destination reveals requirements only
  inside an already-authenticated browser session.
- Safe exclusions: unrelated facts, guessed or conflicting values, a new
  recipient or purpose, credentials, OTPs, full payment details, CAPTCHA,
  unapproved consent, clinical decisions, and unknown-effect retries.
- Proof: assembled-prompt absence of blanket private-input takeover, a focused
  authenticated-portal TERRA journey, existing disclosure/no-disclosure
  journeys, exact tool ordering, and truthful completion reply.

## Success criteria

- The top-level execution contract says an explicit completion request permits
  use of reliable relevant saved facts at its intended destination, subject to
  a narrower owner and the protected boundaries above.
- The always-assembled prompt contains no blanket `other private input`
  takeover rule and points browser policy to `computer-use` once.
- Appointment readiness permits read-only inspection of an already-authorized,
  already-authenticated official destination before disclosure or mutation.
- A production-faithful portal fixture proves inspection precedes any act or
  disclosure, then completes the correct destination-driven identity path.
- Focused deterministic tests, GPT-5.6 TERRA, Assistant Engine typecheck,
  exact-head CI, and final ReviewGPT pass.

## Scope

- In scope: base task authority, relevant saved-fact reuse, generic
  continue-through-friction principle, browser policy consolidation,
  appointment portal readiness ordering, tests, PR evidence, and review.
- Out of scope: full-memory injection, unrelated-data disclosure, new memory
  storage or schema, runtime retry machinery, credential/payment automation,
  CAPTCHA bypass, and changes to clinical or irreversible-effect authority.

## Constraints

- Technical constraints: one generic authority rule at the top level; one exact
  browser policy owner in `computer-use`; appointment skill owns only
  appointment-specific field semantics. Prefer deletion/reordering.
- Product/process constraints: no private evidence in repository or review
  artifacts; preserve final ReviewGPT's immutable first-reviewed head; keep PR
  draft until remediation proof and parent review are complete.

## Risks and mitigations

1. Risk: “use all information” becomes unrelated disclosure.
   Mitigation: authorize only reliable facts relevant and reasonably necessary
   for the requested task, intended destination, and stated purpose.
2. Risk: read-only portal discovery performs a side effect.
   Mitigation: permit `computer_open` and non-mutating inspection only before
   readiness; the first disclosure or mutation remains gated.
3. Risk: durable principles create duplicate browser policies.
   Mitigation: top-level text owns intent and persistence; `computer-use` owns
   exact approval and recovery mechanics.

## Tasks

1. Consolidate top-level saved-fact and completion authority.
2. Delete the remaining blanket private-input takeover wording.
3. Reorder appointment readiness around non-mutating authenticated destination
   inspection.
4. Add deterministic assembled-prompt and production-faithful TERRA coverage.
5. Run focused verification, update the deidentified PR evidence, commit/push,
   rerun exact-head CI, and obtain final ReviewGPT PASS.

## Decisions

- An explicit request to complete a task is sufficient authority to use and
  transmit reliable relevant saved facts to its intended destination; it is not
  authority for unrelated facts, a different audience/purpose, or reserved
  credential/payment/consent steps.
- No full memory injection. Retrieve only relevant canonical evidence.
- Ordinary friction is not a user blocker; use the existing bounded recovery
  owner before handoff.

## Verification

- Commands: focused Assistant Engine prompt/skill/tool tests; one focused
  GPT-5.6 TERRA authenticated-portal journey; Assistant Engine typecheck;
  `git diff --check`; privacy scan; exact-head GitHub checks; final ReviewGPT.
- Expected outcomes: no repeated known-fact question or premature handoff;
  portal requirements are inspected before any act/disclosure; exact required
  fields are entered only after the gate; completion is verified and reported
  truthfully.

## Progress

- Replaced the blanket private-input handoff with explicit credential, full
  payment-detail, and one-time-code boundaries.
- Added one compact top-level task-completion authority rule and one generic
  tool-friction recovery rule; exact browser mechanics remain in `computer-use`.
- Moved appointment readiness to the first disclosure or mutation and permitted
  bounded inspection of an already-authenticated official destination.
- Deterministic proof: a broader package run reached 4,208 passing tests and 145
  opt-in skips with one line-wrap-sensitive assertion failure. After correcting
  it, all six focused files passed with 144 tests and 7 opt-in skips.
- GPT-5.6 TERRA passed the authenticated-portal recovery journey with inspection
  before action, four browser actions, five state opens, one OS fallback, zero
  handoffs, verified completion, and no unsupported insurance-memory write.
- Assistant Engine typecheck and `git diff --check` passed. Exact-head CI and
  final ReviewGPT run after publication.
- Representative first-request delta versus the same pinned baseline is 160
  tokens / 856 bytes for the private browser-enabled route and 160 tokens / 859
  bytes for the group route. The resulting totals are 29,145 tokens / 133,703
  bytes and 25,635 tokens / 117,729 bytes respectively. Serialized tools are
  unchanged; skill-loading turns are excluded from this first-request measure.
Completed: 2026-08-27
