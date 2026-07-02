# Hosted Mailbox Runtime Protocol

Last verified: 2026-06-23

## Decision

Hosted execution is hard-cut to an exact-event mailbox plus
workspace-checkpoint protocol, with device-sync webhook freshness represented by
web-owned dirty state instead of mailbox fanout.
There is no executor-facing `HostedRun` protocol.

The live ownership split is:

- `apps/web` owns hosted product/control-plane facts, encrypted mailbox rows,
  latest workspace checkpoint metadata, redacted runtime status, and bounded
  redacted runtime logs. For Linq and Telegram conversation webhooks, it verifies
  and appends in web-owned code, then signals the per-user hosted Temporal
  workflow by opaque mailbox item pointer only.
  Cloudflare Email ingress appends the same canonical mailbox item through a
  signed web callback and uses a signed pointer-only web callback to signal that
  same Temporal workflow.
  Device-sync webhook freshness is different: web records per-webhook
  trace/audit facts, upserts per-connection dirty resources/revisions,
  appends one deterministic `device-sync.wake` mailbox handoff if the connection
  transitioned from clean to dirty, and completes trace acceptance in the same
  transaction. The post-commit Temporal signal carries only the mailbox pointer.
  There is no periodic dirty-row recovery sweep.
  The runtime pulls pending dirty rows through the required signed dirty-pending
  callback and acks checkpoint-safe handoff through the required dirty-ack
  callback.
  Stripe webhook ingress verifies the raw Stripe request locally, records only
  minimal receipt state in Postgres, and may start a separate Vercel Workflow
  with only the Stripe event id to retry reconciliation. Any appended activation
  work wakes the hosted runtime through the same Temporal signal path.
- `apps/cloudflare` owns per-user runner coordination, lease/alarm/fence
  coordination, container invocation, encrypted object plumbing, and signed
  callback transport.
  UserRunner holds one foreground runtime write fence for the whole hosted
  invocation and passes the single `idleCheckpointDelayMs` runtime policy knob.
  The runtime, not the host, waits for the idle window or a scheduled wake and
  checkpoints dirty local runtime state before returning success. When
  Cloudflare reports container activity
  expiry, the shell yields to any active foreground operation; otherwise it runs
  cleanup only. There is no pending idle-checkpoint Durable Object state, idle
  checkpoint lease, idle checkpoint alarm, or host-owned shutdown checkpoint
  invocation.
  When hosted runtime crypto is configured, Cloudflare fetches signed
  ingress/runtime root envelopes from web through the signed
  `/api/internal/hosted-runtime/crypto-context` callback, verifies the authority
  signature, and unwraps only its `cloudflare-automation-secret` recipient. The
  signed full envelopes are disclosed to preserve signature verification over
  the web-authored body; Cloudflare still has no GCP KMS decrypt authority.
  During active mailbox import, the runner container calls a Worker-owned
  mailbox-payload decode route over the invocation outbound proxy. That route
  requires the runtime write fence, decrypts the mailbox payload with the
  Worker-owned ingress crypto context, and returns only a parsed hosted wake or
  a semantic blocked result. Legacy active-invocation RPC names remain only for
  deployed-caller compatibility and must be deleted after 2026-05-25. The
  container must not receive ingress root keys, callback-signing private
  material, private JWKs, or a root-fetch capability for mailbox import.
- `packages/assistant-runtime` restores the local runtime, imports mailbox
  rows, stages assistant input, runs assistant/device work, and checkpoints the
  resulting workspace.

The final seam is:

```text
append encrypted mailbox item or upsert device-sync dirty state
signal Temporal hosted orchestration
restore hosted workspace
import mailbox prefix into local runtime state and stage AssistantInputEvent rows
pull pending device-sync dirty rows
run best-effort local inbox projection plus audio/video transcript enrichment without checkpointing it
run local runtime work until idle or budget
wait for the runtime idle window, a coalesced wake, or a projected runtime wake
checkpoint final dirty runtime state with checkpoint reason idle_shutdown
project redacted status/logs
```

Hosted execution is a thin containerized runner over the same local runtime
input spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

