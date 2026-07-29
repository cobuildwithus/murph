# Hosted Mailbox Runtime Protocol

Last verified: 2026-07-27

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
  The runtime, not the host, keeps dirty state warm through the configured idle
  floor. The exact assistant wake projected directly by the current foreground
  assistant phase may run once before that floor without checkpointing. The
  exact phone-call-result and usage-referral-reward notification families may
  also run queue-only through their causal outbox intent after fresh
  conversation work has priority; generic notifications remain excluded.
  Inherited or committed wakes and durability barriers remain checkpoint-first.
  At the idle floor, or on shutdown, the runtime checkpoints remaining dirty
  state before returning success. When Cloudflare reports container activity
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

Assistant Ask reuses that same ownership split. Web resolves the target and
return authority, then appends paired encrypted `assistant.ask.requested` and
`assistant.ask.completed` mailbox items. After each append, Web first signals
Temporal and then starts the existing payloadless direct `ensure-processing`
latency hint; the hint has no retry or durable authority. The group runtime may
answer one request in a separate read-only one-shot Codex child while its
resident foreground assistant continues to own writes and sends. The mailbox
remains the only durable queue and operation state; Cloudflare gains no second
container, Durable Object state, scheduler, or workflow for this lane.

The final seam is:

```text
append encrypted mailbox item or upsert device-sync dirty state
signal Temporal hosted orchestration
restore hosted workspace
import mailbox prefix into local runtime state and stage AssistantInputEvent rows
pull pending device-sync dirty rows
for Linq input with link parts, attachment-bearing non-email input, and direct raw email, run best-effort local inbox projection plus audio/video transcript enrichment without checkpointing it
run local runtime work until idle or budget
while dirty and before the idle floor, service fresh foreground input, the
  exact safe Assistant Ask shapes, and only replay-safe phone-call-result or
  usage-referral-reward notifications without publishing a snapshot; other
  wakes do not shorten the floor
at the idle floor, or on shutdown, checkpoint final dirty runtime state with
  checkpoint reason idle_shutdown; commit
  the valid workspace-CAS snapshot even when web observes newer conversation input
if the default-mode runtime remains live, import that ahead input immediately;
  during retention-only work or shutdown, leave the durable mailbox row for
  web/Temporal reconciliation
project redacted status/logs
```

Hosted execution is a thin containerized runner over the same local runtime
input spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

### Resident Codex And Detached Enrichment Boundary

The container owns one resident Codex App Server and keeps it warm across
ordinary turns and ordinary workspace invocations. Turn completion, invocation
completion, and invocation-scoped credential rotation do not replace it. An
explicit workspace invocation abort or preemption is different: the container
interrupts the active background-work boundary and synchronously stops the exact
owned App Server before it releases the job slot for another invocation. A stop
failure poisons the container rather than allowing a replacement invocation to
reuse ambiguous process state.

Detached MultiAgent V2 work does not become a process-memory queue. Before the
root reply, Murph retains a durable accepted input, canonical fact, or raw
source and gives each child its exact source words, ids, or refs. A loaded skill
may assign one independent canonical record family per child, with every write
idempotently attributable to that source. A terminal lifecycle receipt remains
advisory; canonical readback is completion proof. If the member needs the result
in the current reply, the root keeps the work and uses normal progress updates.

Hosted configuration admits one root plus at most three concurrent children
per session. Independent roots may retain their own children inside the same
resident App Server. Every child must be a one-shot leaf with one bounded
family: no root/child interaction, child reuse, nested child, or background
terminal is supported. At the workspace snapshot boundary, the runtime waits
for every exact resident child and checks every touched root and child for
background terminals before archive construction may proceed. The lifecycle
owner retains the complete child set for each root until that boundary clears,
so one sibling's completion cannot evict another. A routine checkpoint wake
cancels only that wait and keeps the process plus all resident lifecycle
evidence warm for the later boundary. A timeout or unsupported lifecycle stops
the exact process and fails the boundary closed. Explicit invocation
abort/preemption cancels the wait and enters the synchronous exact-process stop
path above.

The hosted adapter is the mailbox importer. It decodes a conversation mailbox
row into a bounded `AssistantInputEvent`, stages it in local runtime state,
marks the active invocation dirty, and checkpoints that dirty state only at the
runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint.
Plain-text Linq plus
attachment-free Telegram and WhatsApp input does not initialize or import inbox
projection. Linq input with link parts retains the existing projection path.
Direct email retains raw-message projection because its staged preview is
bounded; group-routed email remains intentionally raw-free.
Attachment-bearing non-email input may run best-effort inbox projection while
the decoded wake is still in memory so local attachment artifacts can help the
same invocation, but hosted runtime must not take a separate workspace
checkpoint just to persist projection/cache cleanup.
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
Native child-process provider egress for OpenAI, Exa, Mapbox,
`murph_data_api`, and `workers_ai_transcribe` uses a signed Murph provider
credential in the provider's native credential slot instead of the
injected-credential sentinel. That credential identifies provider kind, hosted
user, and runner container name. It does not authorize egress by itself: the
Worker verifies the signature, asks UserRunner whether the same runner has an
active runtime for that user/provider, then injects the Worker-owned credential
only after the provider request policy passes. Missing runner state, missing
active runtime, wrong runner, wrong user, wrong provider, missing signing
config, or validator failure all fail closed without provider secret
injection. `ctx.containerId` and RunnerContainer active-user recovery are not
provider-egress authority.
Runtime-controlled delivery/control provider integrations such as Linq and
Telegram still use provider-egress token proof when exact runtime
authority headers are absent. There is no tokenless active-user-fence provider
authorization path. Runner container names remain lifecycle/routing handles,
not provider-egress authority outside the explicit signed provider credential
identity checked by UserRunner.
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

### Vault-Share Direct Read and Cutover

`apps/web` is the authority and read owner for hosted group shares. The existing
`HostedVaultShare` row carries one nullable encrypted replacement-snapshot
column; there is no second table, destination mailbox delivery, local projection
store, generation document, or cleanup queue. Non-device health projection
delivery encrypts the complete bounded record set under the destination
member's existing secure-box root and conditionally replaces the ciphertext on
the exact active share id and scope. An encrypted empty set means observed but
missing; `null` means no snapshot has been supplied. Revoke and regrant clear
the column in the same authority transaction, and regrant rotates the share id,
so a stale producer cannot update a later grant generation.

`murph.group action="read_shared"` accepts one to three unique exact selectable
projection scopes. The signed Web handler captures the current group roster and
exact active grants, decrypts only the captured encrypted snapshots, and returns
every current member with every requested scope. Each result is explicitly
`not_granted`, `granted` plus `missing`, or `available`; a real zero remains
available. Profile labels require their separate granted snapshot. Authority,
decryption, parse, and bound failures return typed unavailability without shared
records or identity-bearing infrastructure fields.

The Web response is complete. For the model boundary, the assistant-engine
adapter keys every retained projection by its exact scope and collapses the
grant/data pair to `not_granted`, `missing`, or `available`. Non-workout record
arrays remain intact; `workouts.v0` additionally hoists repeated day, kind,
time-semantics, and completion-watermark fields. If whole member rows still
exceed the model result limit, the adapter returns `status="partial"` with every
omitted current membership named in `omittedParticipantIds`. It never truncates
a member row, treats an omitted member as departed, or alters stored or
Web-returned truth.

`device-sync-status.v0` is explicit consent only. When that exact grant is in
the captured authority set, Web derives the result live from its bounded device
state. It returns only public source labels, coarse connection state, status
observation times, and the honestly named connection-wide sync-job completion
time. It excludes connection, account, device, and provider identifiers,
credentials, provider payloads and errors, raw health values, and private
diagnostics. A connection sync-job time is not evidence that a health record or
challenge metric arrived. Device data is never produced by the grantor runtime
or stored in the share snapshot column.

The runtime's shared reader is a synchronous no-I/O adapter. Constructing it,
starting or resuming App Server, and admitting foreground, scheduled,
notification, or detached read-only model work adds no group, grant, snapshot,
device, projection, configuration, or attribution read before the model starts;
existing accepted-input and route-binding work is unchanged. The only Web read
occurs inside the adapter's request method after the model invokes `read_shared`.
No roster or authority snapshot is preloaded into scheduled context.

Interactive Linq and Telegram group turns are actor-scoped. The importer
derives blinded `actorId` from the same trimmed sender value stored for the
prompt; initial batching splits on actor change, and pre-provider plus live
admission stop at a foreign group actor. Telegram supplies that sender only on
route-authorized non-direct inbound whose webhook-authenticated user id already
resolved to exactly one active linked member, so anonymous administrators,
`sender_chat` messages, bots, and unlinked senders stay unattributed.
Attribution therefore remains bound to the scanner-selected durable operation
contexts, and active steering cannot add a second participant's identity
authority to the turn.

Telegram sender evidence is additive on the wire: `linqSenderHandles` keeps its
existing meaning and `telegramSenderHandles` is a separate optional field, so a
new runner against an older Web degrades only the not-yet-supported Telegram
field and never disturbs established iMessage attribution.

Persisted Telegram sender metadata is a runner rollback floor. The strict
Telegram input-source schema in a preceding runner does not recognize
`senderHandle` or `senderUsername`, so the first checkpointed workspace snapshot
containing an attributed Telegram group input cannot be read back by that older
runner for replay, projection update, or pending-input recovery. Those keys are
therefore written only when an authoritative route-authorized group sender
exists, leaving direct threads and unattributable group inbound byte-identical
to the previous shape. Below that floor the recovery posture is a forward fix or
an explicit offline migration, not a dual reader. The raw Telegram id and
optional username follow the existing encrypted assistant-input residue
retention and snapshot policy.

Interactive `read_shared` requests may carry only bounded, deduplicated
route-authorized sender handles from that operation scope, in the one field that
names the sending channel. Web matches `linqSenderHandles` against current
membership phone and verified-email blind indexes, and `telegramSenderHandles`
against the current membership Telegram-user blind index, all selected by the
same group query. Matching never crosses channels: a numeric Telegram user id
would otherwise normalize into a valid phone lookup key and could resolve to an
unrelated member. Populating both fields in one request fails closed at the
runtime, the parser, and the store. A handle is
returned only in the matching member's bounded `currentTurnHandles` array and
only when it resolves to exactly one current membership; that row also carries
its group-scoped `participantId`.
Scheduled, notification, and detached requests carry no handles. The runtime
drops overlong handles before transport, and the signed group-tool body limit
covers the declared worst-case JSON expansion for all 32 bounded inputs.

The assistant may join only an exact current prompt `Sender:` handle present in
one returned row. It never persists or renders handles. The model boundary
strips global member ids and legacy roster handles from every group-summary
action. This adds no state, pre-model work, standalone query, or decrypted
contact roster, and the legacy `read_current` request and response wire stay
unchanged.

Legacy `vault-share.delivery` and `vault-share.revoke` mailbox rows are
terminally skipped from their plaintext kind/route metadata before payload fetch
or decryption. They advance ordinary import bookkeeping but never recreate or
mutate a local share store. V2 archive restore excludes
`vault/derived/vault-share/**` and `vault/vault-share/**`; legacy bundle
materialization excludes the corresponding vault-relative subtrees. No
foreground cleanup pass or revoke wake is part of the boundary.

This protocol is a consumer-first hard cut:

1. Deploy Cloudflare Worker and runner with `container_rollout=immediate`.
   Prove fleet convergence, the zero-prestart-I/O boundary, direct-read parser,
   pre-payload legacy-row skip, and snapshot restore exclusions.
