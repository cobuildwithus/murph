# `@murphai/assistant-runtime`

Workspace-private headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the public `@murphai/murph` CLI package.

Current responsibilities:

- run one-shot hosted assistant/inbox/parser/device-sync/share-import passes behind an explicit runtime context object
- collect due hosted side effects before the durable commit, then resume their post-commit delivery from committed state
- provide an isolated child-process execution helper so per-user env overrides do not force container-wide request serialization
- expose runtime-owned hosted execution helpers such as the one-shot runner and hosted email worker client

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, callback hosts, or side-effect codecs that belong in `@murphai/hosted-execution`
- replacing the canonical vault or hosted bundle model

The current implementation imports its local-only assistant runtime from `@murphai/assistant-engine`, vault/inbox app surfaces from `@murphai/vault-inbox`, and operator/setup config seams from `@murphai/operator-config`. Shared hosted execution contracts remain owned by `@murphai/hosted-execution`; this package should not re-export that surface.

Hosted runtime env/config helpers that Cloudflare needs at the app boundary now export from `@murphai/assistant-runtime/hosted-assistant-env` so hosted apps do not need to reach into lower owner packages directly.
