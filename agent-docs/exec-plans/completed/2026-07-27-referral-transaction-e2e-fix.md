# Referral transaction and scheduled E2E repair

Status: completed
Created: 2026-07-27
Updated: 2026-07-28

## Goal

- Restore private-conversation referral activation without concurrent work on a
  single interactive-transaction connection.
- Repair the scheduled-reminder deployment E2E so it preserves a truthful wake,
  checkpoint, and delivery signal without an accidental runway failure.
- Audit the referral transaction closure and shared Prisma transaction boundary
  for connection-pool pressure, nested/concurrent transaction-client work, and
  unnecessarily long lock lifetimes.
- Repair the stale usage-credit ledger constraints that reject every
  `referral_grant` in real PostgreSQL, using a forward-only, bounded-lock
  migration.

## Success criteria

- A real-PostgreSQL private referral flow completes
  `read -> arm -> read -> cancel` with the frozen direct source conversation.
- Referral arm and cancel mutations keep only required locks and writes inside
  the interactive transaction; read-only response projection does not extend
  the transaction lifetime.
- A snapshot failure after a committed arm or cancel returns an explicit
  applied-but-refresh-unavailable result, and a later read converges without
  retrying the mutation or telling the user it failed.
- No referral transaction starts parallel queries on one
  `Prisma.TransactionClient`, calls a root client from inside the transaction,
  or opens nested transactions through a directly invoked helper.
- Focused tests mechanically bound the regression and the transaction audit
  documents any directly adjacent finding that is intentionally not changed.
- The live credit-entry checks accept the exact positive referral-grant shape,
  retain every existing ledger branch, cover every enum kind, and validate
  successfully after normal migration.
- The exact DML-only contract migration inserts missing purchase projections,
  corrects stale values, leaves referral grants unchanged, and is replay-safe
  in real PostgreSQL.
- The DML-only resync serializes with live grant/debit/adjustment writers via
  their shared beneficiary lock and proves an in-flight debit cannot be
  overwritten by an older purchase snapshot.
- The protected deployment workflow's scheduled-reminder E2E has enough
  deterministic runway for its pre-delivery checkpoint/wake proof and still
  observes the scheduled send without a test nudge.
- ReviewGPT returns the initial implementation as an attachment patch, the
  parent inspects and verifies it, canonical verification and direct scenario
  proof pass, and the final exact-head ReviewGPT gate and PR CI are green.

## Scope

- In scope: hosted usage-referral read/arm/cancel transaction construction and
  its direct helper closure; real-PostgreSQL referral regression coverage; the
  forward credit-entry constraint migration required for referral rewards;
  scheduled-reminder hosted-local timing configuration and its workflow/docs
  contract; focused transaction/pool-efficiency audit findings.
- Out of scope: new referral policies, reward amounts, qualification rules,
  unrelated database schema changes, a new retry/queue/state owner, broad
  Prisma abstraction work, and unrelated database-query optimization.

## Constraints

- Keep Web as the single referral and credit owner.
- Preserve beneficiary/referrer lock ordering, cap checks, supersession,
  idempotency, source-conversation binding, and fail-closed feature gating.
- Treat one interactive transaction as one checked-out pooled connection. Keep
  its query sequence explicit and short; do not rely on pool saturation as
  application backpressure.
- Do not weaken the scheduled reminder's no-nudge, real-alarm, checkpoint, or
  delivery assertions merely to make the workflow green.
- Add no dependency, queue, compatibility layer, or new persisted state.

## Proven failures

1. Two production private referral-arm attempts reached the internal group-tool
   route and returned HTTP 500. The sanitized server error was
   `Concurrent nested transactions are not supported`; no referral row or
   partial credit state committed.
2. The arm path runs capacity aggregates concurrently on one interactive
   transaction client and then constructs a multi-read snapshot before that
   transaction commits. Cancel constructs the same snapshot inside its
   transaction.
