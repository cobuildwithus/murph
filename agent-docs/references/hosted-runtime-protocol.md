# Hosted Mailbox Runtime Protocol

Last verified: 2026-05-05

## Decision

Hosted execution is hard-cut to an exact-event mailbox plus
workspace-checkpoint protocol, with device-sync webhook freshness represented by
web-owned dirty state instead of mailbox fanout.
There is no executor-facing `HostedRun` protocol.

The live ownership split is:

- `apps/web` owns hosted product/control-plane facts, encrypted mailbox rows,
  latest workspace checkpoint metadata, redacted runtime status, and bounded
  redacted runtime logs. For Linq and Telegram conversation webhooks, it verifies
  and appends in web-owned code, then attempts to start a Vercel Workflow run
  that durably retries runner nudge by opaque mailbox item pointer only.
  Cloudflare Email ingress appends the same canonical mailbox item through a
  signed web callback and uses a signed pointer-only web callback to start that
  same durable nudge workflow.
  Device-sync webhook freshness is different: web records per-webhook
  trace/audit facts, upserts per-connection dirty resources/revisions,
  completes trace acceptance in the same transaction, and best-effort nudges the
  runner directly. The runtime pulls pending dirty rows through the required
  signed dirty-pending callback and acks checkpoint-safe handoff through the
  required dirty-ack callback.
  Stripe webhook ingress verifies the raw Stripe request locally, records only
  minimal receipt state in Postgres, and may start a separate Vercel Workflow
  with only the Stripe event id to retry reconciliation plus any activation
  runner nudge.
- `apps/cloudflare` owns per-user runner coordination, lease/alarm/nudge
  coalescing, container invocation, encrypted object plumbing, and signed
  callback transport.
  When hosted runtime crypto is configured, Cloudflare fetches signed
  ingress/runtime root envelopes from web through the signed
  `/api/internal/hosted-runtime/crypto-context` callback, verifies the authority
  signature, and unwraps only its `cloudflare-automation-secret` recipient. The
  signed full envelopes are disclosed to preserve signature verification over
  the web-authored body; Cloudflare still has no GCP KMS decrypt authority.
  During active mailbox import, the runner container calls a Worker-owned
  mailbox-payload decode route over the invocation outbound proxy. That route
  requires the active invocation lease, decrypts the mailbox payload with the
  Worker-owned ingress crypto context, and returns only a parsed hosted wake or
  a semantic blocked result. The container must not receive ingress root keys,
  callback-signing private material, private JWKs, or a root-fetch capability
  for mailbox import.
- `packages/assistant-runtime` restores the local runtime, imports mailbox
  rows, stages assistant input, runs assistant/device work, and checkpoints the
  resulting workspace.

The final seam is:

