# Hosted Run Protocol

Last verified: 2026-04-20

## Decision

Hosted execution should converge on a run-centric protocol:

- `apps/web` owns external ingress ordering, the runtime cursor, snapshot refs, and redacted run recovery state.
- The executor adapter, currently Cloudflare and later potentially a TEE runner, owns no canonical queue or recovery truth.
- The private runtime owns internal assistant/parser/scheduler follow-up decisions while it is running.
- Encrypted snapshots and oversized payloads remain in blob storage.

The final seam is:

```text
append external ingress/event
acquire hosted run
prepare runtime snapshot
commit hosted run
finalize hosted run side effects
record redacted run logs/status
```

The old wake-by-wake protocol remains a compatibility lane while callers migrate, but it should not be extended with new runtime-internal work kinds.

## Why

Cloudflare is intentionally hard to treat as the primary support/debug surface. Run state that operators need to answer “what happened?” must be visible in web/Postgres as redacted coordination metadata instead of being hidden in Durable Object state, encrypted snapshots, or container logs.

The run protocol preserves the existing correctness spine from the canonical hosted wake work: web-owned cursor, cursor-version CAS, encrypted payloads, encrypted snapshots, and Cloudflare as execution-only. It removes the highest-friction seam: internal assistant follow-up work should not have to materialize back into the web wake queue before the current drain can observe it.

## Ownership rules

### Web/Postgres owns

- external ingress ledger rows
- `HostedExecutionCursor`
- `HostedRun`
- `HostedRunLog`
- redacted run status and recovery phase
- snapshot refs and cursor CAS
- product/control-plane facts such as member identity, billing, routing, share metadata, and device-sync authority

### Runtime owns

- plaintext execution while a run is active
- assistant session state
- inbox/parser/scheduler/outbox local state
- immediate internal follow-up drain decisions

### Cloudflare owns

- container addressing
- alarm/nudge acceleration
- short-lived active-run guardrails
- no canonical queue/cursor/finalize recovery truth

## Runtime timers

`nextRuntimeWakeAt` is a cursor projection from private runtime state. It is not an instruction for web to create an `assistant.cron.tick` row. When `nextRuntimeWakeAt` is due and there are no external events, `acquire hosted run` may return a zero-event `runtime_timer` run and let the runtime decide what is due.

The deprecated `assistantNextWakeAt` field exists only for the old wake-by-wake executor path.

## Finalize recovery

After a successful commit, any required side-effect/outbox finalization is represented by:

```text
HostedRun.status = committed_needs_finalize
HostedRun.preparedSnapshotRef = ...
HostedRun.outputCommittedSeq = ...
HostedRun.outputCursorVersion = ...
```

A later executor can acquire/resume that run and finalize it from web-visible recovery state. Durable Object `pending_commit_json`-style state should be treated as compatibility scaffolding, not the target recovery database.

## Observability

`HostedRun` is durable correctness/recovery state. `HostedRunLog` is best-effort redacted observability.

Logs may be lossy; run phase state must not be lossy.

Do not store plaintext messages, transcripts, vault data, or provider secrets in either table.
