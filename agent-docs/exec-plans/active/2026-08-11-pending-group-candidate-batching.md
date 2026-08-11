# Batch pending-group candidate resolution

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep first-message Linq group ownership and recovery behavior unchanged while
  replacing candidate-proportional database and KMS fanout with bounded set
  preparation before the route transaction.

## Success criteria

- The provider-proven roster remains capped at 32 and the one-use
  `HostedPendingGroupSetup` row remains the only persisted setup owner.
- Candidate access, managed-line, narrow home-line routing, recovery-intent,
  and payload-root preparation use bounded set owners before `BEGIN`.
- The transaction recomputes sender precedence and live authority, rejects or
  retries stale preparation, and performs no KMS or provider call while holding
  the route transaction or setup-row lock.
- Only-candidate, sender-wins, ambiguity, provider-event time, expiry,
  recovery-in-flight, corrupt-payload, rollback, and concurrent-claim behavior
  remain intact.
- Deterministic 32-candidate load and mutation proofs, focused typecheck/lint,
  exact-head ReviewGPT gates, and CI pass.

## Scope

- In scope: pending-group candidate and recovery reads, request-local
  preparation plumbing, exact stale-state fences, focused tests/direct replay,
  and the matching architecture/security/reliability/testing documentation.
- Out of scope: schema or migration changes, new queues/services/state owners,
  generic caches or frameworks, provider roster resolution, unrelated thread
  routing, and any user-facing setup behavior change.

## Constraints

- Preserve the current route transaction as the irreversible authority and
  keep setup consumption atomic with newly created route ownership.
- Reuse canonical access, managed-line, routing-codec, delivery-intent,
  secure-box, and one-retry preparation owners; do not duplicate their policy.
- Keep decrypted routing/setup material request-local, bound to exact
  ciphertext/root identity, absent from logs and durable artifacts, and
  zeroized through existing crypto owners.
- Treat ReviewGPT patches as untrusted intent: inspect every path and hunk,
  privacy-check, apply-check, and deliberately land only scoped corrections.

## Risks and mitigations

1. Risk: speculative preparation becomes ownership authority.
   Mitigation: recompute the full live eligible candidate set and sender
   precedence inside the transaction and require exact prepared fingerprints.
2. Risk: a root or ciphertext rotates after preparation.
   Mitigation: compare exact routing and setup ciphertext/root identity and use
   the existing single preparation-required retry before route creation.
3. Risk: batching changes recovery ambiguity or in-flight behavior.
   Mitigation: preserve every existing attempt-time, line, template, target,
   status, source-ref, and provider-correlation predicate in one set projection.
4. Risk: corrupt optional setup blocks an otherwise valid group message.
   Mitigation: retain selected-corrupt consume-and-fallback semantics and do
   not let an unselected corrupt envelope invalidate unrelated candidates.

## Tasks

1. [completed] Send the exact scoped implementation request to a unique
   ReviewGPT lane and obtain a complete downloadable patch. The request is in
   a fresh thread; the parent owns exact-thread artifact capture after the
   first watcher proved to be attached to the wrong managed endpoint.
2. [completed] Inspect and apply only accepted patch intent; simplify it against current
   owners and complete missing live-authority or privacy fences locally.
3. [completed] Add deterministic 32-candidate database/KMS/transaction proof plus stale
   preparation and PostgreSQL concurrency coverage.
4. [completed] Run focused tests, direct incident replay, app-local typecheck/lint, diff and
   privacy checks; inspect the entire candidate diff.
5. [in progress] Commit and push the candidate, open the PR after the guidance dependency is
   merged, run preliminary completion-specialists and sensitive final
   ReviewGPT gates with exact-head CI, resolve findings, close this plan with
   `scripts/finish-task`, and push the final head without merging.

## Decisions

- Use an ephemeral preparation value carried through the existing
  `HostedThreadRoutingCryptoPreparation`; do not persist a snapshot.
- Extend current owner boundaries with set-shaped reads rather than copying
  access, line, routing, recovery, or cryptographic policy into the webhook.
- Bound stale recovery to the existing single prepared-transaction retry.
- Classify the change as internal reliability/performance work; no changelog
  item is planned because member-visible behavior intentionally does not change.

## Preliminary ReviewGPT findings

- Accepted all four findings; none were rejected.
- Preserve a replacement-line candidate id as immutable request-local authority
  across the existing single fresh-preparation retry. A different or absent
  fresh selection now returns route-free instead of transferring ownership to a
  different setup or the active-sender fallback.
- Classify deterministic selected-root metadata/ciphertext failure separately
  from transient provider failure. Permanent invalid state is consumed only
  after exact lock and live revalidation; network, availability, missing-key,
  and other retryable provider failures leave the setup untouched.
- Read the bounded routing projection once, but open private home-line
  ciphertext only for candidates already admitted by runtime access,
  active-managed-line, and exact routing-lookup facts.
- Add a production-shaped 32-participant webhook regression that traverses the
  actual one-retry orchestration and proves sequential transactions, alongside
  the owner-level deterministic and real-PostgreSQL incident replays.

## Verification

- Focused Vitest: pending setup selection/claim, prepared container,
  Linq route/webhook entry, crypto batching, and PostgreSQL concurrency.
