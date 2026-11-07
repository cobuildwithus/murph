# Core identity warm cache local implementation

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariant

Reuse the event identity index across device-import drains in one process while
preserving the complete ledger builder as authority. Canonical imports retain
existing identity, revision, overlay, alias, retraction and repair semantics.

## Scope and ownership

Core owns one in-memory vault entry, guarded by existing canonical serialization
and vault/shard metadata. Successful publication advances it from actual append
payloads through the same row reducer as cold construction. Delete caller session
tokens and changed-dependency tracking. Keep state bounded at 100,000 ledger rows.
No persisted index, schema, service, scheduler, deployment, push or PR.
The separate parent identity-index plan remains untouched; parent progress is
provided in the final report.

## Proof and decisions

- Regression first: two fresh sessions visited 1,000 unrelated rows on the second
  import at base. The replacement visits zero.
- Test-only instrumentation compares every successful import's resident index
  against a complete rebuild, including reduction bookkeeping.
- Invalidation covers unobserved append, shard deletion/replacement, vault root
  replacement, publication uncertainty, reducer failure, capacity and restart.
- A discovered replay-result alias exposed mutable cached records; returned events
  are copied at the public import result boundary, with a failing/passing test.
- Equal revisions preserve ledger order, including appends to earlier months.
- Alias histories and reservations remain request-local.
- All cache reads and updates use the existing canonical write-lock scope.

## Verification

Passed core import/preparation/invalidation equivalence (205 tests), session and
preemption (10 tests), importer alias/identity equivalence (73 tests), the full
importers suite (753 tests), device-syncd service (200 tests), and hosted runtime
admission/concurrent/single-snapshot plus option forwarding (50 tests).
Typechecks passed for core, importers, device-syncd and assistant-runtime.
The capture worker was built for the hosted runtime test prerequisite. Cold-scan
preemption fixtures explicitly invalidate seeded metadata because seeding now
warms the process cache.

`pnpm complexity:diff --base origin/main` passes: core complexity debt drops by 2.
Production source changes total +296/-477, net -181 lines (tests, docs, benchmarks
and tooling excluded). `pnpm docs:drift` passes with this separate execution record.
The discovered local threshold override issue is captured in the task-owned Frog
entry; verification policy is unchanged. Changed-file privacy and whitespace
checks pass. No member or production data was read.

The identical 70,000-row/55-shard fixture validates its event IDs and record shape.
Using base `1924bf1635`, first/second identity-index times were 852.28/893.24 ms;
current code measured 835.98/1.05 ms. Both base imports miss, and the second current
import hits. These are local synthetic observations, not production latency claims.
The earlier invalid-ID exploratory fixture is excluded from these measurements.

## Review and remaining limits

Parent review checked publication ordering, returned-record isolation, bounded
retention, existing-lock ownership, equivalent revision ordering, and complete
session-token removal. No runtime cache access occurs outside the canonical lock.
New sparse-history reduction preserves first ledger position for equal revisions;
reference groups retain ledger order across earlier-month appends. Cold builds
and alias repair history scans remain; the persisted-index follow-up is out of
scope. The one-vault/100,000-row bound intentionally falls back to full rebuilds.
No deployment, CI or external PR review is claimed for this local-only task.

## Delivery

Commit locally through scripts/committer with the requested co-author trailer.
Parent retains final combined-step review and release-note ownership; this local
internal implementation does not independently ship a feature or release.
Completed: 2026-11-02
