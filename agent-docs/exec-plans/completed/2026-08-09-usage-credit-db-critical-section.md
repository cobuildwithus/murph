# Bound usage-credit settlement database critical section

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Keep hosted usage accounting available during same-beneficiary bursts by
  replacing the unbounded per-grant settlement loop with the smallest bounded,
  database-only commit that preserves exact credit and billing semantics.

## Success criteria

- A usage debit no longer locks every positive historical grant and performs a
  data-dependent application loop of projection and ledger writes.
- The commit has a documented maximum row and statement count, or uses a
  compact existing owner whose database work is constant-sized; a limit may
  not strand, erase, or silently absorb valid credit.
- Purchase and referral grants remain FIFO, immutable ledger evidence and
  beneficiary sequence semantics remain correct, purchase projections remain
  synchronized, and exact usage replay remains idempotent.
- Purchased credit remains owned by its frozen beneficiary; referral credit is
  final; Family, group sponsorship, refund, dispute, deletion, access, and
  crossing-operation behavior are unchanged.
- No provider, KMS, model, filesystem, callback, retry sleep, or unbounded read
  runs while the usage-credit transaction owns a pooled connection.
- Focused unit and real-PostgreSQL concurrency tests prove replay, FIFO mixed
  grants, a maximum-fragmentation case, rollback, and bounded lock/statement
  behavior with a two-connection pool.

## Scope

- In scope: the canonical usage-credit settlement owner, the minimum ledger or
  schema support needed for a correct bounded commit, focused tests, and the
  live architecture/reliability/testing docs if the durable contract changes.
- Out of scope: changing offer amounts, allowance pricing, Stripe authority,
  referral rewards or caps, Family/group entitlement, access gating, provider
  reconciliation ownership, checkout/payment binding encryption under its
  separate locks, or unrelated database-lock cleanup. The payment-binding
  critical section remains an explicit follow-up and must not be hidden by a
  broad claim that this settlement PR fixes every usage-credit transaction.

## Constraints

- Technical constraints: prefer one atomic CTE, conditional update, or upsert;
  retain only brief internal PostgreSQL row locks required by the write; keep
  one beneficiary serialization/sequence owner unless a simpler atomic write
  proves it unnecessary; do not add a queue, repair service, or second ledger.
- Product/process constraints: ReviewGPT authors the implementation patch;
  local work only triages, applies, verifies, and reviews it. Use the PR lane,
  run the preliminary coverage pass and final ReviewGPT gate on exact pushed
  heads, and preserve product-critical billing and access behavior.

## Risks and mitigations

1. Risk: A superficial `LIMIT` makes fragmented valid credit permanently
   unusable or incorrectly counts it as absorbed.
   Mitigation: require an invariant-safe continuation/compaction design or no
   patch; test credit spanning the boundary and unchanged total conservation.
2. Risk: Removing beneficiary serialization creates duplicate debits, sequence
   gaps, or projection drift under grant/reversal races.
   Mitigation: retain one atomic owner, rely on unique semantic identities and
   conditional writes, and prove concurrent replay and grant settlement in
   real PostgreSQL.
3. Risk: A broad accounting redesign adds another canonical state owner.
   Mitigation: pressure-test for a set-based rewrite of the existing ledger and
   projections first; reject new state without direct proof it is required.

## Tasks

1. Map settlement, grant, reversal, allowance, referral, sponsorship, deletion,
   migration, and test call sites and record the current maximum-work gap.
2. Send a guarded implementation request to ReviewGPT on an assigned managed
   lane and require a scoped patch artifact, explicit invariant reasoning, and
   exact verification commands.
3. Inspect the full patch before applying it; reject unrelated scope, hidden
   product changes, new state without proof, unsafe casts, or a cap that loses
   usable credit.
4. Apply the accepted patch, run focused unit/type/document checks and the
   local real-PostgreSQL concurrency proof, then inspect the final diff.
5. Commit, push, open the PR with the sensitive billing/concurrency intent
   contract, start CI and both required ReviewGPT stages on the exact head, and
   resolve accepted findings until the final head passes.

## Decisions

- The target is zero application-visible lock orchestration, not literally
  zero PostgreSQL locks: correct atomic writes still take short internal locks.
