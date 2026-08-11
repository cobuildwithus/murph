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
- Final focused fanout, owner, pending-setup, prepared-container, crypto, and
  full Linq thread-route matrix: 9 files and 390 tests passed.
- App-local prepared typecheck and scoped ESLint passed with no warnings or
  errors.
- Real PostgreSQL suite: 1 file and 4 tests passed. Its 32-candidate replay used
  a one-connection pool and observed 8 SQL statements for no-sender ambiguity
  and 13 for a sender-selected locked claim, independent of roster cardinality.
