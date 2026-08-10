# Refactor thread-container crypto preparation and route refresh

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep first group-thread admission retry-safe and atomic while moving KMS and
  variable route encryption out of the database critical section.

## Success criteria

- A synthetic member id, all four domain-root envelope candidates, the sealed
  delivery route, and the ingress-root prewarm are prepared before `BEGIN`.
- The creation transaction commits the member, prepared roots, container,
  route, and activation mailbox item atomically without the legacy all-domain
  crypto bridge.
- Concurrent creation is serialized by the existing version-independent
  raw-thread advisory token across privacy-key write versions; the versioned
  unique external-thread identity remains a conflict backstop, and a stale
  prepared attempt rolls back for one fresh preparation against the winner.
- Existing route refresh performs no KMS work while its transaction is open.
- Focused unit, typecheck, and PostgreSQL concurrency proof pass on the final
  candidate; exact-head CI and required ReviewGPT gates are green.

## Scope

- In scope: hosted Web thread-container creation and delivery-route refresh,
  their Linq/Telegram preparation plumbing, focused tests, and matching durable
  architecture/reliability/testing claims if behavior changes materially.
- Out of scope: schema changes, new persisted state, mailbox protocol changes,
  unrelated advisory-lock owners, and the remaining inbound Family legacy
  crypto bridge.

## Constraints

- Technical constraints: preserve owner and participant authority checks,
  pending-group setup semantics, route/account binding, atomic activation wake,
  privacy-key rotation, and rollback on unique conflict. Never retain plaintext
  domain-root bytes beyond the existing request-scoped unwrap cache.
- Product/process constraints: smallest maintainable change, isolated task
  worktree, focused local proof before PR, preliminary coverage specialist plus
  the sensitive final ReviewGPT gate, green exact-head CI, parent final review,
  and scoped plan-closing commit.

## Risks and mitigations

1. Risk: speculative preparation is accidentally treated as route authority.
   Mitigation: repeat all owner/route checks under the version-stable route lock
   and retry when the observed container differs from prepared material.
2. Risk: a prepared ciphertext is applied to a different container or route.
   Mitigation: bind prepared material to container id, channel, and normalized
   thread route and validate that binding before every write.
3. Risk: moving preparation outside `BEGIN` causes a KMS retry inside the
   transaction on a cache miss.
   Mitigation: make creation/refresh writes require prepared material and add
   ordering tests that fail if the transaction opens before preparation.

## Tasks

1. Trace creation, refresh, Linq, Telegram, crypto-cache, mailbox, and
   concurrency owners; capture the current lock/KMS path in focused tests.
2. Add bounded prepared route/container inputs, remove the creation-time legacy
   crypto bridge, and keep the version-stable advisory lock around only the
   short database commit.
3. Plumb preparation through Linq and Telegram before their planning
   transactions and preserve unique-conflict convergence.
4. Run focused unit/typecheck/PostgreSQL proof, inspect the diff, and update any
   durable owner claims required by the final behavior.
5. Commit and push the candidate, run the preliminary specialist and final
   ReviewGPT gates concurrently with CI, resolve accepted findings, perform the
   parent final review, close the plan, and hand off the PR.

## Decisions

- Reuse the existing version-independent raw-thread advisory token as the
  cross-version creation authority and the versioned external-thread unique
  identity as its same-version conflict backstop; add no lock or state owner.
- Keep mailbox lane/causal allocation inside the transaction; prewarm only the
  ingress root because the allocated sequence is authenticated payload metadata.
- Retain the same route lock for absent-row creation and existing-row refresh.
  The stored identity key changes with the contact-privacy write version, so its
  unique constraint alone cannot serialize rolling-version creators.
- Include the existing line/chat-scoped pending-contact resolver in Linq's
  speculative preparation candidates, but repeat that resolver in the
  transaction so prepared material never grants authority after the contact
  becomes stale.
- Preserve a failed preparation's original provider/KMS error when the planner
  proves that material was required. Retry only a successfully prepared stale
  candidate or the existing unique route-write conflict.
- Make the planning resolver the initial route-observation owner for every Linq
  `message.received` event, including self-authored echoes, and reuse that
  snapshot for attempt-zero crypto preparation. A conflict retry rereads the
  route before preparing for the winning container.
- Treat a prepared creation's container id as an attempt-bound crypto package,
  not route authority. If the transaction observes another winning container,
  roll back with a retryable preparation-required result; a distinct explicit
  caller binding remains a non-retryable already-bound error.

## Verification

- Commands to run: focused hosted Web Vitest slices for thread routing and
  pre-transaction crypto ordering; app-local typecheck/lint as selected by the
  final diff; the existing opt-in PostgreSQL route concurrency case; exact-head
  required GitHub Actions.
- Expected outcomes: no legacy bridge call from thread-container creation, no
  KMS operation begins after transaction open, one concurrent external thread
  route wins with no orphaned synthetic state, and all existing routing,
  activation, privacy-rotation, and mailbox assertions remain green.
- Local proof on the round-3-remediated candidate: the six affected crypto/
  Linq/Telegram routing files passed 384 tests together; the PostgreSQL
  concurrency lane passed 9 tests; app-local typecheck and scoped lint passed; and
  `git diff --check` passed.