The hosted adapter is the mailbox importer. It decodes a conversation mailbox
row into a bounded `AssistantInputEvent`, stages it in local runtime state,
marks the active invocation dirty, and checkpoints that dirty state only at the
final runtime-owned idle or scheduled-wake checkpoint. Best-effort inbox projection may
run while the decoded wake is still in memory. Projection status is logged and
local inbox artifacts may help the same invocation, but hosted runtime must not
take a separate workspace checkpoint just to persist projection/cache cleanup.
Failed projection is not durably retried by hosted runtime unless a future
executor adds enough typed remote projection reference data to reconstruct the
work without raw payload duplication. Inbox capture state, raw attachment
paths, and audio/video transcript state remain useful projections for search,
display, attachment evidence, and debugging, but hosted callers must not stage
hidden runtime-only inbox rows to make Codex admission succeed.
Invocation-local Worker routes such as artifact writes, browser-vault replica
writes, provider effects, and mailbox payload decode authorize the current
runner by runtime-kind write-fence identity (`attemptId`, `generation`, and
`userId`). The transport still carries the generation in the historical
`leaseGeneration` header until the 2026-05-25 compatibility deletion.
External provider egress must not send exact runtime authority headers to
third-party provider origins. Runtime provider fetches instead carry the
bound-user header plus a short-lived opaque provider-egress token from the
active invocation lease to the Worker egress authorizer. UserRunner stores only
the token hash on the active write fence. The Worker validates the token against
that hash, injects the Worker-owned provider credential on success, and strips
the provider-egress token before forwarding upstream.
Warm Codex App Server OpenAI egress uses a signed Murph provider credential in
the native OpenAI bearer slot instead of the injected-credential sentinel. That
credential identifies provider kind, hosted user, and runner container name. It
does not authorize egress by itself: the Worker verifies the signature, asks
UserRunner whether the same runner currently has an active runtime for that
user/provider, then injects the Worker-owned OpenAI credential only after the
OpenAI request policy passes. Missing runner state, missing active runtime,
wrong runner, wrong user, wrong provider, missing signing config, or validator
failure all fail closed without provider secret injection. `ctx.containerId` and
RunnerContainer active-user recovery are not OpenAI provider-egress authority.
Runtime-controlled delivery/control provider integrations such as Linq,
Telegram, and WhatsApp still use provider-egress token proof when exact runtime
authority headers are absent. Legacy lookup providers such as Exa, Mapbox,
`murph_data_api`, and `workers_ai_transcribe` remain on the tokenless
active-user-fence fallback until they are migrated deliberately. Runner
container names remain lifecycle/routing handles, not provider-egress authority
outside the explicit signed provider credential identity checked by UserRunner.
Hosted-local may rewrite loopback provider bases to the configured
`HOSTED_EXECUTION_RUNNER_HOST_ALIAS` so Linux runner containers can reach host
stubs through the Docker bridge. The provider-fetch allowlist may accept HTTP
for that exact alias only when hosted-local markers are present and the alias is
a local/test host or private IPv4 address; arbitrary HTTP provider base URLs
must still fail closed.
Hosted-local direct-R2 MinIO keeps host control checks on loopback but publishes
the Docker-facing sidecar port on a container-reachable bind address, because
runner containers reach the sidecar through their host alias rather than the
host process loopback socket.
`workspaceVersion` is the workspace checkpoint compare-and-swap guard and must
stay on the checkpoint path rather than becoming generic side-effect
authorization.
Package-owned hosted checkpoint bridges must validate the current lease's
`attemptId`, `leaseGeneration`, `userId`, and `workspaceVersion` against the
checkpoint request before snapshot creation, direct snapshot upload, and web
checkpoint publication.
Legacy active-invocation heartbeat and container-stopped methods are inert
compatibility shims, not lifecycle policy, and must be deleted after
2026-05-25. Live lifecycle control is the runtime write fence plus explicit
execution cleanup.

## Current Protocol

### Foreground Priority Rule

Fresh user conversation input has absolute priority over background hosted
runtime work. Device sync, provider cleanup, browser-vault refresh, system
maintenance, and idle checkpointing are idle-only lanes; they must not make a
user message wait for background work to finish.

When a foreground wake arrives while idle maintenance is running, the
maintenance lane must yield, abort, or reschedule. This includes
idle-shutdown checkpointing: an in-progress idle checkpoint must not keep a
fresh user message behind snapshot or checkpoint completion. The runtime may
carry forward the maintenance wake, dirty state, or retry metadata needed to
finish later, but assistant admission, assistant automation, outbox intent
creation, and reply delivery must stay independent of device-sync and
maintenance completion.
If an `inbox_media_retention` invocation is the active write-fenced child when
foreground/default work arrives, the runner preempts that exact child through
the existing container abort seam, clears the old fence by identity, and starts
foreground work. Retention remains recoverable through the workspace's projected
retention wake instead of becoming a second scheduler concern.
Runtime-fence liveness uses one container probe vocabulary: exact-active,
inactive, mismatched, or indeterminate. The probe only answers whether the
container still has the requested fence identity in flight. It does not own
completion or replacement policy: UserRunner maps inactive fences to one
controller-owned path that clears the stale fence by identity and starts a
replacement when command budget remains. Committed-progress recovery stays in
the accepted transport-failure path, where the invocation service owns that
context. Ambiguous or mismatched foreground ownership is preserved/retried.
Existing active fences that predate persisted container names resolve through
the legacy unversioned per-user container name for liveness probes; fresh
starts still use the current versioned container resolver.
For foreground/default work behind an `inbox_media_retention` fence, the
existing workspace-invocation abort seam is the preemption authority when
liveness is ambiguous. A local exact-pointer abort enters the same
inactive-fence replacement path. An inactive liveness proof must still send the
identity-checked abort first so any queued exact retention invocation is
canceled before the fence is cleared; an inactive result or queued matching
abort is replacement-safe. Missing-pointer abort delivery without inactive
proof is only an abort request and preserves the fence until a later liveness
pass proves the old child inactive. Stale or failed status preserves the fence
and retries.

The foreground-priority rule does not weaken correctness checks. Wrong-user
authority, invalid auth, undecryptable mailbox payloads, stale leases, and
workspace checkpoint compare-and-swap conflicts still fail closed rather than
publishing partial or corrupt state.

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
Because the Temporal worker can deploy automatically before the manual
Cloudflare worker rollout, new Temporal-to-Cloudflare `ensure-processing` fields
must either be accepted by the currently deployed worker or keep processing
pending with `retry_later` until the consumer deployment catches up.
Web-to-Temporal signal kinds have the same compatibility constraint: add
workflow `patched()`/version gating for any new signal that changes wait or
reconciliation behavior, deploy the Temporal worker before web emits that signal, and
keep old histories replaying the old invalid/no-op signal behavior.