- A fixed row cap is not accepted by itself because current product policy does
  not impose a lifetime bound on unused purchase or referral grants.
- The current risk is structural: settlement selects every positive grant with
  `FOR UPDATE` and no limit, then performs multiple awaited writes per row.
- The accepted SQL keeps one beneficiary serialization point, reads at most 33
  indexed positive projections, rejects the corrupt 33rd row, and settles up to
  32 FIFO grants in one data-modifying CTE with one beneficiary projection
  update and one ledger insert statement.
- The grant projection carries immutable beneficiary/FIFO identity so the
  bounded return is backed by a partial active-grant index instead of a scan of
  historical zero-balance projections. Unfulfilled reservations use a matching
  partial beneficiary index.
- Purchase reservations release only from exact provider-final no-payment
  owners. Local expiry, saved-card fallback, and ambiguous or recoverable
  provider states remain conservatively reserved; the migration backfill uses
  the same proof bar and excludes automatic-refill ordinals from reference-free
  proof.
- Refund and dispute convergence performs one final shared capacity inspection
  after both signed-adjustment passes. Overflow rolls back before receipt
  binding and remains in the existing Stripe retry lane.
- A new purchase at the 32-slot boundary returns a distinct structured 409;
  true eligibility stays 403 and exact replay resolves first. The shared dialog
  presents one truthful temporary-block state with no alternate-amount advice.

## Verification

- Commands to run: focused hosted usage-credit unit tests; focused typecheck;
  migration constraint tests if schema changes; the guarded local
  `hosted-usage-credit-postgres-concurrency` lane with a two-connection pool;
  repository doc drift checks; exact-head GitHub Actions.
- Expected outcomes: all checks pass; exact replay creates no second debit;
  FIFO purchase/referral consumption and projection conservation hold; maximum
  work is deterministic; no connection remains checked out for non-database
  work; PR CI and both ReviewGPT gates pass on the final pushed head.

Current local proof:

- 233 focused unit/migration tests and 56 production/migration guards passed
  after provider-final release remediation.
- A fresh isolated schema applied all 171 migrations, then all 32 guarded real
  PostgreSQL usage-credit tests passed.
- The affected purchase suite passed 176 tests after exact release owners were
  added.
- The capacity-response slice passed 310 focused service, route, dialog, and
  design-catalog tests, web TypeScript, scoped ESLint, and the frontend
  design-proof contract.
- Desktop 1440 CSS-pixel and mobile 390 CSS-pixel catalog renders exercised the
  real synthetic inert dialog state and showed the exact guidance with only a
  dismiss action. The in-app browser had no attached backend, so the documented
  repository Playwright fallback supplied the captures.
- The required fresh Claude Fable UI check stopped on explicit usage-credit
  exhaustion; completion policy records that as a non-blocking evidence gap and
  forbids a substitute request.
- Parent corrected-head product revalidation: the capacity state is the
  smallest complete experience for personal, Family, and group funding—an
  immediate truthful explanation, one dismiss action, no misleading amount
  choice, and no new screen or lifecycle owner. No findings remain.
- The branch merged the latest `main` after ReviewGPT packaging. Its two
  conflicts were limited to retaining both migration-list entries and combining
  the current Stripe and usage-credit testing-map descriptions; the focused
  migration test and docs drift check passed after resolution.
- Against the merged candidate, 512 focused tests, web TypeScript, and scoped
  ESLint passed. A fresh isolated database applied all 172 migrations in order.
  The complete 33-case PostgreSQL suite passed 32 cases while the large-history
  fixture reached its 60-second test timeout; an isolated rerun passed in 55.5
  seconds and again proved the partial-index plans and bounded results. Exact-
  head CI remains the clean-runner authority for that timing-sensitive lane.
- Final ReviewGPT round 2 ran on Eragon against the immutable pre-merge
  remediation snapshot and returned `PASS` with no findings. Its guarded ZIP
  could not independently open the externally hosted design-proof images; the
  parent had already reopened both hosted images at native resolution and
  exercised the hydrated production catalog state locally.
- Exact-head GitHub Actions remain pending until this plan is archived and the
  final candidate is pushed once. Base-only merge history, the isolated
  migration-list regression resolution, and this explanatory plan closure do
  not require another ReviewGPT round under the repository final-gate policy.
Completed: 2026-08-10