2. Apply the nullable snapshot-column migration, then deploy Web's encrypted
   replacement writer, direct `read_shared` handler, and live consent-gated
   device derivation. A new consumer against old Web fails closed as typed
   shared-data unavailability during this bounded interval. The universal
   new-group permission set omits `device-sync-status.v0`; challenge setup adds
   that scope explicitly and remains unavailable until Web supports it. No
   retry, legacy wire widening, or broader fallback is introduced. Remove the
   legacy permission-offer template compatibility field after Web convergence.
3. Once Web can write the new column or serve the direct read, the new
   Cloudflare consumer is the hard rollback floor. Disable the Web producer/read
   path and forward-fix; do not roll back to a consumer that restores or reads
   legacy local projections. No mailbox drain or local cleanup proof can lower
   this floor.

## Current Protocol

### Foreground Priority Rule

Fresh user conversation input has absolute priority over background hosted
runtime work. Device sync, provider cleanup, browser-vault refresh, system
maintenance, and idle checkpointing are idle-only lanes; they must not make a
user message wait for background work to finish.

When a foreground wake arrives before idle maintenance commits to a snapshot,
the maintenance lane must yield, abort, or reschedule. Once a direct-R2 snapshot
has been built and its workspace-version compare-and-swap is still valid, web
commits that snapshot and its requested wake projection even if it observes
newer durable conversation input. It returns `conversationInputAhead` so a
still-live default-mode runtime can import the row immediately after publication.
A retention-only runtime or a runtime already shutting down returns and leaves
the mailbox row to durable web/Temporal reconciliation. The runner must not
discard a valid uploaded
snapshot or create a second metadata-only shutdown snapshot. Assistant
admission, assistant automation, outbox intent creation, and reply delivery
remain independent of device-sync and other maintenance completion.
Once terminal reply delivery is durable, the foreground lane releases ownership;
it does not wait for provider cleanup or another exact automation inventory
scan. A conversation import that lands while foreground-owned maintenance is
in flight aborts that work through the runner-scoped background-maintenance
signal so the new message can enter assistant admission immediately.

Foreground wake projection is read-only unless the foreground turn itself
committed a canonical write under `bank/automations`. That write arms an
immediate assistant maintenance wake, where exact cron reconciliation remains
owned. Ordinary post-delivery work does not rescan exact cron status. Pending
assistant-input probes also inspect only the existing index: a candidate in a
complete index keeps its immediate wake, while a missing or incomplete index
gets a bounded 30-second maintenance wake. Compaction and legacy backfill stay
in the maintenance lane rather than extending reply ownership.

After a bounded background automation pass, the live post-pass cron status is
the assistant cron owner's authoritative continuation. A fast pre-checkpoint
delivery or a deferred post-checkpoint delivery/provider-cleanup drain may
consume the workspace wake that admitted the pass, but each path must carry the
independently recomputed cron candidate through the existing post-delivery
reconciliation wake. The later `idle_shutdown` snapshot therefore persists
remaining due or future canonical occurrences instead of treating successful
delivery or cleanup as authority to disarm them.

If an `inbox_media_retention` invocation is the active write-fenced child when
foreground/default work arrives, the runner preempts that exact child through
the existing container abort seam, clears the old fence by identity, and starts
foreground work. Retention remains recoverable through the workspace's projected
retention wake instead of becoming a second scheduler concern.
The same wake owns all receipt-anchored inbound message-content work: pending
input suppression and redaction, transcript redaction, media expiration, legacy
envelope migration, capture/parser/projection redaction, and their earliest
future deadline. An overdue pending-input pass runs before background input
selection as well as during idle maintenance, so restored content cannot begin a
reply after its deadline.
If a `system_mailbox` invocation owns the active fence when foreground/default
work arrives, the runner uses the same exact-child abort and identity-cleared
replacement path. It must start a default-mode child rather than coalescing the
wake because system-mailbox mode imports only system work and returns before
assistant admission. A system-mailbox request behind an active default runtime
remains deferred and cannot broaden that child's admission authority.
`parseHostedWorkspaceInvocationRequest` is the single wire parser for this
request contract. Assistant-runtime and Cloudflare transport adapters must
delegate to that parser instead of reconstructing a partial request, because
silently omitting `processingMode` turns import-only work back into default
assistant work and defeats the ownership rule.
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
For foreground/default work behind an `inbox_media_retention` or
`system_mailbox` fence, the existing workspace-invocation abort seam is the
sole preemption authority. UserRunner sends that exact abort directly instead
of spending foreground command budget on a non-authoritative liveness
preflight. A local exact-pointer abort enters the same inactive-fence
replacement path. The container registers the
exact attempt, lease generation, user, abort controller, and invocation result
before lifecycle-lock admission. Queued duplicate invokes therefore coalesce,
and an exact abort can cancel already-queued successors before runner dispatch.
While that abort is in flight, its exact operation remains the visible queue
head: liveness reports the same identity, wake fails closed, and no successor
can dispatch. The abort owner releases that token only after both the child
abort request and exact invocation cleanup settle. Runtime wake also fails
closed until the active invocation has reached its runner endpoint, and a child
`absent` response cannot override a still-registered local operation while child
admission is in flight. A pointerless wake is also rejected if a destroy request
or observed stop begins while its child RPC is pending, even when teardown
settles before the wake response. Conversely, a verified accepted pointerless
wake publishes its completion before returning so an already-running expiry
preflight yields instead of destroying that child. Failed fail-closed cleanup
returns `failed` and preserves the fence; the next exact wake re-enters the same
abort-and-stop owner instead of leaving that operation permanently active.
Explicit container destroy aborts every invocation registered before the
destroy call, including lifecycle-lock successors. New invocation admission
resumes only after the stop settles and those exact tokens are released, on a
fresh shell. A delayed abort for a released token rechecks the queue head and
cannot recycle that replacement shell. If explicit destroy fails, any retained
exact token becomes cleanup-retryable through the next exact wake rather than
remaining permanently aborted.
Priority preemption always sends the identity-checked abort first so any queued
exact background invocation is canceled before the fence is cleared; an
inactive result or queued matching abort is replacement-safe. Missing-pointer
abort delivery keeps an exact abort reservation visible while it owns the
container lifecycle and delivers the identity-checked abort. Control-plane
`stopped` status does not bypass that abort, and it is not settled-stop proof
while platform truth explicitly reports the shell running. A stale result
preserves the fence and retries. An accepted or queued result, or an ambiguous
delivery failure, recycles the old shell fail-closed before the container
returns `accepted`; only an observed stop or non-contradicted stopped status
allows the controller to clear the exact fence and start a replacement.

The foreground-priority rule does not weaken correctness checks. Wrong-user
authority, invalid auth, undecryptable mailbox payloads, stale leases, and
workspace checkpoint compare-and-swap conflicts still fail closed rather than
publishing partial or corrupt state.

### Assistant Ask Read Side Lane

`murph.group(action="ask")` is admitted only from a fresh authenticated private
input. The runtime calls `assistantAskPort.request`; the signed
`POST /api/internal/hosted-execution/assistant-asks/runtime` Web control owner
resolves the current `HostedGroupMember` row and synthetic group runtime from
the caller plus an optional exact visible label. Models never supply member,
membership, runtime, mailbox, callback, session, or return-route ids. Web
derives one stable request identity, pins the origin, destination, membership
generation, and ten-minute expiry, appends one encrypted
`assistant.ask.requested` item, then signals the existing group runtime. Exact
retry reuses that item and cannot resolve a different target. Once Temporal
accepts that pointer-only signal, Web starts one payloadless, no-retry direct
ensure so an active runtime does not wait for its routine idle checkpoint.

The target runtime rechecks expiry, membership generation, runtime identity,
and the active write fence before context assembly. It snapshots bounded
committed conversation evidence in memory and seals it with the live restored
group workspace; this is not a second durable snapshot or projection. A
dedicated router keeps the request out of ordinary serial
system-message execution and starts at most one `executeReadOnlyAssistantAsk`
promise. That call launches a separate one-shot App Server process with the
native `murph-group-read` profile, exact runtime workspace roots, `.runtime/**`,
`.codex/**`, and environment-file denial, no tool network or inherited shell
secrets, and only the consent-aware lazy `murph.group/read_shared` dynamic
tool, with no mutation or delivery authority. Thread-start attestation
must confirm the exact profile, roots, sealed empty working directory, empty
instruction sources, and approval policy before model work. Further asks stay
pending in the mailbox. The resident process remains the sole model-authored
canonical-content writer and sender, and foreground start, steering, and
delivery never await the child. The child also receives the server-bound
requester membership `participantId`; first-person references map only to the
`read_shared` member with that exact id. Display name, handle, or member order
cannot substitute, and the opaque id cannot appear in the answer.

When a joined-group request or legacy joined-group completion reaches a dirty
warm runtime, the mailbox prefetch may import it before the routine idle
checkpoint only when the entire fetched prefix contains pre-checkpoint-safe
system wakes. One shared import context revalidates the decoded adapter shape
throughout that pre-checkpoint pass, including pre-assistant follow-up imports
and foreground reruns; a consented-member request or reviewed completion
remains checkpoint-gated regardless of which import observes it. Request import
kicks the existing detached controller; completion import uses the existing
foreground-causal delivery path. Neither starts or advances the
at-least-180-second idle snapshot. Any unrelated system wake in that prefix
keeps the whole system prefix checkpoint-gated. A progressed foreground-causal
pass re-enters the existing bounded pass loop after admitting any newly arrived
personal input first, so multiple safe items or a safe item imported during the
preceding pass drain before checkpoint. No progress, retryable failure,
cancellation, or mailbox-budget exhaustion stops the drain.

The same bounded pass admits only
`assistant.notification.requested:phone-call-result:*` and
`assistant.notification.requested:usage-referral-reward:*`. Import eligibility
does not grant dispatch authority: the foreground-causal system-mailbox selector
must match the exact dedupe-key family again, then collect only the outbox intent
returned by that mailbox execution. Its persisted `sending` transition precedes
provider entry, replay observes the same intent, and an older generic
notification or unrelated pending delivery cannot hitchhike. Fresh conversation
input continues to preempt this pass.

The group runtime returns only the request id and schema-checked bounded answer
through the signed completion control path. Web reloads the request, rechecks
the exact membership generation, runtime fence, expiry, and original private
route, then appends one deterministic encrypted `assistant.ask.completed` item
to the bound private runtime. The first committed completion wins. The private
runtime treats it as correlated untrusted data and may run one output-only
follow-up after current route validation; it cannot recurse into Assistant Ask
or invoke side-effecting tools. Once Temporal accepts the completion's
pointer-only signal, Web starts the same payloadless direct ensure so an active
private runtime can import it immediately. A typed `cannot_answer` bypasses the
private provider continuation and queues the fixed unavailable-evidence response
exactly; it cannot be paraphrased into an expiry or execution-failure claim.

If that joined-group completion and private input are both pending, the
completion uses the existing foreground-causal mailbox lane only when its
occurrence timestamp predates the oldest pending input. A fresh turn derives
that cutoff from the bounded accepted-input batch it already owns. A pass with
no fresh batch reads the existing complete pending-input index. Both paths use
the input's `occurredAt`, not its later receipt time. Missing, incomplete, or
invalid evidence fails closed without backfill or compaction on the foreground
reply path; existing background maintenance remains the only repair owner. The
completion then owns the next assistant pass, and the existing output-only
continuation composes and durably queues one natural Murph response under its
stable idempotency key before the still-pending input runs on the next pass. A
newer completion does not overtake older personal input. This ordering contract
ends at durable intent creation; ordinary carrier retry ordering remains scoped
to one assistant turn so a retrying Ask send cannot block all newer personal
replies. The mailbox
remains transport, not an Ask-specific delivery coordinator.

