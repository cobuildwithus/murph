# Hosted Mailbox Runtime Protocol

Last verified: 2026-05-01

## Decision

Hosted execution is hard-cut to a mailbox plus workspace-checkpoint protocol.
There is no executor-facing `HostedRun` protocol.

The live ownership split is:

- `apps/web` owns hosted product/control-plane facts, encrypted mailbox rows,
  latest workspace checkpoint metadata, redacted runtime status, and bounded
  redacted runtime logs.
- `apps/cloudflare` owns per-user runner coordination, lease/alarm/nudge
  coalescing, container invocation, encrypted object plumbing, and signed
  callback transport.
- `packages/assistant-runtime` restores the local runtime, imports mailbox
  rows, stages assistant input, runs assistant/device work, and checkpoints the
  resulting workspace.

The final seam is:

```text
append encrypted mailbox item
nudge runner
restore hosted workspace
import mailbox prefix into local runtime state and stage AssistantInputEvent rows
checkpoint after import
run local runtime work until idle or budget
checkpoint final runtime state
project redacted status/logs
```

Hosted execution is a thin containerized runner over the same local runtime
input spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

The hosted adapter is the mailbox importer. It decodes a conversation mailbox
row into a bounded `AssistantInputEvent`, checkpoints the mailbox staged
watermark, and only then attempts inbox projection. Projection status and inbox
artifacts are checkpointed separately as best-effort enrichment. Inbox capture
and parser state remain useful projections for search, display, attachment
enrichment, and debugging, but hosted callers must not stage hidden
runtime-only inbox rows to make Codex admission succeed.

## Current Protocol

Hosted producers append one `HostedMailboxItem` in the same transaction as the
product/control-plane mutation that made work necessary. Large payloads use
`HostedMailboxPayload`; lane sequence allocation uses
`HostedMailboxLaneCounter`.

Cloudflare does not acquire a web run row. A runner nudge only asks the
per-user Durable Object to invoke the container if needed. The Durable Object
keeps lease, in-flight invocation, alarm, and short-lived coordination metadata
only. It does not persist queue history, per-message completion, outbox truth,
assistant channel enablement state, or checkpoint recovery truth.

The runtime reads `HostedWorkspace`, restores the encrypted local workspace,
fetches mailbox rows after its checkpointed per-lane watermarks, stages decoded
conversation rows as assistant input, checkpoints immediately after staging, and
attempts any available inbox projection as a post-checkpoint enrichment effect.
Projection status and artifacts checkpoint separately and best-effort, so failed
or slow projection does not delay the staged mailbox watermark. Conversation
import is discovery, not assistant handling: mailbox watermarks prove only that
source input was staged. A conversation input remains
pending until the assistant runtime writes durable terminal auto-reply evidence
for that input, such as committed reply intent evidence or explicit suppression
evidence. Auto-reply channel state stores only a fixed `eligibleAfter` seed
boundary for channel enablement; it is never advanced as handling progress.
Inbox projections are rebuildable scan acceleration and must not hide
imported-but-unhandled assistant input. Late same-conversation input is
supported by the hosted mailbox-backed active-turn input refresh: at provider
request boundaries and at the final commit barrier, the runtime refreshes
mailbox rows, stages any new input, checkpoints accepted input state, and
continues the same logical assistant turn before outbox intent creation.

This is the deploy/reset recovery contract. If a Cloudflare Durable Object,
worker isolate, or runner container resets after mailbox import checkpointing
but before assistant handling, the next invocation starts with an advanced
mailbox watermark and no new fetched items. That must still run the assistant
phase, because replay authority comes from staged assistant input plus missing
terminal auto-reply evidence, not from mailbox import progress.

Mailbox import has no pre-assistant side-effect phase. Provider-visible cleanup,
read acknowledgement, parser drain, and other enrichment work must not run
between import checkpoint and assistant admission. Linq inbound message deletion
is still eventual, but it is queued only after terminal handling evidence is
durable under `.runtime/operations/assistant/auto-reply/evidence/<captureId>.json`
and is drained through the hosted provider-cleanup retry state after the next
workspace checkpoint.

The hosted workspace snapshot preserves durable operational runtime continuity
under `vault/.runtime/operations/**` by default, excluding explicit
unsafe/process-local or repair-bin material such as secrets, device-sync runtime
state, parser executable-selector config, quarantine payloads, locks,
pid/socket files, global cache/tmp, and rebuildable projections. This is
intentionally denylist-based so newly added hosted operational state is not
silently dropped from later checkpoints.

## Ownership Rules

### Web/Postgres Owns

- `HostedMailboxItem`
- `HostedMailboxPayload`
- `HostedMailboxLaneCounter`
- `HostedWorkspace`
- `HostedRuntimeLog`
- runtime status projection from `HostedWorkspace.redactedStatusJson`, mailbox lag, and bounded logs
- hosted member identity/routing/billing/email authorization
- hosted device-sync authority
- hosted AI usage ledger
- anonymized assistant-runtime issue sink

### Runtime Owns

- mailbox import watermarks
- staged assistant input events and accepted-input journal state
- fixed auto-reply channel enablement boundaries
- auto-reply terminal handling evidence
- assistant sessions, transcripts, receipts, diagnostics, and outbox intents
- same-conversation turn revision
- provider delivery and receipt/reconciliation policy
- runtime timers and next wake projection
- checkpoint timing

### Cloudflare Owns

- per-user Durable Object routing
- lease/fencing generation
- alarm/nudge coalescing
- container invocation
- encrypted bundle/artifact/env/journal object plumbing
- worker-to-web callback signing

Cloudflare does not own product facts, mailbox state, mailbox import progress,
assistant channel enablement state, outbox truth, or durable queue history.

## Runtime Timers

Private runtime timers live in local runtime state and surface only as a
redacted due-time projection on the workspace/status surface. Web does not
materialize timer rows, and Cloudflare does not persist timer work items.

If the runner needs a synthetic in-process object for logging or execution
plumbing, it may use an internal-only `runtime.timer` wake. That object is not a
persisted mailbox row unless an external product/control-plane mutation
explicitly appends one.

## Observability

`HostedRuntimeLog` is redacted observability, not correctness state. Logs may be
lossy and must not contain plaintext messages, transcripts, vault data,
provider payloads, secrets, local paths, or direct personal identifiers.

Correctness is recovered from the encrypted workspace checkpoint plus mailbox
rows that remain fetchable by the runtime until imported and checkpointed.

## Deleted Protocol

The old run-centric acquire/commit/finalize protocol is intentionally gone from
live code. Do not reintroduce:

- web-owned `HostedRun`
- web-owned `HostedExecutionCursor`
- web-owned turn-input peek/adopt
- Cloudflare acquire/commit/finalize clients
- executor-facing run-drain request/result contracts
- adopted event-result or cleanup-target arrays

Historical completed execution plans may still mention those terms as past
state. Live architecture docs and production code should not treat them as
current primitives.