- Review remediation: the preliminary specialist and final round 1 both found
  the pending-contact preparation gap; final round 1 also found failed KMS work
  being misclassified as a route race and an overbroad documentation claim.
  All were accepted and covered by the scoped resolver recheck, one-attempt
  error propagation tests for Linq and Telegram, and narrowed architecture/test
  wording. The preliminary pass supplied no patch artifact.
- Initial exact-head CI exposed one stale Linq dispatch read-count assertion and
  one real redundant route read. Crypto preparation now reuses the resolver's
  first route snapshot while a conflict retry explicitly rereads the winner;
  both exact CI regressions pass locally and the full affected slice covers the
  corrected module boundary.
- Parent review found that a stale speculative container id could reject a
  route committed between preparation and `BEGIN` and initially changed that
  case to reuse the winner. Final round 3 proved direct reuse was unsafe because
  the attempt's prewarmed crypto still belonged to the loser; the transaction
  now rolls back for the bounded fresh winner preparation.
- Final ReviewGPT round 2 required an anomaly retrospective after finding that
  self-authored Linq echoes used `null` for both an absent route and a skipped
  lookup, deterministically spending the race retry. Planning now observes the
  route on those paths; explicit and omitted group-metadata regressions prove
  one observation, one preparation, and one transaction, while the existing
  dispatch proof keeps outbound accounting at one update.
- Final ReviewGPT round 3's established-route KMS finding was rejected against
  the merge-base path: every canonical snapshot already entered the refresh
  boundary and opened its sealed route with the control-domain root. The PR
  moves that required unwrap before `BEGIN`; skipping it for apparently healthy
  rows would weaken the existing ciphertext-validation and repair invariant.
- Final ReviewGPT round 3's late-winner finding was accepted. A winner observed
  after loser preparation now exits before demotion or mailbox work and uses
  the existing one fresh preparation attempt. The remediation audit also found
  that the stored identity unique key changes with the privacy write version,
  so it restored the existing version-independent raw-thread lock inside the
  short prepared transaction and added mixed-version PostgreSQL proof.
- The round-3 anomaly retrospective chose the smaller existing architecture:
  one retained raw-thread lock, one attempt-bound preparation package, and the
  existing bounded retry. It adds no persisted state, cache, queue, retry class,
  reconciliation owner, compatibility path, or provider work under the lock.
- Final ReviewGPT round 4 found that Linq preflight treated any active roster
  member as sufficient reason to prepare a synthetic container even when the
  authoritative planner would deterministically refuse creation. It also found
  that the PR's broad "every variable crypto input" wording obscured the
  pre-existing pending-group setup payload read that remains transaction-owned.
- The round-4 runtime finding was accepted. Preflight now returns before
  domain-envelope preparation when roster authority is unavailable, recipient
  authority is unresolved, or the incoming line cannot create a route. An
  active sender remains eligible only on an assignable line or its exact
  AT_RISK iMessage home line; a roster-only candidate must match a live pending
  setup or its existing recovery association. The authoritative transaction
  repeats every decision.
- The round-4 documentation finding was accepted. Architecture and PR wording
  now name the moved thread-container cryptography precisely and disclose that
  pending-group setup transfer-payload opening remains inside the planner
  transaction.
- Local proof on the round-4-remediated source candidate
  `6ee52f90ca8ce6d73900b8162fc489e1369b943a`: the focused Linq route file passed
  137 tests; the six affected crypto/Linq/Telegram routing files passed 390
  tests together; the PostgreSQL concurrency lane passed 9 tests; app-local
  typecheck and scoped lint passed; and `git diff --check` passed.

## Round 4 anomaly retrospective

- Trigger: final round 4 returned `FINDINGS`; the next run is substantive round
  5. The finding showed that speculative crypto eligibility had drifted from
  the planner's existing line and pending-setup authority gates.
- Original requirement: prepare thread-container cryptography before `BEGIN`
  only when first-message admission can create a route, while keeping the
  transaction authoritative, activation atomic, and concurrency retry bounded.
- Shape comparison: authored-source churn is 767 lines at the immutable
  first-reviewed head, 884 lines at the round-4 head, and 962 lines at the
  remediated source head, all below the 2,000-line threshold. The round-4
  remediation adds no schema, durable state, cache, queue, service, lock owner,
  retry class, or compatibility path; its runtime growth is one read-only
  eligibility gate plus focused tests.
- Root cause: preflight correctly checked active member access but incorrectly
  treated roster membership itself as creation authority. It did not mirror the
  planner's earlier roster-unavailable, recipient-line, and selected-live-setup
  decisions, so ignored messages could reach KMS before the transaction proved
  there was no owner.
- Decision: reuse the planner's existing read owners and selection rules in the
  bounded preflight. Do not create a second authority record or move pending
  setup payload opening out of its transaction-owned boundary. Preflight may
  over-read current metadata, but only a currently eligible sender or selected
  live setup can authorize speculative crypto work.
- Required proof: roster-unavailable, unresolved-recipient, hard-blocked-line,
  and roster-without-live-setup paths perform no domain-envelope preparation;
  active pending-contact, exact AT_RISK home-line, and live-setup paths still
  prepare once outside `BEGIN`; the PostgreSQL route races remain green.
- Expected architecture result: no-op group webhooks retain their established
  ignored or typed-retry outcomes without a new KMS failure dependency, while
  genuine route creation keeps the same short atomic prepared transaction.
