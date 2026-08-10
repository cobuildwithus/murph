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
- Parent review tightened the sender gate to the same runtime-access decision
  used by the authoritative planner. Active billing therefore cannot trigger
  speculative domain-envelope preparation after explicit health-data consent
  withdrawal. Real webhook-entry regressions cover both that denial and a
  degraded recipient line, while the eligible pending-contact case still
  prepares once before `BEGIN`.
- Integration with the latest first-contact content guard keeps that rule
  precise: suspended and consent-withdrawn senders stop before setup lookup,
  while an ordinary billing-inactive sender does not suppress a different
  roster member's eligible live pending setup. That recognized-sender path
  also preserves the planner's contentless app-card behavior; blocked content
  still stops before preparation.
- The round-4 documentation finding was accepted. Architecture and PR wording
  now name the moved thread-container cryptography precisely and disclose that
  pending-group setup transfer-payload opening remains inside the planner
  transaction.
- Local proof on the round-4-remediated source candidate
  `6ee52f90ca8ce6d73900b8162fc489e1369b943a`: the focused Linq route file passed
  137 tests; the six affected crypto/Linq/Telegram routing files passed 390
  tests together; the PostgreSQL concurrency lane passed 9 tests; app-local
  typecheck and scoped lint passed; and `git diff --check` passed.
- Follow-up parent proof after aligning runtime access: the Linq route and
  mailbox-prewarm files passed 155 tests together; all six affected
  non-PostgreSQL files passed 400 tests; app-local typecheck, scoped lint, and
  `git diff --check` passed.
- Latest-main integration proof: the focused Linq route file passed 143 tests;
  all six affected non-PostgreSQL files passed 403 tests, the PostgreSQL
  concurrency lane passed 9 tests, and app-local prepared typecheck, scoped
  lint, and `git diff --check` passed.
- Final ReviewGPT round 5 found a supported rotation path that still missed the
  pre-transaction cache: stored delivery-route ciphertext may name a valid
  decrypt-only control root while replacement sealing uses the newer active
  root. Opening that stored route after the raw-thread lock could therefore
  perform the historical-root KMS unwrap inside the transaction.
- The round-5 finding was accepted. Canonical route observation now carries the
  exact stored ciphertext into required preparation. Preparation parses that
  ciphertext and prewarms its referenced control root before `BEGIN` when it
  differs from the active root. Refresh compares the locked row with the exact
  observed ciphertext before demotion, mailbox work, or decryption and uses the
  existing preparation-required retry if it changed. Absent or structurally
  corrupt ciphertext retains the existing owning-ingress repair path.
- Local proof on the round-5-remediated worktree: the eight affected
  non-PostgreSQL crypto/Linq/Telegram routing files passed 431 tests, the
  PostgreSQL concurrency lane passed 9 tests, app-local prepared typecheck and
  scoped lint passed, and `git diff --check` passed. Production-format Linq and
  Telegram fixtures prove both active and decrypt-only roots unwrap before the
  route lock; a stale-ciphertext case exits before demotion or route mutation.
  The combined slice also caught and corrected two stale narrow-query
  assertions after sender suspension state became part of the preflight read.
- Final ReviewGPT round 6 verified the decrypt-only route-root correction, then
  found a distinct Telegram admission path that still repeated KMS after
  `BEGIN`: speculative sender lookup projected full encrypted routing state;
  if that batch unwrap failed and its cache entry was evicted, the suppressed
  warm failure let the authoritative planner repeat the same broad resolver
  inside its transaction.
- The round-6 finding was accepted. Telegram group preparation and both planner
  authority reads now use a blind-index-to-core resolver that preserves all
  contact-privacy read candidates, distinct-member ambiguity, and the existing
  post-lock recheck without selecting encrypted routing columns. Existing full
  routing projection remains unchanged for its other call sites. No cache
  retention or retry mechanism was added.
- Focused round-6 remediation proof: the member-store and Telegram dispatch
  files passed 110 tests together; an eligible group sender succeeds with the
  private-root batch unwrap configured to fail because the core resolver never
  calls it; exact query assertions exclude every encrypted routing column.
  Existing dispatch coverage retains rotated ambiguity, binding changes after
  the member lock, suspended and inactive senders, fresh creation, route
  refresh, and the bounded late-winner retry. App prepared typecheck, scoped
  lint, and `git diff --check` passed.
