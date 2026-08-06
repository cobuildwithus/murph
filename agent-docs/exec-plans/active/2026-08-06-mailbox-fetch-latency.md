# Hosted mailbox fetch latency overlap

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Reduce the established cold-start mailbox-import interval by skipping
  unnecessary work and removing one serialized query without
  changing mailbox ordering, access, AI gating, routing, or replay behavior.

## Success criteria

- The read-only mailbox projection retains its existing 15-second interactive
  transaction boundary.
- No-op, system-only, and consumed-replay projections do not read group running
  state that the runtime cannot use.
- For a fresh conversation, the existing AI-usage gate and fail-soft group
  running-state read execute concurrently after active-access and projection.
- Focused behavior tests, Web typecheck, docs checks, and an RTT-sensitive local
  benchmark pass. No deployment or merge occurs.

## Invariants

- Active-access authorization remains before mailbox payload hydration.
- Mixed conversation/system ordering, replay floors, usage denial, and group
  authorization semantics remain unchanged.
- The authoritative post-restore mailbox watermark fetch remains in place; do
  not reintroduce the unsafe pre-restore result that could hide concurrent
  appends.
- Add no schema, wire contract, state owner, cache, service, dependency, or
  compatibility layer.

## Tasks

1. Map current query ordering and preserve its interactive transaction boundary.
2. Implement the smallest conditional-read and concurrency change.
3. Add focused access, conditional-read, failure, ordering, and concurrency
   coverage.
4. Measure at least 30 before/after samples under a controlled database RTT and
   exercise the hosted-local path without treating it as production evidence.
5. Run required verification, open an unmerged PR, and complete specialist,
   final ReviewGPT, and exact-head CI gates.

## Evidence

- Production unique established-cold traces place foreground import start to
  payload-decode start at about 0.60-0.70 seconds p50; payload decode itself is
  outside this candidate.
- Local state, routing, and warm SQL execution are sub-millisecond. Existing
  telemetry cannot split network, Vercel, Prisma transaction protocol, and
  access/usage round trips, so this PR will claim only locally measured
  protocol-turn savings until deployed evidence exists.

## Verification log

- PASS: 131 focused Web tests covering mailbox projection and internal routes.
- PASS: the root-client projection retains its single `$queryRaw` inside the
  Prisma client's 15-second interactive transaction boundary.
- FALSIFIED: a real local PostgreSQL relation-lock proof showed that Prisma's
  interactive timeout does not cancel an already blocked statement; the query
  stayed blocked until the lock was released and then surfaced `P2028`. The
  retained boundary is therefore fail-closed after an overlong statement, not
  a PostgreSQL statement-cancellation mechanism.
- PASS: no-work, system-only, and consumed-replay batches skip both AI usage and
  group-state reads; fresh conversation coverage interlocks the two reads to
  prove they start concurrently. Usage denial returns without waiting for a
  deliberately unresolved optional group read.
- PASS: Web prepared typecheck, docs drift, and `git diff --check`.
- RETIRED after specialist review: the original 30-sample protocol model with
  100 ms injected database/network RTT predicted a 305 ms p50 reduction by
  deleting the transaction protocol turns and overlapping one optional read.
  The transaction deletion also removed the Prisma client's 15-second
  execution deadline, so it was rejected. Only the conditional-read and
  concurrency portion remains.
- PASS: revised 30-sample 100 ms RTT sensitivity model for only the two reads
  retained by a fresh conversation: serial p50 207 ms, overlapped p50 102 ms,
  modeled p50 reduction 105 ms. This is a protocol sensitivity model, not
  production or loopback endpoint evidence.
