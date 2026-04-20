# Hosted Run Protocol

Last verified: 2026-04-20

## Decision

Hosted execution is hard-cut to a run-centric protocol:

- `apps/web` owns external ingress ordering, the runtime cursor, snapshot refs, and redacted run recovery state.
- The external ingress ledger exists only to order external events; it is not the executor-facing protocol.
- The executor adapter, currently Cloudflare and later potentially a TEE runner, owns no canonical queue or recovery truth and must invoke runtime execution through `runDrain`.
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

There is no legacy wake-by-wake runtime execution lane. Do not describe or preserve a `materialize` / `unseen` / `terminal` / `commit` / `finalize` fallback for hosted executor jobs, including the deleted web/Cloudflare handoff loop.

## Current protocol

All hosted executor jobs must use `runDrain`:

```text
acquire hosted run
execute run-drain runtime entrypoint
commit prepared snapshot through web CAS
finalize side effects from web-visible HostedRun recovery state
```

The external ingress ledger is ingress-only. It is not an executor-facing runtime protocol. Internal runtime follow-ups stay inside runtime state and surface only as `nextRuntimeWakeAt`.

Runtime job requests are `runDrain`-shaped. They carry `request.run` plus `request.runDrain`; they do not carry an independent `request.wake` seam.

## Why

Cloudflare is intentionally hard to treat as the primary support/debug surface. Run state that operators need to answer “what happened?” must be visible in web/Postgres as redacted coordination metadata instead of being hidden in Durable Object state, encrypted snapshots, or container logs.

The run protocol preserves the existing correctness spine from the ingress ledger and hosted run CAS flow: web-owned cursor, cursor-version CAS, encrypted payloads, encrypted snapshots, and Cloudflare as execution-only. It removes the highest-friction seam: internal assistant follow-up work must not materialize back into a web-owned wake loop before the current drain can observe it.

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
- no web-materialized assistant/parser follow-up rows

### Cloudflare owns

- container addressing
- alarm/nudge acceleration
- short-lived active-run guardrails
- no canonical queue/cursor/finalize recovery truth
- no wake-by-wake execution lifecycle state

## Runtime timers

`nextRuntimeWakeAt` is a cursor projection from private runtime state. It is not an instruction for web to create any persisted timer ingress row. When `nextRuntimeWakeAt` is due and there are no external events, `acquire hosted run` may return a zero-event `runtime_timer` run and let the runtime decide what is due.

If executor/runtime plumbing needs a wake-shaped object for logs or callback wiring, it must use an internal-only `kind = "runtime.timer"` representation. That object is not persisted ingress and not a durable contract between web and runtime.

No hosted timer ingress kind exists. Private runtime timers use `runtime.timer` only. If explicit external/manual/admin scheduling is ever needed, it must use a separate external command kind rather than reusing private runtime-timer semantics.

`nextRuntimeWakeAt` is the only hosted cursor wake projection. Internal assistant/parser/device-sync follow-ups stay runtime-local and surface only as this redacted due-time hint. There is no second cursor-level follow-up hint and no internal web-materialized assistant/parser follow-up lane.

## Finalize recovery

After a successful commit, any required side-effect/outbox finalization is represented by:

```text
HostedRun.status = committed_needs_finalize
HostedRun.preparedSnapshotRef = ...
HostedRun.outputCommittedSeq = ...
HostedRun.outputCursorVersion = ...
```

A later executor can acquire/resume that run and finalize it from web-visible recovery state. Durable Objects do not persist commit/finalize recovery truth; they keep only short-lived active-run and alarm/addressing state.

## Observability

`HostedRun` is durable correctness/recovery state. `HostedRunLog` is best-effort redacted observability.

Logs may be lossy; run phase state must not be lossy.

Do not store plaintext messages, transcripts, vault data, or provider secrets in either table.
