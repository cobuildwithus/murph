# Reduce hosted database work during runtime bursts

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Outcome and invariant

Reduce database round trips and connection occupancy for scheduled runtime work.
Preserve fresh access, consent, allowance denial, mailbox retention, replay, and
runtime fencing. No new cache, queue, schema, pool capacity, or state owner.

## Evidence and scope

Code confirms reconciliation separately reads mailbox high water and consumed
watermarks, and enters the write-capable allowance owner even on successful
checks. Existing mailbox projection SQL and read-first allowance checks already
own the required semantics. Private operational evidence remains outside artifacts.
Scope is the Web reconciliation and mailbox owners in this repository.

## Approach

1. Reuse the read-first allowance check; authoritative denial confirmation and
   notice claims remain unchanged, while spend accounting creates periods.
2. Share the existing mailbox lane projection SQL between payload fetch and a
   narrow progress read, replacing repeated reconciliation watermark reads.
3. Reuse the runtime owner snapshot for callback preflight, preserving the
   transaction-held publication fences. Prove that preflight does not wait on
   unrelated locks and rejects committed retirement, deletion, and stale identity.
4. Validate actual SQL against synthetic PostgreSQL data, including empty lanes,
   expired/retained items, consumed watermarks, and maximum lane cardinality.
5. Run focused reconciliation, mailbox, and usage tests and Web typecheck; review
   the complete diff and commit the scoped change.

## Evolution and risks

No wire or schema changes: old and new Web readers remain compatible with current
runtime consumers. Local proof cannot establish post-deploy pressure reduction.
Query composition must retain indexed bounded lane probes and must not select
payloads for progress-only reads. Denials still enter the canonical mutating
owner; successful reads must not acquire member or allowance locks.

## Verification

- Opus independently confirmed duplicate mailbox reads and unnecessary callback
  preflight locks. Those findings were checked against source and PostgreSQL.
- Five focused unit suites: 315 passed (mailbox store, reconciliation, runtime
  usage decision, signed callback authentication, allowance).
- Three local PostgreSQL suites: 85 passed (runtime ownership, payload-free
  mailbox progress, Family allowance). Success-path runtime usage uses exactly
  three reads without transactions, locks, or period writes.
- Web typecheck and complexity guard pass. Existing complexity hotspots are
  unchanged; the patch adds no complexity debt.
- No schema or runtime protocol changes. Production rollout and observed
  pressure reduction remain separate from these local proofs.
- Internal performance correction; no member-facing behavior or changelog entry.

Completed: 2026-10-02
