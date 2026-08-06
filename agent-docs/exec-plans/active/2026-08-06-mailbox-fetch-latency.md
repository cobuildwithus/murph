# Hosted mailbox fetch latency deletion

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Reduce the established cold-start mailbox-import interval by deleting stale
  database protocol work and removing one unnecessary serialized query without
  changing mailbox ordering, access, AI gating, routing, or replay behavior.

## Success criteria

- The read-only mailbox projection executes as one direct query rather than an
  interactive transaction around one statement.
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

1. Prove the transaction wrapper is orphaned and map current query ordering.
2. Implement the smallest route/store deletion and conditional concurrency.
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
- PASS: direct root-client projection performs one `$queryRaw` and never enters
  `$transaction`; mutation owners retain their existing transaction helper.
- PASS: no-work, system-only, and consumed-replay batches skip both AI usage and
  group-state reads; fresh conversation coverage interlocks the two reads to
  prove they start concurrently. Usage denial returns without waiting for a
  deliberately unresolved optional group read.
- PASS: Web prepared typecheck, docs drift, and `git diff --check`.
- PASS: 30-sample protocol model with 100 ms injected database/network RTT:
  serial baseline p50 406 ms / p90 416 ms; deletion/concurrency candidate p50
  101 ms / p90 103 ms; modeled p50 reduction 305 ms. This is an exact
  three-round-trip sensitivity model, not production or loopback endpoint
  evidence.
