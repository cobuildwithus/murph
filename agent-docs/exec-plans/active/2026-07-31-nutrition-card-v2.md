# Goal-aware nutrition response card V2

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Ship the approved compact nutrition card through the existing Murph response
  card and Messages extension owners.
- Add canonical fiber totals and optional frozen goal context without creating
  another state, delivery, or rendering owner.

## Success criteria

- Existing V1 cards remain parseable, deliverable, and readable.
- New V2 cards carry the exact canonical five-metric meal totals plus nullable
  per-metric goal snapshots.
- A goal snapshot contains only a target and Murph's frozen semantic assessment;
  the native renderer does not invent thresholds.
- Missing or untrusted goals stay absent and render neutrally.
- A target is frozen only when the complete bounded active-goal result contains
  exactly one qualifying record for its daily metric and unit.
- Missing or partial metrics cannot carry a colored assessment, and directional
  statuses cannot contradict the frozen total and target.
- The existing private-direct closeout, outbox, SMS fallback, and immutable
  inline URL behavior remain unchanged. A definitive pre-acceptance native-card
  rejection atomically freezes the current outbox intent as text-only under a
  distinct stable provider key before that fallback enters the provider;
  ambiguous delivery never starts that fallback.
- The paired iOS extension renders V1 and V2 offline from
  `selectedMessage.url`, with no account, network, persistence, or second data
  owner.

## Scope

- Closed response-card contracts, encoding, deterministic text, and focused
  tests.
- The managed automatic-meal-closeout skill and response-card tool description.
- Current response-card reliability and architecture documentation.
- The paired Messages decoder, production SwiftUI view, local card studio,
  focused tests, and review evidence.

## Constraints

- No database, API, auth flow, cleanup job, queue, extension networking,
  dependency, or generic card framework.
- V1 remains a first-class compatibility input for retained outbox/checkpoint
  state and already-sent messages.
- Deploy and verify the backward-compatible iOS reader before the backend emits
  V2.
- Copy meal totals exactly from the immediately preceding canonical read.
- Read only current active canonical goals when considering a target; never
  fabricate a target or infer one from the day's total.
- Fail closed to null targets when the bounded goal result is saturated or a
  metric has zero, multiple, range-like, conflicting, wrong-unit, or
  wrong-window candidates.
- Treat goal status as a frozen presentation assessment, not canonical goal
  progress or future product truth.

## Tasks

1. [x] Add the V2 contract while retaining V1 compatibility.
2. [x] Port the approved production SwiftUI card and V1/V2 decoder.
3. [x] Update the closeout skill, deterministic fallback, and focused tests.
4. [x] Capture exact-head iOS simulator evidence and run focused verification.
5. [ ] Push both candidate heads and run preliminary and final ReviewGPT gates
   concurrently with CI.
6. [ ] Resolve findings, complete parent review, close this plan, and record the
   physical-device/deployment gates.

## Verification log

- Backend focused typechecks passed for contracts, operator config, assistant
  engine, and hosted execution.
- Backend focused response-card, skill, outbox, and hosted-runtime coverage
  passed: 217 tests across nine suites.
- Backend affected-code verification passed, including dependency and boundary
  checks, all affected package typechecks and tests, the Web verification and
  production build, and the Cloudflare Node and Workers suites.
- iOS formatting passed with no files requiring changes.
- iOS Messages extension build and tests passed: 27 tests, no failures or
  skips.
- iOS Studio Debug, host Debug, and host Release simulator builds passed. The
  host builds embed the Messages extension.
- Five synthetic Studio fixtures were captured from the production renderer
  across goal, selection, missing-goal, dark-mode, and accessibility states.
- Final ReviewGPT round 4 found two accepted correctness gaps: the active-goal
  list did not prove completeness or uniqueness, and the V2 schema permitted a
  status opposite its frozen total and target. The backend owner and paired iOS
  decoder now fail closed for both cases, including partial metrics; focused
  backend tests pass across three suites with 16 tests, and the iOS extension
  suite passes with 29 tests.
- Final ReviewGPT round 5 passed the remediated goal/status head with no
  findings. The preliminary completion-specialist review found one delivery
  gap: a definitive app-card rejection after a positive capability check could
  escape without sending the already-derived text. The existing Linq delivery
  owner now falls back only for HTTP 400, 415, or 422 under a distinct stable
  key; timeout, transport, rate-limit, and server outcomes remain fail-closed.
  Focused provider/channel coverage passes with 103 tests, and both affected
  packages typecheck.
- Final ReviewGPT round 6 found that the first rejection fix changed the
  provider key only in memory, so a process interruption after text acceptance
  could replay the stale card owner. The existing outbox now atomically clears
  the card and persists the effective text key before provider entry. Focused
  coverage drives a real Linq HTTP 400 through the outbox, interrupts after
  accepted fallback text, and proves stale replay uses only the frozen text and
  same fallback key; no new state or delivery owner was added.
- Final ReviewGPT round 7 required a second retrospective for the same
  dual-authority mechanism: after durable text promotion, the in-flight
  card-bearing request could still veto the existing authorized stale-thread
  recovery and terminally consume the closeout without a message. The decision
  is to keep the outbox as the sole owner and have the promotion boundary also
  establish the one effective in-flight text identity. Every downstream
  provider, recovery, receipt, failure, and replay path must consume that
  identity; card-based recovery vetoes and compensating state are not allowed.
  Composed proof must cover capability fallback and definitive app-card
  rejection followed by stale-thread materialization, alongside the existing
  interruption, persistence-failure, and ambiguous-delivery matrix.