- The combined round-7 affected slice passed 505 tests across nine files, and
  the real PostgreSQL route-concurrency lane remained green at 9 tests.
- Final ReviewGPT round 7 verified the Telegram correction, then returned
  `RETROSPECTIVE_REQUIRED` for the same replay mechanism in Linq. Pending
  contact preparation unnecessarily projected full private routing state;
  AT_RISK home-line and recovered-setup preparation genuinely needed private
  state but evicted a failed batch unwrap, allowing the planner to repeat the
  envelope/KMS request after `BEGIN`.
- The round-7 finding was accepted after the cross-provider retrospective.
  Pending-contact admission now resolves its existing scoped blind indexes
  directly to member core without encrypted columns. Exact private Linq
  authority opts into failure retention in the existing request-scoped cache,
  and the batch unwrap checks that cache before reading envelope rows, so the
  authoritative repeat reuses the same local rejection without database or
  provider replay. Recovered-setup candidates use the same retained boundary.
- Hard-cap round-7 remediation proof: the nine affected non-PostgreSQL files
  passed 508 tests together; the real PostgreSQL route-concurrency lane passed
  9 tests and the pending-setup PostgreSQL lane passed 3 tests; app-local
  typecheck, scoped lint, and `git diff --check` passed.
  Focused slices passed 105 tests across crypto/member-store coverage and 143
  tests in the real Linq route suite. The correction may be pushed, but the
  seven-round cap requires explicit continuation before another substantive
  ReviewGPT run and the PR remains non-merge-ready until a later exact-head
  round returns `PASS`.

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

## Round 5 anomaly retrospective

- Trigger: final round 5 returned `FINDINGS`; the next run is substantive round
  6. The finding identified a valid decrypt-only route root that the active-root
  prewarm did not cover.
- Original requirement: prepare every route/container KMS dependency before
  `BEGIN`, preserve local validation and owning-ingress repair inside the short
  transaction, and use the existing bounded retry when observed route material
  changes.
- Shape comparison: authored-source churn is 767 lines at the immutable
  first-reviewed head and 1,112 lines on the remediated worktree, below the
  2,000-line threshold. The remediation adds no schema, durable state, cache
  lifecycle, queue, service, lock owner, retry class, or compatibility path.
- Root cause: route observation reduced the stored ciphertext to a presence
  flag. Preparation therefore knew only the active control root used to seal a
  replacement, while in-transaction validation correctly followed the exact
  root id embedded in the stored ciphertext. Reader-first rotation makes those
  roots differ by design.
- Decision: carry the exact ephemeral ciphertext through the existing snapshot
  and prepared-value boundary. Prewarm its referenced decryptable root before
  `BEGIN`; after the existing raw-thread lock, compare exact ciphertext before
  any mutation or decrypt. Reuse the existing preparation-required result and
  one fresh attempt when the comparison fails. Do not add persisted observation
  state or weaken ciphertext validation.
- Required proof: production-format Linq and Telegram routes sealed under C1
  still validate after C1 becomes decrypt-only and C2 active, with both KMS
  misses before the route lock; same-active-root preparation performs no second
  historical-root request; a changed locked ciphertext exits before demotion or
  route mutation; corrupt-route repair and PostgreSQL concurrency remain green.
- Expected architecture result: established-route validation remains
  fail-closed and repairable, but supported control-root rotation cannot place
  a KMS call inside the route transaction.

## Round 6 anomaly retrospective

- Trigger: final round 6 returned `FINDINGS`; the next run is substantive round
  7. The finding identified a speculative Telegram sender read that projected
  private routing fields even though preparation and planner authority consumed
  only core member state.
- Original requirement: move variable route/container KMS work before `BEGIN`
  without causing a failed preflight to repeat provider work while holding the
  planner transaction, and keep sender identity/authority fail-closed across
  privacy-key rotation and binding races.
- Shape comparison: authored-source churn is 767 lines at the immutable
  first-reviewed head and 1,197 lines on the round-7 worktree, below the
  2,000-line threshold. The remediation adds one narrow read projection and no
  schema, durable state, cache lifecycle, queue, service, lock owner, retry
  class, or compatibility path.
