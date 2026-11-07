# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Stopping the active mailbox watcher cancels its system HTTP fetch, preserving
the system watermark for retry. Conversation imports keep their completion
boundary, and stop still joins in-flight canonical persistence or rollback.

The existing provider-start callback emits
`Hosted assistant provider-start critical path timing.` with finite nonnegative
`automationGroupAndOperationScopeMs`, `automationTerminalEvidenceMs`,
`automationSessionPreflightMs`, `automationCrossSessionContextMs`, and
`automationPromptPreparationMs` when available. These describe preparation
before reply-started, add no awaits, and also remain in the latency trace.

Current responsibilities:

- skip retired member ChatGPT-linking mailbox work before payload loading and
  discard saved pending linking work before parsing removed checkpoint records;
  preserve platform-managed and local/operator Codex authentication

- configure hosted assistant execution for OpenAI models, including managed API
  credentials, local OpenAI test stubs, and local ChatGPT subscription auth

- import each manual app meal photo once, then queue its existing mailbox item
  for a private estimation or clarification turn through ordinary model
  admission and delivery idempotency; automatic photos remain import-only
- prepare due manual meal notifications before cron preflight or a model-free
  owner handoff can end the default pass; recording device-sync continuations
  still finish through their independent checkpoint owner
- continue to due outbox delivery after idle context or receipt maintenance,
  deriving readiness from the outbox rather than an older workspace wake

- run bounded hosted workspace invocations for assistant, inbox, and device-sync work behind an explicit runtime context object
- yield system-mailbox completion during container shutdown, drain owned projection
  work, and retain checkpointed recording with its due successor wake; explicit
  host aborts and checkpoint failures remain errors
- preserve system-work admission and completion across empty runtime nudges during startup, projection discovery/delivery, browser-vault publication, recording, and snapshotting; qualify notifications through the same bounded foreground mailbox prefetch and current due-work projection, reuse that fetched batch for a real foreground handoff, and avoid qualification reads when no hint arrived
- settle independent system-work writes before a clean foreground return so late
  completion enters the existing durable checkpoint and browser publication path;
  a real projection failure retains the mailbox item and its existing retry wake
- qualify empty scheduler hints during default-owner browser publication against
  the bounded mailbox and current local work, preserving one refresh deadline
  while real foreground work and shutdown still interrupt it
- publish a device-sync completion record's retained provider cadence and
  checkpoint mailbox removal inside the same runtime admission after the exact
  completion record is durable, without another provider-free completion wake
  on the normal path; direct completion requires an accepted full
  reconciliation in that admission, zero retained jobs, and an exact active
  connection epoch; one version conflict rehydrates without re-admitting work,
  carries same-epoch provider cadence and dirty terminal evidence, and retries
  that reconciliation, while restored records repeat the full path and
  authorityless legacy or terminal records drain without a cadence write
- transfer a plain scheduled device hint during import only when a validated
  retained connection owner already covers its cadence; a recording owner's
  retained jobs and matching completion record may prove that coverage, while
  the record and retry remain unchanged until normal checkpoint publication.
  Manual refreshes, dirty webhooks, new jobs, and mismatched connection epochs
  retain ordinary admission. Import rollback restores the prior frontier.
- drain each hosted device-sync pass through one bounded worker call so
  canonical imports can safely reuse core’s process-local event identity index, while
  cumulative progress remains observable and the service-owned foreground
  yield check still runs between jobs