The PR65+PR66 runtime reconciliation change is an explicit hard-cut exception to
the tolerant deploy sequence above. It deletes the old demand Activity and
legacy direct demand signals, so operators must stop old Temporal workers,
terminate old `hosted-user-runtime:*` workflows, deploy matching web,
Temporal, and Cloudflare builds together, then reseed new histories. Existing
Cloudflare Durable Object state is not canonical product truth for this
cutover; the new runner schema drops the retired `runner_bundle_slots` table
during schema migration instead of requiring a manual Durable Object wipe.

Hosted producers for exact user-visible events append one `HostedMailboxItem` in
the same transaction as the product/control-plane mutation that made work
necessary. Large payloads use `HostedMailboxPayload`; lane sequence allocation
uses `HostedMailboxLaneCounter`.
`HostedMailboxLaneCounter` also carries the durable per-lane `consumed_seq`
watermark: after a foreground assistant pass finishes with zero failed replies
and no pending foreground assistant input, the runtime acks the conversation
watermark through the runner-allowlisted `/api/internal/hosted-mailbox/consume`
callback (monotonic max, clamped to the lane append high-water, best-effort).
The mailbox fetch response returns `consumedSeqByLane`; replayed items at or
below the watermark are re-staged as conversation context with a null reply
target, never as fresh reply candidates, so a workspace restore from a stale
snapshot cannot re-reply to an already-handled message. A container rollout
SIGTERM additionally makes the runtime treat the idle window as elapsed and run
its normal `idle_shutdown` checkpoint inside the termination grace period.
Hosted Linq and Telegram conversation webhook routes read the raw body and
verification headers only in the route/service process. That code verifies the
provider payload, appends the canonical encrypted mailbox item transactionally,
drains any local non-mailbox side effects, and signals the per-user hosted
Temporal workflow with only `{ mailboxItemId, lane, laneSeq }`.
Cloudflare Email ingress verifies either a signed reply alias for an active
member or the fixed public sender route plus a trusted authenticated-sender
verdict, stores the encrypted raw message, appends the canonical encrypted
mailbox item through web, and attempts the same pointer-only Temporal signal
through a signed web callback. Signed reply aliases are private routing
capabilities; they do not prove SMTP sender identity. Web may derive the same
deterministic per-member alias as Cloudflare so settings can show the reachable
address, but settings should only present the alias after web has persisted the
matching reply-alias lookup key for route resolution.
Raw provider bodies, raw email messages, message content, verification headers,
provider secrets, and decrypted mailbox payloads must not be Temporal workflow
inputs, outputs, or history payloads. The pointer signal only wakes durable
orchestration; Temporal then re-reads web-owned reconciliation facts and, if
processing is needed, calls Cloudflare's short-lived `ensure-processing`
adapter. There is no
webhook-to-Cloudflare runner nudge path, no direct web-to-Cloudflare message
path, and no second wake authority. If the
Temporal signal cannot be accepted after the mailbox row exists, the failure is
logged as a post-commit best-effort handoff failure and does not make provider
ingress fail. Web does not run a mailbox-lag cron backstop: missed post-commit
workflow signal recovery remains future hardening for a DB-backed
pending-handoff reconciler or Temporal-owned reconciler. Repeated dirty hints
while the same connection is already dirty do not append or signal another
device-sync wake; dirty coalescing remains the work-queue invariant, and any
stronger signal-delivery repair must be mailbox-wide. Redacted runtime logs
remain diagnostic evidence only; they must not be merged into checkpointed
import status for workflow completion or status projection. The narrow liveness
exception is the exact `runner.accepted_attempt_failed` event: after web has
durably recorded that metadata-only row, it may send a cooldown-throttled,
payload-free `runtime_recheck_requested` Temporal signal. That row carries the
fence `attemptId`/`leaseGeneration` plus metadata-only error diagnostics and,
in `redactedJson`, the `attemptLivenessProbeOutcome` enum
(`active`/`inactive`/`mismatch`/`unsupported`/`error`/`timeout`) alongside the derived
`attemptStillActive`/`fenceCleared` flags. The probe outcome is the primary
diagnostic for distinguishing transport-only failures against a still-live
invocation (`active`) from real invocation deaths, and for watching the
documented RunnerContainer DO-restart residual (`inactive` despite a live
container suggests the in-memory active-op record was lost to a DO restart).
`unsupported` means the liveness probe could not run through the expected
RunnerContainer method; it is not proof that the child stopped. That signal only
interrupts the workflow's current wait so Temporal re-reads web-owned
reconciliation facts; it sets no mailbox, manual, browser-vault, lag, or
device-sync work flag.
The cooldown elects the earliest recent same-user accepted-failure log as the
signal owner, so concurrent first-failure callbacks produce at most one
immediate recheck and cannot all suppress each other.
Cloudflare only reports the accepted-attempt failure through the existing
signed runtime-log callback; it does not schedule retries or become a recovery
orchestrator.
Duplicate provider retries, duplicate email delivery attempts, or duplicate
workflow attempts are safe because mailbox append dedupes by event id and
Temporal signals only coalesce pending work.

Linq typing events are verified and ignored; they must not plan onboarding,
bind routes, append mailbox rows, signal Temporal, call Cloudflare, send read
receipts, or add reconciliation work.

Mailbox processing must not wait behind Cloudflare container lifecycle
locks.