- Root cause: the Telegram identity boundary reused a general routing lookup
  whose projection decrypted every private routing field. That projection was
  unnecessary for all three webhook admission calls. A failed batch unwrap was
  evicted normally, and warm-error suppression then allowed the transaction to
  repeat the same KMS work.
- Decision: delete the private-state dependency from Telegram webhook admission.
  Resolve all blind-index read candidates to one member's core state, preserve
  the existing ambiguous result, and repeat that same narrow read after
  `lockHostedMemberRow`. Do not retain unrelated failed crypto, add retry state,
  or weaken the authoritative binding recheck.
- Required proof: an eligible linked group sender reaches creation with private
  routing KMS configured to fail because no private-field unwrap is requested;
  narrow selects contain only member id and core fields; rotated candidates
  remain ambiguous; relinking after the member lock, suspension, inactive
  access, creation, refresh, and late-winner behavior remain unchanged.
- Expected architecture result: Telegram sender admission has no
  hosted-member-private-field KMS dependency before or after `BEGIN`; only
  route and mailbox cryptography that the accepted flow actually consumes is
  prepared, while identity authority remains transactionally repeated.

## Round 7 anomaly retrospective

- Trigger: final round 7 returned `RETROSPECTIVE_REQUIRED` because the same
  failed-preflight replay mechanism fixed for Telegram remained in Linq
  pending-contact, AT_RISK home-line, and recovered pending-setup admission.
  The hard cap is now reached, so remediation may be proved and pushed, but an
  eighth substantive ReviewGPT round requires an explicit continuation
  decision and the PR cannot be merge-ready without its later `PASS`.
- Original requirement: every KMS-capable input needed by thread-container
  creation, route refresh, or mailbox ingress must be prepared before
  `BEGIN`; deliberately suppressing speculative work must never let the
  authoritative transaction repeat that provider operation while holding a
  connection or route/authority lock.
- Cross-provider inventory: Telegram sender authority and Linq pending-contact
  authority consume only blind-index identity plus member core state and must
  use narrow projections with no encrypted routing columns. Linq exact
  AT_RISK home-line and recovered-setup authority genuinely consume private
  home-line plaintext; those reads may be repeated for transaction authority,
  but a failed preflight unwrap must remain in the existing request-scoped
  cache so the repeat cannot issue another envelope/KMS operation. Route and
  mailbox roots remain explicitly prewarmed by container id, while pending
  setup metadata itself remains transaction-owned.
- Shape comparison: authored-source churn is 767 lines at the immutable
  first-reviewed head and 1,394 lines on the round-7 remediation worktree,
  below the 2,000-line threshold. The correction reuses the existing narrow
  core projection and request-scoped unwrap cache; it adds no schema, durable
  state, cache lifecycle owner, queue, service, lock, retry class, migration,
  or reconciliation path.
- Root cause: the round-4 eligibility expansion reused general private-routing
  projections for three Linq authority paths. The round-6 correction narrowed
  only Telegram and did not inventory sibling speculative reads. Batch unwrap
  failures were therefore evicted normally; warm-error suppression then let
  matching planner reads issue the same KMS request after `BEGIN`.
- Decision: delete the private-state dependency from pending-contact
  admission by resolving its existing scoped blind indexes directly to member
  core. Where exact home-line plaintext remains necessary, retain only the
  failed unwrap promise for the lifetime of the already-existing request
  cache, so an authoritative repeat fails locally without provider work.
  Preserve privacy-rotation ambiguity, pending-contact chat/line scope,
  post-lock authority checks, and safe non-admission outcomes. Do not add a
  second planner, persistent preparation record, queue, or reconciliation.
- Required proof: production-faithful pending-contact-only, exact AT_RISK
  home-line, and recovered pending-setup paths show zero envelope/KMS requests
  after `BEGIN` when the private root fails; healthy crypto still creates the
  container and atomically appends the activation/message wakes; existing
  ambiguity, line ownership, ignored-path, route-race, and PostgreSQL
  concurrency coverage remains green.
- Expected architecture result: all sender authority that needs only member
  core is KMS-free across providers, and genuinely private Linq authority can
  never replay an external unwrap under the transaction after a suppressible
  preflight failure.