The signed group-tool Web route returns the deterministic opaque request id in
`x-murph-assistant-ask-request-id` on both accepted and sanitized failed Ask
responses. On failure, Web may also return the underlying Prisma code only when
it matches `P####`, in `x-murph-assistant-ask-diagnostic-code`. Cloudflare
validates both exact shapes before adding them to its typed control-plane error.
The private runtime may expose only the validated request id, diagnostic code,
and HTTP status to the model; raw exception messages, response bodies,
membership ids, and runtime ids remain hidden. These headers are correlation
metadata only and are never accepted as routing or authorization input.

The reverse `consented_member` adapter uses the same mailbox lifecycle but a
different admission and delivery policy. An authenticated group turn first
posts a server-authored permission request through
`murph.group(action="post_disclosure_request")`. Web stores its exact
canonical natural-language permission and digest. It derives a stable request
id and provider idempotency key from the exact group, trusted accepted-input id,
and permission digest. Replay succeeds only when the stored group,
provider-message lookup, text, and digest still match. Only an already-current
member's verified added Like reaction to that exact message creates a new
append-only grant generation for that membership; the reaction does not create
membership. Each verified provider reaction event derives one grant id, so
duplicate delivery cannot recreate a revoked grant. `read_current` exposes an active opaque `grantId` with that member
and exact permission. The model cannot supply or recover any hidden target id.
In a private runtime, the existing `list_memberships` response also exposes
that member's active grants as a top-level additive `disclosureGrants` array;
older Web responses without the field normalize to an empty array. Revocation
may select only an exact id from that private read.

For `murph.group(action="ask_member")`, trusted runtime code injects one origin:
either the current accepted non-direct group input and signed route or one
claimed canonical scheduled-automation occurrence for that group runtime. Web
resolves the supplied current grant selector, binds the group runtime, personal
runtime, exact membership and grant generations, permission digest, injected
origin, and ten-minute expiry, then appends a `consented_member`
`assistant.ask.requested` item to the personal mailbox. Email, direct,
unverified, stale, foreign, or model-selected invocation data fails closed. The
group action targets one grant and one question; it never performs implicit
roster fan-out. The group runtime, exact grant, and trusted invocation derive
the request identity. Exact retries reuse that mailbox item, a changed question
for the same grant conflicts, and another current grant in the same invocation
is independent.

Prepare revalidates the same authority immediately before private context is
read and returns the exact immutable permission to the runtime. The personal
read-only child proposes one candidate under that permission. There is no
incoming model reviewer. One separate fresh one-shot outgoing reviewer has no
personal workspace, history, application tools, network, or delivery route and
receives only the permission, question, and candidate. It returns only `allow`
or `deny`; it cannot rewrite or redact. Invalid output, refusal, timeout, provider
failure, or ambiguity fails closed, and denied candidate bytes do not enter a
Murph mailbox, vault, assistant state, operational log, or error.

On an allow, the completion control path revalidates the group, personal
runtime, membership generation, grant generation, permission digest, origin,
expiry, and active fences again. It appends one deterministic
`assistant.ask.completed` item to the bound group runtime. The trusted `origin`
discriminant owns what happens next. `accepted_input` bypasses a provider
continuation and delivers the reviewed answer byte-for-byte on the revalidated
original group route through the existing outbox. `automation_occurrence` does
not wake the group runtime or create a delivery. The live scheduled Codex turn
starts every selected ask, then uses ordinary shell waits and exact replay to
poll each accepted `ask_member` call until it returns completed or unavailable.
The existing request expiry bounds the loop. Web returns a flat completed
result only after the ordinary cron owner revalidates the current canonical
automation and non-direct Linq route immediately before the tool call, and Web
revalidates the same request, completion, member, grant, permission, target
runtime, origin, expiry, and runtime fences. An unavailable result ends that
request without an answer, and no callback is held open while the member
runtime works. Cannot-answer uses the fixed non-disclosing result. The original
private-to-group continuation retains its
legacy payload shape without an `origin` object. Leave/rejoin and revoke/regrant
produce new generations, so old work cannot cross either lifecycle boundary.
For accepted-input delivery, if live authority disappears after an exact answer
is queued, its existing outbox intent retains the completion id, deterministic
delivery key, and authority expiry through terminal disposition. The runner
rewrites that intent's text and media to the fixed text-only cannot-answer copy
before provider entry. At expiry it uses the outbox-owned deadline even if
mailbox retention has already
removed the request and completion rows; before expiry Web still owns live
revocation revalidation. The final egress claim permits only the structurally
bound fixed fallback without reviving the private grant. Scheduled-origin
completion has no outbox obligation and remains readable only by the one exact
same-turn replay while its live authority remains current.

Web caps retained permission history at 25 rows per group and retained grant
generations at 25 per group and 25 per member. Counts run under the canonical
group/member locks after deterministic request/reaction replay checks. Thus an
exact replay still succeeds at the cap while only a fresh append receives the
typed limit disposition. Only `read_current` decrypts and returns active
disclosure grants. Mutation summaries from `create_join_link`, `post_join_offer`,
and `update_display_name` do not open unrelated permission text or depend on
that secure-box operation.

An unfinished child leaves the request pending. Before invocation return,
checkpoint, shutdown, fence loss, or workspace replacement, the runtime
interrupts the exact child, waits a bounded grace period, terminates only that
proven-owned process if needed, proves exit, and only then releases the
workspace. Child failure cannot interrupt or poison the resident App Server.

Assistant Ask is hard-cut across Web and the hosted runtime. Web always admits
otherwise-authorized requests; there is no producer flag or disabled protocol
mode. The first compatible runner bundle remains the rollback floor while an
Ask request or completion can remain in a mailbox or restored workspace. Roll
below that floor only after the full ten-minute request lifetime has elapsed
and pending work has drained or expired; prefer a forward fix when imported
items may remain.

The consented reverse adapter is also hard-cut with no producer flag or disabled
protocol mode. The first compatible runner bundle remains the rollback floor
while a request or completion can remain in a Web mailbox or imported runtime
state. Roll below that floor only after the full ten-minute request lifetime has
elapsed and pending work has drained or expired; prefer a forward fix when an
imported item may remain.

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
Shared accepted-message targeting is a runtime-only strict outbox-shape change,
so its reader and writer ship together in one runner bundle. Deploy Cloudflare
and that runner with `container_rollout=immediate`, and require managed-container
smoke to report the exact new runner-bundle fingerprint and prove its assistant
CLI surface contract before accepting targeted work. There is no Web ordering
dependency. A rollback to the prior bundle is safe only before the first
`nativeReplyRequested: true` intent is written. After that write, the new bundle
is the hard rollback floor because a workspace, checkpoint, or retained outbox
intent may contain the marker. Do not try to prove an incident-time drain;
forward-fix instead of adding a compatibility reader or dual writer.
Native iMessage response cards follow the same runtime-only hard-cut rule.
Deploy Cloudflare and the runner bundle together with
`container_rollout=immediate`, then require managed-container smoke to report
the exact new runner-bundle fingerprint and assistant CLI surface before card
traffic begins. Ordinary outbox records and hosted delivery side effects omit
the optional `card` field, so a new Worker with an old runner remains safe for
ordinary work; an old runner cannot produce cards. A new runner that has
written or emitted a card-bearing record or side effect must not be paired with
an old Worker. Before the first card-bearing value exists, the prior bundle is
a safe rollback. Afterward, the new bundle is the hard rollback floor for
workspaces, checkpoints, retained outbox intents, and side effects; forward-fix
instead of restoring an older reader. There is no Web deployment dependency.
Preference sparse deltas and cross-lane causal sequencing are hard-cut. Web
always produces the sequence-aware delta and supports the signed input-bound
personality transaction; there is no complete-snapshot producer or disabled
write mode. The hard-cut Web build rejects the retired direct-vault
causal-sequence action. The first sequence-aware Cloudflare consumer and that
Web build are rollback floors while preference items or personality watermarks
exist. Deploy behavior-changing consumer updates with immediate runner rollout
and prove fleet convergence; prefer a forward fix over restoring a legacy
producer or parser. Hourly mailbox retention may encounter a sequence-less
preference row that predates the hard cut and was deliberately exempted from
constraint validation because its lane sequence was already consumed.
Retention deletes that expired legacy tombstone only while it remains at or
below the authoritative consumed watermark. It never updates the row under the
new constraint or fabricates a causal sequence; current sequence-bearing rows
continue to retire in place.
For the `conversationInputAhead` checkpoint and owner-release callback rollout,
deploy Cloudflare Worker plus runner first with immediate container rollout,
wait for the managed-container smoke to prove the new bundle, then deploy web.
During the first phase the new runtime continues to understand an old web
deployment's `foreground_pending` response, and owner-release calls to an old
web deployment may fail without affecting completed work. After web deploys,
checkpoint responses may add `conversationInputAhead` and the callback can emit
the existing Temporal recheck signal. The new producer may also attach the
positive `immediateRecheckRequested` query for invocation-local schedule edges;
old producers omit it and retain owner-horizon latency. Web must therefore be
the last deploy when removing due-wake level triggering, and the first rollback.
An old runner ignores the additive checkpoint field;
durable mailbox lag and the existing owner horizon still recover the input,
although its old post-upload wake interruption may retain the extra-snapshot
latency. The versions are correctness-compatible in either direction, so either
side may be rolled back independently during this compatibility window; the
recommended order minimizes the time spent on the old latency path.
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
checkpoint replay floor. The system lane advances that floor from its
checkpointed handled-through status. At the conversation lane's successful
`idle_shutdown` checkpoint, the runtime instead carries up to 256 exact mailbox
item ids whose local inputs have terminal evidence. In the same transaction as
the accepted snapshot CAS, Web stamps `consumed_at` only on matching same-user
live `conversation.message` rows at or below the snapshot's imported watermark,
then advances `consumed_seq` only to the item immediately before the first
remaining live unstamped row. Thus a terminal item at sequence 20 cannot move
the floor across an unresolved item at sequence 19. A missing event, missing
input-to-mailbox mapping, missing row, malformed sequence, retryable reply
failure, checkpoint conflict, or transaction rollback fails closed without
acknowledging that item or crossing its gap. Status-only assistant or
canonical-runtime checkpoints never stamp conversation rows.

The local hosted pending-input index uses schema v2 for this exact-ack protocol.
Terminal conversation ids stay in the checkpointed snapshot until a later
mailbox fetch returns a `consumedSeqByLane` floor covering them; the wake probe
checks terminal evidence so those retained ids do not schedule another reply.
When more exact ids are pending than the checkpoint request cap, v2 persists a
batch cursor in the same snapshot and rotates later checkpoints through the
remaining ids. It never deletes an id merely because it was selected, so a
blocked earlier sequence cannot make the first batch permanently starve later
terminal rows.
On first compaction of a deployed v1 index, the runtime preserves every input
id that v1 still records and recovers an omitted retained event only when its
terminal evidence already proves handling completed. V1 did not record whether
an omitted nonterminal event had once been admitted and later dropped or had
always been context-only while auto-reply was unavailable. Those ambiguous
events are therefore categorically nonreplyable; enabling a channel later must
not resurrect them as stale outbound work. This fail-closed migration can leave
a bounded legacy admitted input unreplied, but it cannot send an unsolicited
historical message. Exact terminal item stamps are idempotent, and repeated
idle checkpoints safely resend them until the durable floor confirms the
accepted transaction.

Mailbox retention clears payload ciphertext in place rather than deleting an
accepted conversation gap. At the inclusive 14-day deadline, an unconsumed
conversation row receives `policy_non_reply.content_expired`, `consumed_at`, and
content-retirement metadata in the same statement that deletes its payload
sidecar and clears inline payload fields. The lane counter advances only through
the first remaining unconsumed conversation sequence; it never jumps across a
younger gap. Policy non-reply tombstones remain as durable terminal evidence,
while ordinary content-free mailbox tombstones may be pruned after their
separate structural window.

