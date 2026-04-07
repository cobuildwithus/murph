# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run one-shot hosted assistant/inbox/parser/device-sync/share-import passes behind an explicit runtime context object
- collect due hosted side effects before the durable commit, then resume their post-commit delivery from committed state
- expose the method-based `HostedRuntimePlatform` seam that hosted apps inject at runtime
- provide the generic child-launcher env helpers that hosted apps use when they own isolated runner process lifecycle

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, worker topology, or side-effect codecs that belong in `@murphai/hosted-execution` or the host app
- replacing the canonical vault or hosted bundle model

`HostedRuntimePlatform` is the only hosted transport seam this package expects. Runtime code talks to semantic capabilities such as `artifactStore`, `effectsPort`, `deviceSyncPort`, and `usageExportPort`; it does not reconstruct internal URLs, inspect hostnames, or default Cloudflare worker topology.

The current implementation imports its local-only assistant runtime plus the canonical vault/inbox app surfaces directly from `@murphai/assistant-engine`, and explicit operator/setup owner subpaths such as `@murphai/operator-config/operator-config`, `@murphai/operator-config/hosted-assistant-config`, and `@murphai/operator-config/text/shared`. Shared hosted execution contracts remain owned by `@murphai/hosted-execution`; this package should not re-export that surface.

Hosted runtime env/config helpers that Cloudflare needs at the app boundary now export from `@murphai/assistant-runtime/hosted-assistant-env` so hosted apps do not need to reach into lower owner packages directly.