Non-conversation control wakes follow the same durable-work rule where they
own durable product/control facts. Manual runs and browser-vault refreshes
append system-mailbox control rows before Temporal is signaled. Device-sync
uses the same mailbox handoff shape: due-reconcile work is selected from
`DeviceConnection.nextReconcileAt` by the signed scheduled-wake sweep, and
dirty webhook freshness is persisted dirty state plus one clean-to-dirty
`device-sync.wake` handoff. Dirty rows are durable runtime work input, not
periodic scheduler input. Historical `runtime.mailbox-lag-observed` and
`runtime.device-sync-recovery-requested` control rows remain importable for
deploy-skew and drain compatibility, but there is no active producer for them.

### Hosted Runtime Maintenance Wake

`runtime.maintenance-requested` is the explicit operator wake for one-time
hosted runtime maintenance such as a vault format rollout. Web appends the
runtime-control mailbox row and signals the normal hosted runtime workflow; the
assistant runtime treats the row as a no-op control receipt, then runs the same
restore, local runtime maintenance, idle checkpoint, and workspace-version CAS
path as any other hosted invocation. The maintenance wake must not carry
provider payloads, decrypted mailbox content, or migration-specific data.

The production operator surface is the hosted app-session gated
`/ops/runtime-maintenance` page and its same-origin
`/api/ops/runtime-maintenance` route. Access is allowlisted by hosted member id
through `HOSTED_OPS_MEMBER_IDS`; a missing or invalid allowlist fails closed.
The page is intentionally small: it pages active checkpointed hosted workspaces,
can wake one explicit workspace, and caps batch wakes to a tiny window that
stops on the first signal failure. It is not a scheduler, queue, or generic
admin job framework.

The same ops page may also expose narrow hosted-runtime setup actions that reuse
existing source-of-truth services, such as manually ensuring a Linq
external-thread route through `/api/ops/thread-routes`. Those actions must use
the same hosted app-session, allowlist, and same-origin mutation gate, and must
delegate to the owning service primitive rather than hand-writing persisted
runtime rows.

For hard-cut rollouts, deploy consumers before producers: Cloudflare and the
runtime parser must understand the new mailbox kind before web emits it. After
deploy, set `HOSTED_OPS_MEMBER_IDS`, open `/ops/runtime-maintenance`, wake a
single canary workspace, verify the runtime checkpoint/version advances, then
run small batches until no targeted legacy snapshots remain. Any missed
workspace may still hit the runtime's format gate on its next wake, so the
operator rollout gate is zero known v1 hosted snapshots before returning to
normal traffic.

Hosted Codex auth is system-mailbox runtime-control work, but hosted ChatGPT
connect is disabled until credentials have an isolated control-plane owner
outside the hosted tool filesystem. Already-queued connect wakes fail closed
without starting OAuth. Disconnect remains local-revocation-first for cleanup:
remote app-server logout is best effort, local `auth.json` deletion is required,
and a local deletion failure keeps the system-mailbox item retryable instead of
consuming a revocation request. Any terminal `connected` callback from an old
in-flight wake prunes local managed `auth.json` and is reported as a failed
connection cleanup callback, not as a durable connected state.

Hosted device-sync webhook freshness is owned by web dirty state, not mailbox
completion. The route claims the exact provider trace, writes sparse
audit/signal facts, widens the per-connection dirty row and safe dirty
resource/window map, and completes the trace in the same transaction. Dirty
state is durable runtime work input; the `device-sync.wake` mailbox row is only
the bounded handoff to the normal Temporal wake path and must not carry provider
payloads or become the device-sync queue. Active foreground wake handling stays
conversation-focused; system-lane work runs through normal invocation and
reconciliation when no fresh conversation input is pending, and reschedules a
short `device-sync.reconcile` wake if foreground work preempts that background
pass. Do not add a separate system-lane active-wake import path unless measured
latency or product behavior proves the simpler split is insufficient.
The scheduled-wake sweep is the bounded backstop for active connections whose
canonical `nextReconcileAt` is due. Temporal owns that cadence through a global
scheduled reconciler workflow, but web owns the signed legacy-named command that
selects due-reconcile facts, records due-reconcile signals, appends bounded
`device-sync.wake` handoffs, and keeps retries idempotent. Dirty rows are not
independently swept; due-reconcile candidates may include dirty or stuck rows
when canonical `nextReconcileAt` is due. Dirty state remains the work source,
not a scheduler queue. The runtime must support dirty-pending and dirty-ack
callbacks; dirty ack means the dirty revision was handed off into the
checkpointed local device-sync job store, not that upstream provider sync
succeeded. Connection-established and disconnect lifecycle commands may still
use coarse device-sync mailbox wakes because they are explicit lifecycle events,
not high-cardinality freshness hints.

Hosted Stripe webhook routes keep raw request bodies and Stripe signatures in
the route/service verification path only. After verification, web stores the
minimal `HostedStripeEvent` receipt and starts a Stripe-specific Vercel Workflow
with `{ eventId }`. The workflow uses one event-id step to re-fetch the Stripe
event through the existing Stripe API reconciliation path, apply billing and
activation mailbox facts behind the hosted Stripe receipt claim, and signal
Temporal when activation appended runtime work. Step inputs and outputs stay
pointer-only; any member or activation ids needed for retry are re-derived
inside the step from web-owned Postgres and Stripe. Raw Stripe
payloads, signatures, customer objects, invoice objects, provider headers, and
mailbox payloads must not be Workflow inputs or step outputs. The minute cron
drain remains a receipt retry fallback for due Stripe rows.

