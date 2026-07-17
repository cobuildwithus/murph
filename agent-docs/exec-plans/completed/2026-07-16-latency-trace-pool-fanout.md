# Serialize hosted ingress latency-trace locked updates

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Stop `recordHostedIngressProviderStarted` and
  `recordHostedIngressAssistantMilestone` from opening one concurrent
  `$transaction` per matched trace row, which pins one pooled Postgres
  connection per row on the per-assistant-turn latency callback path and can
  exhaust the 15-client web pool under light concurrent load.

## Success criteria

- Both record functions process matched trace rows sequentially, holding at
  most one pooled connection at a time, with per-row transaction semantics,
  matched/unmatched accounting, and merge behavior unchanged.
- Existing latency-store tests pass; a focused regression proves the locked
  updates no longer run concurrently.

## Scope

- In scope: `apps/web/src/lib/hosted-runtime-latency/store.ts`, matching tests,
  and expanding `docs/contracts/00-invariants.md` § Database Load And
  Collection Fanout with the two failure shapes this incident exposed
  (per-item parallel transactions; fanout composing across a request).
- Out of scope: latency route contracts, trace schema, any other fan-out sites
  (tracked in separate tasks).

## Constraints

- Observability must not add user latency: rows per call are few (one user's
  assistant input ids), so sequential execution stays in the same millisecond
  band while removing the pool-exhaustion failure mode.
Completed: 2026-07-16