- Direct replay: 32 live candidate owners with no sender/no recovery and a
  selected race; assert exact bounded reads, KMS concurrency at most four, and
  zero KMS/provider work while the transaction is active.
- Mutation matrix: expiry, sender/candidate precedence, suspension/access,
  incoming/original managed line, routing binding/ciphertext/root, setup
  ciphertext/root, recovery intent, participant membership, and route race.
- Static proof: app-local typecheck, scoped lint, `git diff --check`, privacy
  scan, current-base merge-tree, mandatory ReviewGPT stages, and exact-head CI.

### Baseline evidence

- Generated the worktree-local Prisma client, then ran the three focused unit
  suites: 3 files and 159 tests passed.
- Started a session-owned temporary PostgreSQL 14 cluster on loopback with
  `max_connections=50`, applied all 176 current migrations, and ran the existing
  pending-group PostgreSQL concurrency suite: 1 file and 3 tests passed.
- The initial unit invocation before generation failed only because the fresh
  worktree had no generated Prisma client; no test body ran in the two affected
  suites. The canonical rerun above is the baseline.

### Candidate evidence

- ReviewGPT patch inspected in full and applied as untrusted intent. Local
  review removed setup plaintext from the prepared package: preparation now
  prewarms only the selected root, and the locked transaction performs the
  authenticated local AES open through the request-scoped cache.
- Final focused provider, fanout, owner, pending-setup, prepared-container,
  crypto, and full Linq thread-route matrix: 10 files and 414 tests passed.
- App-local prepared typecheck and scoped ESLint passed with no warnings or
  errors.
- The broad hosted-web run reached 9,496 passing tests and exposed one legacy
  diagnostic-message expectation; preserving that diagnostic in the new typed
  permanent error made its focused rerun pass.
- Real PostgreSQL suite after remediation: 1 file and 4 tests passed. Its 32-candidate replay used
  a one-connection pool and observed 8 SQL statements for no-sender ambiguity
  and 13 for a sender-selected locked claim, independent of roster cardinality.

### Final ReviewGPT round-one remediation

- Harvested replacement final ReviewGPT round one for PR #1642 at exact head
  `7a16c35110654fd7991db68b22096bf1c5db48ce`; accepted the finding that
  authority-reader keyring/config failures were being classified as permanent
  corrupt setup state.
- Narrowed root-envelope permanent classification to persisted envelope shape,
  row/root binding, malformed persisted signature bytes, and completed
  signature verification failure. Missing historical verify keys, runtime
  config assembly, public-key import/runtime failures, and other availability
  failures now escape as retryable preparation failures before setup lock or
  deletion. Signature encoding remains owned by one shared runtime-state
  predicate rather than a second app-local DER parser.
- Added real-classifier pending-setup proof for replacement-line recovery:
  a root signed by a historical authority key remains unconsumed when that key
  is absent from the Web verify keyring, then claims after the verify-only key
  is restored; malformed historical signatures remain permanent and are
  consumed only after exact lock and live revalidation.
- Verification after remediation: runtime-state focused test 1 file/4 tests
  passed; web focused tests 2 files/58 tests passed; pending-group matrix
  7 files/383 tests passed; package and web typechecks passed; focused ESLint,
  `git diff --check`, and privacy scan passed.
- The final real PostgreSQL rerun passed 1 file/4 tests against the
  session-owned PostgreSQL 14 cluster configured with `max_connections=50`;
  the earlier default-port attempt failed before exercising code because it
  did not target that cluster.

### Requirement-level retrospective

- Original requirement: bound pending-group database and KMS work for a
  provider-proven roster of at most 32 while preserving the one-use setup
  owner, recovery and selection rules, transaction authority, and visible
  behavior.
- Base to first-reviewed head changed 1,970 authored production-source lines
  (1,497 additions and 473 deletions across 10 files). The direct correction
  from the first-reviewed head to the current round-two head changed 42 source
  lines (37 additions and 5 deletions in the domain-root and runtime-state
  owners). Base to the round-two head is 2,002 source lines (1,529 additions
  and 473 deletions across 11 files); tests, docs, fixtures, generated code,
  configuration, and tooling are excluded.
- The 42-line review delta corrects missing historical verify-key failures
  being treated as permanent corruption. It centralizes the existing
  signature-byte predicate and deletes the duplicate app-local parser; it does
  not add another owner or lifecycle.
- Direction: continue as one indivisible change. The request-local package
  replaces candidate-by-candidate preparation, set reads remain with their
  canonical access, line, routing, recovery, and crypto owners, selected-root
  prewarm removes provider/KMS work from the transaction, and exact live and
  locked revalidation preserves authority and atomic consumption. These pieces
  must land together; splitting them would leave either the unbounded/locked
  work in place or require temporary compatibility machinery between
  preparation and claim.
- The 1,148-line pending-setup rewrite is the existing convergence point for
  roster selection, recovery authority, selected-root readiness, and locked
  claim semantics. The cross-owner surface follows those current predicates;
  it adds no schema, queue, cache, service, framework, durable state owner, or
  second recovery lifecycle.
- ReviewGPT round two verified the round-one correction and returned no code
  finding. Its sole outcome was the 2,000-line retrospective gate; the next
  step is a fresh full-snapshot round-three audit on this docs-only successor
  head.
