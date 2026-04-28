# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run one-shot hosted assistant/inbox/device-sync/vault-sync-import passes behind an explicit runtime context object
- own the canonical hosted runtime launch spec: semantic env split,
  forwarded env profiles, platform-only runtime config, typed resolved config,
  commit timeout, and child-env projection helpers
- keep `conversation.message` ingestion capture-scoped, including inline parser draining and same-run local maintenance without materializing web-owned follow-up wakes
- collect due hosted side effects before the durable commit, then resume their post-commit delivery from committed state
- export sanitized pending assistant-runtime issue records through the injected host platform after commit instead of persisting raw hosted diagnostics in the worker
- expose the method-based `HostedRuntimePlatform` seam that hosted apps inject at runtime
- provide shared hosted runtime env sanitization so host apps can build their own launcher policy without forwarding control-plane secrets

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, worker topology, child-process launch policy, or side-effect codecs that belong in `@murphai/hosted-execution` or the host app
- replacing the canonical vault or hosted bundle model

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, `issueExportPort`, and `usageExportPort`; it does not reconstruct internal URLs, inspect hostnames, or default Cloudflare worker topology.

The current implementation imports its local-only assistant runtime plus the canonical vault/inbox app surfaces directly from `@murphai/assistant-engine`, and explicit operator/setup owner subpaths such as `@murphai/operator-config/operator-config`, `@murphai/operator-config/hosted-assistant-config`, and `@murphai/operator-config/text/shared`. Shared hosted execution contracts remain owned by `@murphai/hosted-execution`; this package should not re-export that surface.

Hosted runtime env/config helpers that Cloudflare needs at the app boundary export from
`@murphai/assistant-runtime/hosted-assistant-env` and
`@murphai/assistant-runtime/hosted-runtime-contracts`, so hosted apps do not need
to reach into lower owner packages directly. Host apps may still decide which env
profiles are enabled and how transport-specific URL rewriting works, but the
profile key sets and runtime manifest shape come from this package.
