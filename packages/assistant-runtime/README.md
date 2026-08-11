# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run bounded hosted workspace invocations for assistant, inbox, and device-sync work behind an explicit runtime context object
- run inbox media retention during existing idle checkpoint maintenance so old raw inbox image/audio/video bytes expire without a separate scheduler
- run bounded post-device-sync dense raw retention through the core dense-prune primitive, logging only counts, byte totals, and tombstone totals
- build the encrypted hosted browser-vault replica from generic canonical query sources plus schema-valid saved experiment outcomes referenced by canonical experiment frontmatter; referenced outcome bytes participate in source freshness, while invalid, escaping, missing, or mismatched references are omitted fail-closed
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  typed parser toolchain validation, commit timeout, and child-env projection helpers
- keep hosted execution local-runtime-first: normal hosted turns write mailbox and assistant input state into the warm container, may defer intermediate foreground checkpoints, may hot-service only the exact assistant wake projected by the current foreground phase before the idle floor, and otherwise keep dirty state dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds
- admit only joined-group Assistant Ask requests and legacy joined-group completions through the pre-checkpoint-safe system prefix; keep consented requests and reviewed completions checkpoint-gated, order a legacy completion against older personal input through the read-only pending index, and deliver typed `cannot_answer` with fixed exact copy instead of another provider turn
- before provider execution for a direct user-action turn, compare the resident session with the session ids restored from the published snapshot; when absent, including a session created earlier in the same invocation by deterministic welcome output, stop foreground mailbox watching and pause detached work while the existing full `idle_shutdown` checkpoint makes the origin durable
- accept a committed valid checkpoint's optional `conversationInputAhead` observation, import that durable conversation input immediately while the invocation remains live, and avoid post-upload snapshot discard or metadata-only shutdown resnapshot
- collect and deliver due hosted side effects from live container state without waiting for foreground hosted workspace checkpointing
- release foreground ownership after terminal reply delivery, abort in-flight provider cleanup when later conversation input is staged, and reserve exact automation reconciliation for canonical automation writes or maintenance wakes
- keep foreground pending-input checks read-only; incomplete indexes schedule bounded maintenance while compaction and legacy backfill remain maintenance-owned
- apply every Web-approved sparse `member.preferences.updated` delta with that event's own cross-lane mailbox sequence, so the canonical preference owner preserves approved event order while stale-no-oping only affected fields; bounded per-field watermarks in `bank/assistant-preference-mutations.json` make replay idempotent without reservation or receipt retention
- admit one bounded, cursor-ordered batch of same-conversation, same-reply-anchor mailbox inputs only when their positive causal sequences are exact successors; pass the terminal accepted input id to hosted personality commands so Web derives the compound turn frontier from its member-bound mailbox row, and leave gaps, legacy input, overflow, and later arrivals pending
- re-read Web's effective core-provider choice immediately before every
  target-owned provider entry: resident accepted input, joined-group Assistant
  Ask, consented private candidate, and private disclosure review; a missing or
  invalid owner response uses the existing typed retry, while a mismatch closes
  detached work in the stale invocation, requeues any claimed ask through its
  existing encrypted mailbox with no delay, suppresses provider-backed idle
  compaction, and forces the dirty checkpoint and fresh invocation without
  consuming the input
- expose invocation-scoped automation and device authority only through narrow typed tools on the active root turn, never through Codex App Server or descendant shell env; the runtime supplies existing domain ports directly, canonical automation records remain owned by the already-bound vault, route writes use the trusted current destination rather than model-supplied locators, the structured group-newsletter write accepts only current group routes and system-owned delivery configuration, and the automation tool remains unavailable to scheduled turns and descendants
- seed one finite hosted signup onboarding follow-up after successful signup welcome delivery; the exact current seed, PR 1203 one-shot, older recurring fingerprint, or bounded original legacy seed is reconciled without granting execution authority to editable metadata; reconciliation preserves the signup-selected daily minute or derives it from an exact one-shot's stored occurrence, and conversion durably binds that occurrence before exposing the daily schedule; the notification gets one opportunity on each of the next three local days in a stable per-member window from 1:30 PM through 2:29 PM, reserves at least 30 minutes for execution before delivery authority closes at 3:00 PM on the third day, checks canonical onboarding state before provider entry, tool execution, delivery, commit, and queued external transport without mutating it, consumes each daily opportunity after either one reply-oriented continuation or a skip, and emits metadata-only seed, reconciliation, state-source, decision, delivery, and run-outcome diagnostics
- export sanitized pending assistant-runtime issue records through the injected host platform after commit instead of persisting raw hosted diagnostics in the worker
- expose the method-based `HostedRuntimePlatform` seam that hosted apps inject at runtime
- execute `clinical-records.sync-requested` as finite, preemptible background
  work through the injected clinical-records port, keeping provider credentials
  in web and loading the clinical importer only inside that maintenance lane
- provide shared hosted runtime env sanitization so host apps can build their own launcher policy without forwarding control-plane secrets

Hosted runtime is a thin containerized runner over the same local assistant input
spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner/active turn -> accepted-input journal -> Codex
```

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
channel is enabled. Once an accepted snapshot contains the v2 envelope, its
runner bundle is a hard rollback floor because the preceding v1-only reader
cannot restore that state.

For hosted conversation traffic, the mailbox importer is the source adapter. It
stages bounded `AssistantInputEvent` records in the warm live workspace.
Plain-text Linq plus attachment-free Telegram and WhatsApp input proceeds
directly to assistant admission without opening the inbox runtime. Linq input
with link parts retains the existing projection path. Email retains raw-message
projection for direct messages because its staged preview is bounded;
group-routed email remains intentionally raw-free. Attachment-bearing non-email
input makes one best-effort inbox projection attempt while the decoded wake is
still in memory so raw attachment paths remain inspectable and audio/video
transcription jobs can drain before prompt construction when parser output is
available. Normal foreground work may defer intermediate hosted workspace
checkpoints before Codex admission or reply delivery. While dirty, the exact
assistant wake projected by the current foreground phase may run once when due
before the idle floor without publishing a snapshot. Otherwise the invocation
remains dirty until the runtime-owned idle-floor—or last-chance shutdown—
`idle_shutdown` checkpoint succeeds; inherited or committed wakes and
durability barriers remain checkpoint-first. A restored due wake in a clean
workspace runs ordinarily. If the container dies before that checkpoint, local
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
mailbox retry continuations stay deferred until their retry time. If the
Cloudflare caller loses that result after explicit inactive-container proof, it
may conservatively reconstruct the edge for a recovered due committed wake
because invocation-local provenance is no longer available. The edge is never
checkpointed; Temporal re-reads the durable workspace and mailbox facts before
acting.

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, worker topology, child-process launch policy, or side-effect codecs that belong in `@murphai/hosted-execution` or the host app
- replacing the canonical vault or hosted bundle model

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, `issueExportPort`, `usageRecordPort`, the read-only `planUsageToolPort`, the read-only `labsToolPort`, and the bounded `subscriptionToolPort`; it does not reconstruct internal URLs, inspect hostnames, default Cloudflare worker topology, or interpret billing or provider catalog state. The plan-usage and Labs ports pass through to assistant context without mutation authority; the Labs port receives only normalized facts and never a Junction credential. The subscription port is available only for private interactive input and attaches the current accepted input id before calling the host; it never exposes Stripe credentials or a general billing client.
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
`@murphai/assistant-engine/codex-lifecycle`.
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