Cloudflare does not acquire a web run row and does not reconcile durable work.
Only Temporal decides when Cloudflare should process. The short-lived
`ensure-processing` command asks the per-user Durable Object to make processing
active by starting a runner, waking a ready child, recording a pending wake while
the child is still starting, or replacing an old runtime write fence after
startup grace only when no active child exists. The command returns
`retry_later` instead of pretending success when Cloudflare cannot confirm fresh
start or fresh wake acceptance. Fresh starts begin the runtime write fence, then
overlap container readiness with hosted workspace read, workspace-version
binding, runtime config/secrets preparation, and container job construction
before returning accepted; failures in that pre-handoff path clear the fresh
fence and return `retry_later`. Because readiness is overlapped, a failed
preparation may still leave a best-effort warm shell behind; write-fence
ownership remains the only authority to invoke or commit runtime work. The Temporal
caller sends its existing ensure-processing HTTP timeout as an internal header.
Cloudflare treats that value as an operational hint only: the foreground
pre-accept budget is clamped by Cloudflare's configured web-control timeout, and
workspace read/readiness steps are capped by the remaining budget. Accepted
background invocations are registered with the Durable Object lifetime.
Accepted starts and wakes return an owner recheck aligned to the
expected idle checkpoint horizon rather than a short durable-lag polling loop. A
runtime fence whose child is missing is replaced after the startup grace window
when a later ensure command observes it. A wake-unconfirmed active child is not
replaced; the caller retries until the child finishes, becomes wakeable, or is no
longer active.
A failed transport call to an accepted invocation does not prove the invocation
died. Before clearing the write fence after an invoke transport failure, the
UserRunner probes the RunnerContainer for the exact fence identity
(`attemptId`, `leaseGeneration`, `userId`); a still-active matching attempt
keeps its fence so wakes keep routing to the live invocation. If that accepted
attempt has no durable committed progress yet and the local active-operation
pointer is missing, the fence is preserved for the next identity-aware wake
recheck instead of being cleared from the pointer alone; only the wake path may
then replace the fence after it explicitly reports no active child. Inactive
liveness is explicit no-active-child proof, so the controller clears and
replaces that fence directly instead of asking web status to complete it first.
Committed-progress recovery stays in the transport-failure adapter, where the
transport outcome is the thing being reconciled. Mismatched liveness probes
clear the fence because they prove the active child is not the fenced attempt;
unsupported, error, and timeout probe outcomes preserve the accepted fence when
durable progress is not visible yet.
This prevents duplicate replacement while a live child may still be running and
leaves replacement ownership in the exact identity-aware wake path.
When the outer RunnerContainer active-operation pointer is missing, a container
wake response must carry explicit identity-checked wake metadata before an
accepted wake is trusted; identity-blind accepted responses from deploy-skewed
or legacy bridges are treated as unconfirmed and retried rather than as proof of
the fenced child. Explicit identity-blind rejected responses from legacy bridges
(`x-runtime-wake-accepted: 0`) fall back to the container health active-job
count: a valid numeric zero active-job count is explicit no-active-child proof,
while missing wake headers and active, missing, malformed, or unavailable health
remain unconfirmed.
The Durable Object keeps lease, in-flight invocation, alarm, and short-lived
coordination metadata only. It does not persist queue history, per-message
completion, outbox truth, assistant channel enablement state, or checkpoint
recovery truth. When a write-fenced invocation exists, the write fence is commit
authority and active ownership truth for orchestration; useful runtime progress
is still proven only by the later durable checkpoint. Local Durable Object
promises are allowed to coalesce work, but they are not durable work truth. The
alarm path only syncs/clears write-fence alarm state; it is not semantic wake or mailbox-work
scheduling. Durable mailbox lag is durable recovery truth; when it is observed
while Cloudflare still owns an active write fence, Cloudflare may coalesce it
into the active runner instead of starting duplicate execution. The hosted
runtime owns the foreground
conversation-mailbox import loop, imports late rows through the same mailbox
state/input-store path as the initial import, and then notifies the
assistant-engine active-turn controller. If the foreground wake path does not
consume or commit appended mailbox rows, Temporal/web reconciliation rechecks are
the durable recovery path rather than Cloudflare alarm inference.

