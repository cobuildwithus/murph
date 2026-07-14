# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run bounded hosted workspace invocations for assistant, inbox, and device-sync work behind an explicit runtime context object
- run inbox media retention during existing idle checkpoint maintenance so old raw inbox image/audio/video bytes expire without a separate scheduler
- run bounded post-device-sync dense raw retention through the core dense-prune primitive, logging only counts, byte totals, and tombstone totals
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  typed parser toolchain validation, commit timeout, and child-env projection helpers
- keep hosted execution local-runtime-first: normal hosted turns write mailbox and assistant input state into the warm container, may defer intermediate foreground checkpoints, and keep dirty state dirty until the runtime-owned idle/scheduled-wake `idle_shutdown` checkpoint succeeds
- accept a committed valid checkpoint's optional `conversationInputAhead` observation, import that durable conversation input immediately while the invocation remains live, and avoid post-upload snapshot discard or metadata-only shutdown resnapshot
- collect and deliver due hosted side effects from live container state without waiting for foreground hosted workspace checkpointing
- apply every `member.preferences.updated` system-mailbox delta in mailbox order, carrying the mailbox owner's cross-lane causal sequence so the canonical preference owner stale-no-ops only fields superseded by newer accepted intent while current siblings still apply; bounded per-field watermarks in `bank/assistant-preference-mutations.json` make replay idempotent without reservation or receipt retention
- admit at most one mailbox-backed input per hosted provider turn and pass its exact causal sequence directly to hosted personality commands at the accepted-input boundary, leaving later inputs pending rather than steering across causal anchors
- seed the hosted signup onboarding follow-up automation after successful signup welcome delivery; its first run is deferred until the next local day, then the scheduled assistant checks onboarding resume context and archives the automation once onboarding is complete
- export sanitized pending assistant-runtime issue records through the injected host platform after commit instead of persisting raw hosted diagnostics in the worker
- expose the method-based `HostedRuntimePlatform` seam that hosted apps inject at runtime
- provide shared hosted runtime env sanitization so host apps can build their own launcher policy without forwarding control-plane secrets

Hosted runtime is a thin containerized runner over the same local assistant input
spine used by local automation:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner/active turn -> accepted-input journal -> Codex
```

For hosted conversation traffic, the mailbox importer is the source adapter. It
stages bounded `AssistantInputEvent` records in the warm live workspace.
Attachment-free Linq, Telegram, and WhatsApp input proceeds directly to
assistant admission without opening the inbox runtime. Email retains raw-message
projection for direct messages because its staged preview is bounded;
group-routed email remains intentionally raw-free. Attachment-bearing non-email
input makes one best-effort inbox projection attempt while the decoded wake is
still in memory so raw attachment paths remain inspectable and audio/video
transcription jobs can drain before prompt construction when parser output is
available. Normal foreground work may defer intermediate hosted workspace
checkpoints before Codex admission or reply delivery. The active invocation
remains dirty until the runtime-owned idle/scheduled-wake
`idle_shutdown` checkpoint succeeds; if the container dies before that
checkpoint, local runtime residue since the last accepted checkpoint can be
lost. Inbox capture, audio/video transcript work,
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

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, `issueExportPort`, `usageRecordPort`, and the read-only `planUsageToolPort`; it does not reconstruct internal URLs, inspect hostnames, default Cloudflare worker topology, or interpret billing state. The plan-usage port passes through to assistant context without mutation authority.

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