- run inbox media retention during existing idle checkpoint maintenance so raw inbox image/audio bytes expire at their ordinary deadline, while unprotected hosted video bytes expire immediately and stay outside every new snapshot without a separate scheduler
- run bounded post-device-sync dense raw retention through the core dense-prune primitive, logging only counts, byte totals, and tombstone totals
- build the encrypted hosted browser-vault replica from one strict canonical source snapshot, with its metric projection derived in memory instead of through local SQLite, plus schema-valid saved experiment outcomes referenced by canonical experiment frontmatter; referenced outcome bytes participate in source freshness, while invalid, escaping, missing, or mismatched references are omitted fail-closed
- keep the bounded Browser Vault refresh lifecycle inside the existing system-mailbox owner: fresh and post-effect work preserves its preparation fence, resumed Browser Vault-only recording work stays read-only until a real outcome, foreground or host preemption retains the current item, no-progress outcomes terminally advance it, and cancellation joins owned local build work before yielding
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  typed parser toolchain validation, commit timeout, and child-env projection helpers
- keep hosted execution local-runtime-first: normal hosted turns write mailbox and assistant input state into the warm container, may defer intermediate foreground checkpoints, services its projected wakes of every reason through the existing wakeable wait before the idle floor or retained-work deadline, including clean voice retention; device timers enter the existing mailbox claim owner and repeated no-progress wake keys stay bounded, and otherwise keep dirty state dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds
- prune assistant-generated delivery staging before snapshot construction when
  the outbox inventory is trusted: existing active files remain protected, a
  missing active reference is counted without blocking safe cleanup of other
  regular files, legacy nested directories are counted and retained without
  blocking independent direct files, and unsafe direct structural uncertainty
  fails closed with a bounded error code; checkpoint logs report counts and byte
  totals without paths or names
- admit only joined-group Assistant Ask requests and legacy joined-group completions through the pre-checkpoint-safe system prefix; keep consented-member requests, authenticated operator tasks, and reviewed completions checkpoint-gated, dispatch an operator task through one direct `executeOperatorDiagnostic` turn instead of the consent/reviewer composition, order a legacy completion against older personal input through the read-only pending index, and deliver typed `cannot_answer` with fixed exact copy instead of another provider turn
- before provider execution for a direct user-action turn, compare the resident session with the session ids restored from the published snapshot; when absent, including a session created earlier in the same invocation by deterministic welcome output, stop foreground mailbox watching and pause detached work while the existing full `idle_shutdown` checkpoint makes the origin durable
- accept a committed valid checkpoint's optional `conversationInputAhead` observation, import that durable conversation input immediately while the invocation remains live, and avoid post-upload snapshot discard or metadata-only shutdown resnapshot
- collect and deliver due hosted side effects from live container state without waiting for foreground hosted workspace checkpointing
- project a saved outbox retry as `assistant_delivery`, distinct from model-capable `assistant` work, so Web can admit delivery reconciliation after managed AI usage is exhausted while the existing assistant phase remains the sole delivery owner
- release foreground ownership after terminal reply delivery, abort in-flight provider cleanup when later conversation input is staged, and reserve exact automation reconciliation for canonical automation writes or maintenance wakes
- keep foreground pending-input checks read-only; incomplete indexes schedule bounded maintenance while compaction and legacy backfill remain maintenance-owned
- reject empty or unrelated system-mailbox selections from a read-only snapshot before taking the shared runtime write lock; positive selections re-read and claim current state under that lock, later arrivals stay queued for a later pass, and conversation occurrence timestamps are loaded outside the lock only after the snapshot contains an eligible foreground candidate
- apply every Web-approved sparse `member.preferences.updated` delta with that event's own cross-lane mailbox sequence, so the canonical preference owner preserves approved event order while stale-no-oping only affected fields; bounded per-field watermarks in `bank/assistant-preference-mutations.json` make replay idempotent without reservation or receipt retention
- admit one bounded, cursor-ordered batch of same-conversation, same-reply-anchor mailbox inputs only when their positive causal sequences are exact successors; pass the terminal accepted input id to hosted personality commands so Web derives the compound turn frontier from its member-bound mailbox row, and leave gaps, legacy input, overflow, and later arrivals pending
- recover late foreground input from the current invocation's exact imported-ID snapshot when best-effort active-turn notifications are early or missed; at admission, compose that recovered cursor-ordered prefix with any notified exact IDs, admit every valid same-room successor up to the existing cumulative cap, and reuse the same replyability, route, and capacity checks without scanning or mutating the broad pending index
- expose invocation-scoped automation and device authority only through narrow typed tools on the active root turn, never through Codex App Server or descendant shell env; the runtime supplies existing domain ports directly, canonical automation records remain owned by the already-bound vault, route writes use the trusted current destination rather than model-supplied locators, and the automation tool remains unavailable to scheduled turns and descendants
- keep automation occurrence projection explicit and operation-local: responses distinguish resolved timing, healthy in-flight scheduler work, and unavailable projection; only unavailable projection receives one bounded read-only readback and typed content-free diagnostics through the existing nonblocking assistant automation-detail log path, without model mediation, retries, new persistence, or a second scheduler owner
- enroll every activated member in one finite hosted onboarding follow-up independently of optional welcome delivery: activation persists canonical onboarding start once and carries any available direct route separately from the welcome, immediate route-bearing activation performs the canonical idempotent upsert, and route-less Telegram activation remains silent until ordinary managed reconciliation sees a later direct route; delayed creation preserves the activation-anchored window, transient failures reuse the activation mailbox or existing bounded managed-setup retry ladder, and completed, expired, group, or archived follow-ups stay closed; the exact current seed, PR 1203 one-shot, older recurring fingerprint, or bounded original legacy seed is reconciled without granting execution authority to editable metadata; reconciliation preserves the signup-selected daily minute or derives it from an exact one-shot's stored occurrence, and conversion durably binds that occurrence before exposing the daily schedule; the notification gets one opportunity on each of the next three local days in a stable per-member window from 1:30 PM through 2:29 PM, reserves at least 30 minutes for execution before delivery authority closes at 3:00 PM on the third day, checks canonical onboarding state before provider entry, tool execution, delivery, commit, and queued external transport without mutating it, consumes each daily opportunity after either one reply-oriented continuation or a skip, and emits metadata-only seed, reconciliation, state-source, decision, delivery, and run-outcome diagnostics
- export sanitized pending assistant-runtime issue records through the injected host platform after commit instead of persisting raw hosted diagnostics in the worker

