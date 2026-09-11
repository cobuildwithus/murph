# Recover Linq inventory snapshot contention

## Outcome and invariant

Concurrent authoritative provider snapshots converge under the existing
Serializable transaction owner. Keep the 250-line bound, three attempts, default
transaction timeout, atomic replacement, and provider/crypto preparation outside
transactions. Unknown failures remain terminal and cancellation stops new work.

## Evidence and decision

The required PostgreSQL proof exhausted three recognized statement serialization
conflicts within 28 milliseconds. A focused local reproduction also exposed a
commit-time DriverAdapterError that lacks the top-level Prisma code required by
the current classifier. No inventory lock or newer-snapshot discard remains to
reorder. We cannot weaken Serializable: disjoint Read Committed snapshots could
leave a combined authoritative inventory.

Extend the existing classifier to recognize direct adapter SQLSTATE evidence.
Space its existing attempts with an abort-aware 50–250 millisecond jittered wait,
matching the established database reconnect delay range without importing its
unrelated retry owner. At most two waits add 500 milliseconds; each wait starts
after rollback has released the transaction. No new state, queue, lock, or helper.

## Proof and progress

- [x] Trace CI attempts and reproduce the direct commit error on local PostgreSQL.
- [x] Deterministic tests for both conflict shapes, spacing, three-attempt cap,
      unknown errors, cancellation, and unchanged one-time preprocessing.
- [x] Full focused inventory unit and real PostgreSQL suites; Web typecheck.
- [ ] Inspect diff/privacy/complexity, close plan, commit, and open draft PR.

The parent session owns candidate review, ReviewGPT, required CI, and merge.
No provider, production database, or production deployment is used locally.

## Product UX and evidence

Effort: Patch. Outcome: background line refreshes recover from transient
contention so current provider ownership remains available to contact selection.
Protected experience: revoked or stale inventory remains ineligible; no routing,
contact identity, or foreground reply-speed promise changes. Result: Ready at the
local proof boundary; production rollout has not been observed.

The inventory unit suite passes 25 tests, including direct adapter uniqueness,
serialization, and deadlock errors, terminal unknown/transport failures, both
cancellation boundaries, three total attempts, two bounded waits, and one provider
read. All 12 real PostgreSQL inventory tests pass against a fresh fully migrated
local database, including the concurrent 250-line replacements, revocation,
freshness, atomicity, and key rotation cases. The owned database was removed.
Web typecheck, complexity (maximum 15, no hotspots), and documentation checks pass.
A narrow public changelog entry will describe background contact freshness only.
