# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run bounded hosted workspace invocations for assistant, inbox, and device-sync work behind an explicit runtime context object
- run bounded post-device-sync dense raw retention through the core dense-prune primitive, logging only counts, byte totals, and tombstone totals
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  typed parser toolchain validation, commit timeout, and child-env projection helpers
- keep hosted execution local-runtime-first: normal hosted turns write mailbox and assistant input state into the warm container, may defer intermediate foreground checkpoints, and keep dirty state dirty until the runtime-owned idle/scheduled-wake `idle_shutdown` checkpoint succeeds
- collect and deliver due hosted side effects from live container state without waiting for foreground hosted workspace checkpointing
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
stages bounded `AssistantInputEvent` records in the warm live workspace, then
makes one best-effort inbox projection attempt while the decoded wake is still
in memory. That projection preserves raw attachment paths for inspectable files
and drains only audio/video transcription jobs before prompt construction when
media parser output is available. Normal foreground work may defer intermediate hosted workspace
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

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, worker topology, child-process launch policy, or side-effect codecs that belong in `@murphai/hosted-execution` or the host app
- replacing the canonical vault or hosted bundle model

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, `issueExportPort`, and `usageRecordPort`; it does not reconstruct internal URLs, inspect hostnames, or default Cloudflare worker topology.

The current implementation imports its local-only assistant runtime plus the canonical vault/inbox app surfaces directly from `@murphai/assistant-engine`, and explicit operator/setup owner subpaths such as `@murphai/operator-config/operator-config`, `@murphai/operator-config/hosted-assistant-config`, and `@murphai/operator-config/text/shared`. Shared hosted execution contracts remain owned by `@murphai/hosted-execution`; this package should not re-export that surface.

Hosted runtime env/config helpers that Cloudflare needs at the app boundary export from
`@murphai/assistant-runtime/hosted-assistant-env` and
`@murphai/assistant-runtime/hosted-runtime-contracts`, so hosted apps do not need
to reach into lower owner packages for runtime launch/profile contracts. Concrete
Codex app-server process lifecycle hooks remain owned by `@murphai/assistant-engine/codex-lifecycle`.
Host apps may still decide which env profiles are enabled and how
transport-specific URL rewriting works, but the profile key sets and runtime
manifest shape come from this package.

Hosted runner executable lookup is also package-owned: `PATH` is projected from
the canonical runner image entries plus absolute ambient extras, while forwarded
and per-user env are not allowed to override it.
