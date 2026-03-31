# `@murph/assistant-runtime`

Headless hosted/runtime surface for Murph assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the published `murph` CLI package.

Current responsibilities:

- run one-shot hosted assistant/inbox/parser/device-sync/share-import passes behind an explicit runtime context object
- collect due hosted side effects before the durable commit, then resume their post-commit delivery from committed state
- provide an isolated child-process execution helper so per-user env overrides do not force container-wide request serialization
- expose runtime-owned hosted execution helpers such as the one-shot runner and hosted email worker client

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- owning shared hosted execution contracts, callback hosts, or side-effect codecs that belong in `@murph/hosted-execution`
- replacing the canonical vault or hosted bundle model

The current implementation imports its local-only assistant, inbox, vault, and operator-config seams directly through `@murph/assistant-core`, so hosted runtimes use the same single headless boundary as the local daemon without depending on a legacy CLI compatibility path. Shared hosted execution contracts remain owned by `@murph/hosted-execution`; this package should not re-export that surface.