The runtime reads `HostedWorkspace`, validates workspace version/user metadata,
then restores the encrypted local workspace before fetching mailbox rows. A new
v2 foreground lease restores from durable workspace snapshot truth and clears
the legacy dirty live-runtime marker before restore; dirty local runtime files
are valid only inside the currently owned write-fenced invocation and must not
carry across leases. The
restored `.runtime/operations/assistant/hosted-mailbox.json` file is the
authoritative source for imported per-lane watermarks; `HostedWorkspace`
redacted status is a diagnostic/status surface, not an import progress input.
Fetching after restore keeps user messages appended during restore visible to
the same invocation instead of hiding them behind a stale pre-restore read. The
runtime stages decoded conversation rows as assistant input and marks the active
invocation dirty. Foreground runtime work may defer intermediate checkpoints.
The active invocation remains dirty until the runtime-owned
idle or scheduled-wake checkpoint succeeds. RunnerContainer never records
pending checkpoint intent. Activity expiry is cleanup-only. Projection status
is logged and artifacts remain rebuildable best-effort state rather than a
reason to take another workspace checkpoint, so failed or slow projection does
not block assistant admission and does not imply a durable retry queue.
Successful projection may make raw attachment paths, image evidence, or
audio/video transcript evidence available to the same assistant turn.
Retryable mailbox import blockers, including lane gaps, missing or temporarily
unavailable sidecar payloads, deferred imports, and retryable importer blocks,
stay pending instead of aging into quarantine. They do not advance lane
watermarks, and the runtime result carries the next fast mailbox retry wake so
Cloudflare can promptly reinvoke the workspace.
When no local import state changed, that retry wake is scheduling metadata only:
it must not mark the restored workspace dirty or force an idle-shutdown
checkpoint.
Browser-vault refresh now enters through normal runtime work with the active
write fence rather than a separate container refresh route, and failure or
staleness cannot mutate runner checkpoint, reply, or wake state.
Conversation import is discovery, not assistant handling:
mailbox watermarks prove only that source input was staged. A conversation input remains
pending until the assistant runtime writes durable terminal auto-reply evidence
for that input, such as committed reply intent evidence or explicit suppression
evidence. Auto-reply channel state stores the durable assistant-handling cursor
(`eligibleAfter`) for that channel. The assistant automation scanner advances
that cursor only after terminal handling tells it to advance; mailbox import,
Assistant Input ID creation, and active-turn notification must not advance it.
Inbox projections are rebuildable scan acceleration and must not hide
imported-but-unhandled assistant input. Late same-conversation input is
supported by the hosted foreground mailbox import loop plus the store-backed
assistant input spine: a payloadless runtime wake causes the active child to
import conversation mailbox rows, stage any new `AssistantInputEvent` records,
run prompt-preparation effects best-effort, and notify active-turn admission.
The assistant engine then admits the persisted input through live steering or
pre-provider admission without using hosted-specific mailbox
refresh/checkpoint ports. While a Codex turn is live, same-conversation input is
steered into that live provider turn. After the live provider turn ends,
untargeted new input remains staged for a normal later assistant turn, while
strict active-turn-targeted input fails closed instead of falling through; the
assistant engine does not synthesize another provider request inside the same
assistant turn.
Accepted-input journaling, transcript updates, checkpoint bookkeeping,
provider-request metadata, and outbox intent creation remain on the normal
local assistant-service path. The same-reply coalescing window ends when the
live provider turn ends, not at physical provider delivery; mailbox input that
arrives after that boundary remains durable staged input for a later turn.
Hosted Linq reply sends are idempotent when an outbox idempotency key is
present. The Linq HTTP layer may retry those POST sends on transient transport,
408, or 5xx failures, and the hosted outbox must keep such failures retryable
instead of terminal. Non-idempotent POST sends still fail closed unless the
provider confirms a safe retry contract.

This is the deploy/reset recovery contract. If a Cloudflare Durable Object,
worker isolate, or runner container resets after local mailbox staging but
before the final runtime-owned idle or scheduled-wake checkpoint succeeds, the next
invocation reimports from the web-owned mailbox because the staged watermark was
never checkpointed. If reset happens after a successful final checkpoint but
before terminal handling, the next invocation must still run the assistant
phase, because replay authority comes from staged assistant input plus missing
terminal auto-reply evidence, not from mailbox import progress.

Mailbox import has no provider-visible pre-assistant side-effect phase.
Provider-visible cleanup and read acknowledgement must not run between local
mailbox staging and assistant admission. Local inbox projection and audio/video
transcript enrichment may run after local staging and before assistant admission because
they only update rebuildable local projection artifacts and `AssistantInputEvent`
projection metadata. These projection updates must not request an additional
workspace checkpoint. Linq inbound message deletion is still eventual, but it is
queued only after terminal handling evidence is durable under
`.runtime/operations/assistant/auto-reply/evidence/<captureId>.json` and is
drained through hosted provider-cleanup after the next successful runtime-owned
idle or scheduled-wake workspace checkpoint. The first deferred cleanup wake is
scheduled after the configured idle-checkpoint horizon so cleanup cannot shorten
the warm idle window; actual cleanup failures use the provider-cleanup retry
delay. Post-checkpoint delivery and provider-cleanup drains recompute cleanup
wakes from the post-side-effect state, not from a pre-side-effect base wake.

The hosted workspace checkpoint ref may be a v2 direct-R2 snapshot ref, a
legacy full/base workspace bundle, a legacy working `{base, delta}` ref, or a
legacy layered `{base, hot}` ref. Live v2 snapshots are one encrypted zstd-compressed
tar object uploaded directly from the container to R2 through a short-lived
presigned `PUT` URL. The Worker handles only JSON start, presign, complete,
abort, and data-key unwrap metadata, stores a short-lived upload session without
the URL or data key, verifies the object by `HEAD` on completion, and never
receives the snapshot body. The v2 format is a greenfield zstd hard cut, so
gzip v2 refs are intentionally unsupported; legacy restore compatibility stays
limited to pre-v2 workspace refs. The bridge no longer writes foreground working
commits. Mailbox import, active-turn acceptance, `canonical_runtime_commit`,
assistant-runtime commits, provider cleanup, system-mailbox receipts, and
pre-delivery outbox state must not enter workspace snapshot construction; the
foreground caller tripwire fails those paths before the bridge. Bootstrap or
live foreground paths must not fall back to broad foreground full snapshots,
path-scoped working deltas, legacy hot
producers, Worker-body snapshot uploads, or artifact-sidecar v2 producers.
`idle_shutdown` is the only new checkpoint snapshot producer.
`idle_shutdown` is the snapshot boundary for warm-runner wind-down: it maps to
a direct-R2 v2 snapshot from the effective restored state, runs through the
ordinary invocation lease shortly before container sleep, and checks the lease
during the broad snapshot walk so stale idle shutdown can abort before direct
R2 upload. `packages/assistant-runtime` owns the hosted invocation bridge,
snapshot planning, diagnostics, and mailbox-import policy; Cloudflare supplies
only explicit platform capabilities such as mailbox payload decode, direct-R2
ports, and the local encrypted archive writer.