3. The protected deployment scheduled-reminder E2E reached the second runway
   assertion with less than the required five seconds remaining on three
   attempts. The canonical PR lane uses an explicit fast timing profile; the
   protected deployment job does not, while the scenario performs additional
   wake/checkpoint proof before the scheduled delivery.
4. The full real-PostgreSQL usage-credit/referral suite rejected four referral
   reward paths with PostgreSQL check-violation code `23514`. The original
   credit-entry amount and source-shape constraints predated
   `referral_grant`; the later referral migration added the enum and authority
   column without replacing those checks.
5. The first DML-only projection resync read purchase capacity before waiting
   on a locked grant row. A concurrent debit could commit a lower purchase and
   grant value while resync waited, after which resync could restore the stale
   higher snapshot and break parity.

## Risks and mitigations

1. Risk: moving snapshot reads after commit returns state changed by a later
   request.
   Mitigation: treat the response as the truthful current snapshot; preserve
   exact mutation outcome from the committed row only where the wire contract
   requires it.
2. Risk: sequential queries increase transaction wall time.
   Mitigation: remove nonessential projection reads from the transaction and
   keep only required lock/cap/mutation queries on the checked-out connection.
3. Risk: a timing-only E2E change hides a production scheduling regression.
   Mitigation: preserve real Temporal alarm observation, no test nudge,
   checkpoint publication, system-mailbox handling, and final Linq delivery;
   change only the deterministic setup runway/profile contract.
4. Risk: a broad database audit sprawls into unrelated cleanup.
   Mitigation: audit the referral transaction closure plus shared transaction
   construction it directly invokes; record unrelated patterns separately
   unless they are required for this flow's correctness or pool bound.
5. Risk: replacing ledger constraints blocks or scans a hot production table
   under an exclusive lock.
   Mitigation: use a five-second-bounded, scan-free metadata transaction with
   `NOT VALID` replacements, commit that brief lock, then validate retained
   rows under PostgreSQL's less disruptive validation lock.
6. Risk: a response-projection failure after commit is mistaken for a mutation
   failure and causes a contradictory retry.
   Mitigation: acknowledge the committed action with an exact recovery reason,
   keep the existing wire shape compatible, and direct Murph to read current
   state instead of repeating the mutation.
7. Risk: state changes between the committed mutation and recovery read.
   Mitigation: distinguish committed history from current state and make the
   recovery read authoritative, including later cancellation, supersession, or
   re-arming.
8. Risk: contract resync snapshots purchase capacity while a live debit is
   blocked on the grant row, then overwrites the newer lower projection.
   Mitigation: lock affected beneficiaries in runtime writer order in a
   separate statement before reading capacity, fail closed on post-upsert
   parity, and prove the blocking interleaving in real PostgreSQL.

## Tasks

1. Package the proven failures, owner invariants, relevant source/tests, and
   transaction-audit questions for ReviewGPT; require an attachment patch.
2. Inspect ReviewGPT's patch and findings against the real call graph, reject
   speculative complexity, and apply only the scoped changes.
3. Add or correct focused unit, workflow, and real-PostgreSQL regression proof,
   including transaction-query ordering and post-commit snapshot behavior.
4. Add the forward referral-grant constraint migration and exact static/live
   database contract proof.
5. Run direct PostgreSQL and scheduled-reminder scenario proof, then canonical
   diff-aware and acceptance verification.
6. Complete local product-experience review, preliminary coverage ReviewGPT,
   parent final review, plan closure, final exact-head ReviewGPT, CI, and
   mergeability proof.

## Verification

- Focused hosted-web referral unit tests.
- A loopback real-PostgreSQL referral `read -> arm -> read -> cancel` regression.
- Focused workflow/config assertions for the scheduled-reminder gate.
- Hosted-local `linq-scheduled-reminder` direct scenario with the selected
  deterministic timing contract.
- `pnpm test:diff` for every touched owner.
- `pnpm verify:acceptance`.
Completed: 2026-07-28