```text
append encrypted mailbox item or upsert device-sync dirty state
nudge runner
restore hosted workspace
import mailbox prefix into local runtime state and stage AssistantInputEvent rows
pull pending device-sync dirty rows
checkpoint after import
run best-effort local inbox projection/parser enrichment and checkpoint it
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
watermark, and only then makes one best-effort inbox projection attempt while
the decoded wake is still in memory. Projection status and inbox artifacts are
checkpointed separately as diagnostic/enrichment state. Failed projection is not
durably retried by hosted runtime unless a future executor adds enough durable
projection reference data to reconstruct the work without raw payload
duplication. Inbox capture and parser state remain useful projections for
search, display, attachment enrichment, and debugging, but hosted callers must
not stage hidden runtime-only inbox rows to make Codex admission succeed.
Invocation-local Worker routes such as artifact writes, browser-vault replica
writes, provider effects, and mailbox payload decode authorize the current
runner by active invocation identity (`attemptId`, `leaseGeneration`, and
`userId`). `workspaceVersion` is the workspace checkpoint compare-and-swap
guard and must stay on the checkpoint path rather than becoming generic
side-effect authorization.

## Current Protocol

### Deploy Compatibility Rule

Any web-to-Cloudflare or Cloudflare-to-web protocol change must land in this
order:

1. Consumer tolerant first: the new consumer must handle the old producer.
2. Producer dual path second: the new producer must still emit old-compatible
   work.
3. Contract later: remove the old path only after both services have been
   deployed and production lag is clear.

Do not add a deploy orchestrator or generic capability system by default. Use
this compatibility invariant first, and only introduce heavier machinery when a
specific protocol change cannot be made safe with the sequence above.

Hosted producers for exact user-visible events append one `HostedMailboxItem` in
the same transaction as the product/control-plane mutation that made work
necessary. Large payloads use `HostedMailboxPayload`; lane sequence allocation
uses `HostedMailboxLaneCounter`.
Hosted Linq and Telegram conversation webhook routes read the raw body and
verification headers only in the route/service process. That code verifies the
provider payload, appends the canonical encrypted mailbox item transactionally,
drains any receipt-local side effects, and attempts to start a Vercel Workflow
with only `{ mailboxItemId, source }` to nudge the per-user Cloudflare runner.
Cloudflare Email ingress verifies the authorized email route and sender, stores
the encrypted raw message, appends the canonical encrypted mailbox item through
web, and attempts to start the same pointer-only nudge workflow through a signed
web callback.
Raw provider bodies, raw email messages, message content, verification headers,
provider secrets, and decrypted mailbox payloads must not be Vercel Workflow
inputs or outputs. If the pointer workflow cannot be accepted after the mailbox
row exists, the failure is logged as a post-commit best-effort handoff failure
and does not make provider ingress fail. This avoids duplicate provider retries
after the durable append. The minute hosted mailbox lag sweeper is the current
bounded recovery backstop for missed workflow starts: it compares mailbox
high-water rows with checkpointed import status and nudges lagged runners by
opaque user/work pointer. A DB-backed pending-handoff reconciler remains future
hardening for exact workflow-start failure journaling.
Duplicate provider retries, duplicate email delivery attempts, or duplicate
workflow attempts are safe because mailbox append dedupes by event id and runner
nudges only coalesce pending work.

Hosted device-sync webhook freshness does not append mailbox work and does not
start the pointer nudge workflow. The route claims the exact provider trace,
writes sparse audit/signal facts, widens the per-connection dirty row and safe
dirty resource/window map, completes the trace in the same transaction, then
best-effort nudges the user runner. The dirty sweeper is the bounded recovery
backstop for missed direct nudges. The runtime must support dirty-pending and
dirty-ack callbacks; dirty ack means the dirty revision was handed off into the
checkpointed local device-sync job store, not that upstream provider sync
succeeded. Connection-established and disconnect lifecycle commands may still
use coarse device-sync mailbox wakes because they are explicit lifecycle events,
not high-cardinality freshness hints.

Hosted Stripe webhook routes keep raw request bodies and Stripe signatures in
the route/service verification path only. After verification, web stores the
minimal `HostedStripeEvent` receipt and starts a Stripe-specific Vercel Workflow
with `{ eventId }`. The workflow uses one event-id step to re-fetch the Stripe
event through the existing Stripe API reconciliation path, apply billing and
activation mailbox facts behind the hosted Stripe receipt claim, and retry the
Cloudflare runner nudge when activation appended runtime work. Step inputs and
outputs stay pointer-only; any member or activation ids needed for retry are
re-derived inside the step from web-owned Postgres and Stripe. Raw Stripe
payloads, signatures, customer objects, invoice objects, provider headers, and
mailbox payloads must not be Workflow inputs or step outputs. The minute cron
drain remains a receipt retry fallback for due Stripe rows.

Cloudflare does not acquire a web run row. A runner nudge only asks the
per-user Durable Object to invoke the container if needed. The Durable Object
keeps lease, in-flight invocation, alarm, and short-lived coordination metadata
only. It does not persist queue history, per-message completion, outbox truth,
assistant channel enablement state, or checkpoint recovery truth.
When the Durable Object is idle, the persisted nudge starts the runner drive
directly and keeps the alarm as recovery. When an invocation is active, runtime
liveness heartbeats surface that input is available so the active-turn refresh
path can import late mailbox rows; the alarm remains the durable backstop if the
active path does not consume or commit them.

The runtime reads `HostedWorkspace`, validates workspace version/user metadata,
then restores the encrypted local workspace before fetching mailbox rows. The
restored `.runtime/operations/assistant/hosted-mailbox.json` file is the
authoritative source for imported per-lane watermarks; `HostedWorkspace`
redacted status is a diagnostic/status surface, not an import progress input.
Fetching after restore keeps user messages appended during restore visible to
the same invocation instead of hiding them behind a stale pre-restore read. The
runtime stages decoded conversation rows as assistant input, checkpoints
immediately after staging, and attempts inbox projection once as a
post-checkpoint enrichment effect before assistant admission. Projection status
and artifacts checkpoint separately and best-effort, so failed or slow
projection does not delay the staged mailbox watermark and does not imply a
durable retry queue. Successful projection may make parsed or bounded attachment
evidence available to the same assistant turn.
Retryable mailbox import blockers, including lane gaps, missing or temporarily
unavailable sidecar payloads, deferred imports, and retryable importer blocks,
stay pending instead of aging into quarantine. They do not advance lane
watermarks, and the runtime/checkpoint result carries the next fast mailbox
retry wake so Cloudflare can promptly reinvoke the workspace.
Conversation import is discovery, not assistant handling:
mailbox watermarks prove only that source input was staged. A conversation input remains
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

Mailbox import has no provider-visible pre-assistant side-effect phase.
Provider-visible cleanup and read acknowledgement must not run between import
checkpoint and assistant admission. Local inbox projection and parser enrichment
may run after the import checkpoint and before assistant admission because they
only update vault projection artifacts and `AssistantInputEvent` projection
state. Linq inbound message deletion is still eventual, but it is queued only
after terminal handling evidence is durable under
`.runtime/operations/assistant/auto-reply/evidence/<captureId>.json` and is
drained through the hosted provider-cleanup retry state after the next workspace
checkpoint.

The hosted workspace checkpoint ref may be either a full/base workspace bundle
or a layered `{base, hot}` ref. The full/base bundle preserves durable
operational runtime continuity under `vault/.runtime/operations/**` by default,
excluding explicit unsafe/process-local or repair-bin material such as secrets,
device-sync runtime state, parser executable-selector config, quarantine
payloads, locks, pid/socket files, global cache/tmp, and rebuildable
projections. Hot checkpoints snapshot a much narrower explicit assistant
runtime continuity subset under `vault/.runtime/operations/assistant/**` for
user-visible checkpoint boundaries such as mailbox import, active-turn
acceptance, and pre-delivery outbox sending state.
Operator-home `.codex-hosted/**` remains full/base snapshot provider
continuity, not hot-state continuity. Restore applies the base bundle first,
clears the vault hot-state include paths, leaves operator-home Codex state from
the base image in place when the hot bundle omits it, then restores the latest
hot bundle so files deleted by a hot checkpoint cannot resurrect from the base
image. If no base snapshot exists, the runner may fall back to a full
checkpoint so non-hot workspace content is not lost. Hot checkpoints also carry
forward the browser-vault replica ref for the current base snapshot explicitly;
if that continuity is missing or stale, the runner uses a full checkpoint
instead. `system_mailbox_receipt` remains full because activation can mutate
canonical vault bootstrap state that must be present for later conversation
wakes. Maintenance checkpoints refresh the full/base provider-continuity image,
but pre-delivery outbox sending must stay hot so user-visible delivery is not
gated on compacting or validating large native Codex continuity artifacts.

Assistant liveness is the stronger invariant than dashboard sidecar freshness.
The web checkpoint callback must accept a valid workspace snapshot checkpoint
from an older or partially deployed runner when `browserVaultReplicaRef` is
absent or explicitly null. Missing browser-vault replica continuity is
recoverable dashboard state and must not stop mailbox import, assistant
admission, outbox checkpointing, or the runner's ability to reach idle. When a
replica ref is supplied, web still validates that it matches the checkpoint base
snapshot hash; stale or mismatched replica metadata may be rejected because that
indicates an internally inconsistent sidecar, not a recoverable omission. Future
checkpoint fields that are not required to answer user messages must follow the
same compatibility rule: old deployed runners may omit them without blocking
assistant progress, and any stricter lockstep contract needs an explicit
capability/version rollout plan before it can be required in production.
The same runner-side liveness rule applies to auxiliary lanes: browser-vault
publishing, hot-checkpoint current-ref reads, inbox projection and parser
enrichment, provider cleanup and read acknowledgement, usage export, telemetry,
log export, post-checkpoint system-mailbox acknowledgement, billing/customer
decoration, and device-connect context enrichment may record degraded status,
request a later wake, or force a full checkpoint. They must not prevent mailbox
import, assistant admission, outbox intent checkpointing, or reply delivery when
the user-message trust boundary is otherwise valid. Hard failures remain
appropriate for wrong-user authority, invalid auth, undecryptable mailbox
payloads, mismatched supplied sidecar refs, and lease/CAS conflicts.

Hosted snapshots also preserve safe non-secret Codex home continuity under
`.codex-hosted/**` by default, while excluding environment files, credential,
auth, token, key, cert, temp, cache, log, history, lock, pid, socket, and
secret-looking paths. Checkpoint diagnostics for that tree may expose only
candidate/included counts, exclusion classes, and keyed hashed relative names
when the hosted log fingerprint secret is configured; raw Codex home paths,
filenames, prompts, and credentials must not appear in hosted runtime logs.
Without the fingerprint secret, checkpoint diagnostics stay count/class only.

## Ownership Rules

### Web/Postgres Owns

- `HostedMailboxItem`
- `HostedMailboxPayload`
- `HostedMailboxLaneCounter`
- `HostedWorkspace`
- `HostedRuntimeLog`
- `hosted_user_crypto_envelope` signed wrapped domain-root envelopes
- `hosted_user_crypto_audit` append-only hosted crypto authority audit events
- runtime status projection from `HostedWorkspace.redactedStatusJson`, mailbox lag, and bounded logs
- hosted member identity/routing/billing/email authorization
- hosted device-sync authority
- hosted AI usage ledger, pricing/accounting projection, and monthly allowance aggregate
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
- checkpoint snapshot policy and metrics (`full` vs `hot`, external artifact
  PUT count, bundle PUT count, hot-state file/byte counts)

### Cloudflare Owns

- per-user Durable Object routing
- lease/fencing generation
- alarm/nudge coalescing
- container invocation
- signed web usage-gate enforcement before container invocation
- encrypted bundle/artifact/env/journal object plumbing
- worker-to-web callback signing
- verification of signed ingress/runtime root envelopes plus Cloudflare P-256
  recipient unwrap; Cloudflare must not hold GCP KMS decrypt authority

Cloudflare does not own product facts, mailbox state, mailbox import progress,
hosted AI usage spend, assistant channel enablement state, outbox truth, or
durable queue history.

### Vercel Workflow Owns

- accepted pointer-only nudge workflow run state for Linq, Telegram, and Cloudflare Email ingress handoff
- Stripe event-id reconciliation workflow run state after local Stripe signature verification and receipt recording
- workflow event logs for opaque mailbox item ids, Stripe event ids, channel/source labels, retry status, and step errors
- runner nudge handoff and retry state after web-owned verification and mailbox append have committed and the workflow start is accepted

Vercel Workflow does not own raw webhook payloads, provider verification
headers, Stripe request bodies, provider secrets, canonical product facts,
mailbox payload content, mailbox state after Postgres commit, message-processing
completion, outbox truth, or per-user runner coordination. Treat workflow state
as durable execution state, not as queryable product truth.

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