The portable workspace policy excludes explicit unsafe/process-local or
repair-bin material such as secrets, device-sync runtime state, parser
executable-selector config, quarantine payloads, locks, pid/socket files, global
cache/tmp, rebuildable projections, and assistant JSONL event logs. Assistant
diagnostics snapshots, status snapshots, runtime budgets, pending issue records,
and the diagnostics snapshot's recent warning/error text remain portable; event
logs are bounded local observability only and are rewritten by runtime
maintenance. Codex provider continuity is the exact active rollout JSONL
referenced by live assistant session resume state, not ChatGPT `auth.json` or
the whole `.codex-hosted` tree. Restore downloads and verifies v2 snapshot objects
by `objectKey`, decrypts the encrypted `tar.zst`, and extracts into a fresh durable
root. For legacy refs, restore clears local roots and legacy cache markers, then
applies the base bundle when present and either the working delta or legacy hot
bundle according to the snapshot ref shape. Legacy working `{base, delta}` and
layered `{base, hot}` refs remain
restorable during migration, but new bridge snapshots are idle-shutdown direct
R2 v2 refs only.

Foreground assistant turns do not publish a separate Codex continuity artifact
or workspace pointer. Provider-native continuity remains a workspace snapshot
concern: if a container dies before the next idle-shutdown direct-R2 v2 snapshot,
restore must still be correct from durable mailbox, transcript, and assistant
runtime state even if provider-native resume optimization is unavailable.
Fresh-thread starts and stale native-resume fallback may include bounded recent
committed transcript history; primary native-resume attempts do not replay that
history into the provider prompt. Active-turn input is not serialized as
provider prompt history; it is either folded in before the first provider
request, steered through the live Codex turn, or left unaccepted for a later
normal turn when it misses the live steering window.

Browser-vault replicas are derived dashboard sidecars, not canonical workspace
state. `apps/web` assesses browser-session backstops from the latest replica
ref, client-known ref identity, and a bounded max-age policy; ref presence alone
is never freshness. Workspace checkpoint timestamps are not content-version
signals for replica freshness. Stale session reads may still serve a usable
replica, but they must mark it stale and request refresh after the HTTP response.
Web represents that request as ordinary low-priority runtime work only when its
freshness policy explicitly asks for it; normal nudges do not become browser-vault
refresh sweeps just because a workspace has no replica yet. Foreground work may
schedule refresh as ordinary runtime work, but `idle_shutdown` v2 checkpoints write only
the workspace snapshot ref; they do not publish browser-vault replicas.
Browser-vault replica writes require the active runtime write fence and publish
the latest replica ref separately, without changing the workspace checkpoint
version.

The assistant runtime owns the refresh build. It computes a stable canonical
query-source hash from sorted source-relative paths, byte sizes, and content
hashes; mtimes, generatedAt, user ids, and runtime cache paths are excluded.
Refresh builds from the restored `vaultRoot`, recomputes the source hash before
publish, and discards the attempt if source content changed. Empty current
query-visible content is publishable so deletions can clear stale dashboard
state. Runtime-side refresh runs only after foreground work and checkpoint
correctness are settled, is capped by the browser-vault replica byte limit, and
races the existing runtime wake signal; if a wake arrives before publish, refresh
returns scheduled/deferred work instead of publishing partial state.

Assistant liveness is the stronger invariant than dashboard sidecar freshness.
The web checkpoint callback must accept a valid workspace snapshot checkpoint
from an older or partially deployed runner when `browserVaultReplicaRef` is
absent or explicitly null. Missing browser-vault replica continuity is
recoverable dashboard state and must not stop mailbox import, assistant
admission, outbox checkpointing, or the runner's ability to reach idle. Browser
session reads return not-modified only when the client already knows the latest
`browserVaultReplicaRef`. Stale or malformed replica metadata may be rejected
because that indicates an internally inconsistent sidecar, not a recoverable
omission. Future
checkpoint fields that are not required to answer user messages must follow the
same compatibility rule: old deployed runners may omit them without blocking
assistant progress, and any stricter lockstep contract needs an explicit
capability/version rollout plan before it can be required in production.
The direct-R2 snapshot-complete bridge must preserve semantic checkpoint
responses from web. In particular, `checkpointed: false` with
`checkpointConflictReason: "foreground_pending"` is a successful transport
response that interrupts idle checkpointing so the same invocation can import
fresh foreground mailbox input; Cloudflare may retire the upload session as an
orphan candidate, but it must not collapse that response into a generic HTTP
conflict before `packages/assistant-runtime` handles it.
Web must evaluate the workspace-version CAS before returning
`foreground_pending`: pending conversation input may interrupt only a checkpoint
whose locked workspace version still equals the request's expected version.
Retryable mailbox import blocks are mailbox-continuation checkpoints even when
an earlier assistant or device wake wins the projected `nextWakeReason`; web
uses the redacted `hostedMailboxRetryableBlockedCount` as the explicit signal.
The same runner-side liveness rule applies to auxiliary lanes: browser-vault
publishing, inbox projection and audio/video transcript enrichment, provider cleanup and read
acknowledgement, usage record, telemetry, log export, inbox media retention,
post-checkpoint system-mailbox acknowledgement, billing/customer decoration,
and device-connect context enrichment may record degraded status or request a
later wake. They must not prevent mailbox
import, assistant admission, outbox intent checkpointing, or reply delivery when
the user-message trust boundary is otherwise valid. Hard failures remain
appropriate for wrong-user authority, invalid auth, undecryptable mailbox
payloads, mismatched supplied sidecar refs, and lease/CAS conflicts.

