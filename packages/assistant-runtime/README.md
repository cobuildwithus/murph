# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run bounded hosted workspace invocations for assistant, inbox, and device-sync work behind an explicit runtime context object
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  typed parser toolchain validation, commit timeout, and child-env projection helpers
- keep hosted execution local-runtime-first: normal hosted turns write mailbox and assistant input state into the warm container and defer hosted workspace checkpointing to idle/background persistence
- collect and deliver due hosted side effects from live container state without waiting for foreground hosted workspace checkpointing
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
in memory. Normal foreground turns do not wait for hosted workspace
checkpointing before Codex admission or reply delivery; if the container dies
before the next idle/background checkpoint, local runtime residue since the last
checkpoint can be lost. Inbox capture, parser work, attachment materialization,
and display/search indexes are recovery context; they are not a hidden
runtime-only admission path for Codex. Prompt construction reads the staged
assistant input event and its sanitized vault-relative attachment evidence refs;
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
to reach into lower owner packages directly. Host apps may still decide which env
profiles are enabled and how transport-specific URL rewriting works, but the
profile key sets and runtime manifest shape come from this package.