Assistant transcript retention uses only the user entry's stamped
`contentReceivedAt`. Projection `createdAt`, accepted-turn journals, and input
events are not fallback receipt owners: normal settled-snapshot cleanup may
delete the journal and input before a later retention wake. The rollout is
therefore two-phase. Phase one stamps every new user entry and preserves every
unstamped legacy entry. After immediate runner rollout is verified, operators
record the fleet-convergence instant and apply the additive mailbox migration,
which re-arms every persisted snapshot once and advances its workspace CAS
version without changing checkpoint time. Any invocation holding the prior
version must retry instead of overwriting that wake. The existing hourly cron
signals five due snapshots per successful run; each wake scrubs receipt-backed
captures, parser output, projections, inputs, and stamped transcripts while leaving the
unstamped legacy pair intact. Operators must preflight aggregate queue capacity
and may not declare phase one complete until no due snapshot remains. After 14
complete days and phase-one drain completion, a separate phase-two migration
may re-arm persisted snapshots again and the runtime may retire every remaining
unstamped user entry. Until both gates pass, fail-closed legacy scrubbing is
forbidden because it can erase recent paired conversation history
irreversibly.

Accepted Linq reply delivery carries an earlier copy of the same exact-item
consume authority:
the runtime reports
`answeredMailboxItemIds`, and the signed delivery callback stamps matching
same-user `conversation.message` rows with `HostedMailboxItem.consumedAt`.
The mailbox fetch response returns both `consumedSeqByLane` and each item's
`consumedAt`; replayed conversation items at or below the checkpoint replay
floor, or with `consumedAt != null`, are re-staged as conversation context with
a null reply target, never as fresh reply candidates. This keeps a workspace
restore or restart from re-replying to an already-handled message without a
side table or lane high-water advance past gaps. A container rollout SIGTERM
additionally makes the runtime treat the idle window as elapsed and run its
normal `idle_shutdown` checkpoint inside the termination grace period.

`handledConversationMailboxItemIds` is an additive Cloudflare-to-Web checkpoint
extension. Deploy the Cloudflare worker and runner bundle first with immediate
container rollout, verify the managed runner fingerprint, and only then deploy
Web. The old Web parser tolerates and ignores the new field, while the new
runner retains terminal local ids until `consumedSeqByLane` confirms them, so
that producer-first window is replay-safe. If Web lands first, an old runner
sends no exact ids; Web stamps none and therefore cannot repair Telegram
progress until the runner converges, but it does not infer acknowledgement from
the old local index.

The v2 pending-index envelope is not readable by the preceding v1-only runner.
The first accepted workspace snapshot containing v2 is therefore a hard runner
rollback floor for that workspace; operationally, treat the new runner bundle
as the fleet rollback floor before admitting production traffic. After that
point, Web may roll back while the v2-capable runner remains deployed, but the
runner must be forward-fixed rather than restored below this floor. Returning
to a v1-only runner requires an explicit offline workspace migration that
preserves unresolved IDs and the exact batch cursor; incident-time Web-first
rollback is not sufficient. Already-advanced server floors remain valid because
they were derived from exact row stamps in an accepted snapshot transaction.
After rollout, verify that conversation lane floors converge toward
checkpointed imported prefixes and run a Telegram reply across a controlled
reload with no duplicate reply or multi-minute stall.

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
adapter. Linq webhook ingress and Assistant Ask request/completion append
handlers may additionally fire one best-effort direct
`ensure-processing` request (Vercel OIDC, fire and forget, no retries, no
message payload). Linq first proves the committed known-checkpoint owner and
canonical live active access; Assistant Ask first completes its normal
server-bound append checks. Web always awaits the applicable Temporal
`signalWithStart`; only after Temporal accepts that durable signal does Web
start the direct ensure. An access failure or Temporal acceptance failure starts
no direct wake. This is a latency hint only, not a second durable wake authority:
accepted Linq reply delivery stamps `consumedAt` on the exact
`HostedMailboxItem`, while Assistant Ask uses deterministic request/completion
ids, mailbox dedupe, and idempotent continuation delivery. Do not add
workflow-side direct-wake flags, derived-floor SQL, or lag netting merely to
avoid harmless post-delivery no-op ensures. There is no direct
Web-to-Cloudflare message path and no second durable wake authority. Temporal
remains the sole durable retry and reconciliation owner. The existing
Temporal scheduled-reconcile
command also runs one bounded preference-handoff sweep. Web selects live
`member.preferences.updated` rows above the authoritative system-lane
`consumed_seq` for active person runtimes or synthetic room runtimes with an
active owner or current participant, then rechecks canonical runtime access and
reissues their pointer-only `signalWithStart`; the mailbox row remains the only
work record and repeated sweeps are idempotent. This is a narrow backstop for
already-committed hosted style writes from personal Settings or runtime-bound
conversation controls, not a second queue or a generic mailbox-lag scheduler.
Other missed post-commit signals still have no web cron backstop.

Hosted reply-latency telemetry records only boundaries observed by their owning
process. Its ingress `acceptedAt` value copies the mailbox row's PostgreSQL
`created_at`; because that default uses transaction-start time, the interval
from `acceptedAt` includes the remainder of the append transaction and must not
be labeled row-insert or commit latency. The web-owned `provider_started` field
means the runtime observed a local Codex `turn/start`; it is not evidence of an
upstream OpenAI request or first token. The runtime may also emit metadata-only
`assistant_milestone` events for Linq typing request start/acceptance and the
first locally observed Codex output/text. It projects
`terminal_non_reply_committed` only from the assistant engine's existing durable
`suppressed` terminal evidence for the named input set, either immediately after
that write succeeds or when a replay reads the completed evidence. That marker
is an observability projection of the existing terminal owner; it is not a
second disposition record and does not advance mailbox consumption. Web keeps
in-flight timing milestones scoped to the exact staged runtime attempt. The
terminal marker may converge across a later attempt because authenticated user,
source, and assistant input ID identify the durable disposition being projected.
Terminal convergence and deadline refreshes carry the authenticated runtime
lease generation in the existing phase document. A strictly newer generation
transfers the unresolved trace's runtime-attempt ownership, the same generation
merges monotonically for that owner, and an older generation is a no-op. This
makes a recovery terminal and its deadline converge in either callback order
while preventing a delayed callback from the prior attempt from reclaiming the
trace. The trace's current attempt may publish its own deadline before terminal
telemetry arrives; cross-attempt deadline adoption still requires terminal
evidence, so an unrelated newer attempt cannot claim a merely staged trace.
The terminal projection carries the runtime's current checkpoint-publication
expectation. Whenever later dirty work restarts the idle window, the runtime
publishes a monotonic `checkpoint_publication_expected_by` milestone across the
same fenced attempt so every earlier terminal trace observes the reset.
All milestones merge into the existing phase document under a row lock. Emission
is queued off the reply path and may retry only the bounded staging/trace-row
race; it carries no message, prompt, response, reasoning, or provider payload.
Post-generation delivery guards must never create or overwrite the local Codex
start milestone.

The existing App Server `turn-completed` diagnostic additionally carries
cumulative, assign-once local offsets from that `turn/start` write to the local
RPC acknowledgement, the `turn/started` notification that proves Codex core
began the turn task, the completion notification, and completion-trace emission
after local drains. The RPC acknowledgement and `turn/started` notification are
independent deliveries and have no guaranteed arrival order. Its provider
request ordinal joins those offsets to the existing provider-result and
reply-dispatched timing entries for the same wake; the existing assistant
milestones remain the source of truth for first local output/text. The total
completion offset ends after local dynamic-tool/progress drains; the outer
provider-result boundary remains the separate assistant turn-timing entry. None
of these fields is an upstream request-start, response-header, or first-token
boundary. The offsets retain the existing same-process `Date.now()` clock
semantics, clamp negative values to zero, and must not be used for strict
ordering assertions if the wall clock moves during a turn. The existing
Cloudflare provider-egress GET/101 durations end at the Responses WebSocket
upgrade handshake; per-turn metadata and generation events live inside frames
that the interceptor deliberately does not inspect, so those egress logs must
not be interpreted as model latency or a durable attempt/turn join.

Runner-to-Worker legacy artifact reads carry one fixed-vocabulary purpose and
one UUID correlation id per logical fetch; retries retain that same id. Both
sides log only validated purpose/correlation metadata, timing, status, and
ordinal fields, never artifact refs or bytes. The allowed purposes distinguish
workspace restore, canonical-write receipts, legacy snapshot materialization,
and workspace artifact materialization.

Repeated dirty hints while the same connection is already dirty do not append or signal
another device-sync wake; dirty coalescing remains the work-queue invariant,
and any stronger signal-delivery repair must be mailbox-wide. Redacted runtime logs
remain diagnostic evidence only; they must not be merged into checkpointed
import status for workflow completion or status projection. The narrow liveness
exception is the exact `runner.accepted_attempt_failed` event: when web receives
that metadata-only row, it may send a cooldown-throttled, payload-free
`runtime_recheck_requested` Temporal signal. That row carries the
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
The cooldown is a per-member claim on `HostedWorkspace`
(`acceptedAttemptFailureRecheckClaimedAt`), taken with one conditional update, so
concurrent first-failure callbacks produce at most one immediate recheck and
cannot all suppress each other. Recovery therefore does not depend on the
diagnostic row having been written or read back: runtime logs stay purely
diagnostic and remain subject to ordinary retention. The callback reports the
number of rows actually persisted. If account deletion removes the member
before a draining runtime's diagnostic batch arrives, Web treats only the exact
`hosted_runtime_log_user_id_fkey` failure as a successful zero-row diagnostic
drop; every other database failure remains visible.
Cloudflare only reports the accepted-attempt failure through the existing
signed runtime-log callback; it does not schedule retries or become a recovery
orchestrator.
Separately, after an exact successful completion clears the matching write
fence, Cloudflare makes at most one signed `POST` to
`/api/internal/hosted-runtime/owner-released`. The request has no body, uses a
timeout capped at two seconds, and is not retried. A known strictly future
mailbox retry continuation skips the callback unless the invocation carries the
positive `immediateRecheckRequested` edge. The callback accepts only no query or
the exact signature-bound `immediateRecheckRequested=1` query. That transient
edge means this invocation produced a default or retention schedule which it
committed but did not service; inherited and already-attempted wakes do not emit
it on the ordinary result path. Transport-loss recovery is the narrow exception:
after explicit inactive-container proof and durable workspace-version advance,
Cloudflare has lost attempt-local provenance and may conservatively emit the
edge for a recovered due default wake, causing one facts re-read. It does not do
so for a future wake. Web binds the user through the signed request. Without the edge, it
re-derives runnable mailbox lag and never treats a persisted due wake as
level-triggered signal authority. With the edge, it emits the same payload-free
`runtime_recheck_requested` signal so Temporal immediately re-reads durable
facts and either runs due work or owns the exact future timer. Future mailbox
retry continuations remain deferred to their retry time. A callback timeout,
transport failure, non-success response, or Temporal signal failure is logged
as metadata-only degradation and cannot change the completed runtime result.
This is a prompt recheck hint over the existing durable reconciliation path,
not a new work owner, queue, alarm, or signal kind.
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

`member.preferences.updated` carries a sparse canonical mutation delta, not a
replaceable snapshot. The local system mailbox keeps each imported preference
item and executes them in mailbox order. If an older item is waiting for its
retry time, later preference items remain blocked behind it; the runtime never
selects a newer preference item around that retry and never drops older pending
preference items during enqueue or checkpoint preparation. This ordering is
what preserves two adjacent changes to different personality dials without a
merge queue or second state owner.