- expose the method-based `HostedRuntimePlatform` seam that hosted apps inject at runtime
- execute `clinical-records.sync-requested` as finite, preemptible background
  work through the injected clinical-records port, keeping provider credentials
  in web and loading the clinical importer only inside that maintenance lane
- provide shared hosted runtime env sanitization so host apps can build their own launcher policy without forwarding control-plane secrets

The existing `assistant.pass_finished` diagnostic records relative wake offsets
for the phase's workspace, selected wake, and system mailbox. Non-delivery
background passes also record the already-computed automation, cron, device-sync,
outbox, and provider-cleanup candidate offsets. Null means absent or invalid;
negative means overdue. Candidate fields are omitted on paths that do not compute
them. Background progress-cause booleans distinguish wake projection changes and
provider cleanup from actual automation progress. These fields add no reads or
log events and never control scheduling or expose raw timestamps or payloads.

Refreshing an already-due wake for the same normalized reason does not by itself
count as assistant-phase progress. The selected due wake remains available to
its authorized successor; retained operator diagnostics keep the existing
detached read-only controller after checkpoint handoff. New or newly due wakes,
reason changes, future schedule changes, and real canonical, foreground, cleanup,
delivery, and usage work retain their existing checkpoint ownership.

Hosted runtime is a thin containerized runner over the same local assistant input
spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner/active turn -> accepted-input journal -> Codex
```

System-mailbox connection failures retain a finite Codex error subtype and an
optional integer HTTP status in the existing `mailbox.system_processed` warning.
The preparation result carries these fields transiently; they are never persisted
in mailbox state and do not affect acknowledgement, retry timing, or admission.
Only the four connection-loss variants known to the engine are retained; missing
or unsupported subtypes become `unknown`. The existing runtime-log reader accepts
these additive metadata fields, so old and new producers can coexist.

Conversation import and handling progress remain distinct. The imported
watermark records local staging; terminal inputs stay in the hosted pending
index until an accepted idle checkpoint stamps their exact Web-owned mailbox
rows and a later fetch confirms the resulting contiguous consumed floor. The
checkpoint lifecycle logs expose the bounded exact-item candidate count and a
boolean saying whether the selected batch contains the exact conversation
frontier, but never item identifiers. Plan/start/failure logs describe local
selection only; the finished log separately records whether Web accepted the
checkpoint. This localizes acknowledgement gaps without turning observability
into correctness state. The
v2 index rotates capped exact-id checkpoint batches with a snapshot-persisted
cursor, so an earlier unresolved sequence cannot starve later terminal rows.
V1 migration preserves recorded pending IDs and recovers omitted events only
when terminal evidence proves they are safe to acknowledge; ambiguous omitted
nonterminal history stays nonreplyable instead of becoming stale work after a
channel is enabled. V2 also carries the conservative derived
`hasImageCompletionCandidate` projection. A missing projection reads as
positive, enqueue classifies only the newly added immutable event, and existing
maintenance compaction recomputes the exact value. A negative projection lets
ordinary foreground selection skip pending-event hydration; a positive value
still exposes the complete cohort to the existing route and ordering selector.
Once an accepted snapshot contains the v2 envelope, its runner bundle is a hard
rollback floor because the preceding v1-only reader cannot restore that state.
The first snapshot containing the additive projection similarly requires the
projection-aware runner because the preceding v2 value reader is strict; deploy
this runner with immediate container rollout and use a forward fix below that
floor rather than adding a second compatibility owner for a derived hint.

Snapshot session start/complete annotations on `checkpoint.snapshot_failed`
use fixed phase allowlists. Recognized phases survive absent or invalid optional
timeouts; unknown phases are omitted. Timeout diagnostics include only
nonnegative safe integers in milliseconds, including values above 60 seconds.
This validates telemetry only and imposes no execution timeout limit.

For hosted conversation traffic, the mailbox importer is the source adapter. It
stages bounded `AssistantInputEvent` records in the warm live workspace.
Plain-text Linq plus attachment-free Telegram and WhatsApp input proceeds
directly to assistant admission without opening the inbox runtime. Linq input
with link parts retains the existing projection path. Email retains raw-message
projection for direct messages because its staged preview is bounded;
group-routed email remains intentionally raw-free. Attachment-bearing non-email
input makes one best-effort inbox projection attempt while the decoded wake is
still in memory. Staging and foreground-activity signals remain immediate.
Projection-required attachment input waits for durable available, partial, or
failed evidence before pending-index visibility and active-turn notification.
Attachment-free text and privacy-preserving group email whose raw projection is
intentionally omitted keep their immediate admission paths. Parser retries
leave projection pending, intentional cancellation leaves the mailbox watermark
unchanged, and evidence-write
failures remain retryable unless a durable read proves terminal evidence was
already preserved. This keeps raw attachment paths inspectable and available
audio/video transcripts in the input snapshot used for prompt construction.
Consecutive fresh direct Linq audio inputs may be prepared in batch-local pairs
(fixed cap two) only after inline mailbox validation, contiguous lane and causal
sequences, matching decoded conversation/reply authority, and serial input/context
staging. Each input must contain exactly one audio attachment; system-lane batches,
sidecars, durably consumed replay, mixed media, other channels, and different reply contexts retain
the serial path. The existing item budget reserves both slots before preparation.
Downloads and capture-scoped parser preparation may overlap; canonical raw capture
persistence, index/enqueue/claim operations, derived publication/attempt finalization,
and assistant evidence/pending/notification remain ordered in their existing owners.
A failure before the next raw capture stops further persistence/claims. Every
already-started download and parser preparation is joined before the inbox runtime
closes. Hosted preemption is observed after non-aborted parser finalization, not
forwarded into a claimed parse attempt. If an earlier input needs retry, a completed
sibling's local raw/derived result remains reusable on replay, but its assistant
evidence, pending visibility, and notification stay withheld behind that input.
This does not add a retry owner or strengthen the existing checkpoint/crash boundary.
Only direct Linq inputs requiring attachment evidence start best-effort typing
during preparation after durable staging. Other direct inputs wait until the
model request fires; preparation stays owned until that provider-start handoff. Group preparation stays silent; the engine may request typing only for
a held reply draft. The existing per-chat claim and refresh
loop pass to the admitted turn without another start request, even while initial
provider acceptance is pending. Typing never blocks admission. Failed staging,
self-authored input, consumed replay, disabled auto-replies, and unbound routes do
not start preparation; failed admission cancels an unclaimed handle. Attachment
evidence and canonical receipt/watermark checkpoints keep their existing gates.
Direct iMessage typing asks Web once for confirmed burst tapback coverage, after
500 ms from the first typing request, with a one-second lookup budget.
Only literal `ackCovered: true` holds the existing engine-owned typing handle;
errors, timeouts and old Web responses start typing. Final-answer start or the
30-second deadline releases it. Preparation and the turn share that decision
and deadline; receipt time is not carried by the typing delivery context.
Web's typing branch is advisory, read-only, and outside delivery locks. Roll
out Web before the runner. Disabling `HOSTED_LINQ_ACK_REACTIONS` makes new reads
uncovered; already-held handles drain on final answer, deadline or stop.
Runtime status checkpoints resolve independent pending-input, outbox,
provider-cleanup, system-mailbox and cron wake reads concurrently (at most five).
Wake selection keeps its existing precedence; every started read settles before
failure can release or replace the workspace.
The existing content-free import diagnostic may include `audioPairCount`,
`audioPairPreparationMs` (whole pair preparation wall span), and
`audioParsePreparationOverlapMs` (intersection of artifact/parse/scratch-cleanup
spans). These are not isolated transcription/download timers; summed per-input
projection timings are not batch wall time. Reply selection and prompts are unchanged.

`mailbox.imported` may also include `projectionCapturePersistMs`, the summed
successful serial capture-persistence span inside `projectionImportMs`. It includes
pipeline setup, dedupe lookup, image normalization, canonical writes, and local
index updates; it excludes connector download/normalization, inbox opening,
parser drain, evidence publication, and pending-reply admission. It is not an
isolated encoder timer. Audio-pair preparation and failed imports omit it.
The existing buffered log carries this optional numeric field without another
event, callback, or reader rollout requirement.

Ordinary video bytes remain warm-container-only: accepted input may
protect them locally while active, but snapshot planning excludes their
validated canonical paths and idle maintenance deletes them atomically as soon
as protection ends. Explicit canonical durable raw references remain outside
this transient policy. Normal foreground work may defer intermediate hosted workspace
checkpoints before Codex admission or reply delivery. While dirty, a projected
wake of any reason may run once when due before the idle floor or active
background-work deadline without publishing a snapshot. Assistant wakes require
the exact projection from the current invocation. A no-progress attempt retains
its due key without repeating local service; a successful attempt can clear it
or project a distinct successor. Otherwise the invocation
remains dirty until the runtime-owned idle-floor—or last-chance shutdown—
`idle_shutdown` checkpoint succeeds; inherited or committed assistant wakes and
durability barriers remain checkpoint-first. Successful assistant writes to the
canonical event ledger request Browser Vault publication after the reply finishes.
They use the same idle checkpoint and foreground-preemptible replica publisher,
but skip the conversation quiet window so confirmed journal changes appear
promptly. Active background work retains its existing wait and successor owners.
The canonical checkpoint still precedes projection publication. Only newly admitted foreground
priority work restarts the quiet window. Empty probes and generic maintenance
do not restart it; cleanup that dirties state after a checkpoint uses the spent
window and proceeds directly to its required follow-up checkpoint. Provider
cleanup still runs only after its saved intent, and required post-checkpoint
effects are not removed or collapsed into an unsafe single snapshot. Active
background-work waits use their existing work deadlines and remain wakeable,
without moving the conversation or checkpoint clocks. Once a checkpoint pauses
background reads, they stay paused through checkpoint retries, effect drain and
return. Foreground work still proceeds; unfinished asks and clinical extraction
retain their durable successors instead of repeatedly reclaiming canceled work.

Finite `inbox_media_retention` checkpoints run the existing transient-content
cleanup owners and publish their next deadlines. Due transaction slices and
nearby expiries share one invocation and snapshot, using the existing wakeable
wait within a fixed runner idle duration (normally ten minutes). Expiries are
serviced at their exact deadlines, never rounded later; unexpired media stays
intact. The invocation returns sooner when there is no nearby expiry, an
independent default wake is earlier, cleanup fails, or canonical receipt capacity
requires a checkpoint. Foreground wakes preempt the wait, shutdown checkpoints
its remaining deadline, and failures retain their retry. Transaction batch sizes
remain local atomic-write limits rather than mandatory invocation boundaries.
These checkpoints do not scan or compress unrelated canonical event, audit, or
integration history; ordinary idle checkpoints remain responsible for those
archives. Content eligibility, protected pending work, and retention windows
are unchanged. The separate mode and wake column remain the inactive-member
cleanup authority and keep retention independent of assistant admission.

This scheduling change is runner-image-only: Web and Worker protocol fields,
persisted deadlines, snapshot formats, and receipt limits are unchanged. Roll
out the image through the normal Worker/container release and let older warm
runners drain. Old and new Web/Worker versions accept both runner behaviors;
old runners remain correct but perform more invocations. No migration, rearm,
Web-first release, or new rollback floor is required.

Post-device-sync dense raw retention receives up to forty-five seconds within
the remaining overall device-pass budget. Time spent fetching or importing does
not consume that separate stage allowance. An exhausted overall budget, remaining
retention work, or a failure still uses the existing bounded continuation wake.

The conversation-activity callback carries the original persisted
`AssistantInputEvent.receivedAt` epoch milliseconds (mailbox `createdAt`), not
provider `occurredAt`, replay time, response time, or invocation completion.
Unknown reads retain foreground priority but emit no warmth; self-authored
responses and system notifications also emit none. A replay returns the
original persisted input receipt rather than the replay's mailbox timestamp.
The child reduces valid observations to one process-local maximum; the host
owns the separate ten-minute retention deadline. A restored due wake in a clean
workspace runs ordinarily. Discovering an already-durable device completion
journal does not make the workspace dirty before that initial pass. Replaying
the journal still saves its cleanup, while preserving the pass's current wake;
it must not restore a serviced deadline from the older workspace checkpoint.
Fresh device preparation keeps its checkpoint-before-acknowledgment barrier.
If the container dies before that checkpoint, local
runtime residue since the last accepted checkpoint can be lost. Inbox capture,
audio/video transcript work,
attachment materialization, and display/search indexes are recovery context;
they are not a hidden runtime-only admission path for Codex. Prompt construction
reads the staged assistant input event and its sanitized vault-relative
attachment evidence refs;
it does not call inbox projection at prompt time.

The checkpoint response's `conversationInputAhead` field is transient
coordination, not durable runtime state. Web has already committed the valid
workspace snapshot, redacted watermarks, and requested wake projection as one
workspace-version CAS prefix.
After device-sync provider work stages an exact single or batch dirty-processed
record, a coalesced runtime wake is revalidated against canonical conversation
and system-mailbox high waters before it can defer that record. A complete,
caught-up prefetch lets the staged record finish; newer conversation or system
work, an incomplete or failed prefetch, and a wake during exact dirty
acknowledgement retain their existing preemption behavior.
If shutdown has begun, this package leaves the newer mailbox row to the durable
web/Temporal reconciliation path instead of consuming a local wake and creating
a second metadata-only snapshot. If input was already imported and staged before
the shutdown yield, its real dirty checkpoint carries a due `assistant` wake so
restore cannot strand the staged turn. Bare wake notifications and no-work
imports do not create that wake or another checkpoint. Runtime/parser handling
for an old web deployment's `foreground_pending` response remains rollout
compatibility only.

Invocation results may include the positive-only
`immediateRecheckRequested: true` edge when this invocation produced a default
or retention schedule, committed it, and did not service it. The runtime tracks
only invocation-local exact wake keys: presenting a wake removes its key, while
a same-key continuation adds it again. Inherited or attempted no-progress wakes
do not emit the edge on the ordinary runtime result path, and known future
mailbox retry continuations stay deferred until their retry time. The Worker no
longer forwards the edge to Web. Final release wakes Temporal, which re-reads
durable workspace and mailbox facts before acting. The edge is never checkpointed.

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, worker topology, child-process launch policy, or side-effect codecs that belong in `@murphai/hosted-execution` or the host app
- replacing the canonical vault or hosted bundle model

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, `issueExportPort`, `usageRecordPort`, the read-only `planUsageToolPort` and `usageDiagnosticsPort`, the read-only `labsToolPort`, and the bounded `subscriptionToolPort`; it does not reconstruct internal URLs, inspect hostnames, default Cloudflare worker topology, or interpret billing or provider catalog state. The plan-usage and Labs ports pass through to assistant context without mutation authority; the Labs port receives only normalized facts and never a Junction credential. The subscription port is available only for private interactive input and attaches the current accepted input id before calling the host; it never exposes Stripe credentials or a general billing client.
Artifact reads require a fixed-vocabulary purpose so the host can correlate
secret-safe timing across retries without exposing a content hash or payload.
Automation-document inventory reads are bounded to small concurrent batches,
and cron occurrence projection searches eligible local dates and configured
hours/minutes while preserving DST and standard day-of-month/day-of-week
semantics.

Clinical retrieval follows the same system-mailbox ownership rule. The mailbox
contains only `{runId, generation}`. The runtime reads a bounded descriptor,
fetches one sanitized page at a time through an opaque cursor, keeps page bodies
only in memory until the raw-first vault commit, and yields between pages when
foreground input is pending. A yield records a nonterminal preemption hint and
throws so the durable mailbox row remains retryable. Family/page/byte caps make
the pass finite, and the runtime enforces the raw manifest's per-page and total
resource-count caps before import; raw FHIR is never added to a model prompt or
runtime log.

The current implementation imports its local-only assistant runtime plus the canonical vault/inbox app surfaces directly from `@murphai/assistant-engine`, and explicit operator/setup owner subpaths such as `@murphai/operator-config/operator-config`, `@murphai/operator-config/hosted-assistant-config`, and `@murphai/operator-config/text/shared`. Shared hosted execution contracts remain owned by `@murphai/hosted-execution`; this package should not re-export that surface.

Hosted runtime env/config helpers that Cloudflare needs at the app boundary export from
`@murphai/assistant-runtime/hosted-runtime-contracts` and
`@murphai/assistant-runtime/hosted-runtime-worker-contracts`. Hosted capability
membership is owned by `@murphai/hosted-execution/assistant-capabilities`, so
runtime launch/profile contracts do not re-export lower owner packages through
legacy shims. Concrete Codex app-server process lifecycle hooks remain owned by
`@murphai/assistant-engine/codex-lifecycle`. The Cloudflare container invokes
that owner before delegating to production workspace restore, so its restore
cannot validate, replace, clear, or sanitize Codex home while the prior process
is alive.
Hosted Codex keeps WebSockets enabled for the first provider attempt and sets
`stream_max_retries = 0`, so a retryable stream failure activates Codex's native
HTTPS fallback instead of spending another full stream-idle window on the same
transport. The stream idle timeout remains 90 seconds, and HTTPS requests retain
their separate request retry budget.
Host apps may still decide which env profiles are enabled and how
transport-specific URL rewriting works, but the profile key sets and runtime
manifest shape come from this package.

Hosted runner executable lookup is also package-owned: `PATH` is projected from
the canonical runner image entries plus absolute ambient extras, while forwarded
and per-user env are not allowed to override it.

System-mailbox preparation reads continuation ownership only when the requested
selection has eligible items. A selection that neither admits work nor retires
a covered hint leaves mailbox state untouched; idle housekeeping is not a reason
to rewrite the mailbox on a fresh conversation's path.

## Focused tests

Run `pnpm build:test-runtime:prepared` before invoking the package Vitest config
from a fresh checkout. Vault-share entrypoint cases use the real isolated capture
worker through its published package entrypoint; Vitest source aliases do not
compile that separate Node worker. The prepared build includes this package and
checks the compiled worker and its public import before reporting success.
The entrypoint test harness rejects a missing capture worker as soon as a
vault-share port is configured, with the package build command to run before
retrying; this avoids misleading projection-delivery timeouts.

Device import yield reasons and receipt-capacity slicing are specified in
[`agent-docs/RELIABILITY.md`](../../agent-docs/RELIABILITY.md).


### Pending reply ownership

An answered newer message does not settle an earlier unanswered input. Background
selection retains that input until its own terminal evidence or the separate
privacy content-retention limit applies. A fifteen-minute delay never settles it. Historical suppression evidence stays terminal.
Retention owns the full-store scan; selection no longer scans later chat messages
or reads their terminal evidence to infer supersession.

A selected reply's dated retry belongs to the current invocation regardless of
foreground or background selection. Both phase result paths carry that deadline
to the existing hot-wake timer. Aggregate cron, cleanup and outbox wake times do
not confer this authority; publication gates and no-progress wake keys remain.

Deferred background delivery uses the current durable-effect cancellation scope
alongside the original phase signal, including provider cleanup. A batch carrying
a current-turn reply preserves its delivery priority across scheduling wakes.
Cancellation before provider entry releases only exact prepared claims; provider
entry uncertainty and accepted receipts continue to prevent blind resend.