Hosted snapshots preserve only active `.codex-hosted/sessions/YYYY/MM/DD/rollout-*.jsonl`
files referenced by live assistant resume state. They do not write a Codex continuity manifest, and they
do not preserve Codex logs, SQLite metadata, prompt history, cache/temp,
auth, credential, key, cert material, unreferenced sessions, or archived
sessions. Restore sanitizes assistant session native
resume state by clearing Codex resume metadata when the referenced rollout file
is absent, does not match the saved Codex thread id, or is not a regular file
under `.codex-hosted`; it then prunes restored `.codex-hosted` contents back to
the surviving session-referenced rollout files.
Checkpoint diagnostics for Codex continuity may expose only thread counts, byte
totals, missing/invalid counters, and keyed hashed rollout-relative names when
the hosted log fingerprint secret is configured; raw Codex home paths,
filenames, prompts, and credentials must not appear in hosted runtime logs.
Without the fingerprint secret, checkpoint diagnostics omit relative-name hashes.

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
- auto-reply channel state, including channel enablement, `eligibleAfter`, and terminal handling evidence
- assistant sessions, transcripts, receipts, diagnostics, and outbox intents
- same-conversation turn revision
- provider delivery and receipt/reconciliation policy
- runtime timers, assistant next wake projection, and inbox media retention wake
  projection
- checkpoint timing
- checkpoint snapshot policy and metrics (`direct-r2-presigned-put`, the
  512 MiB encrypted single-object and 1 GiB total plain-byte limits, encrypted byte
  size, and warning threshold)

### Cloudflare Owns

- per-user Durable Object routing
- lease/fencing generation
- alarm/fence coordination
- container invocation
- optional signed web allow-decision payload compatibility on legacy foreground
  requests; Cloudflare does not validate it as runner-start authority and
  missing, stale, mismatched, or invalid decisions never trigger a live web
  usage-gate callback before the hot reply path starts
- direct-R2 snapshot upload-session plumbing plus legacy encrypted
  bundle/artifact/env/journal object plumbing
- worker-to-web callback signing
- verification of signed ingress/runtime root envelopes plus Cloudflare P-256
  recipient unwrap; Cloudflare must not hold GCP KMS decrypt authority

Cloudflare does not own product facts, mailbox state, mailbox import progress,
hosted AI usage spend, assistant channel enablement state, outbox truth, or
durable queue history.

### Temporal Hosted Orchestration Owns

- per-user hosted runtime workflow state
- pointer-only mailbox and recheck signals
- reading web-owned reconciliation facts and deciding when Cloudflare should
  process
- short-lived Cloudflare `ensure-processing` activity calls
- signal-interruptible waits, retries, and scalar workflow status diagnostics

Temporal does not own raw webhook payloads, provider verification headers,
provider secrets, mailbox payload content, product facts, workspace checkpoint
truth, or runner coordination. Treat workflow state as durable execution state,
not as queryable product truth.

### Vercel Workflow Owns

- Stripe event-id reconciliation workflow run state after local Stripe signature verification and receipt recording
- workflow event logs for Stripe event ids, retry status, and step errors

Vercel Workflow does not own raw webhook payloads, provider verification
headers, Stripe request bodies, provider secrets, canonical product facts,
mailbox payload content, mailbox state after Postgres commit, workspace
checkpoint progress, runtime processing handoff, message-processing completion,
outbox truth, or per-user runner coordination.

## Runtime Timers

Private runtime timers live in local runtime state and surface only as redacted
due-time projection on the workspace/status surface. Assistant work uses
`nextWakeAt` and `nextWakeReason`; inbox media retention uses the independent
`inboxMediaRetentionWakeAt` field. Web does not materialize timer rows, and
Cloudflare does not persist timer work items.

If the runner needs a synthetic in-process object for logging or execution
plumbing, it may use an internal-only `runtime.timer` wake. That object is not a
persisted mailbox row unless an external product/control-plane mutation
explicitly appends one.

## Observability

`HostedRuntimeLog` is redacted observability, not correctness state. Logs may be
lossy and must not contain plaintext messages, transcripts, vault data,
provider payloads, secrets, local paths, or direct personal identifiers.
The hosted runtime also emits metadata-only phase boundary logs to stdout/stderr
for supervisor correlation. Those phase logs carry fixed-vocabulary phase names
and status plus bounded metadata-only correlation, count, and timing fields. The
Cloudflare child supervisor treats that output as untrusted: it may summarize
only fixed-vocabulary phase/status pairs plus a supervisor-derived last-phase
ordinal into container failure payloads. It must not trust child-provided
numeric timing fields or copy raw child output, mailbox contents, prompts,
transcripts, provider bodies, local paths, or direct personal identifiers into
parent logs.

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