Mailbox append also allocates one immutable per-member causal sequence under a
user-scoped transaction lock, shared by the conversation and system lanes.
That acceptance sequence, not lane import order or wall-clock time, orders
Settings deltas against conversational preference commands. System pending
items and durable conversation input records carry it to the canonical
preference owner, which stores only a per-field applied watermark. Web keeps
matching nullable per-field projection watermarks for tone, voice, Humor, Push,
Detail, and the conversational-only Unhinged dial. The four-case equality-aware rule applies at the canonical owner
and to Web's Humor, Push, Detail, and Unhinged projection: a newer sequence applies even
when the visible value is unchanged, an older sequence is a field-local stale
no-op while a fresh sibling still applies, the same sequence and value is an
idempotent retry, and the same sequence with a different value is a later
command in the same accepted turn. Web tone and voice retain their existing
watermark ordering. Tokenless v1 pending items map to sequence zero and drain;
they cannot overwrite a field whose zero-or-newer watermark is already
established.
Those watermarks live in the bounded canonical companion document
`bank/assistant-preference-mutations.json`, separate from the strict preference
value document. The canonical selector admits a bounded, cursor-ordered compound
batch. Foreground begins with the oldest fresh input in the current wake and
considers only later fresh siblings; background begins with the oldest replyable
pending input. The batch continues only across the same canonical conversation,
the same provider-native reply anchor, and exact-successor positive per-member
causal sequences. A gap, missing or legacy sequence, boundary change, or the
50-input bound ends the batch and leaves the remainder pending. During that
turn, the accepted-input boundary passes the terminal provider input id to the
private hosted style operation. The signed Web transaction binds that id to the
member's live conversation row and derives the compound turn frontier; the
model supplies neither the id nor a numeric sequence. Exact-successor proof
prevents that frontier from crossing an intervening Settings row.

Hosted style set/reset atomically updates the Web projection and requested
per-dial watermarks in that transaction and, when at least one requested dial
applies, appends a sparse
`member.preferences.updated` event with `causalOrigin: "turn"` and the derived
frontier as `preferenceCausalSeq`. The new mailbox row's own transport sequence
does not become a second intent time. Runtime handling remains the only durable
vault mutation path. Until that event is imported, the invocation keeps only
Web's accepted effective dials as a turn-scoped overlay; `show` reads canonical
vault state first and overlays those accepted current-turn results. The overlay
is cleared when the invocation completes.

`runtime.pending-effects-reconcile-requested` is the pointer-only continuation
for a trusted owner-state change that may unblock an already-persisted runtime
effect. The owner mutation and control row commit in one transaction; the row
carries only the stable approval action identity needed to select the matching
parked effect. Attachment, destination, approval outcome, and authorization stay
with their existing owners. The runtime records the control receipt and performs
bounded delivery-effect reconciliation without continuing the assistant
automation lane. Reconciliation uses an observation-only approval read that
cannot create or refresh an approval cycle; only an explicit new action request
may refresh a denied or expired cycle. The row is never authorization or outcome
truth.
Secure-action approval and denial use this shape because the exact attachment,
destination, and delivery identity remain in the runtime-owned parked intent.
When a pending vault-file action must surface an approval capability, the
assistant runtime keeps the approval owner's URL out of model context and
appends that exact hidden value only to the ephemeral delivery response. The
durable assistant transcript stores the capability-free semantic response, not
the transport-complete delivery text. A required user-visible capability also
overrides no-reply selection before the runtime persists any no-reply
suppression or completion marker. The model is not an authority for
capability-token transcription or delivery decisions.
An approved vault-file intent is also bound to its persisted provider target and
target kind at final dispatch. Linq current-home fallback cannot substitute a
different destination after approval; that intent fails before approval consume
or provider entry, and the new destination requires a fresh action identity.
One active approval cycle maps to one parked intent through a cycle-stable
approval-ID-plus-expiry transport identity. A causal outcome wake carries that
exact owner identity plus the observed approval generation, reconciles only that
owner, allowlists only it for dispatch, and does not mix unrelated due work into
the control item. A delayed wake from an older cycle cannot apply a refreshed
generation. If foreground input arrives after control-item preparation, the same
pending mailbox item is retained for the next eligible pass instead of
acknowledging an unreconciled obligation. A missing, denied, or deferred causal
owner produces no delivery effect; only the background fallback path scans its
fixed due-item bound.
The parked intent arms one pre-expiry fallback wake ten minutes before the
pending approval expires. A rejected post-commit Temporal signal is logged; the
existing outbox wake then makes Temporal re-read mailbox lag while at least five
minutes remain in the renewed authorization window. If the approval is still
pending at that fallback, normal pending reconciliation restores the expiry wake,
which provides the same margin for any decision made afterward. This reuses the
effect's existing durable timer instead of adding an approval-specific retry
queue, poller, or second handoff owner. Within a delivery boundary, that parked
fallback is transparent to later outbound work: the next wake is the earlier of
the approval fallback and the first ordinary predecessor wake, so an approval-link
reply retry is never hidden behind authorization reconciliation.
Generated-delivery staging uses an expand-then-produce rollout. The first
Cloudflare release added persisted-outbox, hosted-side-effect, retry-read, and
encrypted-checkpoint compatibility for the exact flat ref
`.runtime/operations/assistant/generated-deliveries/<filename>` while keeping the
writer closed. Only after that release reaches 100% traffic and the exact runner
fingerprint converges may the producer release let initial `send_vault_file`
preparation accept this ref.

The producer uses the runtime path only when the same assistant turn creates a
file for an already-established delivery obligation and calls `send_vault_file`.
It never moves or copies an existing, canonical, or prepare-now/maybe-later file
into staging. Generated-file sends join the existing stateful dynamic-tool chain,
so overlapping calls execute in request order and a later call cannot race file
adoption or approval against an earlier response-media update. Before the initial
descriptor is persisted, the runtime-state owner tightens the exact path's parent
directories to `0700`, rejects symlinks, non-regular files, and multiply-linked
inodes, tightens the file to `0600`, and revalidates it before the assistant
hashes or reads it. Ordinary vault-file refs are not chmodded.

The owned physical ref is derived deterministically from
`sha256([sessionId, turnId, toolCallId, ref])`, so two distinct tool calls that
reuse one friendly staging name receive distinct owned refs (no cross-send
overwrite), and an exact re-delivery of the same tool call re-derives and
idempotently re-adopts the same owned bytes. A generated send without the
provider's semantic tool-call id fails before adoption; the process-local JSON-RPC
request id is not a substitute. Adoption uses an atomic no-clobber hard link,
verifies the captured inode, removes the friendly source name, and then carries
that identity through tightening the single-link target to `0600`. The verified
target handle stays open across source unlink and chmod, so destination
delete/recreate and inode reuse cannot substitute different bytes. A safe existing
deterministic target is treated as the idempotent prior result, and an interrupted
same-inode two-link transfer is completed before normal adoption; source or
destination swaps and validation failures fail closed. Accepted limitation: this
identity is attempt-scoped. If `send_vault_file` fails after the staging file is
moved to its owned ref but before the outbox intent is persisted (approval-HTTP
failure or process death),
the model's in-turn recovery is a new provider call with a new `toolCallId` (the
App Server mints a fresh call id per Responses request), which derives a different
owned ref; the earlier owned file has no active descriptor and is pruned as
unclaimed at the next quiescent checkpoint. The exposed data is a freshly
generated, regenerable one-time artifact only — no stored user/vault data, no
already-persisted outbox intent, and the persisted awaiting-approval retry path
is unaffected. A retry-stable logical send identity that survives a replacement
provider call would require a durable send fact or an explicit identical-send
coalescing decision that no currently available input provides; this is
intentionally deferred rather than solved with a registry, sidecar, scan-based
recovery, or reconciliation loop.

Once a vault-file outbox intent is approved, it remains the delivery owner across
later conversation turns. A locally approved `pending`, `sending`, or
`retryable` intent blocks a different generated ref for the same persisted
provider target. While the local intent still says `awaiting_approval`, the send
tool reads the exact existing approval action: an observed approved result also
blocks the replacement, closing the decision-to-local-reconciliation gap. A
still-pending, denied, expired, or superseded approval does not block a distinct
new file request. The check happens before touching the new staging file or
requesting approval. This prevents a confirmation turn from replacing the
approved file identity or starting a second approval cycle while preserving
pre-decision revisions, same-turn multi-file preparation, exact-ref retries,
and different-target sends. The model contract also forbids later confirmation
turns from inspecting, replacing, or deleting the runtime-owned bytes for the
same pending send.

Idle snapshot publication already waits for foreground and background assistant
work to become quiescent. At that boundary, cleanup validates the complete direct
staging inventory and outbox state before deleting anything. Exact files remain
when their filename/content type, size, and SHA-256 match an awaiting-approval,
pending, sending, retryable, or delivery-confirmation-pending descriptor.
Terminal, changed, or orphaned direct regular files are removed before archive
planning; an orphan staging hardlink may remove only its runtime-owned link,
leaving the ordinary linked file unchanged, while an active multiply-linked file
fails closed. Nested directories, unsafe names, symlinks, special entries, or
malformed/untrusted live outbox inventory retain the entire staging set. A
malformed live record is quarantined on that pass; quarantine is terminal
operational evidence, so a later clean live-inventory pass may prune its orphan.
Cleanup emits aggregate counts and bytes only.

Once a producer can persist the hidden ref, the phase-one compatibility release
is the rollback floor while any active or retained outbox record or committed
checkpoint can contain it. Portable support bundles omit all `.runtime/**`; the
generic `exports/assistant-deliveries/**` path remains ordinary checkpointed
vault data and receives no deletion or path-specific packaging authority.
Existing global file-type exclusions still apply regardless of directory.

Hosted dynamic image generation is invocation-local background work. The tool
returns after launch so the current assistant turn can continue. Provider work
stays detached; the canonical capture save waits for an invocation boundary and
uses the existing receipt checkpoint against the latest workspace. After the
private capture is ready, the runtime upserts one trusted system input containing
its exact `vault_image` descriptor on the original route, registers that input
with the ordinary pending assistant-input index, and notifies the existing wake
signal. Normal foreground selection therefore keeps fresh conversation ahead of
the completion and owns completion retry and terminal evidence. Provider
completion starts the existing generic usage recorder without awaiting it, and
image delivery never waits for accounting or diagnostic writes. This adds no
durable image job, mailbox kind, scheduler, reservation, allowance
implementation, or image-specific usage lifecycle. Runner loss may drop
unfinished provider work.

Detached `assistant.notification.requested` work remains output-only and cannot
mutate resident conversation history or native provider resume state. A completed phone
call is delivered as an ordinary `assistant.notification.requested` system-mailbox
event: Murph composes the result in its own voice and proactively messages the
member's resolved messaging route, and may skip a non-meaningful call
(allow-send-or-skip). The result JSON is framed as untrusted provider/callee
text. At call start Web stores the trusted initiating resident-session id on the
call row for request-key idempotency only; delivery resolves its target route
from member state at completion time, so a lost or missing origin session does
not orphan the result and no pre-provider workspace checkpoint is required.
Delivery is idempotent on `phone-call-result:${callId}` via the notification
`deliveryIdempotencyKey`.

Because completion reuses the existing notification wake path, phone-call
results add no new mailbox kind, runtime consumer, or checkpoint boundary, and
there is no result-path consumer-first rollout. Apply the additive nullable
`origin_session_id` migration; it feeds only request idempotency, so legacy rows
without it still deliver. The `create_phone_call` start schema requires
`originSessionId`, so a runner-first window fails those starts closed at the old
Web endpoint — deploy Web and the runner together, or keep the window short.

Approval decisions always append the generation-scoped reconciliation wake in
the same transaction as the decision. Browser returns use a bare conversation
link; there is no legacy runtime recheck, confirmation-message fallback, or
disabled protocol mode. An old runtime is unsafe because its parser quarantines
the system row and blocks system-lane progress. The first compatible
Cloudflare/runner bundle is therefore a permanent runtime rollback floor, and
the first web bundle that serves the action-approval read route is the matching
permanent web rollback floor. Keep web at that floor or newer while the
compatible runtime or any parked local item, committed snapshot, approved row,
or in-flight reconciliation can depend on the route. Removing either floor
requires a separate migration or forward runtime that removes the dependency.
System-lane lag measures import progress, not handling progress: an imported
approval wake may still be pending in
`hosted-system-mailbox.json` and preserved in the hot workspace snapshot after
lag reaches zero. Roll Cloudflare back only to that compatible bundle or newer,
or forward-fix it. A rollback below the floor requires a separate migration and
operator proof that covers durable server rows, imported local pending items,
committed snapshots, and in-flight producers; observing zero lag alone is
insufficient.

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

An already-dormant workspace that persisted `nextWakeAt = null` before a
wake-preservation fix cannot self-start merely because the fixed runtime has
been deployed. Recover it through the same bounded maintenance surface rather
than writing workspace wake fields directly:

1. Confirm Web, Temporal, Cloudflare, and the assistant runtime are all on the
   wake-preserving deployment before producing a maintenance request.
2. Target one known affected active checkpointed workspace from
   `/ops/runtime-maintenance` and emit exactly one
   `runtime.maintenance-requested` wake as the canary.
3. Let Web append the durable system-mailbox row and signal the ordinary
   per-user Temporal workflow. The restored assistant runtime owns canonical
   automation reconciliation, overdue-occurrence policy, and the resulting
   workspace wake projection.
4. Verify the workspace version and checkpoint time advance. When eligible
   canonical work remains, verify the checkpoint projects a non-null assistant
   wake; if it does not, stop and inspect redacted runtime diagnostics instead
   of repeatedly waking or manufacturing scheduler state.
5. Repeat only for the explicitly identified affected workspaces, retaining the
   existing one-workspace canary and tiny failure-stopping batch limits.

A source-less `runtime_recheck_requested` signal is not a reseed for this
state: with no mailbox lag and no persisted wake, Web reconciliation still
projects an idle runtime. Do not add a periodic sweep, a Cloudflare alarm, a
repair table, or a direct `nextWakeAt` update. The maintenance mailbox item is
the durable handoff that admits one normal runtime pass while leaving encrypted
automation state and occurrence decisions with the assistant runtime.

The same ops page may also expose narrow hosted-runtime setup actions that reuse
existing source-of-truth services. Those actions must use the same hosted
app-session, allowlist, and same-origin mutation gate, and must delegate to the
owning service primitive rather than hand-writing persisted runtime rows. Linq
group-thread containers are no longer operator-provisioned: the Linq webhook
planner auto-provisions the thread-container route through
`ensureHostedThreadContainerRouteTx` when an attested group message arrives from
an active member through a configured, enabled managed Linq line whose health
is `healthy` or `unknown`. The webhook recipient only identifies the candidate
line; the existing `HostedLinqLine` projection grants new-route authority.
Established thread routes remain authoritative independently of current
line-pool eligibility.

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

Hosted clinical-record retrieval uses the existing per-user workflow and
system-mailbox path, not a separate Temporal workflow. Web transactionally
creates the retrieval run and appends one `clinical-records.sync-requested`
item whose payload is exactly `{runId, generation}`, then sends the ordinary
pointer-only `mailbox_appended` signal. The assistant runtime reads the run and
fetches pages only through the three signed web-control callbacks exported by
`@murphai/hosted-execution/clinical-records`; Cloudflare supplies the typed
transport adapter and owns no tokens or provider URLs. Web owns encrypted OAuth
credentials, same-base pagination, opaque cursor/request replay, terminal
reauthorization, and run state. Runtime owns finite background iteration and
the raw-first vault import, enforcing raw-manifest page and aggregate resource
caps before calling the importer. Foreground preemption records a nonterminal
hint and throws before the mailbox cursor advances, so the same generation can
resume; web must preserve its request/page progress. Raw FHIR, tokens, patient
ids, and URLs must never enter the mailbox, Temporal state, logs, or model
context.

Before due background assistant automation, the runtime may read the existing
web-owned device snapshot through provider- or source-filtered requests with
fixed result limits and project positively established active or
reconnect-required wearable state as bounded dynamic context. That projection
contains only product labels and coarse state; it excludes connection and
account identifiers, credential material, provider payloads, raw health values,
and diagnostic text. Established account state uses the shared device-sync
lifecycle predicate (`active` plus `source_confirmed`), and source-derived active
labels require a connected source. Empty, incomplete-setup, failed, or preempted
reads produce no device context and must not be interpreted as proof that the
user has no connection.

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
before returning accepted. Inside that preparation, the signed workspace read,
workspace ownership validation, and exact workspace-version fence binding
precede the runtime-store ensure and job construction. Failures in that
pre-handoff path clear the fresh fence and return `retry_later`. Because
readiness is overlapped, a failed preparation may still leave a best-effort
warm shell behind; write-fence
ownership remains the only authority to invoke or commit runtime work. The Temporal
caller sends its existing ensure-processing HTTP timeout as an internal header.
Cloudflare treats that value as an operational hint only: the foreground
pre-accept budget is clamped by Cloudflare's configured web-control timeout, and
workspace read/readiness steps are capped by the remaining budget. Accepted
background invocations begin their pending I/O before acceptance; Durable Object
`waitUntil()` is not a lifecycle mechanism and is not used.
Accepted starts and wakes return an owner recheck aligned to the
expected idle checkpoint horizon rather than a short durable-lag polling loop. A
same-version runtime fence whose child is missing remains protected by the
startup grace window. When an identity-aware direct wake proves that the exact
stored prior-version container has no active child, UserRunner immediately
compare-and-swap replaces that fence. Concurrent replacement callers converge
on the authoritative current fence record returned by the same compare-and-swap.
A wake-unconfirmed active child is not replaced; the caller retries until the
child finishes, becomes wakeable, or is no longer active.
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
While RunnerContainer still holds a transport-uncertain exact operation, a
numeric zero child-health count is not inactive proof because that read can
overtake child admission. Liveness retains the exact operation while the shell
is running. An explicit absent wake response initiates the existing exact
abort-and-stop path and becomes inactive only after that path settles; only a
verified stopped shell may clear the local operation without the abort.
For the active-wake probe, a verifiably stopped container shell
(`ctx.container.running === false`) is the same explicit no-active-child proof.
Committed-progress recovery stays in the transport-failure adapter, where the
transport outcome is the thing being reconciled. Only explicit inactive proof
may enter accepted committed-progress recovery. A newer workspace version plus
a changed, non-null checkpoint timestamp proves committed prefix progress even
when newer durable mailbox lag remains; recovery clears the exact fence and the
owner-release callback asks Temporal to process actionable remaining lag.
Version-only administrative transitions are not runtime commit proof. In
particular, retention rollout rearm advances the workspace CAS version without
changing checkpoint time, so a runtime that read the pre-rearm workspace cannot
checkpoint over the due wake and an ambiguous transport failure cannot
misclassify the migration as runtime completion. Mismatch may clear a
transport-failure fence because it proves that the active child is not the
fenced attempt. Active, unsupported, error, and timeout probe outcomes preserve
the fence regardless of whether a status read appears to show progress. Exact
successful completion clears the fence only by the matching attempt identity.
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
alarm path is limited to workspace snapshot orphan cleanup; it is not write-fence
maintenance, semantic wake, or mailbox-work scheduling. Durable mailbox lag is
durable recovery truth; when it is observed while Cloudflare still owns an
active write fence, Cloudflare may coalesce it into the active runner instead of
starting duplicate execution. The hosted runtime owns the foreground
conversation-mailbox import loop, imports late rows through the same mailbox
state/input-store path as the initial import, and then notifies the
assistant-engine active-turn controller. If the foreground wake path does not
consume or commit appended mailbox rows, Temporal/web reconciliation rechecks are
the durable recovery path rather than Cloudflare alarm inference. The workspace
runner owns every mutating mailbox path; the outer wake coordinator may only read
or prefetch mailbox state. An intermediate receipt-and-watermark checkpoint carries
the earliest continuation already owned by imported work or the committed workspace;
a terminal import does not invent one.

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
normal foreground path takes one authorized post-restore snapshot of the
conversation and system lanes, consumes the conversation slice first, and then
consumes the system slice through the existing failure-contained pre-assistant
phase. A failed mixed snapshot falls back independently by lane, so system-lane
denial or import failure cannot suppress current conversation work. Additional
system pages remain ordinary system-only fetches. This snapshot defines the
same-turn system-fact barrier: system facts accepted before the snapshot may
affect the current turn, while facts appended after it remain durable for their
normal wake or a later pass. Late conversation input continues through the
active-turn import path and retains foreground priority. Cold bootstrap and
background-only mailbox semantics are unchanged.
The runtime stages decoded conversation rows as assistant input and marks the
active invocation dirty. Foreground runtime work may defer intermediate checkpoints.
The active invocation remains dirty until the runtime-owned
idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds.
RunnerContainer never records pending checkpoint intent. Activity expiry is
cleanup-only and uses two clocks: `HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS`
controls how often an idle shell is reconsidered, while
`HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` is the post-completion conversation warm
lease. The assistant runtime observes only fresh staged conversation input or
recovered conversation input admitted to the provider. The container process
publishes that observation as a private completion watermark in its health
response. At each lifecycle expiry RunnerContainer derives the remaining lease
from that live child watermark, re-arms the platform timeout while the lease or
active work remains, and destroys the shell after expiry. Durable Object
reconstruction reads the same resident process; a replacement process starts
without inherited warmth. Replay, system-lane work, device sync, and generic
maintenance do not mint or slide the lease. An inactive old child missing the
watermark has no current conversation lease and is cleanup-eligible; its active
work count remains independently authoritative. Child health failure and the
wake-versus-destroy race retain and re-arm fail closed.
Plain-text Linq plus
attachment-free Telegram and WhatsApp input skips projection and cannot be
delayed by projection initialization or history scans. Linq links, direct email,
and attachment projection status are logged, and their artifacts remain
rebuildable best-effort state rather than a reason to take another workspace
checkpoint or create a durable retry queue. Successful attachment projection
may make raw paths, image evidence, or audio/video transcript evidence
available to the same assistant turn.
Assistant prompt preparation reads derived attachment evidence sequentially
under one 32 MiB budget for the current turn and a 16 MiB per-file limit. Hosted
artifact materialization rejects an external artifact whose declared size is
over the caller's limit before fetching its bytes. Evidence outside those
bounds remains rebuildable local state and is omitted best-effort; it must not
block an already accepted foreground turn.
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
The pre-delivery system-mailbox consistency barrier may pause that loop, but it
must resume before post-checkpoint delivery or background drains continue. A
source-less wake preempts those drains only after the resumed import proves new
conversation work; a no-progress or system-only nudge must not starve bounded
maintenance or the idle checkpoint.
The assistant engine admits the frozen same-wake compound batch before provider
start without broad hosted mailbox rediscovery. While a Codex turn is live,
later mailbox input may still be imported and staged. Its exact staged input ID
may join through the generic live-steering path only when the stored event is
the next positive causal-sequence successor and preserves the conversation,
delivery route, native reply anchor, account/audience, and group actor. A
projection-pending input is a causal barrier until the existing
projection-completion notification retries it; terminal projection failure is
still replyable through the normal fallback. Duplicate staging and
projection-completion notifications at or behind the newest queued or committed
frontier are ignored before exact-successor proof. After the provider
acknowledges `turn/steer`, Murph journals and checkpoints the accepted input
before any hosted tool effect or final delivery may proceed. Missing input, a
causal gap, a boundary change, or a missed live window remains pending for a normal later
assistant turn. Strict active-turn-targeted input still fails closed instead of
falling through, and the assistant engine does not synthesize another provider
request inside the same assistant turn. Final-delivery and hosted-tool effect
keys use the newest accepted causal input as the stable replay anchor while the
full answered-mailbox set remains attached as evidence.
When mailbox import produces or reuses a canonical write receipt, the runner
publishes the receipt-log fingerprint and the advanced imported watermark in
the same status checkpoint. That progress checkpoint is still required when
the receipt fingerprint is already durable: receipt durability proves the
canonical write, not the corresponding mailbox watermark.
Receipt replay is fail-stop for each restore attempt. The encrypted R2 reader
owns artifact failure disposition: transport, object-read, key-resolution
request, and service failures remain retryable, while a persisted object with
a malformed envelope, unavailable key ID, or deterministic decryption failure
is terminal. If a retryable read
failure reaches receipt recovery, the runtime discards that local tree and
fails the invocation without changing the durable receipt fingerprint; a later
invocation retries the same input. If the artifact failure is terminal, or if
referenced content is missing, malformed, conflicting, or fails application,
the runtime instead reloads the authoritative snapshot before admitting
foreground work.
That failed receipt batch is rejected as unauthorized recovery input and its
active fingerprint is removed; the runtime reports the degraded recovery but
does not create a repair owner or claim the rejected batch remains repairable.
A later canonical write starts from the authoritative snapshot with a fresh
receipt log, so repeated deterministic recovery failures cannot acquire
foreground authority or checkpoint partial state.
Accepted-input journaling, transcript updates, checkpoint bookkeeping,
provider-request metadata, and outbox intent creation remain on the normal
local assistant-service path. The same-reply coalescing window closes when the
bounded batch is selected before provider start; mailbox input that arrives
after that boundary remains durable staged input for a later turn.
For accepted Linq input positively identified as iMessage, or Telegram input
with a valid numeric provider message target, the prompt may show the existing
input id as an opaque `Message ref` when at least one targeting action is
eligible. Linq SMS, RCS, and unknown service types expose no ref. Exact-message
replies and reactions use one resolver that binds the ref to the current
accepted delivery context, reloads the stored input, and rechecks route,
audience, group-actor, provider-target, and action-specific authority. Provider
ids never cross into model-visible state. Reply selection annotates a normal
response; each delimiter-generated bubble persists the same true-only
`nativeReplyRequested` marker and target. Reactions remain the existing
`message-reaction` operation, and unmarked automatic replies remain flat.
Hosted Linq reply sends are idempotent when an outbox idempotency key is
present. The Linq HTTP layer may retry those POST sends on transient transport,
408, or 5xx failures, and the hosted outbox must keep such failures retryable
instead of terminal. Non-idempotent POST sends still fail closed unless the
provider confirms a safe retry contract.

This is the deploy/reset recovery contract. If a Cloudflare Durable Object,
worker isolate, or runner container resets after local mailbox staging but
before the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown`
checkpoint succeeds, the next
invocation reimports from the web-owned mailbox because the staged watermark was
never checkpointed. If reset happens after a successful final checkpoint but
before terminal handling, the next invocation must still run the assistant
phase, because replay authority comes from staged assistant input plus missing
terminal auto-reply evidence, not from mailbox import progress.

Mailbox import has no provider-visible pre-assistant side-effect phase.
Provider-visible cleanup and read acknowledgement must not run between local
mailbox staging and assistant admission. For Linq input with link parts,
attachment-bearing non-email input, and direct raw email, local inbox projection
and audio/video transcript enrichment may run after local staging and before
assistant admission because they update rebuildable local projection artifacts
and `AssistantInputEvent` projection metadata. Plain-text Linq plus
attachment-free Telegram and WhatsApp input proceeds from staging to admission
without that work.
Projection updates must not request an additional workspace checkpoint. Linq
inbound message deletion is still eventual, but it is
queued only after terminal handling evidence is durable under
`.runtime/operations/assistant/auto-reply/evidence/<captureId>.json` and is
drained through hosted provider-cleanup after the next successful runtime-owned
idle-floor workspace checkpoint. The first deferred cleanup wake is
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
limited to pre-v2 workspace refs. The bridge no longer writes foreground
working commits. Mailbox import, active-turn acceptance, assistant-runtime
commits, canonical-runtime commits, provider cleanup, system-mailbox receipts,
and pre-delivery outbox state must not enter workspace snapshot construction;
the foreground caller tripwire fails those paths before the bridge. Bootstrap
or live foreground paths must not fall back to broad foreground full snapshots,
path-scoped working deltas, legacy hot producers, Worker-body snapshot uploads,
or artifact-sidecar v2 producers. `idle_shutdown` is the only new checkpoint
snapshot producer. `canonical_runtime_commit` instead uploads exact canonical
write receipts and publishes a receipt-log ref, bounded to 64 pending entries
and 64 KiB, through a status-only workspace checkpoint that retains the prior
snapshot ref. Capacity, log shape, and payload lengths are validated before
upload. The complete immutable payload, receipt, and log artifact set then
uploads in small fixed concurrent waves; every started wave settles before a
failure returns, and the checkpoint publishes the log ref only after the whole
set succeeds. If that checkpoint has an ambiguous transport outcome, the
Cloudflare workspace port retries the identical expected-version CAS once. It
accepts a version-conflict response only when the active invocation fence still
matches and the returned workspace is the exact requested successor, including
the receipt fingerprint, snapshot ref, wake fields, and retention wake.
Cloudflare forwarding maps an unreadable successful checkpoint response to a
server error so this bounded ambiguity path remains reachable; verified
authority and fence rejections remain deterministic `401` failures. Cold
restore replays that log over the prior snapshot and marks affected context
domains dirty. The initial mailbox import uses the same canonical mailbox-write
port as later runner imports, including bootstrap lane selection and
conversation deferral. When that import performs a canonical write, the runner
publishes its receipt and imported watermark atomically before later assistant
or managed-automation writes can add dependent receipts. Restore can therefore
replay the complete canonical sequence directly over the published snapshot
without reconstructing unauthenticated local prefixes. When the restored log
is at the hard entry bound, the runtime consolidates it through an idle
snapshot before foreground mailbox or assistant work. That recovery snapshot
publishes an immediate
mailbox-continuation wake so web accepts it even when foreground conversation
rows are already pending; immediately after that snapshot, a status-only
checkpoint durably restores the prior wake projection before foreground work
or any early return, and the runner then drains any queued runtime wake. The
recovery snapshot retains the receipt-log pointer and the original prior wake
as its retry marker; only the wake-reset status checkpoint clears them, so a
crash or ambiguous failure between those checkpoints safely repeats idempotent
receipt replay and consolidation without losing or replacing that prior wake.
The two receipt-log pointer fields and three recovery-marker fields are
reserved outside the ordinary 96-field redacted-status budget at both
transport parsing and workspace persistence boundaries; ordinary status
remains capped at 96 fields.
Later idle snapshots omit the receipt-log status. The pending-log
limits bound replay work, not object
retention: encrypted owner-scoped receipt, log, and payload artifacts are not
eagerly deleted after consolidation until the artifact store has a
reference-safe owner-scoped retention primitive.
`idle_shutdown` is the snapshot boundary for warm-runner wind-down: it maps to
a direct-R2 v2 snapshot from the effective restored state, runs through the
ordinary invocation lease shortly before container sleep, and checks the lease
during the broad snapshot walk so stale idle shutdown can abort before direct
R2 upload. Before planning begins, the runtime completes the resident-Codex
background boundary described above; no snapshot may race admitted optional
enrichment or an unowned background terminal. Snapshot planning, archive
construction, upload, and publication hold the vault's canonical-write lock as
one transaction. A canonical mutation may therefore complete with its receipt
before snapshotting starts or begin after the published snapshot boundary, but
it cannot change the local canonical base
between archive collection and publication. `packages/assistant-runtime` owns
the hosted invocation bridge,
snapshot planning, diagnostics, and mailbox-import policy; Cloudflare supplies
only explicit platform capabilities such as mailbox payload decode, direct-R2
ports, and the local encrypted archive writer.

True idle-shutdown maintenance also compacts closed
`ledger/integration-ingests/YYYY/YYYY-MM.jsonl` shards in place before snapshot
planning. The core owner streams each raw shard into deterministic level-6
gzip, validates all rows and the exact decompressed byte receipt, publishes the
archive exclusively, and only then removes the raw representation. Pending
foreground work skips this pass, and a runner wake, shutdown, or 30-second pass
budget aborts it. A timeout or ordinary compaction failure is logged in
aggregate and does not suppress the checkpoint; remaining raw months are the
next pass's durable worklist. If interruption lands after archive publication
but before raw removal, startup removes the raw copy only after independently
validating an exact, newline-terminated raw/gzip match. A conflicting closed
pair fails closed before mailbox or assistant work. No compaction queue,
marker, or second persistence owner is introduced.

The portable workspace policy excludes explicit unsafe/process-local or
repair-bin material such as secrets, device-sync runtime state, parser
executable-selector config, quarantine payloads, locks, pid/socket files, global
cache/tmp, rebuildable projections, and assistant JSONL event logs. The one
derived-cache exception is the exact query SQLite triplet
`.runtime/projections/query.sqlite{,-wal,-shm}`: carrying it avoids a foreground
canonical rescan after a cold restore, while normal source-manifest validation
still discards and rebuilds stale copies. New archives use the POSIX PAX format
so canonical source-file subsecond mtimes survive restore and keep an otherwise
fresh carried manifest fresh; extraction remains format-agnostic for older
archives. No other projection is portable. Assistant
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
or snapshot pointer. Provider-native continuity remains an idle workspace
snapshot concern: if a container dies before the next idle-shutdown direct-R2
v2 snapshot, restore must still be correct from durable mailbox, exact canonical
write receipts, transcript, and assistant runtime state even if provider-native
resume optimization is unavailable.
Fresh-thread starts and stale native-resume fallback may include bounded recent
committed transcript history. That history is semantic assistant content and
must exclude runtime-owned capability URLs that were appended only for user
delivery. Primary native-resume attempts do not replay committed history into
the provider prompt, and the provider-native turn never receives those
runtime-appended URLs. Active-turn input is not serialized as provider prompt
history; it is either folded in before the first provider request, steered
through the live Codex turn, or left unaccepted for a later normal turn when it
misses the live steering window.

Browser-vault replicas are derived dashboard sidecars, not canonical workspace
state. `apps/web` assesses browser-session backstops from the latest replica
ref, the shared current projection generation, client-known ref identity, and a
bounded max-age policy; ref presence alone is never freshness. Every newly built
replica and published ref carries the shared generation marker. A missing or
mismatched marker remains readable for deploy compatibility but is always stale,
so opening any browser-vault-backed surface requests the existing refresh path.
Projection-shape or projection-interpretation changes that make older sidecars
incomplete must bump that one shared generation; feature routes must not add
their own replica-version checks. Workspace checkpoint timestamps are not
content-version signals for replica freshness. Stale session reads may still
serve a usable replica, but they must mark it stale and request refresh after the
HTTP response.
Web represents that request as ordinary low-priority runtime work only when its
freshness policy explicitly asks for it; normal nudges do not become browser-vault
refresh sweeps just because a workspace has no replica yet. Foreground work may
schedule refresh as ordinary runtime work, but workspace snapshot checkpoints
write only the workspace snapshot ref; they do not publish browser-vault
replicas.
Browser-vault replica writes require the active runtime write fence and publish
the latest replica ref separately, without changing the workspace checkpoint
version. Web and Worker/runner deploy skew stays fail-soft: Web may serve a
legacy readable replica while refresh retries, but the Worker and warm containers
should converge immediately after a generation bump so refreshes produce the
current marker instead of repeatedly publishing legacy refs. During rollback,
an older Web or Worker parser may omit the additive marker while echoing an
otherwise identical ref. The browser loader may restore only that omission from
its exact known ref or the authenticated replica payload; present mismatches and
all other immutable-field mismatches still fail closed.

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
The web checkpoint transaction evaluates workspace-version compare-and-swap
before conversation lag. If the version still matches, it commits the valid
snapshot even when a conversation row exists above the checkpoint's imported
sequence. The matching workspace-version CAS makes the request snapshot,
redacted watermarks, and wake projection one authoritative prefix; conversation
append does not mutate workspace wake state. Web therefore returns optional
`conversationInputAhead: true` without splicing an older wake pair into that
prefix. The flag is a transient observation, not a
persisted work fact or another checkpoint conflict.

A live default-mode runtime that receives `conversationInputAhead: true`
immediately runs the existing conversation import/active-turn path after
checkpoint publication. A retention-only runtime keeps its bounded lane
separation. If shutdown has started, the runtime does not consume a local wake
merely to manufacture a replacement wake, does not create a metadata-only
follow-up snapshot, and does not discard the uploaded snapshot. In both cases
the durable mailbox row remains visible to web/Temporal reconciliation, and the
post-fence owner-release callback asks the existing workflow to re-read runnable
facts promptly; deferred mailbox continuations retain their future wake. If the
runtime imported conversation input before observing shutdown and therefore
staged assistant input plus an advanced mailbox watermark, it records a due
`assistant` wake in the already-required dirty checkpoint. That wake makes the
restored staged input runnable; it is not a metadata-only handoff checkpoint.

The direct-R2 snapshot-complete bridge and runtime parser retain support for an
old web deployment's `checkpointed: false` plus
`checkpointConflictReason: "foreground_pending"` response during rollout. That
response remains a successful transport-level compatibility result and must not
be collapsed into a generic HTTP conflict. Current web no longer produces it;
post-upload local wake checks must not discard a valid snapshot on its behalf.
In production, the configured idle checkpoint delay is at least 180 seconds,
and every dirty foreground pass restarts that hard lower bound. The exact
assistant wake projected directly by the current foreground assistant phase may
run once per dirty checkpoint generation before that boundary against the warm
projected state, without entering maintenance or publishing a snapshot. A
no-progress hot attempt preserves its exact wake without replaying it again in
the same invocation; a dirty progressed attempt restarts the full idle window.
Mailbox budget exhaustion, pending durable checkpoint effects, staged durable
follow-ups, and inherited, committed, or otherwise unproven wake keys remain
checkpoint-first and do not shorten the routine floor. Shutdown does not use the
hot-service exception; it may take the separate last-chance durability
checkpoint. A restored or committed due wake may run ordinarily when the
workspace is clean, but a dirty invocation checkpoints first. A durable
checkpoint-effect follow-up still carries its real typed wake. Conversation
input actually imported and staged before a shutdown yield carries a due
assistant wake on its real dirty-state checkpoint; a bare runtime wake or
no-work mailbox notification observed during shutdown does not become a
metadata-only assistant handoff.
Routine snapshot planning, archive construction, and direct object upload remain
interruptible until canonical checkpoint publication begins. A foreground wake
aborts that pre-publication work, unwinds the snapshot session and temporary
archive, and returns to foreground import. Once canonical publication begins,
the checkpoint completes and the consumed wake is retained for immediate
post-commit foreground handling.
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
- Assistant Ask target resolution, membership-generation and origin binding,
  deterministic request/completion identity, expiry checks, and private return
  route authority; immutable consented-disclosure permissions, per-membership
  grant generations, exact-reaction consent, group return authority, and
  completion revalidation; encrypted mailbox rows remain the only durable ask
  operation state

The runtime may attach one bounded usage-notice delivery target to an assistant
usage record only when every accepted input for that provider request resolves
to the same authority-bound Linq group route. Web remains the notice-claim and
delivery owner. Missing or ambiguous target provenance is explicit and a
thread-container crossing must never derive a replacement from member home
routing.

### Runtime Owns

- mailbox import watermarks
- staged assistant input events and accepted-input journal state
- auto-reply channel state, including channel enablement, `eligibleAfter`, and terminal handling evidence
- assistant sessions, transcripts, receipts, diagnostics, and outbox intents
- same-conversation turn revision
- provider delivery and receipt/reconciliation policy
- runtime timers, assistant next wake projection, and the shared inbound
  message/media retention wake projection
- checkpoint timing
- the invocation-local one-child Assistant Ask controller, sealed target
  context builder, consented personal candidate pass, fresh outgoing reviewer,
  and exact-child abort/await lifecycle; none is durable queue state
- checkpoint snapshot policy and metrics (`direct-r2-presigned-put`, the
  512 MiB encrypted single-object and 1 GiB total plain-byte limits, encrypted byte
  size, and warning threshold)

### Cloudflare Owns

- per-user Durable Object routing
- lease/fencing generation
- alarm/fence coordination
- container invocation
- no signed usage-allow decision or live Web usage-gate callback in runner-start
  authority; Temporal consumes the web-owned member-access decision, and
  Cloudflare/runner #587 or newer is the permanent rollback floor while Web
  omits the retired callback route
- direct-R2 snapshot upload-session plumbing plus legacy encrypted
  bundle/artifact/env/journal object plumbing
- worker-to-web callback signing
- verification of signed ingress/runtime root envelopes plus Cloudflare P-256
  recipient unwrap; Cloudflare must not hold GCP KMS decrypt authority
- signed Assistant Ask Web-control transport and normal runner-container process
  hosting; Cloudflare does not own ask routing, membership, queueing, or results

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
`nextWakeAt` and `nextWakeReason`; inbound message and media retention share the
independent `inboxMediaRetentionWakeAt` field. Web does not materialize timer
rows, and Cloudflare does not persist timer work items.

If the runner needs a synthetic in-process object for logging or execution
plumbing, it may use an internal-only `runtime.timer` wake. That object is not a
persisted mailbox row unless an external product/control-plane mutation
explicitly appends one.

## Observability

`HostedRuntimeLog` is redacted observability, not correctness state. Logs may be
lossy and must not contain plaintext messages, transcripts, vault data,
provider payloads, secrets, local paths, or direct personal identifiers.
Web runs one Vercel-authenticated reply-latency monitor every five minutes over
the existing `HostedIngressLatencyTrace`, accepted `HostedLinqDelivery`, and
conversation `consumed_at` facts. The fixed product boundary is 30 seconds. A
recent accepted delivery at or above that boundary is anomalous. A trace at or
above the boundary with no accepted delivery and no durable consumed evidence
is provisionally resolved only when it has valid
`terminal_non_reply_committed` evidence and the runtime's latest
checkpoint-publication expectation has not elapsed. The expectation includes
the configured idle window plus the bounded idle-maintenance, snapshot
construction/upload, and checkpoint-control envelope. Later dirty work moves it
forward through the attempt-wide runtime milestone; a crashed runtime stops
refreshing it, so the trace becomes unresolved after the last published
expectation. The marker never pretends a reply was delivered or consumes the
mailbox item early. Missing, expired, or chronologically invalid expectation
data cannot hide still-unconsumed work. The terminal and publication-expectation
leaves alone use max-timestamp merge semantics. Every other latency leaf remains
assign-once.
Durable consumption remains the long-term terminal proof and the rolling-deploy
or best-effort-link fallback after handling is otherwise known.
Accepted grouped Linq replies keep the complete answered mailbox-item set on the
existing outbox intent: replay of the same pending or retryable effect retains
the existing set and adds newly observed items instead of replacing it. The
transition to `sending` freezes that set for the provider dispatch, and later
items receive an uncovered/retryable result rather than inheriting that intent's
terminal evidence. They remain pending until the frozen dispatch settles and a
new follow-up effect can own them. The accepted delivery links every mailbox item
carried by its dispatch; a sending or terminal outbox intent is never widened
retroactively.
One fixed-kind `HostedLinqAlert` row provides the incident claim, provider
idempotency identity, last provider-attempt boundary, and active state. A
healthy scan silently clears the claim so a later incident receives a new
identity, but preserves the last attempt/success timestamps as the cross-
incident pacing floor; the monitor does not send a potentially misleading
recovery message from aged observability data. Every provider attempt,
including an uncertain retry, is separated from the prior attempt or success
by at least ten minutes plus stable bounded jitter. Uncertain retries reuse the
exact incident body and incident-scoped provider idempotency key. That key
remains independent of mutable email configuration. Within Resend's idempotency
retention window, an identical replay deduplicates and a changed payload under
the same key fails closed instead of receiving a second send identity. The
monitor does not claim provider-side exactly-once behavior beyond that external
retention window. Separate incidents carry fresh aggregate evidence and a fresh
checked-at timestamp rather than artificial text variation. The configured
destination is the shared Resend operational-alert mailbox; the historical
`HOSTED_LINQ_ALERT_EMAIL_*` environment names remain its deployment
configuration, but the latency path never sends through or falls back to
Linq/iMessage. Its separately configured IANA operator timezone
suppresses provider sends from 11 PM through 7 AM local time. A stable per-day
delay of up to ten minutes spreads deferred alerts across more than one
five-minute cron tick instead of resuming every alert at the same quiet-hours
boundary. Detection and healthy-state transitions continue while sends are
suppressed. Before provider entry, the monitor re-reads latency health and
operator local time. Recovery or quiet hours at that boundary make no
provider-attempt state change. The subsequent singleton compare-and-swap is
fenced by the candidate row's `updatedAt` version and is the sole admission
boundary: only it enters sending state, increments attempt count, and advances
`lastAttemptedAt` immediately before Resend. The same version comparison makes
a stale recovery coalesce if another incident changed and then restored the
visible status. A known-unsent first alert therefore has no incident or pacing
boundary to carry overnight and later builds current evidence; a blocked retry
whose prior provider call may have succeeded keeps its exact incident body,
idempotency key, and real attempt time. Once a provider call has been admitted,
another healthy scan coalesces against the bounded four-minute send lease rather
than reporting recovery while delivery is still unknown. After the call settles
or fails, or after the lease expires, a healthy scan silently clears sending,
failed, or accepted active state. An admitted request may still complete.
Persisted provider failure metadata contains only the sanitized error code and
HTTP status. Persisted and delivered evidence is aggregate counts and durations
only: no message content, member, phone, chat, mailbox, delivery, or trace
identifiers. The monitor is observability-only: it does not append mailbox work,
signal Temporal, wake Cloudflare, alter usage gates, or participate in
foreground reply ownership.
Orchestration phase telemetry is interpreted causally: direct-request routing
ends at the Cloudflare route/auth stamps, Durable Object activation ends at
`userRunnerEnsureStartedAtEpochMs`, stale-fence recovery is the active-wake and
replacement-clear interval, and fresh container allocation/readiness ends at
`freshStartContainerReadyAtEpochMs`. The outer Temporal-signal-to-runner span is
not a single Temporal activity duration; the direct wake may win before the
Temporal activity begins. Replacement traces also carry same-call elapsed
scalars for the active wake and exact fence clear. Fresh-start traces carry
elapsed scalars for the sequential workspace read, runtime-store ensure, and
total invocation preparation. Fixed booleans distinguish prior-version targets
and explicit no-child results. These fields are stamped onto the existing trace
payload with no additional I/O. Prefer the same-call elapsed scalars when direct
and Temporal retries may have contributed independently merged epoch
timestamps.
Fence-attempt diagnostics remain one coherent bundle across replacement races.
When a replacement compare-and-swap loses, UserRunner drops the superseded
fence's observation, active-wake, and replacement-clear leaves before probing
the authoritative record returned by the store. The container entrypoint may
then stamp accepted/finished evidence onto that clean pending wake. At the
initial assistant-runtime import, the invocation-header seed owns overlapping
orchestration leaves; pending-wake timing and non-overlapping caller context are
still preserved. Web keeps the first populated trace leaves, so mixed-attempt
bundles must be prevented at these producer boundaries rather than repaired
after persistence.
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
